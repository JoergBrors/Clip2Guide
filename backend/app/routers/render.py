"""
Router: Rendering (Tutorial-Video erzeugen)
"""
from __future__ import annotations

import asyncio
import re
import subprocess
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from app import job_store
from app.config import settings
from app.models import JobStartResponse, RenderRequest
from app.services.manual_render_service import ManualRenderService
from app.services.render_service import RenderService
from app.services.storyboard_service import StoryboardService

router = APIRouter()
_render_svc = RenderService()
_manual_svc = ManualRenderService()
_storyboard_svc = StoryboardService()


async def _send(job_id: str, type_: str, step: str, message: str, percent: int = 0, data: dict | None = None) -> None:
    await job_store.send_event(job_id, {
        "type": type_, "step": step, "message": message,
        "percent": percent, **({"data": data} if data else {}),
    })


# ── Regex-Muster fuer Fortschritts-Parsing ─────────────────────────────────────
# Matches:  "  Szene 3/12: scene_003 [de] – 5 Frames, noch 9 übrig"
_RE_SCENE = re.compile(r"Szene\s+(\d+)/(\d+)", re.IGNORECASE)
# Matches:  "  [de] Encoding: Frame 250/500 (50%)"
_RE_ENCODING = re.compile(r"Encoding:\s*Frame\s+(\d+)/(\d+)\s*\((\d+)%\)", re.IGNORECASE)
# Matches:  "  Kodiere Video (25 fps, CRF=23, Preset=faster)..."
_RE_ENCODE_START = re.compile(r"Kodiere Video", re.IGNORECASE)


# ── Vor-Render: Szenen-Dauern neu berechnen ────────────────────────────────────

# Schätzung: gTTS (Deutsch/Englisch) spricht ca. 13 Zeichen/Sekunde.
# Damit ist sichergestellt, dass kein TTS-Audio abgeschnitten wird.
_TTS_CHARS_PER_SEC = 13.0
_MIN_SCENE_DURATION = 2.0   # Szene immer mindestens 2 Sekunden


def _recalculate_durations(storyboard, languages: list[str]) -> list[str]:
    """
    Läuft über alle Szenen und stellt sicher, dass duration_seconds lang genug
    ist für das längste TTS-Audio in einer der angefragten Sprachen.
    Gibt eine Liste von Log-Zeilen zurück.
    """
    from app.models import StoryboardJson  # lokaler Import vermeidet zirkuläre Importe
    logs: list[str] = []
    for scene in storyboard.scenes:
        # Längsten speaker_notes-Text über alle angefragten Sprachen ermitteln
        max_text_len = 0
        for lang in languages:
            panel = scene.texts.get(lang)
            if panel and panel.speaker_notes:
                max_text_len = max(max_text_len, len(panel.speaker_notes.strip()))

        # Geschätzte TTS-Dauer (Sekunden)
        estimated = max_text_len / _TTS_CHARS_PER_SEC if max_text_len > 0 else 0.0
        required = max(estimated, _MIN_SCENE_DURATION)

        if scene.duration_seconds < required:
            old = scene.duration_seconds
            scene.duration_seconds = round(required, 2)
            logs.append(
                f"  {scene.scene_id}: duration {old:.1f}s → {scene.duration_seconds:.1f}s "
                f"(TTS-Schätzung: {estimated:.1f}s, Text: {max_text_len} Zeichen)"
            )

    return logs


# ── Synchroner Render-Worker (laeuft in Thread-Pool-Thread) ────────────────────

def _render_lang_worker(
    lang: str,
    cmd: list[str],
    job_id: str,
    loop: asyncio.AbstractEventLoop,
    lang_idx: int,
    total_langs: int,
    cwd: str,
) -> None:
    """
    Fuehrt Rendering fuer eine Sprache synchron durch (subprocess.Popen).
    Laeuft in einem Thread-Pool-Thread → blockiert den asyncio Event-Loop NICHT.
    Jede Stdout-Zeile und alle Stderr-Ausgaben (Tracebacks, Fehler) werden
    thread-sicher als SSE-Events an den asyncio Event-Loop uebergeben.
    """

    def push(
        type_: str, step: str, message: str, percent: int,
        data: dict | None = None,
    ) -> None:
        """Thread-sicherer SSE-Push: laeuft in Event-Loop-Thread via call_soon_threadsafe."""
        q = job_store.job_queues.get(job_id)
        if q is None:
            return
        event: dict = {"type": type_, "step": step,
                       "message": message, "percent": percent}
        if data:
            event["data"] = data
        loop.call_soon_threadsafe(q.put_nowait, event)

    lang_base  = 10 + int(85 * lang_idx / max(total_langs, 1))
    lang_share = max(1, 85 // max(total_langs, 1))

    push("log", "render", f"[{lang}] $ {' '.join(cmd)}", lang_base)

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    # Stderr-Drain in eigenem Daemon-Thread.
    # Config-Diagnosezeilen ([config] ...) werden gefiltert.
    # Alle anderen Zeilen (Python-Tracebacks, Warnings, Errors) werden
    # als Log-Events an das Frontend gestreamt.
    stderr_lines: list[str] = []

    def drain_stderr() -> None:
        assert proc.stderr is not None
        for raw in proc.stderr:
            line = raw.rstrip()
            if not line or line.startswith("[config]"):
                continue
            stderr_lines.append(line)
            push("log", "render", f"[{lang}] STDERR: {line}", lang_base)

    stderr_t = threading.Thread(target=drain_stderr, daemon=True)
    stderr_t.start()

    # Stdout zeilenweise lesen – synchron, kein Event-Loop-Blocking.
    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.rstrip()
        if not line:
            continue
        push("log", "render", f"[{lang}] {line}", lang_base)

        m = _RE_SCENE.search(line)
        if m:
            cur = int(m.group(1))
            tot = int(m.group(2))
            pct = lang_base + int(lang_share * cur / max(tot, 1))
            push(
                "progress", "render",
                f"[{lang}] Szene {cur}/{tot} – noch {tot - cur} übrig",
                min(pct, lang_base + lang_share - 1),
            )
            continue

        if _RE_ENCODE_START.search(line):
            # Einmalige Warnung sobald FFmpeg-Encoding startet
            enc_start_pct = lang_base + int(lang_share * 0.85)
            push(
                "progress", "render",
                f"[{lang}] Encoding gestartet – Video wird kodiert, "
                f"dies kann je nach Länge bis zu 30 Minuten dauern ...",
                enc_start_pct,
            )
            continue

        m2 = _RE_ENCODING.search(line)
        if m2:
            enc_cur  = int(m2.group(1))
            enc_tot  = int(m2.group(2))
            enc_pct  = int(m2.group(3))
            # Encoding ist der letzte Schritt → letzte 15% des lang_share reservieren
            enc_offset = lang_base + int(lang_share * 0.85) + int(lang_share * 0.15 * enc_pct / 100)
            push(
                "progress", "render",
                f"[{lang}] Encoding {enc_pct}% – Frame {enc_cur}/{enc_tot}",
                min(enc_offset, lang_base + lang_share - 1),
            )

    proc.wait()
    stderr_t.join(timeout=10)

    if proc.returncode != 0:
        context = "\n".join(stderr_lines[-20:]) if stderr_lines else "(kein stderr)"
        raise RuntimeError(
            f"[{lang}] Rendering fehlgeschlagen (Exit-Code {proc.returncode}).\n{context}"
        )

    push("progress", "render", f"[{lang}] Fertig ✓", lang_base + lang_share)


def _render_manual_worker(
    video_id: str,
    lang: str,
    req: RenderRequest,
    job_id: str,
    loop: asyncio.AbstractEventLoop,
    lang_idx: int,
    total_langs: int,
) -> str:
    """Erzeugt ein DOCX-Handbuch fuer eine Sprache."""

    def push(type_: str, step: str, message: str, percent: int, data: dict | None = None) -> None:
        q = job_store.job_queues.get(job_id)
        if q is None:
            return
        event: dict = {"type": type_, "step": step, "message": message, "percent": percent}
        if data:
            event["data"] = data
        loop.call_soon_threadsafe(q.put_nowait, event)

    base = 10 + int(85 * lang_idx / max(total_langs, 1))
    push("log", "render", f"[{lang}] Starte Handbuch-Rendering (DOCX)...", base)
    if req.handbook_optimize:
        push("log", "render", f"[{lang}] Optimiere Handbuchtexte per KI...", base)
        push("progress", "render", f"[{lang}] Handbuch-KI wird vorbereitet...", base + 10)

    def debug_prompt(step: str, content: str) -> None:
        push("debug", step, f"[{lang}] {content}", base + 20, {"language": lang})

    out_path = _manual_svc.render_manual(
        video_id,
        lang,
        optimize=req.handbook_optimize,
        ai_provider=req.ai_provider,
        ai_model=req.ai_model,
        debug_callback=debug_prompt,
    )
    push("log", "render", f"[{lang}] Handbuch gespeichert: {out_path}", base + 80)
    return str(out_path)


# ── Asynchroner Orchestrator ───────────────────────────────────────────────────

async def _run_render(video_id: str, job_id: str, req: RenderRequest) -> None:
    # Kurze Pause damit der SSE-Client sicher verbunden ist bevor Events gesendet werden.
    await asyncio.sleep(0.8)
    loop = asyncio.get_running_loop()

    try:
        await _send(job_id, "progress", "render", "Lade Storyboard...", 5)

        if not _storyboard_svc.exists(video_id):
            raise FileNotFoundError(f"Storyboard nicht gefunden fuer {video_id}")

        output_formats = set(req.output_formats or ["video"])
        valid_formats = {"video", "manual"}
        invalid_formats = output_formats - valid_formats
        if invalid_formats:
            raise ValueError(f"Ungueltige Ausgabeformate: {', '.join(sorted(invalid_formats))}")

        # ── Szenen-Dauern vor dem Render neu berechnen ──────────────────────
        # Stellt sicher, dass kein TTS-Audio abgeschnitten wird und keine
        # Szene zu kurz ist, auch wenn der Benutzer Texte geändert hat.
        storyboard = _storyboard_svc.load(video_id)
        if "video" in output_formats:
            await _send(
                job_id, "log", "render",
                f"Prüfe Szenen-Dauern für {len(storyboard.scenes)} Szenen...", 5,
            )
            duration_logs = _recalculate_durations(storyboard, req.languages)
            if duration_logs:
                _storyboard_svc.save(storyboard)
                for log_line in duration_logs:
                    await _send(job_id, "log", "render", f"[Dauer angepasst] {log_line}", 6)
                await _send(
                    job_id, "log", "render",
                    f"Storyboard aktualisiert: {len(duration_logs)} Szene(n) korrigiert.", 6,
                )
            else:
                await _send(job_id, "log", "render", "Alle Szenen-Dauern sind plausibel ✓", 6)
        else:
            await _send(job_id, "log", "render", "Handbuch-Rendering nutzt das Storyboard unveraendert.", 6)

        storyboard_path = settings.ai_output_dir / video_id / "storyboard.json"

        # output_dir einmalig aus dem kombinierten Build-Command lesen
        _, output_dir = _render_svc.build_command(
            video_id, req.languages, storyboard_path,
            fps=req.fps, quality=req.quality, tts_slow=req.tts_slow,
        )

        total_langs = len(req.languages)
        worker_tasks = []

        await _send(
            job_id, "progress", "render",
            f"Starte Render-Worker fuer {', '.join(sorted(output_formats))} "
            f"({total_langs} Sprache(n))...", 8,
        )

        if "video" in output_formats:
            lang_cmds: list[tuple[str, list[str], str]] = []
            for lang in req.languages:
                cmd, out_dir = _render_svc.build_command(
                    video_id, [lang], storyboard_path,
                    fps=req.fps, quality=req.quality, tts_slow=req.tts_slow,
                )
                lang_cmds.append((lang, cmd, str(out_dir)))

            worker_tasks.extend(
                loop.run_in_executor(
                    None,
                    _render_lang_worker,
                    lang, cmd, job_id, loop, idx, total_langs,
                    cwd,
                )
                for idx, (lang, cmd, cwd) in enumerate(lang_cmds)
            )

        if "manual" in output_formats:
            worker_tasks.extend(
                loop.run_in_executor(
                    None,
                    _render_manual_worker,
                    video_id, lang, req, job_id, loop, idx, total_langs,
                )
                for idx, lang in enumerate(req.languages)
            )

        # Alle Worker parallel abwarten; return_exceptions=True sammelt alle Fehler.
        results = await asyncio.gather(*worker_tasks, return_exceptions=True)

        errors = [str(r) for r in results if isinstance(r, Exception)]
        if errors:
            raise RuntimeError("\n".join(errors))

        output_files = [str(f) for f in output_dir.glob("*.mp4")]
        manual_files = [str(f) for f in output_dir.glob("manual_*.docx")]
        await _send(
            job_id, "completed", "render",
            f"Rendering abgeschlossen. {len(output_files)} Video(s), {len(manual_files)} Handbuch-Datei(en).", 100,
            {"output_dir": str(output_dir), "files": output_files, "manual_files": manual_files},
        )

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


@router.get("/videos/{video_id}/manual/{filename}")
async def download_manual(video_id: str, filename: str) -> FileResponse:
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Ungueltiger Dateiname")
    path = settings.render_output_dir / video_id / filename
    if not path.exists() or path.suffix.lower() != ".docx" or not filename.startswith("manual_"):
        raise HTTPException(status_code=404, detail="Handbuch-Datei nicht gefunden")
    return FileResponse(
        str(path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=filename,
    )
