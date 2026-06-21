"""
OpenAI-Provider: Multimodale Frame-Analyse via OpenAI Vision API.
"""
from __future__ import annotations

import base64
from pathlib import Path
from typing import List

from openai import OpenAI

from app.config import settings
from app.models import StoryboardJson
from app.services.ai_provider_base import AiProviderBase, compress_frame_for_ki
from app.services.storyboard_service import build_analysis_prompt, parse_storyboard_response


class OpenAiProvider(AiProviderBase):

    def __init__(self, model: str | None = None) -> None:
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY ist nicht gesetzt.")
        self._client = OpenAI(api_key=settings.openai_api_key, timeout=120, max_retries=0)
        self._model_name = model or settings.openai_model

    def _encode_image(self, path: Path) -> str:
        return base64.b64encode(compress_frame_for_ki(path)).decode("utf-8")

    def analyze_frames(
        self,
        frame_paths: List[Path],
        languages: List[str],
        video_id: str,
        prompt_extra: str = "",
    ) -> StoryboardJson:
        # Bilder vorbereiten (max. 10 Frames – OpenAI ist kostenintensiver)
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

        response = self._client.chat.completions.create(
            model=self._model_name,
            messages=[{"role": "user", "content": content}],
            response_format={"type": "json_object"},
            max_tokens=4096,
        )

        raw_json = response.choices[0].message.content or "{}"
        storyboard = parse_storyboard_response(raw_json, video_id, frame_paths, languages)
        return storyboard

    def complete_text(self, prompt: str) -> str:
        response = self._client.chat.completions.create(
            model=self._model_name,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=8192,
        )
        return response.choices[0].message.content or "{}"

    def complete_text_with_images(self, prompt: str, image_paths: list[Path]) -> str:
        content: list = []
        for i, p in enumerate(image_paths, 1):
            content.append({"type": "text", "text": f"[Bild {i}]"})
            b64 = self._encode_image(p)
            content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "low"}})
        content.append({"type": "text", "text": prompt})
        response = self._client.chat.completions.create(
            model=self._model_name,
            messages=[{"role": "user", "content": content}],
            response_format={"type": "json_object"},
            max_tokens=8192,
        )
        return response.choices[0].message.content or "{}"
