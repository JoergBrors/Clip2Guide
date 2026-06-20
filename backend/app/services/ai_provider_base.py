"""
AI-Provider – Abstrakte Basisklasse
"""
from __future__ import annotations

import io
from abc import ABC, abstractmethod
from pathlib import Path
from typing import List

from app.models import StoryboardJson

# Zielgröße und Qualität für KI-Übertragung.
# 768px Kantenlänge reicht für Texterkennung und UI-Details; Qualität 40
# liefert ~10-25 KB pro Frame statt 200-800 KB im Original.
_KI_MAX_SIDE = 768
_KI_JPEG_QUALITY = 40


def compress_frame_for_ki(path: Path) -> bytes:
    """Liest ein Frame, skaliert auf max. _KI_MAX_SIDE px und komprimiert als JPEG."""
    try:
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("Pillow ist nicht installiert.") from exc

    with Image.open(path) as img:
        img = img.convert("RGB")
        w, h = img.size
        if max(w, h) > _KI_MAX_SIDE:
            scale = _KI_MAX_SIDE / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=_KI_JPEG_QUALITY, optimize=True)
        return buf.getvalue()


class AiProviderBase(ABC):
    """Gemeinsame Schnittstelle fuer alle KI-Anbieter."""

    @abstractmethod
    def analyze_frames(
        self,
        frame_paths: List[Path],
        languages: List[str],
        video_id: str,
        prompt_extra: str = "",
    ) -> StoryboardJson:
        """
        Analysiert eine Liste von Frames und gibt ein vollstaendiges
        StoryboardJson zurueck.

        :param frame_paths:   Sortierte Liste der Frame-JPG-Pfade.
        :param languages:     Zielsprachen, z.B. ['de', 'en'].
        :param video_id:      ID des Quellvideos.
        :param prompt_extra:  Optionaler Zusatz-Kontext fuer den Prompt.
        """
        ...

    @abstractmethod
    def complete_text(self, prompt: str) -> str:
        """
        Schickt einen Text-Prompt an das Modell und gibt die Antwort als String zurueck.
        Kein Bildinhalt, nur Text. Wird fuer Enrich-Aufgaben verwendet.
        """
        ...
