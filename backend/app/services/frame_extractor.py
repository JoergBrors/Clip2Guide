"""
Frame-Extractor: Extrahiert JPG-Frames aus einem Video mit ffmpeg.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import List

from app.config import settings
from app.models import FrameInfo, FrameStack


class FrameExtractor:

    def extract(
        self,
        video_path: Path,
        video_id: str,
        fps: float | None = None,
    ) -> FrameStack:
        """
        Extrahiert Frames aus `video_path` und speichert sie unter
        workspace/frames/{video_id}/frame_NNN.jpg.

        :returns: FrameStack mit allen extrahierten Frames.
        """
        out_dir = settings.frames_dir / video_id
        out_dir.mkdir(parents=True, exist_ok=True)

        if fps is None:
            fps = settings.frame_extraction_fps

        pattern = str(out_dir / "frame_%03d.jpg")

        cmd = [
            str(settings.ffmpeg_path),
            "-y",
            "-i", str(video_path),
            "-vf", f"fps={fps}",
            "-q:v", "2",
            pattern,
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        if result.returncode != 0:
            raise RuntimeError(f"Frame-Extraktion fehlgeschlagen:\n{result.stderr[-2000:]}")

        frame_files = sorted(out_dir.glob("frame_*.jpg"))

        frames: List[FrameInfo] = []
        for i, f in enumerate(frame_files):
            timestamp = i / fps
            frames.append(FrameInfo(filename=f.name, timestamp_seconds=timestamp))

        return FrameStack(
            video_id=video_id,
            frames=frames,
            total_frames=len(frames),
        )
