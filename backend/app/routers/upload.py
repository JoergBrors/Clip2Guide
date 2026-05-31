"""
Router: Video-Upload
"""
from __future__ import annotations

import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, HTTPException, UploadFile, File

from app.config import settings
from app.models import UploadResponse
from app.services.ffmpeg_service import FfmpegService

router = APIRouter()
_ffmpeg = FfmpegService()

_ALLOWED_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


@router.post("/upload/video", response_model=UploadResponse)
async def upload_video(file: UploadFile = File(...)) -> UploadResponse:
    suffix = Path(file.filename or "video.mp4").suffix.lower()
    if suffix not in _ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"Dateiformat nicht unterstuetzt: {suffix}. Erlaubt: {', '.join(_ALLOWED_SUFFIXES)}",
        )

    video_id = str(uuid.uuid4())
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.upload_dir / f"{video_id}{suffix}"

    async with aiofiles.open(dest, "wb") as out:
        while chunk := await file.read(1024 * 1024):  # 1 MB chunks
            await out.write(chunk)

    try:
        metadata = _ffmpeg.get_metadata(dest)
        has_audio = _ffmpeg.has_audio(metadata)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Video konnte nicht analysiert werden: {exc}")

    return UploadResponse(
        video_id=video_id,
        filename=file.filename or dest.name,
        path=str(dest),
        has_audio=has_audio,
        metadata=metadata,
    )
