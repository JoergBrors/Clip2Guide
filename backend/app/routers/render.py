"""
Router: Rendering (Tutorial-Video erzeugen)
"""
from __future__ import annotations

import asyncio
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from app import job_store
from app.config import settings
from app.models import JobStartResponse, RenderRequest
from app.services.render_service import RenderService
from app.services.storyboard_service import StoryboardService

router = APIRouter()
_render_svc = RenderService()
_storyboard_svc = StoryboardService()


async def _send(job_id: str, type_: str, step: str, message: str, percent: int = 0, data: dict | None = None) -> None:
    await job_store.send_event(job_id, {
        "type": type_, "step": step, "message": message,
        "percent": percent, **({"data": data} if data else {}),
    })


# ── Regex-Muster fuer Fortschritts-Parsing ─────────────────────────────────────
# Matches:  "  Szene 3/12: scene_003 [de] – 5 Frames, noch 9 übrig"
_RE_SCENE = re.compile(r"Szene\s+(\d+)/(\d+)", re.IGNORECASE)
_RE_LANG  = re.compile(r"===\s*Rendern:\s*\[(\w+)\]", re.IGNORECASE)


async def _run_render(video_id: str, job_id: str, req: RenderRequest) -> None:
    # Kurze Pause damit der SSE-Client sicher verbunden ist bevor Events gesendet werden.
    # Der Background-Task startet sofort nach der HTTP-Response, der Browser braucht
    # noch einen Roundtrip um die SSE-Verbindung aufzubauen.
    await asyncio.sleep(1.0)
    try:
        await _send(job_id, "progress", "render", "Lade Storyboard...", 5)
        if not _storyboard_svc.exists(video_id):
            raise FileNotFoundError(f"Storyboard nicht gefunden fuer {video_id}")

        storyboard_path = settings.ai_output_dir / video_id / "storyboard.json"

        await _send(job_id, "progress", "render",
                    f"Starte Rendering fuer Sprachen: {', '.join(req.languages)} "
                    f"(FPS={req.fps}, Qualitaet={req.quality})", 10)

        cmd, output_dir = _render_svc.build_command(
            video_id, req.languages, storyboard_path,
            fps=req.fps, quality=req.quality, tts_slow=req.tts_slow,
        )

        await _send(job_id, "log", "render", f"$ {' '.join(cmd)}", 10)

        # Subprocess mit gestreamter Ausgabe starten.
        # Hinweis: stderr=STDOUT fuehrt auf Windows (ProactorEventLoop) zu einem
        # asyncio-Bug, bei dem der StreamReader nach der ersten Zeile keine weiteren
        # Daten mehr liest. Daher stderr separat als PIPE mit eigenem Drain-Task.
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,  # Separater Drain – kein STDOUT-Merge
            cwd=str(settings.project_root / "backend"),
        )

        # Stderr im Hintergrund verwerfen (Config-Meldungen, [WARN]-Hinweise).
        async def _drain_stderr() -> None:
            assert proc.stderr is not None
            async for _ in proc.stderr:
                pass

        drain_task = asyncio.create_task(_drain_stderr())

        total_langs  = len(req.languages)
        current_lang_idx = 0
        current_scene = 0
        total_scenes  = 0
        base_pct      = 10

        async for raw_line in proc.stdout:  # type: ignore[union-attr]
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue

            # Log-Event an Frontend senden
            await _send(job_id, "log", "render", line, base_pct)

            # Sprach-Block erkennen
            m_lang = _RE_LANG.search(line)
            if m_lang:
                current_lang_idx = req.languages.index(m_lang.group(1)) if m_lang.group(1) in req.languages else current_lang_idx
                current_scene = 0
                base_pct = 10 + int(85 * current_lang_idx / total_langs)

            # Szenen-Fortschritt erkennen
            m_scene = _RE_SCENE.search(line)
            if m_scene:
                current_scene = int(m_scene.group(1))
                total_scenes  = int(m_scene.group(2))
                remaining = total_scenes - current_scene
                lang_share = 85 // total_langs
                scene_pct  = int(lang_share * current_scene / total_scenes)
                pct = 10 + int(85 * current_lang_idx / total_langs) + scene_pct
                status_msg = (
                    f"[{req.languages[current_lang_idx] if current_lang_idx < len(req.languages) else '?'}] "
                    f"Szene {current_scene}/{total_scenes} – noch {remaining} Szene(n) übrig"
                )
                await _send(job_id, "progress", "render", status_msg, min(pct, 95))

        await proc.wait()
        await drain_task

        if proc.returncode != 0:
            raise RuntimeError(f"Rendering fehlgeschlagen (Exit-Code {proc.returncode})")

        output_files = [str(f) for f in output_dir.glob("*.mp4")]
        await _send(job_id, "completed", "render",
                    f"Rendering abgeschlossen. {len(output_files)} Datei(en).", 100,
                    {"output_dir": str(output_dir), "files": output_files})

    except Exception as exc:
        await _send(job_id, "error", "render", str(exc))


@router.post("/videos/{video_id}/render", response_model=JobStartResponse)
async def render_video(
    video_id: str,
    req: RenderRequest,
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> JobStartResponse:
    job_id = str(uuid.uuid4())
    job_store.create_queue(job_id)
    background_tasks.add_task(_run_render, video_id, job_id, req)
    return JobStartResponse(job_id=job_id, video_id=video_id, message="Rendering gestartet")


@router.get("/videos/{video_id}/output/{filename}")
async def download_output(video_id: str, filename: str) -> FileResponse:
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Ungueltiger Dateiname")
    path = settings.render_output_dir / video_id / filename
    if not path.exists() or path.suffix.lower() != ".mp4":
        raise HTTPException(status_code=404, detail="Ausgabe-Datei nicht gefunden")
    return FileResponse(str(path), media_type="video/mp4", filename=filename)
