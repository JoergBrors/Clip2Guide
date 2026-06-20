"""
Projektarchiv-Service: ZIP Export/Import fuer Clip2Guide-Projektstaende.
"""
from __future__ import annotations

import hashlib
import json
import shutil
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings


class ProjectArchiveService:
    """Sichert und restauriert Workspace-Artefakte eines Projekts."""

    _ZIP_ROOT = "clip2guide-project"
    _SCHEMA_VERSION = "1.0"
    _MAX_IMPORT_SIZE = 2 * 1024 * 1024 * 1024
    _ALLOWED_PREFIXES = ("ai-output/", "frames/", "uploads/", "normalized/", "cut/", "output/", "metadata/", "session/")

    def export_project(self, video_id: str, include_session: bool = True) -> dict[str, Any]:
        output_dir = settings.render_output_dir / video_id
        output_dir.mkdir(parents=True, exist_ok=True)
        zip_path = output_dir / f"project_{video_id}.zip"
        tmp_dir = settings.workspace_root / "tmp" / "project-exports"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = tmp_dir / f"project_{video_id}_{uuid.uuid4().hex}.zip"
        files: list[dict[str, Any]] = []

        try:
            with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                self._add_project_files(zf, video_id, files)
                if include_session:
                    self._add_ki_session(zf, video_id, files)
                manifest = self._build_manifest(video_id, files)
                manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
                zf.writestr(f"{self._ZIP_ROOT}/manifest.json", manifest_bytes)
                export_info = {
                    "exported_at": manifest["exported_at"],
                    "original_video_id": video_id,
                    "workspace_root": str(settings.workspace_root),
                }
                zf.writestr(
                    f"{self._ZIP_ROOT}/metadata/export_info.json",
                    json.dumps(export_info, ensure_ascii=False, indent=2).encode("utf-8"),
                )
            try:
                tmp_path.replace(zip_path)
            except PermissionError:
                zip_path.unlink(missing_ok=True)
                tmp_path.replace(zip_path)
        finally:
            if tmp_path.exists():
                tmp_path.unlink()

        return {
            "video_id": video_id,
            "filename": zip_path.name,
            "path": str(zip_path),
            "message": "Projektstand exportiert",
        }

    def import_project(self, zip_path: Path, restore_mode: str = "new_id") -> dict[str, Any]:
        if restore_mode not in ("new_id", "overwrite"):
            raise ValueError("restore_mode muss 'new_id' oder 'overwrite' sein.")
        if zip_path.stat().st_size > self._MAX_IMPORT_SIZE:
            raise ValueError("ZIP-Datei ist zu gross.")

        with zipfile.ZipFile(zip_path, "r") as zf:
            self._validate_zip_members(zf)
            manifest = self._read_manifest(zf)
            original_video_id = str(manifest.get("original_video_id") or "")
            if not original_video_id:
                raise ValueError("Manifest enthaelt keine original_video_id.")
            target_video_id = original_video_id if restore_mode == "overwrite" else str(uuid.uuid4())
            restored = 0

            for info in zf.infolist():
                rel = self._archive_rel_path(info.filename)
                if rel is None or info.is_dir() or rel in ("manifest.json", "metadata/export_info.json"):
                    continue
                # Session-Datei nicht als Datei extrahieren — wird separat in RAM geladen
                if rel == "session/ki_session.json":
                    continue
                self._verify_manifest_hash(zf, rel, manifest)
                target = self._target_path_for(rel, target_video_id)
                if target is None:
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info, "r") as src, target.open("wb") as dst:
                    shutil.copyfileobj(src, dst)
                restored += 1

            session_restored = self._restore_ki_session(zf, target_video_id, original_video_id)

        self._rewrite_imported_ids(target_video_id)
        return {
            "video_id": target_video_id,
            "original_video_id": original_video_id,
            "restored_files": restored,
            "session_restored": session_restored,
            "message": "Projektstand wiederhergestellt",
        }

    def _add_ki_session(self, zf: zipfile.ZipFile, video_id: str, files: list[dict[str, Any]]) -> None:
        """Serialisiert die In-Memory-KI-Session und fügt sie ins ZIP ein."""
        from app.services.session_store import session_store
        session = session_store.get(video_id)
        if session is None:
            return
        data = session.to_archive_dict()
        raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        archive_name = f"{self._ZIP_ROOT}/session/ki_session.json"
        zf.writestr(archive_name, raw)
        import hashlib as _hashlib
        files.append({
            "type": "session",
            "path": "session/ki_session.json",
            "sha256": _hashlib.sha256(raw).hexdigest(),
            "size": len(raw),
        })

    def _restore_ki_session(
        self,
        zf: zipfile.ZipFile,
        target_video_id: str,
        original_video_id: str,
    ) -> bool:
        """Lädt die KI-Session aus dem ZIP und stellt sie im session_store wieder her."""
        session_arc = f"{self._ZIP_ROOT}/session/ki_session.json"
        if session_arc not in zf.namelist():
            return False
        try:
            from app.services.session_store import session_store, KiSession
            raw = zf.read(session_arc)
            data = json.loads(raw.decode("utf-8"))
            if data.get("schema") != "ki_session_v1":
                return False
            # video_id auf neue ID umschreiben
            data["video_id"] = target_video_id
            session = KiSession.from_archive_dict(data)
            session_store.restore(session)
            return True
        except Exception:
            return False

    def _add_project_files(self, zf: zipfile.ZipFile, video_id: str, files: list[dict[str, Any]]) -> None:
        ai_dir = settings.ai_output_dir / video_id
        self._add_dir(zf, ai_dir, "ai-output", files)
        self._add_dir(zf, settings.frames_dir / video_id, "frames", files)
        self._add_dir(zf, settings.render_output_dir / video_id, "output", files, exclude_project_zips=True)

        for upload in sorted(settings.upload_dir.glob(f"{video_id}.*")):
            if upload.is_file():
                self._add_file(zf, upload, f"uploads/original{upload.suffix}", files)
        normalized = settings.normalized_dir / f"{video_id}.mp4"
        if normalized.exists():
            self._add_file(zf, normalized, "normalized/video.mp4", files)
        cut = settings.cut_dir / f"{video_id}.mp4"
        if cut.exists():
            self._add_file(zf, cut, "cut/video.mp4", files)

    def _add_dir(
        self,
        zf: zipfile.ZipFile,
        src_dir: Path,
        archive_dir: str,
        files: list[dict[str, Any]],
        exclude_project_zips: bool = False,
    ) -> None:
        if not src_dir.exists():
            return
        for path in sorted(p for p in src_dir.rglob("*") if p.is_file()):
            if exclude_project_zips and path.name.startswith("project_") and path.suffix.lower() == ".zip":
                continue
            rel = path.relative_to(src_dir).as_posix()
            self._add_file(zf, path, f"{archive_dir}/{rel}", files)

    def _add_file(self, zf: zipfile.ZipFile, src: Path, rel: str, files: list[dict[str, Any]]) -> None:
        archive_name = f"{self._ZIP_ROOT}/{rel}"
        compress_type = zipfile.ZIP_STORED if src.suffix.lower() in {
            ".mp4", ".mov", ".avi", ".mkv", ".webm", ".jpg", ".jpeg", ".png", ".webp", ".docx", ".zip",
        } else zipfile.ZIP_DEFLATED
        zf.write(src, archive_name, compress_type=compress_type)
        files.append({
            "type": rel.split("/", 1)[0],
            "path": rel,
            "sha256": self._sha256_file(src),
            "size": src.stat().st_size,
        })

    def _build_manifest(self, video_id: str, files: list[dict[str, Any]]) -> dict[str, Any]:
        storyboard_path = settings.ai_output_dir / video_id / "storyboard.json"
        frame_stack_path = settings.ai_output_dir / video_id / "frame_stack.json"
        storyboard = self._read_json(storyboard_path)
        frame_stack = self._read_json(frame_stack_path)
        return {
            "schema_version": self._SCHEMA_VERSION,
            "app": "Clip2Guide",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "original_video_id": video_id,
            "project_title": Path(str(storyboard.get("source_video", video_id))).name,
            "languages": storyboard.get("languages", []),
            "files": files,
            "metadata": {
                "source_video": storyboard.get("source_video", ""),
                "scene_count": len(storyboard.get("scenes", [])),
                "frame_count": int(frame_stack.get("total_frames", 0) or 0),
            },
        }

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def _validate_zip_members(self, zf: zipfile.ZipFile) -> None:
        names = zf.namelist()
        if f"{self._ZIP_ROOT}/manifest.json" not in names:
            raise ValueError("Manifest fehlt im ZIP.")
        for name in names:
            rel = self._archive_rel_path(name)
            if rel is None:
                if name.rstrip("/") == self._ZIP_ROOT:
                    continue
                raise ValueError(f"Ungueltiger ZIP-Pfad: {name}")
            if rel == "manifest.json":
                continue
            if Path(rel).is_absolute() or ".." in Path(rel).parts:
                raise ValueError(f"Unsicherer ZIP-Pfad: {name}")
            if not rel.startswith(self._ALLOWED_PREFIXES):
                raise ValueError(f"Nicht erlaubter ZIP-Pfad: {name}")

    def _archive_rel_path(self, name: str) -> str | None:
        normalized = name.replace("\\", "/")
        prefix = f"{self._ZIP_ROOT}/"
        if not normalized.startswith(prefix):
            return None
        rel = normalized[len(prefix):]
        return rel or None

    def _read_manifest(self, zf: zipfile.ZipFile) -> dict[str, Any]:
        with zf.open(f"{self._ZIP_ROOT}/manifest.json", "r") as fh:
            manifest = json.loads(fh.read().decode("utf-8"))
        if manifest.get("schema_version") != self._SCHEMA_VERSION:
            raise ValueError("Nicht unterstuetzte Manifest-Version.")
        return manifest

    def _verify_manifest_hash(self, zf: zipfile.ZipFile, rel: str, manifest: dict[str, Any]) -> None:
        entry = next((item for item in manifest.get("files", []) if item.get("path") == rel), None)
        if not entry:
            return
        data = zf.read(f"{self._ZIP_ROOT}/{rel}")
        expected_size = entry.get("size")
        if isinstance(expected_size, int) and len(data) != expected_size:
            raise ValueError(f"Dateigroesse stimmt nicht: {rel}")
        expected_hash = entry.get("sha256")
        if expected_hash and self._sha256(data) != expected_hash:
            raise ValueError(f"SHA256 stimmt nicht: {rel}")

    def _target_path_for(self, rel: str, video_id: str) -> Path | None:
        rel_path = Path(rel)
        parts = rel_path.parts
        if not parts:
            return None
        root = parts[0]
        remainder = Path(*parts[1:]) if len(parts) > 1 else Path()
        if root == "ai-output":
            return settings.ai_output_dir / video_id / remainder
        if root == "frames":
            return settings.frames_dir / video_id / remainder
        if root == "output":
            return settings.render_output_dir / video_id / remainder
        if root == "uploads" and remainder.name.startswith("original"):
            return settings.upload_dir / f"{video_id}{remainder.suffix}"
        if root == "normalized":
            return settings.normalized_dir / f"{video_id}{remainder.suffix or '.mp4'}"
        if root == "cut":
            return settings.cut_dir / f"{video_id}{remainder.suffix or '.mp4'}"
        return None

    def _rewrite_imported_ids(self, video_id: str) -> None:
        storyboard_path = settings.ai_output_dir / video_id / "storyboard.json"
        if storyboard_path.exists():
            data = json.loads(storyboard_path.read_text(encoding="utf-8"))
            data["video_id"] = video_id
            upload_candidates = list(settings.upload_dir.glob(f"{video_id}.*"))
            if upload_candidates:
                data["source_video"] = str(upload_candidates[0])
            cut = settings.cut_dir / f"{video_id}.mp4"
            data["cut_video"] = str(cut) if cut.exists() else None
            storyboard_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        stack_path = settings.ai_output_dir / video_id / "frame_stack.json"
        if stack_path.exists():
            data = json.loads(stack_path.read_text(encoding="utf-8"))
            data["video_id"] = video_id
            stack_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _sha256(self, data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def _sha256_file(self, path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
