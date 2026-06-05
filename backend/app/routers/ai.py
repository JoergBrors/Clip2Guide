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
from app.models import AnalyzeRequest, AiProvider, EnrichRequest, JobStartResponse, RewriteSceneRequest, StoryboardJson, StoryboardUpdateRequest
from app.services.frame_stack_service import FrameStackService
from app.services.storyboard_service import StoryboardService, build_analysis_prompt, build_enrich_prompt

router = APIRouter()
_stack_svc = FrameStackService()
_storyboard_svc = StoryboardService()


async def _send(job_id: str, type_: str, step: str, message: str, percent: int = 0, data: dict | None = None) -> None:
    await job_store.send_event(job_id, {
        "type": type_, "step": step, "message": message,
        "percent": percent, **({"data": data} if data else {}),
    })

async def _call_with_retry(job_id: str, step: str, fn, base_percent: int, *args):
    """Fuehrt fn(*args) in einem Thread-Executor aus.

    Bei Throttling (503/429) wird der Aufruf automatisch mit Exponential-Backoff
    wiederholt (Anzahl, Wartezeit und Faktor kommen aus den Settings).
    Waehrenddessen werden Countdown-Progress-Events gesendet.
    Nach Erschoepfen aller Versuche wird die letzte Exception re-raised.
    """
    loop = asyncio.get_event_loop()
    max_attempts = max(1, settings.ai_retry_max_attempts + 1)  # +1 = erster Versuch
    delay = settings.ai_retry_initial_delay
    last_exc: Exception | None = None

    for attempt in range(max_attempts):
        try:
            return await loop.run_in_executor(None, fn, *args)
        except Exception as exc:
            last_exc = exc
            if not _is_throttle_error(exc):
                raise  # Nicht-Throttle-Fehler sofort weiterleiten
            retry_left = max_attempts - attempt - 1
            if retry_left <= 0:
                break  # alle Versuche aufgebraucht
            wait = min(delay, settings.ai_retry_max_delay)
            for remaining in range(int(wait), 0, -1):
                await _send(
                    job_id, "progress", step,
                    f"Modell überlastet – Retry {attempt + 1}/{max_attempts - 1} in {remaining}s ...",
                    base_percent,
                )
                await asyncio.sleep(1)
            delay = min(delay * settings.ai_retry_backoff_factor, settings.ai_retry_max_delay)

    raise last_exc  # type: ignore[misc]

# ── Verfuegbare Modelle ────────────────────────────────────────────────────────

OPENAI_VISION_MODELS: List[str] = [
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "o4-mini",
    "o3",
]

AZURE_OPENAI_VISION_MODELS: List[str] = [
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-4o",
    "gpt-4o-mini",
]

AZURE_COGNITIVE_VISION_MODELS: List[str] = [
    "gpt-5-mini",
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-4o",
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


@router.get("/ai/providers")
async def list_providers() -> dict:
    """Gibt die in AI_PROVIDER konfigurierten Provider zurueck (kommagetrennte Liste in .env)."""
    PROVIDER_LABELS = {
        AiProvider.GEMINI.value: "Google Gemini",
        AiProvider.OPENAI.value: "OpenAI",
        AiProvider.AZURE_OPENAI.value: "Azure OpenAI",
        AiProvider.AZURE_COGNITIVE.value: "Azure Cognitive Services",
    }
    result = []
    for p in settings.ai_providers:
        if p not in PROVIDER_LABELS:
            continue
        result.append({"id": p, "label": PROVIDER_LABELS[p]})
    return {"providers": result, "default": result[0]["id"] if result else "gemini"}


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
    elif provider == AiProvider.AZURE_OPENAI.value:
        if not settings.azure_openai_api_key:
            raise HTTPException(status_code=400, detail="AZURE_OPENAI_API_KEY ist nicht gesetzt.")
        if not settings.azure_openai_endpoint:
            raise HTTPException(status_code=400, detail="AZURE_OPENAI_ENDPOINT ist nicht gesetzt.")
        return {
            "provider": provider,
            "models": AZURE_OPENAI_VISION_MODELS,
            "default": settings.azure_openai_deployment,
        }
    elif provider == AiProvider.AZURE_COGNITIVE.value:
        if not settings.azure_cognitive_api_key:
            raise HTTPException(status_code=400, detail="AZURE_COGNITIVE_API_KEY ist nicht gesetzt.")
        if not settings.azure_cognitive_endpoint:
            raise HTTPException(status_code=400, detail="AZURE_COGNITIVE_ENDPOINT ist nicht gesetzt.")
        return {
            "provider": provider,
            "models": AZURE_COGNITIVE_VISION_MODELS,
            "default": settings.azure_cognitive_deployment,
        }
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
    elif provider_name == AiProvider.AZURE_OPENAI.value:
        from app.services.azure_openai_provider import AzureOpenAiProvider
        return AzureOpenAiProvider(model=model)
    elif provider_name == AiProvider.AZURE_COGNITIVE.value:
        from app.services.azure_cognitive_provider import AzureCognitiveProvider
        return AzureCognitiveProvider(model=model)
    else:
        raise ValueError(f"Unbekannter AI-Provider: {provider_name}")


def _is_throttle_error(exc: Exception) -> bool:
    """Erkennt 503/429 Throttling-Fehler aller KI-Anbieter."""
    msg = str(exc).lower()
    return any(k in msg for k in [
        "503", "429", "high demand", "overloaded", "rate limit", "rate_limit",
        "quota", "too many requests", "resource exhausted", "unavailable", "capacity",
    ])


def _get_effective_model(provider_name: str, model_override: str | None) -> str:
    """Gibt den tatsaechlich verwendeten Modellnamen zurueck."""
    if model_override:
        return model_override
    if provider_name == AiProvider.GEMINI.value:
        return settings.gemini_model
    elif provider_name == AiProvider.OPENAI.value:
        return settings.openai_model
    elif provider_name == AiProvider.AZURE_OPENAI.value:
        return settings.azure_openai_deployment
    elif provider_name == AiProvider.AZURE_COGNITIVE.value:
        return settings.azure_cognitive_deployment
    return "unknown"


def _throttle_alternatives(current_provider: str, current_model: str) -> list[dict]:
    """Baut eine Liste alternativer Modelle fuer den Throttle-Dialog."""
    alternatives: list[dict] = []
    provider_labels: dict[str, str] = {
        AiProvider.GEMINI.value: "Google Gemini",
        AiProvider.OPENAI.value: "OpenAI",
        AiProvider.AZURE_OPENAI.value: "Azure OpenAI",
        AiProvider.AZURE_COGNITIVE.value: "Azure Cognitive Services",
    }
    same_provider_models: dict[str, list[str]] = {
        AiProvider.GEMINI.value: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-flash"],
        AiProvider.OPENAI.value: OPENAI_VISION_MODELS,
        AiProvider.AZURE_OPENAI.value: AZURE_OPENAI_VISION_MODELS,
        AiProvider.AZURE_COGNITIVE.value: AZURE_COGNITIVE_VISION_MODELS,
    }
    # Andere Modelle desselben Providers
    for m in same_provider_models.get(current_provider, []):
        if m != current_model:
            alternatives.append({
                "provider": current_provider,
                "model": m,
                "label": f"{provider_labels.get(current_provider, current_provider)} · {m}",
            })
    # Andere konfigurierte Provider mit Default-Modell
    provider_defaults: dict[str, str] = {
        AiProvider.GEMINI.value: settings.gemini_model,
        AiProvider.OPENAI.value: settings.openai_model,
        AiProvider.AZURE_OPENAI.value: settings.azure_openai_deployment,
        AiProvider.AZURE_COGNITIVE.value: settings.azure_cognitive_deployment,
    }
    for p in settings.ai_providers:
        if p != current_provider and p in provider_defaults:
            alternatives.append({
                "provider": p,
                "model": provider_defaults[p],
                "label": f"{provider_labels.get(p, p)} · {provider_defaults[p]}",
            })
    return alternatives[:6]

    if provider_name == AiProvider.GEMINI.value:
        from app.services.gemini_provider import GeminiProvider
        return GeminiProvider(model=model)
    elif provider_name == AiProvider.OPENAI.value:
        from app.services.openai_provider import OpenAiProvider
        return OpenAiProvider(model=model)
    elif provider_name == AiProvider.AZURE_OPENAI.value:
        from app.services.azure_openai_provider import AzureOpenAiProvider
        return AzureOpenAiProvider(model=model)
    else:
        raise ValueError(f"Unbekannter AI-Provider: {provider_name}")


def _build_analyze_master_context(req: AnalyzeRequest, provider_name: str, model_name: str) -> dict:
    """Erzeugt den unveraenderlichen Master-Kontext der Erstanalyse."""
    scenes: list[dict] = []
    for idx, group in enumerate(req.scene_groups or []):
        scenes.append({
            "scene_index": idx,
            "description": req.scene_descriptions[idx] if idx < len(req.scene_descriptions) else "",
            "frames": group,
            "image_prompts": {
                fn: req.image_prompts[fn]
                for fn in group
                if req.image_prompts.get(fn, "").strip()
            },
        })
    return {
        "provider": provider_name,
        "model": model_name,
        "languages": req.languages,
        "master_prompt": req.master_prompt.strip(),
        "selected_frames": req.selected_frames,
        "scene_groups": scenes,
        "instruction": (
            "Dieser Master-Kontext stammt aus der initialen Storyboard-Erstellung. "
            "Bei spaeteren Szenen-Rewrites muss diese Gesamtanweisung erhalten bleiben; "
            "Aenderungen duerfen sie nur ergaenzen, nicht ersetzen."
        ),
    }


def _append_change_history(storyboard: StoryboardJson, change_summary: str, context: dict | None = None) -> None:
    """Fuegt einen kompakten Eintrag zur Storyboard-Aenderungshistorie hinzu."""
    history = storyboard.metadata.get("ai_change_history", [])
    if not isinstance(history, list):
        history = []
    entry = {
        "index": len(history) + 1,
        "summary": change_summary,
    }
    if context:
        entry["context"] = context
    history.append(entry)
    storyboard.metadata["ai_change_history"] = history[-50:]


def _build_storyboard_context_hint(storyboard: StoryboardJson) -> str:
    """Fasst Master-Kontext, Historie und aktuelle Storyboard-Struktur fuer Rewrites zusammen."""
    master = storyboard.metadata.get("ai_master_context")
    history = storyboard.metadata.get("ai_change_history", [])
    lines: list[str] = [
        "Gesamt-Kontext des Storyboards:",
        "Bewahre den urspruenglichen Master-Kontext und die erzählerische Kontinuitaet.",
    ]
    if master:
        lines.append("Urspruenglicher Master-Kontext:")
        lines.append(str(master))
    if history:
        lines.append("Aenderungshistorie:")
        for item in history[-20:]:
            lines.append(f"  {item}")
    lines.append("Aktuelle Storyboard-Struktur:")
    for idx, scene in enumerate(storyboard.scenes, 1):
        text_bits = []
        for lang, panel in scene.texts.items():
            text_bits.append(
                f"{lang}: heading={panel.heading!r}; body={panel.body!r}; "
                f"speaker_notes={panel.speaker_notes!r}"
            )
        lines.append(
            f"  Szene {idx} ({scene.scene_id}): frames={scene.image_group}; "
            f"duration={scene.duration_seconds:.1f}s; texts={' | '.join(text_bits)}"
        )
    return "\n".join(lines)


def _extract_master_context_from_request(req: RewriteSceneRequest) -> dict | None:
    """Liest einen vom Client aktualisierten Master-Kontext aus dem Rewrite-Kontext."""
    if not req.storyboard_context:
        return None
    master_context = req.storyboard_context.get("master_context")
    return master_context if isinstance(master_context, dict) else None


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

        provider = _get_provider(req)
        provider_name = req.ai_provider.value if req.ai_provider else settings.ai_provider
        model_name = _get_effective_model(provider_name, req.ai_model)
        master_prompt = req.master_prompt.strip()

        if req.scene_groups:
            # ── Nutzer-definierte Szenen-Gruppen: KI einmal pro Gruppe aufrufen ──────────
            all_frame_map = {p.name: p for p in frame_paths}
            scenes_result = []
            total_groups = len(req.scene_groups)
            await _send(job_id, "progress", "analyze",
                        f"Nutzer-Gruppierung: {total_groups} Szene(n) werden separat analysiert...", 10)

            for g_idx, group_filenames in enumerate(req.scene_groups):
                pct_base = 15 + int(70 * g_idx / max(total_groups, 1))
                scene_id = f"scene_{g_idx + 1:03d}"
                group_paths = [all_frame_map[fn] for fn in group_filenames if fn in all_frame_map]
                if not group_paths:
                    continue
                await _send(job_id, "progress", "analyze",
                            f"Szene {g_idx + 1}/{total_groups}: {len(group_paths)} Bilder...", pct_base)
                prompt_parts = [
                    f"Erstelle genau EINE Szene mit scene_id '{scene_id}'. "
                    "Alle gezeigten Bilder gehoeren zusammen zu dieser einen Szene.",
                ]
                if master_prompt:
                    prompt_parts.insert(
                        0,
                        "Allgemein vorangestellter Master-Prompt des Nutzers:\n"
                        f"{master_prompt}"
                    )
                scene_description = (
                    req.scene_descriptions[g_idx].strip()
                    if g_idx < len(req.scene_descriptions)
                    else ""
                )
                if scene_description:
                    prompt_parts.append(
                        "Kurze Nutzerbeschreibung dieser Szene:\n"
                        f"{scene_description}"
                    )
                image_prompt_lines = []
                for fn in group_filenames:
                    image_prompt = req.image_prompts.get(fn, "").strip()
                    if image_prompt:
                        image_prompt_lines.append(f"  Bild '{fn}': {image_prompt}")
                if image_prompt_lines:
                    prompt_parts.append(
                        "Bildspezifische KI-Anweisungen des Nutzers:\n"
                        + "\n".join(image_prompt_lines)
                    )
                prompt_extra = "\n\n".join(prompt_parts)
                sys_prompt = build_analysis_prompt(req.languages, video_id, prompt_extra, len(group_paths))
                await _send(job_id, "debug", "analyze",
                            f"[Szene {g_idx + 1}/{total_groups}]  Provider: {provider_name} / {model_name}\n"
                            f"Frames: {[p.name for p in group_paths]}\n\n"
                            f"--- Prompt ---\n{sys_prompt}",
                            pct_base,
                            {"prompt": sys_prompt, "scene_id": scene_id})
                group_sb = await _call_with_retry(
                    job_id, "analyze",
                    provider.analyze_frames, pct_base,
                    group_paths, req.languages, video_id, prompt_extra,
                )
                if group_sb.scenes:
                    s = group_sb.scenes[0]
                    s.scene_id = scene_id
                    s.image_group = [fn for fn in group_filenames if fn in all_frame_map]
                    s.image_prompts = {
                        fn: req.image_prompts[fn].strip()
                        for fn in s.image_group
                        if req.image_prompts.get(fn, "").strip()
                    }
                    if s.image_group:
                        s.start_frame = s.image_group[0]
                        s.end_frame = s.image_group[-1] if len(s.image_group) > 1 else None
                    scenes_result.append(s)

            storyboard = StoryboardJson(
                video_id=video_id,
                source_video="",
                cut_video=None,
                languages=req.languages,
                scenes=scenes_result,
                metadata={},
            )
        else:
            # ── Standard: KI erkennt Szenen selbst ───────────────────────────────────────
            await _send(job_id, "progress", "analyze", f"Analysiere {len(frame_paths)} Frames...", 20)
            standard_prompt_extra = (
                "Allgemein vorangestellter Master-Prompt des Nutzers:\n"
                f"{master_prompt}"
                if master_prompt else ""
            )
            sys_prompt = build_analysis_prompt(req.languages, video_id, standard_prompt_extra, len(frame_paths))
            await _send(job_id, "debug", "analyze",
                        f"Provider: {provider_name} / {model_name}\n"
                        f"Frames gesamt: {len(frame_paths)}\n\n"
                        f"--- System-Prompt ---\n{sys_prompt}",
                        20,
                        {"prompt": sys_prompt, "frame_count": len(frame_paths)})
            storyboard = await _call_with_retry(
                job_id, "analyze",
                provider.analyze_frames, 20,
                frame_paths, req.languages, video_id, standard_prompt_extra,
            )

        # Quellvideo eintragen
        cut_path = settings.cut_dir / f"{video_id}.mp4"
        storyboard.source_video = str(
            cut_path if cut_path.exists() else settings.upload_dir / f"{video_id}.mp4"
        )
        storyboard.cut_video = str(cut_path) if cut_path.exists() else None
        storyboard.metadata["ai_master_context"] = _build_analyze_master_context(req, provider_name, model_name)
        storyboard.metadata["ai_change_history"] = []

        await _send(job_id, "progress", "analyze", "Speichere Storyboard...", 90)
        _storyboard_svc.save(storyboard)

        await _send(job_id, "completed", "analyze", f"{len(storyboard.scenes)} Szenen erkannt.", 100,
                    {"scenes": len(storyboard.scenes), "video_id": video_id})
    except Exception as exc:
        if _is_throttle_error(exc):
            pname = req.ai_provider.value if req.ai_provider else (settings.ai_providers[0] if settings.ai_providers else AiProvider.GEMINI.value)
            mname = _get_effective_model(pname, req.ai_model)
            await _send(job_id, "throttled", "analyze",
                "Modell überlastet (503/429). Bitte wähle ein alternatives Modell.", 0,
                {"alternatives": _throttle_alternatives(pname, mname)})
        else:
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
        persisted_storyboard: StoryboardJson | None = None
        if _storyboard_svc.exists(video_id):
            persisted_storyboard = _storyboard_svc.load(video_id)
            should_save_context = False
            updated_master_context = _extract_master_context_from_request(req)
            if updated_master_context:
                persisted_storyboard.metadata["ai_master_context"] = updated_master_context
                should_save_context = True
            if req.change_summary:
                _append_change_history(
                    persisted_storyboard,
                    req.change_summary,
                    req.storyboard_context,
                )
                should_save_context = True
            if should_save_context:
                _storyboard_svc.save(persisted_storyboard)
        frames_dir = settings.frames_dir / video_id
        # Reihenfolge aus req.image_group beibehalten (entspricht der vom Nutzer
        # im Editor festgelegten Anordnung per Drag & Drop) – kein sorted()!
        frame_paths = [
            frames_dir / fn for fn in req.image_group if (frames_dir / fn).exists()
        ]
        if not frame_paths:
            raise FileNotFoundError(f"Keine Frames gefunden fuer Szene '{req.scene_id}'")

        await _send(job_id, "progress", "rewrite", f"Analysiere {len(frame_paths)} Frames...", 30)

        # Nutzer-Texte in den Prompt einbauen wenn vorhanden
        user_text_hint = ""
        if req.current_texts:
            lines = [
                "Der Nutzer hat fuer diese Szene bereits folgende Texte verfasst. "
                "Halte dich an den inhaltlichen Kern dieser Vorgaben und verbessere/ergaenze sie passend zu den Bildern:",
            ]
            for lang, tp in req.current_texts.items():
                if tp.heading or tp.body or tp.speaker_notes:
                    lines.append(f"  Sprache '{lang}':")
                    if tp.heading:
                        lines.append(f"    Ueberschrift: {tp.heading}")
                    if tp.body:
                        lines.append(f"    Beschreibung: {tp.body}")
                    if tp.speaker_notes:
                        lines.append(f"    Sprecher-Notizen: {tp.speaker_notes}")
            user_text_hint = "\n".join(lines)

        # Bildreihenfolge explizit aufführen (frame_paths = gefilterte Dateinamen in Nutzer-Reihenfolge)
        frame_order_lines = [
            f"  Position {i}: {p.name}"
            for i, p in enumerate(frame_paths, 1)
        ]
        frame_order_hint = (
            f"Die Bilder wurden vom Nutzer in folgender Reihenfolge angeordnet "
            f"(Position 1 = erstes/frühestes Bild, Position {len(frame_paths)} = letztes Bild):\n"
            + "\n".join(frame_order_lines)
        )

        # Bild-spezifische KI-Anweisungen
        image_prompt_hint = ""
        if req.image_prompts:
            lines = ["Fuer folgende Bilder hat der Nutzer spezifische KI-Anweisungen angegeben:"]
            for fn, ip in req.image_prompts.items():
                if ip and ip.strip():
                    pos = next((i + 1 for i, p in enumerate(frame_paths) if p.name == fn), None)
                    pos_str = f" (Position {pos})" if pos else ""
                    lines.append(f"  Bild '{fn}'{pos_str}: {ip.strip()}")
            if len(lines) > 1:
                image_prompt_hint = "\n".join(lines)

        duration_hint = ""
        if req.duration_seconds and req.duration_seconds > 0:
            words = max(5, int(req.duration_seconds * 130 / 60))
            duration_hint = (
                f"Die Szene soll {req.duration_seconds:.1f} Sekunden lang sein. "
                f"Passe die Laenge der speaker_notes entsprechend an – "
                f"schreibe ca. {words} Woerter pro Sprache "
                f"(bei ca. 130 Woertern pro Minute Sprechgeschwindigkeit). "
                f"Halte heading und body ebenfalls praegnant und zum Umfang passend."
            )

        prompt_extra = "\n\n".join(filter(None, [
            f"Hinweis: Diese Frames gehoeren alle zu EINER zusammenhaengenden Szene. "
            f"Erstelle genau eine Szene mit scene_id '{req.scene_id}'.",
            _build_storyboard_context_hint(persisted_storyboard) if persisted_storyboard else "",
            "Aktuelle Aenderung:\n" + req.change_summary if req.change_summary else "",
            "Aktueller vom Client uebergebener Gesamtzustand:\n" + str(req.storyboard_context)
            if req.storyboard_context else "",
            frame_order_hint,
            duration_hint,
            image_prompt_hint,
            user_text_hint,
        ]))

        # Debug-Event: Prompt-Details an den Client senden
        _pname = req.ai_provider.value if req.ai_provider else settings.ai_provider
        _mname = _get_effective_model(_pname, req.ai_model)
        await _send(job_id, "debug", "rewrite",
                    f"Provider: {_pname} / {_mname}\n"
                    f"Szene: {req.scene_id}\n"
                    f"Frames ({len(frame_paths)}): {[p.name for p in frame_paths]}\n\n"
                    f"--- Prompt-Extra ---\n{prompt_extra}",
                    30,
                    {"prompt_extra": prompt_extra, "scene_id": req.scene_id,
                     "provider": _pname, "model": _mname})

        analyze_req = AnalyzeRequest(
            video_id=video_id,
            languages=req.languages,
            ai_provider=req.ai_provider,
            ai_model=req.ai_model,
        )
        provider = _get_provider(analyze_req)
        storyboard = await _call_with_retry(
            job_id, "rewrite",
            provider.analyze_frames, 30,
            frame_paths, req.languages, video_id, prompt_extra,
        )

        if not storyboard.scenes:
            raise ValueError("KI hat keine Szene zurueckgegeben")

        scene_texts = storyboard.scenes[0].texts
        scene_duration = storyboard.scenes[0].duration_seconds
        await _send(job_id, "completed", "rewrite", "Szene erfolgreich neu geschrieben.", 100, {
            "texts": {lang: t.model_dump() for lang, t in scene_texts.items()},
            "scene_id": req.scene_id,
            "duration_seconds": scene_duration,
            "metadata": persisted_storyboard.metadata if persisted_storyboard else {},
        })
    except Exception as exc:
        if _is_throttle_error(exc):
            pname = req.ai_provider.value if req.ai_provider else (settings.ai_providers[0] if settings.ai_providers else AiProvider.GEMINI.value)
            mname = _get_effective_model(pname, req.ai_model)
            await _send(job_id, "throttled", "rewrite",
                "Modell überlastet (503/429). Bitte wähle ein alternatives Modell.", 0,
                {"alternatives": _throttle_alternatives(pname, mname)})
        else:
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


# ── Enrich: slide_panels + render_hints per KI befuellen ─────────────────────

def _parse_enrich_response(raw: str) -> dict:
    """Parst die KI-Antwort fuer den Enrich-Endpoint."""
    import json, re
    # JSON aus Markdown-Codeblöcken herausschneiden falls nötig
    match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw)
    cleaned = match.group(1) if match else raw.strip()
    # Führendes/abschließendes Nicht-JSON entfernen
    start = cleaned.find("{")
    end = cleaned.rfind("}") + 1
    if start >= 0 and end > start:
        cleaned = cleaned[start:end]
    return json.loads(cleaned)


async def _run_enrich(video_id: str, job_id: str, req: EnrichRequest) -> None:
    """Reichert slide_panels und render_hints fuer Szenen mit mehreren Bildern an."""
    import json as _json
    loop = asyncio.get_event_loop()
    try:
        if not _storyboard_svc.exists(video_id):
            raise FileNotFoundError(f"Storyboard nicht gefunden fuer {video_id}")

        storyboard = _storyboard_svc.load(video_id)
        analyze_req = AnalyzeRequest(
            video_id=video_id,
            languages=req.languages,
            ai_provider=req.ai_provider,
            ai_model=req.ai_model,
        )
        provider = _get_provider(analyze_req)
        frames_dir = settings.frames_dir / video_id
        languages = req.languages or storyboard.languages or ["de"]

        # Szenen bestimmen die angereichert werden sollen
        target_ids = set(req.scene_ids) if req.scene_ids else None
        scenes_to_enrich = [
            (i, s) for i, s in enumerate(storyboard.scenes)
            if len(s.image_group) > 1
            and (target_ids is None or s.scene_id in target_ids)
            and (target_ids is not None or not s.slide_panels)
        ]

        total = len(scenes_to_enrich)
        if total == 0:
            await _send(job_id, "completed", "enrich",
                        "Alle Szenen bereits angereichert oder keine Szene mit mehreren Bildern.", 100,
                        {"enriched": 0})
            return

        await _send(job_id, "progress", "enrich",
                    f"Reichere {total} Szene(n) an...", 5)

        enriched_count = 0
        for step, (scene_idx, scene) in enumerate(scenes_to_enrich):
            pct = 5 + int(90 * step / total)
            await _send(job_id, "progress", "enrich",
                        f"Szene {step+1}/{total}: {scene.scene_id} ({len(scene.image_group)} Bilder)...",
                        pct)

            prompt = build_enrich_prompt(scene, languages, frames_dir)
            # Provider mit Text-only-Prompt aufrufen – mit automatischem Retry bei Throttling
            try:
                raw = await _call_with_retry(
                    job_id, "enrich",
                    provider.complete_text, pct,
                    prompt,
                )
            except Exception as call_exc:
                await _send(job_id, "progress", "enrich",
                            f"  [WARN] Szene {scene.scene_id}: API-Fehler ({call_exc}), übersprungen.", pct)
                continue

            try:
                data = _parse_enrich_response(raw)
            except Exception as parse_exc:
                await _send(job_id, "progress", "enrich",
                            f"  [WARN] Szene {scene.scene_id}: Parse-Fehler ({parse_exc}), übersprungen.", pct)
                continue

            # slide_panels befüllen
            slide_panels_raw = data.get("slide_panels", {})
            slide_panels: dict = {}
            for lang, panels_raw in slide_panels_raw.items():
                if isinstance(panels_raw, list):
                    parsed_panels = []
                    for p in panels_raw:
                        if isinstance(p, dict):
                            parsed_panels.append({
                                "heading": str(p.get("heading", "")),
                                "body":    str(p.get("body", "")),
                                "speaker_notes": str(p.get("speaker_notes", "")),
                            })
                    # Länge an image_group anpassen (kürzen oder mit letztem Element auffüllen)
                    n = len(scene.image_group)
                    while len(parsed_panels) < n and parsed_panels:
                        parsed_panels.append(parsed_panels[-1])
                    slide_panels[lang] = parsed_panels[:n]

            render_hints_raw = data.get("render_hints", {})
            render_hints: dict = {}
            if isinstance(render_hints_raw, dict):
                if "transition" in render_hints_raw:
                    render_hints["transition"] = str(render_hints_raw["transition"])
                if "image_durations" in render_hints_raw:
                    try:
                        durations = [float(d) for d in render_hints_raw["image_durations"]]
                        n = len(scene.image_group)
                        while len(durations) < n and durations:
                            durations.append(durations[-1])
                        render_hints["image_durations"] = durations[:n]
                    except (TypeError, ValueError):
                        pass

            storyboard.scenes[scene_idx].slide_panels = slide_panels
            storyboard.scenes[scene_idx].render_hints = render_hints
            enriched_count += 1

        # Storyboard mit angereicherten Daten speichern
        _storyboard_svc.save(storyboard)
        await _send(job_id, "completed", "enrich",
                    f"{enriched_count} Szene(n) angereichert.", 100,
                    {"enriched": enriched_count, "storyboard": storyboard.model_dump()})

    except Exception as exc:
        if _is_throttle_error(exc):
            pname = req.ai_provider.value if req.ai_provider else (settings.ai_providers[0] if settings.ai_providers else AiProvider.GEMINI.value)
            mname = _get_effective_model(pname, req.ai_model)
            await _send(job_id, "throttled", "enrich",
                "Modell überlastet (503/429). Bitte wähle ein alternatives Modell.", 0,
                {"alternatives": _throttle_alternatives(pname, mname)})
        else:
            await _send(job_id, "error", "enrich", str(exc))


@router.post("/videos/{video_id}/storyboard/enrich", response_model=JobStartResponse)
async def enrich_storyboard(
    video_id: str,
    req: EnrichRequest,
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> JobStartResponse:
    """Reichert Szenen mit mehreren Bildern via KI an (slide_panels + render_hints)."""
    job_id = str(uuid.uuid4())
    job_store.create_queue(job_id)
    background_tasks.add_task(_run_enrich, video_id, job_id, req)
    return JobStartResponse(job_id=job_id, video_id=video_id, message="Anreicherung gestartet")
