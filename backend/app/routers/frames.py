"""
Router: Frame-Verwaltung (Extraktion, Abruf, FrameStack)
"""
from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app import job_store
from app.config import settings
from app.models import FrameInfo, FrameStack, JobStartResponse
from app.services.frame_extractor import FrameExtractor
from app.services.frame_stack_service import FrameStackService

router = APIRouter()
_extractor = FrameExtractor()
_stack_svc = FrameStackService()


async def _send(job_id: str, type_: str, step: str, message: str, percent: int = 0, data: dict | None = None) -> None:
    await job_store.send_event(job_id, {
        "type": type_, "step": step, "message": message,
        "percent": percent, **({"data": data} if data else {}),
    })


async def _run_extract(video_id: str, job_id: str) -> None:
    loop = asyncio.get_event_loop()
    try:
        # Bevorzuge geschnittenes Video, dann normalisiertes, dann Upload
        for candidate in [
            settings.cut_dir / f"{video_id}.mp4",
            settings.normalized_dir / f"{video_id}.mp4",
        ]:
            if candidate.exists():
                source = candidate
                break
        else:
            # Fallback: suche Upload
            found = list(settings.upload_dir.glob(f"{video_id}.*"))
            if not found:
                raise FileNotFoundError(f"Kein Video fuer {video_id} gefunden")
            source = found[0]

        await _send(job_id, "progress", "extract", f"Extrahiere Frames aus {source.name}...", 10)
        stack: FrameStack = await loop.run_in_executor(None, _extractor.extract, source, video_id)

        await _send(job_id, "progress", "extract", "Speichere Frame-Stack...", 80)
        _stack_svc.save(stack)

        await _send(job_id, "completed", "extract", f"{stack.total_frames} Frames extrahiert.", 100,
                    {"total_frames": stack.total_frames, "video_id": video_id})
    except Exception as exc:
        await _send(job_id, "error", "extract", str(exc))


@router.post("/videos/{video_id}/extract-frames", response_model=JobStartResponse)
async def extract_frames(
    video_id: str,
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> JobStartResponse:
    job_id = str(uuid.uuid4())
    job_store.create_queue(job_id)
    background_tasks.add_task(_run_extract, video_id, job_id)
    return JobStartResponse(job_id=job_id, video_id=video_id, message="Frame-Extraktion gestartet")


@router.get("/videos/{video_id}/frame-stack", response_model=FrameStack)
async def get_frame_stack(video_id: str) -> FrameStack:
    if not _stack_svc.exists(video_id):
        raise HTTPException(status_code=404, detail="Frame-Stack nicht gefunden")
    return _stack_svc.load(video_id)


@router.get("/videos/{video_id}/frames/{filename}")
async def get_frame_image(video_id: str, filename: str) -> FileResponse:
    # Sicherheitspruefung: nur einfache Dateinamen erlaubt
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Ungueltiger Dateiname")
    path = settings.frames_dir / video_id / filename
    if not path.exists() or path.suffix.lower() not in (".jpg", ".jpeg", ".png"):
        raise HTTPException(status_code=404, detail="Frame nicht gefunden")
    return FileResponse(str(path), media_type="image/jpeg")


_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


@router.post("/videos/{video_id}/frames/upload", response_model=FrameStack)
async def upload_custom_frames(
    video_id: str,
    files: list[UploadFile] = File(...),
) -> FrameStack:
    """Laedt eigene Bilder als Custom-Frames hoch und fuegt sie dem Frame-Stack hinzu."""
    frames_dir = settings.frames_dir / video_id
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Bestehenden Stack laden oder neuen anlegen
    if _stack_svc.exists(video_id):
        stack = _stack_svc.load(video_id)
    else:
        stack = FrameStack(video_id=video_id, frames=[], total_frames=0)

    new_frames: list[FrameInfo] = []
    for upload in files:
        # Inhaltstyp pruefen
        content_type = (upload.content_type or "").lower()
        suffix = ""
        if upload.filename:
            suffix = "." + upload.filename.rsplit(".", 1)[-1].lower() if "." in upload.filename else ""

        if content_type not in _ALLOWED_IMAGE_TYPES and suffix not in _ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Nicht erlaubter Dateityp: {upload.filename!r} ({content_type})"
            )

        # Dateierweiterung bestimmen: JPEG normieren
        ext = ".jpg" if suffix in (".jpg", ".jpeg") else (suffix or ".jpg")
        unique_name = f"custom_{uuid.uuid4().hex[:8]}{ext}"
        dest = frames_dir / unique_name

        data = await upload.read()
        dest.write_bytes(data)

        new_frames.append(FrameInfo(
            filename=unique_name,
            timestamp_seconds=0.0,
            scene_index=None,
        ))

    stack.frames.extend(new_frames)
    stack.total_frames = len(stack.frames)
    _stack_svc.save(stack)
    return stack
