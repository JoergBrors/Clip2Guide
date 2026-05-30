"""
Clip2Guide – FastAPI Hauptanwendung
"""
from __future__ import annotations

import asyncio
import json

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app import job_store
from app.models import HealthResponse
from app.routers import ai, frames, processing, render, upload

app = FastAPI(
    title="Clip2Guide API",
    version="0.1.0",
    description="Backend fuer Clip2Guide – automatische Tutorial-Erstellung aus Bildschirmaufnahmen.",
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
app.include_router(processing.router, prefix="/api", tags=["Processing"])
app.include_router(frames.router,     prefix="/api", tags=["Frames"])
app.include_router(ai.router,         prefix="/api", tags=["AI"])
app.include_router(render.router,     prefix="/api", tags=["Render"])

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
