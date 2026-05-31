"""
Router: KI-Analyse (Frame-Analyse → Storyboard)
"""
from __future__ import annotations

import asyncio
import uuid
from typing import List

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from app import job_store
from app.config import settings
from app.models import AnalyzeRequest, AiProvider, JobStartResponse, RewriteSceneRequest, StoryboardJson, StoryboardUpdateRequest
from app.services.frame_stack_service import FrameStackService
from app.services.storyboard_service import StoryboardService

router = APIRouter()
_stack_svc = FrameStackService()
_storyboard_svc = StoryboardService()


async def _send(job_id: str, type_: str, step: str, message: str, percent: int = 0, data: dict | None = None) -> None:
    await job_store.send_event(job_id, {
        "type": type_, "step": step, "message": message,
        "percent": percent, **({"data": data} if data else {}),
    })


# ── Verfuegbare Modelle ────────────────────────────────────────────────────────

OPENAI_VISION_MODELS: List[str] = [
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "o4-mini",
    "o3",
]


def _list_gemini_models() -> List[str]:
    """Listet alle Gemini-Modelle auf, die generateContent unterstuetzen."""
    from google import genai
    client = genai.Client(api_key=settings.gemini_api_key)
    names = [
        m.name.removeprefix("models/")
        for m in client.models.list()
        if "generateContent" in (m.supported_actions or [])
        and "gemini" in (m.name or "")
        and "tts" not in (m.name or "")
        and "computer-use" not in (m.name or "")
        and "robotics" not in (m.name or "")
    ]
    return sorted(set(names))


@router.get("/ai/models")
async def list_models(provider: str = Query(default="gemini")) -> dict:
    """Gibt die verfuegbaren Modelle fuer den gewaehlten Provider zurueck."""
    if provider == AiProvider.GEMINI.value:
        if not settings.gemini_api_key:
            raise HTTPException(status_code=400, detail="GEMINI_API_KEY ist nicht gesetzt.")
        try:
            import asyncio as _asyncio
            loop = _asyncio.get_event_loop()
            models = await loop.run_in_executor(None, _list_gemini_models)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Gemini API Fehler: {e}")
        return {"provider": provider, "models": models, "default": settings.gemini_model}
    elif provider == AiProvider.OPENAI.value:
        if not settings.openai_api_key:
            raise HTTPException(status_code=400, detail="OPENAI_API_KEY ist nicht gesetzt.")
        return {"provider": provider, "models": OPENAI_VISION_MODELS, "default": settings.openai_model}
    else:
        raise HTTPException(status_code=400, detail=f"Unbekannter Provider: {provider}")


def _get_provider(req: AnalyzeRequest):
    """Gibt den passenden KI-Provider zurueck."""
    provider_name = req.ai_provider.value if req.ai_provider else settings.ai_provider
    model = req.ai_model  # None = Modell-Default aus settings

    if provider_name == AiProvider.GEMINI.value:
        from app.services.gemini_provider import GeminiProvider
        return GeminiProvider(model=model)
    elif provider_name == AiProvider.OPENAI.value:
        from app.services.openai_provider import OpenAiProvider
        return OpenAiProvider(model=model)
    else:
        raise ValueError(f"Unbekannter AI-Provider: {provider_name}")


async def _run_analyze(video_id: str, job_id: str, req: AnalyzeRequest) -> None:
    loop = asyncio.get_event_loop()
    try:
        await _send(job_id, "progress", "analyze", "Lade Frame-Stack...", 5)
        if not _stack_svc.exists(video_id):
            raise FileNotFoundError(f"Frame-Stack nicht gefunden fuer {video_id}. Bitte zuerst Frames extrahieren.")

        frame_paths = _stack_svc.list_frame_paths(video_id)

        # Benutzerdefinierte Frame-Auswahl filtern
        if req.selected_frames:
            selected_set = set(req.selected_frames)
            frame_paths = [p for p in frame_paths if p.name in selected_set]
            # Auch hochgeladene Custom-Frames einbeziehen (liegen direkt im Frames-Dir)
            frames_dir = settings.frames_dir / video_id
            existing_names = {p.name for p in frame_paths}
            for fname in req.selected_frames:
                if fname not in existing_names:
                    fp = frames_dir / fname
                    if fp.exists():
                        frame_paths.append(fp)
            frame_paths = sorted(frame_paths, key=lambda p: p.name)

        if not frame_paths:
            raise FileNotFoundError(f"Keine Frames gefunden fuer {video_id}")

        await _send(job_id, "progress", "analyze", f"Analysiere {len(frame_paths)} Frames...", 20)

        provider = _get_provider(req)

        storyboard: StoryboardJson = await loop.run_in_executor(
            None, provider.analyze_frames, frame_paths, req.languages, video_id
        )

        # Quellvideo eintragen
        cut_path = settings.cut_dir / f"{video_id}.mp4"
        storyboard.source_video = str(
            cut_path if cut_path.exists() else settings.upload_dir / f"{video_id}.mp4"
        )
        storyboard.cut_video = str(cut_path) if cut_path.exists() else None

        await _send(job_id, "progress", "analyze", "Speichere Storyboard...", 90)
        _storyboard_svc.save(storyboard)

        await _send(job_id, "completed", "analyze", f"{len(storyboard.scenes)} Szenen erkannt.", 100,
                    {"scenes": len(storyboard.scenes), "video_id": video_id})
    except Exception as exc:
        await _send(job_id, "error", "analyze", str(exc))


@router.post("/videos/{video_id}/analyze", response_model=JobStartResponse)
async def analyze_video(
    video_id: str,
    req: AnalyzeRequest,
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> JobStartResponse:
    job_id = str(uuid.uuid4())
    job_store.create_queue(job_id)
    background_tasks.add_task(_run_analyze, video_id, job_id, req)
    return JobStartResponse(job_id=job_id, video_id=video_id, message="KI-Analyse gestartet")


@router.get("/videos/{video_id}/storyboard", response_model=StoryboardJson)
async def get_storyboard(video_id: str) -> StoryboardJson:
    if not _storyboard_svc.exists(video_id):
        raise HTTPException(status_code=404, detail="Storyboard nicht gefunden")
    return _storyboard_svc.load(video_id)


@router.put("/videos/{video_id}/storyboard", response_model=StoryboardJson)
async def update_storyboard(video_id: str, body: StoryboardUpdateRequest) -> StoryboardJson:
    storyboard = body.storyboard
    storyboard.video_id = video_id   # sicherstellen dass video_id konsistent ist
    _storyboard_svc.save(storyboard)
    return storyboard


async def _run_rewrite_scene(video_id: str, job_id: str, req: RewriteSceneRequest) -> None:
    loop = asyncio.get_event_loop()
    try:
        await _send(job_id, "progress", "rewrite", "Lade Frames...", 10)
        frames_dir = settings.frames_dir / video_id
        frame_paths = sorted(
            [frames_dir / fn for fn in req.image_group if (frames_dir / fn).exists()]
        )
        if not frame_paths:
            raise FileNotFoundError(f"Keine Frames gefunden fuer Szene '{req.scene_id}'")

        await _send(job_id, "progress", "rewrite", f"Analysiere {len(frame_paths)} Frames...", 30)

        prompt_extra = (
            f"Hinweis: Diese Frames gehoeren alle zu EINER zusammenhaengenden Szene. "
            f"Erstelle genau eine Szene mit scene_id '{req.scene_id}'."
        )
        analyze_req = AnalyzeRequest(
            video_id=video_id,
            languages=req.languages,
            ai_provider=req.ai_provider,
            ai_model=req.ai_model,
        )
        provider = _get_provider(analyze_req)
        storyboard = await loop.run_in_executor(
            None, provider.analyze_frames, frame_paths, req.languages, video_id, prompt_extra
        )

        if not storyboard.scenes:
            raise ValueError("KI hat keine Szene zurueckgegeben")

        scene_texts = storyboard.scenes[0].texts
        await _send(job_id, "completed", "rewrite", "Szene erfolgreich neu geschrieben.", 100, {
            "texts": {lang: t.model_dump() for lang, t in scene_texts.items()},
            "scene_id": req.scene_id,
        })
    except Exception as exc:
        await _send(job_id, "error", "rewrite", str(exc))


@router.post("/videos/{video_id}/rewrite-scene", response_model=JobStartResponse)
async def rewrite_scene(
    video_id: str,
    req: RewriteSceneRequest,
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> JobStartResponse:
    job_id = str(uuid.uuid4())
    job_store.create_queue(job_id)
    background_tasks.add_task(_run_rewrite_scene, video_id, job_id, req)
    return JobStartResponse(job_id=job_id, video_id=video_id, message="Szene wird neu analysiert")
