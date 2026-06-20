"""
Azure Cognitive Services Provider: Multimodale Frame-Analyse via
cognitiveservices.azure.com-Endpunkt (z. B. gpt-5-mini Deployment).
"""
from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import List

from openai import AzureOpenAI

from app.config import settings
from app.models import StoryboardJson
from app.services.ai_provider_base import AiProviderBase, compress_frame_for_ki
from app.services.storyboard_service import build_analysis_prompt, parse_storyboard_response

logger = logging.getLogger(__name__)

# gpt-5-mini ist ein Reasoning-Modell: internes Reasoning verbraucht deutlich
# mehr Zeit als normale Modelle. 300s Timeout um Abbrueche bei komplexen
# multimodalen Anfragen mit mehreren Bildern zu vermeiden.
_REQUEST_TIMEOUT = 300


class AzureCognitiveProvider(AiProviderBase):

    def __init__(self, model: str | None = None) -> None:
        if not settings.azure_cognitive_api_key:
            raise ValueError("AZURE_COGNITIVE_API_KEY ist nicht gesetzt.")
        if not settings.azure_cognitive_endpoint:
            raise ValueError("AZURE_COGNITIVE_ENDPOINT ist nicht gesetzt.")

        self._client = AzureOpenAI(
            api_key=settings.azure_cognitive_api_key,
            azure_endpoint=settings.azure_cognitive_endpoint,
            api_version=settings.azure_cognitive_api_version,
            timeout=_REQUEST_TIMEOUT,
            max_retries=0,  # Retry-Logik liegt im _call_with_retry-Wrapper
        )
        self._deployment = model or settings.azure_cognitive_deployment

    def _encode_image(self, path: Path) -> str:
        return base64.b64encode(compress_frame_for_ki(path)).decode("utf-8")

    def analyze_frames(
        self,
        frame_paths: List[Path],
        languages: List[str],
        video_id: str,
        prompt_extra: str = "",
    ) -> StoryboardJson:
        sample_paths = frame_paths[:: max(1, len(frame_paths) // 10)][:10]
        total = len(sample_paths)

        prompt = build_analysis_prompt(languages, video_id, prompt_extra, num_frames=total)

        content: list = [{"type": "text", "text": prompt}]
        for i, p in enumerate(sample_paths, 1):
            content.append({"type": "text", "text": f"[Bild {i} von {total}]"})
            b64 = self._encode_image(p)
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"},
            })

        logger.debug(
            "AzureCognitive analyze_frames: deployment=%s frames=%d",
            self._deployment, total,
        )
        try:
            response = self._client.chat.completions.create(
                model=self._deployment,
                messages=[{"role": "user", "content": content}],
                response_format={"type": "json_object"},
                max_completion_tokens=16000,  # Reasoning-Modell: Tokens fuer Denken + Antwort
            )
        except Exception as exc:
            logger.warning("AzureCognitive analyze_frames Fehler: %s", exc)
            raise

        raw_json = response.choices[0].message.content or "{}"
        return parse_storyboard_response(raw_json, video_id, frame_paths, languages)

    def complete_text(self, prompt: str) -> str:
        try:
            response = self._client.chat.completions.create(
                model=self._deployment,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                max_completion_tokens=16000,  # Reasoning-Modell: Tokens fuer Denken + Antwort
            )
        except Exception as exc:
            logger.warning("AzureCognitive complete_text Fehler: %s", exc)
            raise
        return response.choices[0].message.content or "{}"
