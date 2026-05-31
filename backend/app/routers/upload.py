"""
Router: Video-Upload
"""
from __future__ import annotations

import asyncio
import json
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import StreamingResponse

from app import job_store
from app.config import settings
from app.models import UploadResponse
from app.services.ffmpeg_service import FfmpegService

router = APIRouter()
_ffmpeg = FfmpegService()

_ALLOWED_SUFFIXES = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
_CHUNK = 1024 * 1024  # 1 MB


@router.get("/upload/{upload_id}/events")
async def upload_events_sse(upload_id: str, request: Request) -> StreamingResponse:
    """SSE-Stream fuer Upload-Fortschritt."""
    if upload_id not in job_store.job_queues:
        job_store.create_queue(upload_id)

    async def generator():
        queue = job_store.job_queues.get(upload_id)
        if queue is None:
            return
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event: dict = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in ("completed", "error"):
                    break
        except (GeneratorExit, asyncio.CancelledError):
            pass
        finally:
            job_store.remove_queue(upload_id)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/upload/video", response_model=UploadResponse)
async def upload_video(
    file: UploadFile = File(...),
    upload_id: str = Query(default=""),
    file_size: int = Query(default=0),
) -> UploadResponse:
    suffix = Path(file.filename or "video.mp4").suffix.lower()
    if suffix not in _ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"Dateiformat nicht unterstuetzt: {suffix}. Erlaubt: {', '.join(_ALLOWED_SUFFIXES)}",
        )

    # Queue fuer SSE anlegen falls upload_id uebergeben
    if upload_id and upload_id not in job_store.job_queues:
        job_store.create_queue(upload_id)

    video_id = str(uuid.uuid4())
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    dest = settings.upload_dir / f"{video_id}{suffix}"

    # Phase 1: Datei in Chunks empfangen (0 – 80 %)
    received = 0
    async with aiofiles.open(dest, "wb") as out:
        while chunk := await file.read(_CHUNK):
            await out.write(chunk)
            received += len(chunk)
            if upload_id and file_size > 0:
                percent = min(int(received / file_size * 80), 80)
                mb_recv = received / (1024 * 1024)
                mb_total = file_size / (1024 * 1024)
                await job_store.send_event(upload_id, {
                    "type": "progress",
                    "step": "upload",
                    "message": f"{mb_recv:.1f} MB / {mb_total:.1f} MB",
                    "percent": percent,
                })

    # Phase 2: ffmpeg-Analyse (88 %)
    if upload_id:
        await job_store.send_event(upload_id, {
            "type": "progress", "step": "analyze",
            "message": "Video analysieren…", "percent": 88,
        })

    try:
        metadata = _ffmpeg.get_metadata(dest)
        has_audio = _ffmpeg.has_audio(metadata)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        if upload_id:
            await job_store.send_event(upload_id, {
                "type": "error", "step": "analyze",
                "message": str(exc), "percent": 0,
            })
        raise HTTPException(status_code=422, detail=f"Video konnte nicht analysiert werden: {exc}")

    # Phase 3: Fertig (100 %)
    if upload_id:
        await job_store.send_event(upload_id, {
            "type": "completed", "step": "done",
            "message": "Upload abgeschlossen", "percent": 100,
            "data": {"video_id": video_id},
        })

    return UploadResponse(
        video_id=video_id,
        filename=file.filename or dest.name,
        path=str(dest),
        has_audio=has_audio,
        metadata=metadata,
    )
