"""
Gemini-Provider: Multimodale Frame-Analyse via Google GenAI SDK (google-genai).
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import List

from google import genai
from google.genai import types

from app.config import settings
from app.models import StoryboardJson
from app.services.ai_provider_base import AiProviderBase
from app.services.storyboard_service import build_analysis_prompt, parse_storyboard_response


class GeminiProvider(AiProviderBase):

    def __init__(self, model: str | None = None) -> None:
        _env_file = Path(__file__).resolve().parent.parent.parent.parent / ".env"
        if not settings.gemini_api_key:
            import os
            lines = [
                "GEMINI_API_KEY ist nicht gesetzt.",
                f"  Projektverzeichnis : {Path(__file__).resolve().parent.parent.parent.parent}",
                f"  .env-Datei        : {_env_file}  (existiert={_env_file.exists()})",
                f"  AI_PROVIDER       : {settings.ai_provider!r}",
                "  Alle geladenen Keys aus os.environ mit 'GEMINI':",
            ]
            found = [k for k in os.environ if "GEMINI" in k.upper()]
            if found:
                for k in found:
                    val = os.environ[k]
                    lines.append(f"    {k}={val[:6]}... ({len(val)} Zeichen)")
            else:
                lines.append("    (keine)")
            msg = "\n".join(lines)
            print(msg, file=sys.stderr)
            raise ValueError(msg)

        self._client = genai.Client(api_key=settings.gemini_api_key)
        self._model_name = model or settings.gemini_model

    def analyze_frames(
        self,
        frame_paths: List[Path],
        languages: List[str],
        video_id: str,
        prompt_extra: str = "",
    ) -> StoryboardJson:
        # Bilder laden (max. 20 Frames um Token-Limit einzuhalten)
        sample_paths = frame_paths[:: max(1, len(frame_paths) // 20)][:20]
        total = len(sample_paths)

        prompt = build_analysis_prompt(languages, video_id, prompt_extra, num_frames=total)

        # Bilder als inline Parts aufbereiten – mit Nummernmarkierung
        parts: list = []
        for i, p in enumerate(sample_paths, 1):
            parts.append(types.Part.from_text(text=f"[Bild {i} von {total}]"))
            parts.append(types.Part.from_bytes(data=p.read_bytes(), mime_type="image/jpeg"))

        response = self._client.models.generate_content(
            model=self._model_name,
            contents=[prompt, *parts],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )

        raw_json = response.text.strip()
        storyboard = parse_storyboard_response(raw_json, video_id, frame_paths, languages)
        return storyboard
