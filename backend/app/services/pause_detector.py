"""
Pause-Detector: OpenCV-basierter Fallback fuer Szenen-Segmentierung.
Erkennt signifikante visuelle Aenderungen zwischen Frames.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import List

import cv2
import numpy as np

from app.config import settings


class PauseDetector:

    def detect_scenes(self, video_path: Path) -> List[float]:
        """
        Gibt eine Liste von Zeitpunkten (Sekunden) zurueck, an denen eine
        neue Szene beginnt. Nutzt pixelweise Frame-Differenz via OpenCV.
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise RuntimeError(f"Kann Video nicht oeffnen: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        threshold = settings.scene_diff_threshold
        min_frames = int(settings.min_scene_seconds * fps)

        scene_starts: List[float] = [0.0]
        prev_gray: np.ndarray | None = None
        frame_idx = 0
        frames_since_last_scene = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (5, 5), 0)

            if prev_gray is not None and frames_since_last_scene >= min_frames:
                diff = cv2.absdiff(gray, prev_gray)
                score = float(diff.mean()) / 255.0

                if score > threshold:
                    timestamp = frame_idx / fps
                    scene_starts.append(timestamp)
                    frames_since_last_scene = 0

            prev_gray = gray
            frame_idx += 1
            frames_since_last_scene += 1

        cap.release()
        return scene_starts

    def detect_silent_segments(self, audio_path: Path) -> List[dict]:
        """
        Erkennt Stille-Segmente via ffmpeg silencedetect.
        Gibt Liste von {'start': float, 'end': float} zurueck.
        """
        cmd = [
            str(settings.ffmpeg_path),
            "-i", str(audio_path),
            "-af", "silencedetect=noise=-40dB:d=0.5",
            "-f", "null", "-",
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        segments: List[dict] = []
        current_start: float | None = None

        for line in result.stderr.splitlines():
            if "silence_start" in line:
                try:
                    current_start = float(line.split("silence_start:")[1].strip())
                except (IndexError, ValueError):
                    pass
            elif "silence_end" in line and current_start is not None:
                try:
                    end_str = line.split("silence_end:")[1].split("|")[0].strip()
                    segments.append({"start": current_start, "end": float(end_str)})
                    current_start = None
                except (IndexError, ValueError):
                    pass

        return segments
