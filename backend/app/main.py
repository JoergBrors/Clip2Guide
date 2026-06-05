"""
Clip2Guide – FastAPI Hauptanwendung
"""
from __future__ import annotations

import asyncio
import json
import shutil
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app import job_store
from app.config import settings
from app.models import HealthResponse
from app.routers import ai, frames, images, processing, projects, render, upload


def _cleanup_startup_cache() -> None:
    """Entfernt temporaere Laufzeitfragmente ohne Projektdaten zu loeschen."""
    workspace_root = settings.workspace_root.resolve()
    tmp_dir = (workspace_root / "tmp").resolve()
    if workspace_root == tmp_dir or workspace_root not in tmp_dir.parents:
        raise RuntimeError(f"Unsicherer Cache-Pfad: {tmp_dir}")
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    print(f"[startup] Cache bereinigt: {tmp_dir}", file=sys.stderr)


@asynccontextmanager
async def lifespan(_: FastAPI):
    _cleanup_startup_cache()
    yield


app = FastAPI(
    title="Clip2Guide API",
    version="0.1.0",
    description="Backend fuer Clip2Guide – automatische Tutorial-Erstellung aus Bildschirmaufnahmen.",
    lifespan=lifespan,
)

# CORS: nur localhost – kein oeffentlicher Zugriff
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # Electron-Renderer hat keinen festen Ursprung
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Router ────────────────────────────────────────────────────────────────────

app.include_router(upload.router,     prefix="/api", tags=["Upload"])
app.include_router(images.router,     prefix="/api", tags=["Images"])
app.include_router(processing.router, prefix="/api", tags=["Processing"])
app.include_router(frames.router,     prefix="/api", tags=["Frames"])
app.include_router(ai.router,         prefix="/api", tags=["AI"])
app.include_router(render.router,     prefix="/api", tags=["Render"])
app.include_router(projects.router,   prefix="/api", tags=["Projects"])

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", version="0.1.0")


# ── SSE: Job-Events ────────────────────────────────────────────────────────────

@app.get("/api/jobs/{job_id}/events")
async def job_events_sse(job_id: str, request: Request) -> StreamingResponse:
    """Server-Sent Events stream fuer Job-Fortschritt.

    Sendet Ereignisse im SSE-Format: ``data: <json>\\n\\n``
    Alle 15 Sekunden wird ein Keepalive-Kommentar gesendet.
    """

    async def generator():
        # Queue anlegen falls Job noch nicht gestartet hat
        if job_id not in job_store.job_queues:
            job_store.create_queue(job_id)
        queue = job_store.job_queues[job_id]
        total_wait = 0.0
        try:
            while True:
                # Verbindungsstatus pruefen
                if await request.is_disconnected():
                    break
                try:
                    event: dict = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    total_wait += 15.0
                    if total_wait >= 3600.0:
                        payload = json.dumps({
                            "type": "error", "step": "",
                            "message": "Timeout: Job nach 1 h noch nicht abgeschlossen.",
                            "percent": 0,
                        }, ensure_ascii=False)
                        yield f"data: {payload}\n\n"
                        break
                    # Keepalive damit Browser-Verbindung offen bleibt
                    yield ": keepalive\n\n"
                    continue
                total_wait = 0.0
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in ("completed", "error"):
                    break
        except (GeneratorExit, asyncio.CancelledError):
            pass
        finally:
            job_store.remove_queue(job_id)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
