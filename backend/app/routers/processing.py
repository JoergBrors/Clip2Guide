"""
Router: Video-Verarbeitung (Normalisierung + Auto-Editor-Schnitt)
"""
from __future__ import annotations

import asyncio
import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks

from app import job_store
from app.config import settings
from app.models import EditMode, JobStartResponse, ProcessingRequest
from app.services.auto_editor_service import AutoEditorService
from app.services.video_normalizer import VideoNormalizer

router = APIRouter()
_normalizer = VideoNormalizer()
_auto_editor = AutoEditorService()

# ── Hilfsfunktionen ───────────────────────────────────────────────────────────

async def _send(job_id: str, type_: str, step: str, message: str, percent: int = 0, data: dict | None = None) -> None:
    await job_store.send_event(job_id, {
        "type": type_, "step": step, "message": message,
        "percent": percent, **({"data": data} if data else {}),
    })


def _find_upload(video_id: str) -> Path:
    for suffix in (".mp4", ".mov", ".avi", ".mkv", ".webm"):
        p = settings.upload_dir / f"{video_id}{suffix}"
        if p.exists():
            return p
    raise FileNotFoundError(
        f"Upload-Datei nicht gefunden fuer video_id='{video_id}' "
        f"in {settings.upload_dir}"
    )


def _check_tool(path: Path, name: str) -> None:
    """Prueft ob ein externes Tool-Binary existiert."""
    if not path.exists():
        raise FileNotFoundError(
            f"{name} nicht gefunden: {path}\n"
            f"Bitte sicherstellen dass das Tool vorhanden ist."
        )


# ── Normalisierung ────────────────────────────────────────────────────────────

async def _run_normalize(video_id: str, job_id: str, has_audio: bool) -> None:
    try:
        await _send(job_id, "progress", "normalize", "Pruefe Voraussetzungen...", 2)
        _check_tool(settings.ffmpeg_path, "FFmpeg")
        _check_tool(settings.ffprobe_path, "FFprobe")

        await _send(job_id, "progress", "normalize", "Suche Eingabevideo...", 5)

        # Bevorzuge geschnittenes Video (Auto-Editor-Output) als Eingabe
        cut_path = settings.cut_dir / f"{video_id}.mp4"
        if cut_path.exists():
            input_path = cut_path
            await _send(job_id, "progress", "normalize",
                        f"Eingabe: geschnittenes Video ({cut_path.name})", 8)
        else:
            input_path = _find_upload(video_id)
            await _send(job_id, "progress", "normalize",
                        f"Eingabe: Original-Upload ({input_path.name})", 8)

        out_path = settings.normalized_dir / f"{video_id}.mp4"
        settings.normalized_dir.mkdir(parents=True, exist_ok=True)

        await _send(job_id, "log", "normalize",
                    f"[clip2guide] ffmpeg: {settings.ffmpeg_path}")
        await _send(job_id, "log", "normalize",
                    f"[clip2guide] Eingabe:  {input_path}")
        await _send(job_id, "log", "normalize",
                    f"[clip2guide] Ausgabe:  {out_path}")
        await _send(job_id, "progress", "normalize", "Starte FFmpeg...", 10)

        async def on_progress(pct: int, msg: str) -> None:
            await _send(job_id, "progress", "normalize", msg, pct)

        async def on_ffmpeg_log(line: str) -> None:
            await _send(job_id, "log", "normalize", line)

        await _normalizer.normalize_async(
            input_path, out_path, has_audio,
            progress_cb=on_progress, log_cb=on_ffmpeg_log,
        )

        await _send(job_id, "completed", "normalize", "Normalisierung abgeschlossen.", 100,
                    {"normalized_path": str(out_path)})
    except Exception as exc:
        tb = traceback.format_exc()
        short = str(exc) or type(exc).__name__
        await _send(job_id, "log", "normalize", f"[FEHLER]\n{tb}")
        await _send(job_id, "error", "normalize",
                    f"Normalisierung fehlgeschlagen: {short}")


@router.post("/videos/{video_id}/normalize", response_model=JobStartResponse)
async def normalize_video(
    video_id: str,
    background_tasks: BackgroundTasks,
    has_audio: bool = True,
) -> JobStartResponse:
    job_id = str(uuid.uuid4())
    job_store.create_queue(job_id)
    background_tasks.add_task(_run_normalize, video_id, job_id, has_audio)
    return JobStartResponse(job_id=job_id, video_id=video_id, message="Normalisierung gestartet")


# ── Auto-Editor Schnitt ───────────────────────────────────────────────────────

async def _run_cut(video_id: str, job_id: str, req: ProcessingRequest) -> None:
    try:
        await _send(job_id, "progress", "cut", "Pruefe Voraussetzungen...", 2)
        _check_tool(settings.auto_editor_path, "Auto-Editor")

        await _send(job_id, "progress", "cut", "Suche Upload...", 5)
        # Auto-Editor laeuft jetzt auf dem Original-Upload (vor der Normalisierung)
        input_path = _find_upload(video_id)

        out_path = settings.cut_dir / f"{video_id}.mp4"
        settings.cut_dir.mkdir(parents=True, exist_ok=True)

        # Schwellwerte: User-Eingabe hat Vorrang, sonst Defaults
        audio_t = req.audio_threshold if req.audio_threshold is not None else 0.03
        motion_t = req.motion_threshold if req.motion_threshold is not None else 0.08

        edit_expr: str
        if req.edit_mode == EditMode.AUDIO:
            edit_expr = f"audio:threshold={audio_t:.3f}"
        elif req.edit_mode == EditMode.MOTION:
            edit_expr = f"motion:threshold={motion_t:.3f}"
        else:
            edit_expr = f"(or audio:threshold={audio_t:.3f} motion:threshold={motion_t:.3f})"

        await _send(job_id, "log", "cut",
                    f"[clip2guide] auto-editor: {settings.auto_editor_path}")
        await _send(job_id, "log", "cut",
                    f"[clip2guide] Eingabe:     {input_path}")
        await _send(job_id, "log", "cut",
                    f"[clip2guide] Ausgabe:     {out_path}")
        await _send(job_id, "log", "cut",
                    f"[clip2guide] Edit-Expr:   {edit_expr}  Margin: {req.margin}")
        await _send(job_id, "progress", "cut",
                    f"Schneide Pausen heraus ({req.edit_mode.value})...", 20)

        async def on_ae_log(line: str) -> None:
            await _send(job_id, "log", "cut", line)

        await _auto_editor.cut_video_async(
            input_path, out_path, edit_expr, req.margin, req.has_audio, log_cb=on_ae_log
        )

        await _send(job_id, "completed", "cut", "Schnitt abgeschlossen.", 100,
                    {"cut_path": str(out_path)})
    except Exception as exc:
        tb = traceback.format_exc()
        short = str(exc) or type(exc).__name__
        await _send(job_id, "log", "cut", f"[FEHLER]\n{tb}")
        await _send(job_id, "error", "cut",
                    f"Schnitt fehlgeschlagen: {short}")


@router.post("/videos/{video_id}/cut", response_model=JobStartResponse)
async def cut_video(
    video_id: str,
    req: ProcessingRequest,
    background_tasks: BackgroundTasks,
) -> JobStartResponse:
    job_id = str(uuid.uuid4())
    job_store.create_queue(job_id)
    background_tasks.add_task(_run_cut, video_id, job_id, req)
    return JobStartResponse(job_id=job_id, video_id=video_id, message="Schnitt gestartet")
