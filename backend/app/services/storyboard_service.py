"""
Storyboard-Service: Prompt-Bau, JSON-Parsing, Persistenz.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from app.config import settings
from app.models import Scene, StoryboardJson, TextPanel


# ── Prompt ────────────────────────────────────────────────────────────────────

def build_analysis_prompt(languages: List[str], video_id: str, extra: str = "") -> str:
    lang_list = ", ".join(languages)
    return f"""Du bist ein Experte fuer das Erstellen von Video-Tutorials.
Analysiere die folgenden Screenshots einer Bildschirmaufnahme und erstelle ein strukturiertes Storyboard.

Aufgabe:
- Teile die Aufnahme in logische Szenen ein (jede Szene = ein zusammenhaengender Arbeitsschritt).
- Vergebe fuer jede Szene eine scene_id (z.B. "scene_001").
- Schreibe fuer jede Szene und jede der folgenden Sprachen einen Text:
  Sprachen: {lang_list}
- Jeder Text hat: heading (kurze Ueberschrift), body (Erklaerung), speaker_notes (Vorlese-Text).
- Jedes Bild gehört zu exakt einer Szene. Weise alle Bilder den Szenen zu (image_group).
- Schaetze eine sinnvolle duration_seconds fuer jede Szene (min 2.0 Sekunden).

{extra}

Antworte NUR mit einem JSON-Objekt in diesem Format (kein Markdown, kein Erklaerungstext):
{{
  "scenes": [
    {{
      "scene_id": "scene_001",
      "image_group": ["frame_001.jpg", "frame_002.jpg"],
      "duration_seconds": 5.0,
      "texts": {{
        "de": {{"heading": "...", "body": "...", "speaker_notes": "..."}},
        "en": {{"heading": "...", "body": "...", "speaker_notes": "..."}}
      }}
    }}
  ]
}}

video_id: {video_id}
"""


# ── Parsing & Validierung ─────────────────────────────────────────────────────

def parse_storyboard_response(
    raw_json: str,
    video_id: str,
    frame_paths: List[Path],
    languages: List[str],
    retry_count: int = 0,
) -> StoryboardJson:
    """
    Parsed die KI-Antwort als StoryboardJson.
    Wirft ValueError bei ungueltiger Struktur (Aufrufer kann 1x retrien).
    """
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"KI-Antwort kein gueltiges JSON: {exc}") from exc

    scenes_raw = data.get("scenes", [])
    if not isinstance(scenes_raw, list) or len(scenes_raw) == 0:
        raise ValueError("KI-Antwort enthaelt keine Szenen.")

    all_frame_names = {p.name for p in frame_paths}
    scenes: List[Scene] = []

    for raw in scenes_raw:
        image_group: List[str] = [
            fn for fn in raw.get("image_group", []) if fn in all_frame_names
        ]

        texts: dict = {}
        for lang, tdata in raw.get("texts", {}).items():
            if isinstance(tdata, dict):
                texts[lang] = TextPanel(
                    heading=str(tdata.get("heading", "")),
                    body=str(tdata.get("body", "")),
                    speaker_notes=str(tdata.get("speaker_notes", "")),
                )

        scenes.append(Scene(
            scene_id=str(raw.get("scene_id", f"scene_{len(scenes)+1:03d}")),
            start_frame=image_group[0] if image_group else "",
            end_frame=image_group[-1] if image_group else None,
            image_group=image_group,
            texts=texts,
            duration_seconds=float(raw.get("duration_seconds", 5.0)),
        ))

    storyboard = StoryboardJson(
        video_id=video_id,
        source_video="",
        languages=languages,
        scenes=scenes,
    )
    return storyboard


# ── Persistenz ────────────────────────────────────────────────────────────────

class StoryboardService:

    def _path(self, video_id: str) -> Path:
        return settings.ai_output_dir / video_id / "storyboard.json"

    def save(self, storyboard: StoryboardJson) -> Path:
        path = self._path(storyboard.video_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(storyboard.model_dump_json(indent=2), encoding="utf-8")
        return path

    def load(self, video_id: str) -> StoryboardJson:
        path = self._path(video_id)
        if not path.exists():
            raise FileNotFoundError(f"Storyboard nicht gefunden: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        return StoryboardJson.model_validate(data)

    def exists(self, video_id: str) -> bool:
        return self._path(video_id).exists()
