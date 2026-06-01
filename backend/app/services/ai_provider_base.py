"""
AI-Provider – Abstrakte Basisklasse
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import List

from app.models import StoryboardJson


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
