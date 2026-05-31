"""
FFmpeg-Service: Metadaten, Konvertierung, Frame-Zählung.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import settings


class FfmpegService:

    def _run(self, cmd: List[str]) -> subprocess.CompletedProcess:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

    def get_metadata(self, video_path: Path) -> Dict[str, Any]:
        """Gibt ffprobe-Metadaten als Dict zurueck."""
        cmd = [
            str(settings.ffprobe_path),
            "-v", "quiet",
            "-print_format", "json",
            "-show_streams",
            "-show_format",
            str(video_path),
        ]
        result = self._run(cmd)
        if result.returncode != 0:
            raise RuntimeError(f"ffprobe Fehler:\n{result.stderr}")
        return json.loads(result.stdout)

    def has_audio(self, metadata: Dict[str, Any]) -> bool:
        """Prueft ob das Video einen Audio-Stream hat."""
        return any(
            s.get("codec_type") == "audio"
            for s in metadata.get("streams", [])
        )

    def get_duration(self, metadata: Dict[str, Any]) -> float:
        """Gibt die Videodauer in Sekunden zurueck."""
        try:
            return float(metadata["format"]["duration"])
        except (KeyError, TypeError, ValueError):
            return 0.0

    def get_video_stream(self, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for s in metadata.get("streams", []):
            if s.get("codec_type") == "video":
                return s
        return None

    def get_resolution(self, metadata: Dict[str, Any]) -> tuple[int, int]:
        """Gibt (Breite, Hoehe) zurueck."""
        vs = self.get_video_stream(metadata)
        if vs:
            return int(vs.get("width", 0)), int(vs.get("height", 0))
        return 0, 0

    def extract_audio(self, video_path: Path, audio_path: Path) -> Path:
        """Extrahiert Audio-Spur als WAV."""
        audio_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            str(settings.ffmpeg_path),
            "-y", "-i", str(video_path),
            "-vn", "-acodec", "pcm_s16le",
            "-ar", "44100", "-ac", "2",
            str(audio_path),
        ]
        result = self._run(cmd)
        if result.returncode != 0:
            raise RuntimeError(f"Audio-Extraktion fehlgeschlagen:\n{result.stderr}")
        return audio_path
