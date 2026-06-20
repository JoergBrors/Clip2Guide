"""
Router: Bild-Upload und -Normalisierung
"""
from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path
from typing import List

import aiofiles
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image as PILImage
from pydantic import BaseModel

from app.config import settings
from app.models import FrameInfo, FrameStack
from app.services.frame_stack_service import FrameStackService

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    _HEIC_SUPPORTED = True
except ImportError:
    _HEIC_SUPPORTED = False

router = APIRouter()

_ALLOWED_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".heic", ".heif"}
_HEIC_SUFFIXES = {".heic", ".heif"}
_MAX_IMAGES = 200


# ── Modelle ───────────────────────────────────────────────────────────────────

class ImageInfo(BaseModel):
    image_id: str
    filename: str
    width: int
    height: int


class ImageSetResponse(BaseModel):
    session_id: str
    images: List[ImageInfo]


class NormalizeRequest(BaseModel):
    session_id: str
    target_width: int
    target_height: int
    mode: str = "crop"  # "crop" | "fit" | "stretch"


class NormalizeResponse(BaseModel):
    session_id: str
    images: List[ImageInfo]


# ── Hilfsfunktionen ───────────────────────────────────────────────────────────

def _session_dir(session_id: str) -> Path:
    return settings.upload_dir / "images" / session_id


def _find_image(directory: Path, image_id: str) -> Path | None:
    if not directory.exists():
        return None
    for suffix in _ALLOWED_SUFFIXES:
        candidate = directory / f"{image_id}{suffix}"
        if candidate.exists():
            return candidate
    return None


# ── Endpunkte ─────────────────────────────────────────────────────────────────

@router.post("/upload/images", response_model=ImageSetResponse)
async def upload_images(files: List[UploadFile] = File(...)) -> ImageSetResponse:
    """Mehrere Bilder in eine neue Session hochladen."""
    if not files:
        raise HTTPException(400, "Keine Dateien übermittelt")
    if len(files) > _MAX_IMAGES:
        raise HTTPException(400, f"Maximal {_MAX_IMAGES} Bilder gleichzeitig")

    session_id = str(uuid.uuid4())
    img_dir = _session_dir(session_id)
    img_dir.mkdir(parents=True, exist_ok=True)

    images: List[ImageInfo] = []

    for file in files:
        original_suffix = Path(file.filename or "image.jpg").suffix.lower()
        if original_suffix not in _ALLOWED_SUFFIXES:
            raise HTTPException(415, f"Format nicht unterstützt: {original_suffix}")
        if original_suffix in _HEIC_SUFFIXES and not _HEIC_SUPPORTED:
            raise HTTPException(415, "HEIC/HEIF wird nicht unterstützt – pillow-heif fehlt")

        image_id = str(uuid.uuid4())
        # HEIC/HEIF direkt zu JPEG konvertieren – Folgestufen erwarten kein HEIC
        is_heic = original_suffix in _HEIC_SUFFIXES
        upload_suffix = original_suffix if not is_heic else original_suffix
        dest = img_dir / f"{image_id}{upload_suffix}"

        async with aiofiles.open(dest, "wb") as out:
            while chunk := await file.read(512 * 1024):
                await out.write(chunk)

        try:
            with PILImage.open(dest) as img:
                if is_heic:
                    # HEIC → JPEG konvertieren; Original löschen
                    jpg_dest = img_dir / f"{image_id}.jpg"
                    img.convert("RGB").save(jpg_dest, "JPEG", quality=95, optimize=True)
                    dest.unlink(missing_ok=True)
                    dest = jpg_dest
                w, h = img.size
        except Exception:
            dest.unlink(missing_ok=True)
            raise HTTPException(422, f"Datei '{file.filename}' ist kein gültiges Bild")

        images.append(ImageInfo(
            image_id=image_id,
            filename=file.filename or dest.name,
            width=w,
            height=h,
        ))

    # Upload-Reihenfolge persistieren; normalize und to-frames lesen diese Datei
    # statt sorted() zu verwenden, damit die Ordner/Bild-Nummerierung erhalten bleibt.
    order_file = img_dir / "order.json"
    order_file.write_text(
        json.dumps([img.image_id for img in images], ensure_ascii=False),
        encoding="utf-8",
    )

    return ImageSetResponse(session_id=session_id, images=images)


@router.post("/images/normalize", response_model=NormalizeResponse)
async def normalize_images(req: NormalizeRequest) -> NormalizeResponse:
    """Alle Bilder einer Session auf eine einheitliche Größe bringen."""
    img_dir = _session_dir(req.session_id)
    if not img_dir.exists():
        raise HTTPException(404, "Session nicht gefunden")

    if req.target_width < 1 or req.target_height < 1:
        raise HTTPException(400, "Ungültige Zielgröße")
    if req.mode not in ("crop", "fit", "stretch"):
        raise HTTPException(400, "Modus muss 'crop', 'fit' oder 'stretch' sein")

    out_dir = img_dir / "normalized"
    out_dir.mkdir(exist_ok=True)

    target = (req.target_width, req.target_height)

    # Reihenfolge aus order.json lesen; Fallback: alphabetisch sortiert
    order_file = img_dir / "order.json"
    if order_file.exists():
        image_ids: list[str] = json.loads(order_file.read_text(encoding="utf-8"))
        src_files = []
        for iid in image_ids:
            found = _find_image(img_dir, iid)
            if found:
                src_files.append(found)
        # Bilder ohne Eintrag in order.json anhängen (Defensiv-Fallback)
        ordered_set = {str(f) for f in src_files}
        for f in sorted(img_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in _ALLOWED_SUFFIXES and str(f) not in ordered_set:
                src_files.append(f)
    else:
        src_files = sorted(
            f for f in img_dir.iterdir()
            if f.is_file() and f.suffix.lower() in _ALLOWED_SUFFIXES
        )
    if not src_files:
        raise HTTPException(404, "Keine Bilder in dieser Session")

    result_images: List[ImageInfo] = []

    for src_path in src_files:
        dest_path = out_dir / f"{src_path.stem}.jpg"

        with PILImage.open(src_path) as img:
            img = img.convert("RGB")

            if req.mode == "stretch":
                result = img.resize(target, PILImage.LANCZOS)

            elif req.mode == "fit":
                ratio = min(target[0] / img.width, target[1] / img.height)
                new_size = (int(img.width * ratio), int(img.height * ratio))
                img_scaled = img.resize(new_size, PILImage.LANCZOS)
                background = PILImage.new("RGB", target, (0, 0, 0))
                offset = (
                    (target[0] - img_scaled.width) // 2,
                    (target[1] - img_scaled.height) // 2,
                )
                background.paste(img_scaled, offset)
                result = background

            else:  # crop (default): skalieren + mittig zuschneiden
                ratio = max(target[0] / img.width, target[1] / img.height)
                new_w = int(img.width * ratio + 0.5)
                new_h = int(img.height * ratio + 0.5)
                img_scaled = img.resize((new_w, new_h), PILImage.LANCZOS)
                left = (new_w - target[0]) // 2
                top = (new_h - target[1]) // 2
                result = img_scaled.crop((left, top, left + target[0], top + target[1]))

            result.save(dest_path, "JPEG", quality=95, optimize=True)

        result_images.append(ImageInfo(
            image_id=src_path.stem,
            filename=dest_path.name,
            width=req.target_width,
            height=req.target_height,
        ))

    return NormalizeResponse(session_id=req.session_id, images=result_images)


@router.post("/images/{session_id}/to-frames", response_model=FrameStack)
def images_to_frames(session_id: str) -> FrameStack:
    """Importiert Bilder einer Session als Frames fuer die Video-Pipeline."""
    img_dir = _session_dir(session_id)
    if not img_dir.exists():
        raise HTTPException(404, "Session nicht gefunden")

    # Normalisierte Bilder bevorzugen
    norm_dir = img_dir / "normalized"
    src_dir = norm_dir if norm_dir.exists() and any(
        f for f in norm_dir.iterdir() if f.is_file() and f.suffix.lower() in _ALLOWED_SUFFIXES
    ) else img_dir

    # Reihenfolge aus order.json lesen; Fallback: alphabetisch sortiert
    order_file = img_dir / "order.json"
    if order_file.exists():
        image_ids_ordered: list[str] = json.loads(order_file.read_text(encoding="utf-8"))
        src_files = []
        for iid in image_ids_ordered:
            # Im normalisierten Verzeichnis haben alle Dateien die Endung .jpg
            candidate = src_dir / f"{iid}.jpg"
            if candidate.exists():
                src_files.append(candidate)
                continue
            found = _find_image(src_dir, iid)
            if found:
                src_files.append(found)
        ordered_set = {str(f) for f in src_files}
        for f in sorted(src_dir.iterdir()):
            if f.is_file() and f.suffix.lower() in _ALLOWED_SUFFIXES and str(f) not in ordered_set:
                src_files.append(f)
    else:
        src_files = sorted(
            f for f in src_dir.iterdir()
            if f.is_file() and f.suffix.lower() in _ALLOWED_SUFFIXES
        )
    if not src_files:
        raise HTTPException(404, "Keine Bilder in dieser Session")

    video_id = str(uuid.uuid4())
    frames_dir = settings.frames_dir / video_id
    frames_dir.mkdir(parents=True, exist_ok=True)

    frames: List[FrameInfo] = []
    for i, src in enumerate(src_files):
        dest_name = f"frame_{i + 1:03d}{src.suffix.lower()}"
        shutil.copy2(src, frames_dir / dest_name)
        frames.append(FrameInfo(filename=dest_name, timestamp_seconds=float(i), scene_index=None))

    stack = FrameStack(video_id=video_id, frames=frames, total_frames=len(frames))
    FrameStackService().save(stack)
    return stack


@router.get("/images/{session_id}/{image_id}")
async def get_image(
    session_id: str,
    image_id: str,
    normalized: bool = False,
) -> FileResponse:
    """Einzelnes Bild aus einer Session abrufen."""
    img_dir = _session_dir(session_id)
    sub = img_dir / "normalized" if normalized else img_dir

    # Normalisierte Bilder werden immer als JPEG gespeichert
    if normalized:
        candidate = sub / f"{image_id}.jpg"
        if candidate.exists():
            return FileResponse(str(candidate))
    else:
        found = _find_image(sub, image_id)
        if found:
            return FileResponse(str(found))

    raise HTTPException(404, "Bild nicht gefunden")
