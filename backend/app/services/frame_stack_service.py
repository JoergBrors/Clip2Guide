"""
Frame-Stack-Service: Laedt und speichert den FrameStack als JSON.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.config import settings
from app.models import FrameStack


_FILENAME = "frame_stack.json"


class FrameStackService:

    def _stack_path(self, video_id: str) -> Path:
        return settings.frames_dir / video_id / _FILENAME

    def save(self, stack: FrameStack) -> Path:
        path = self._stack_path(stack.video_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(stack.model_dump_json(indent=2), encoding="utf-8")
        return path

    def load(self, video_id: str) -> FrameStack:
        path = self._stack_path(video_id)
        if not path.exists():
            raise FileNotFoundError(f"frame_stack.json nicht gefunden: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        return FrameStack.model_validate(data)

    def exists(self, video_id: str) -> bool:
        return self._stack_path(video_id).exists()

    def list_frame_paths(self, video_id: str) -> list[Path]:
        """Gibt sortierte Liste aller Frame-JPG-Pfade zurueck."""
        frame_dir = settings.frames_dir / video_id
        return sorted(frame_dir.glob("frame_*.jpg"))
