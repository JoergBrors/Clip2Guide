"""
Render-Service: Baut den Subprocess-Befehl fuer create_tutorial.py.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import List, Tuple

from app.config import settings


class RenderService:

    def build_command(
        self,
        video_id: str,
        languages: List[str],
        storyboard_path: Path,
        fps: int = 25,
        quality: str = "ausgewogen",
        tts_slow: bool = False,
    ) -> Tuple[List[str], Path]:
        """
        Gibt (cmd, output_dir) zurueck.
        Der Aufrufer startet den Subprocess und streamt die Ausgabe.
        """
        script_path = settings.backend_root / "app" / "scripts" / "create_tutorial.py"
        output_dir = settings.render_output_dir / video_id
        output_dir.mkdir(parents=True, exist_ok=True)

        cmd: List[str] = [
            sys.executable,
            "-u",           # unbuffered stdout/stderr – wichtig fuer Echtzeit-Streaming
            str(script_path),
            "--storyboard", str(storyboard_path),
            "--languages", ",".join(languages),
            "--output-dir", str(output_dir),
            "--frames-dir", str(settings.frames_dir / video_id),
            "--fps", str(fps),
            "--quality", quality,
        ]
        if tts_slow:
            cmd.append("--tts-slow")

        return cmd, output_dir

    # Legacy-Kompatibilitaet (blockierend, kein Streaming)
    def render(self, video_id: str, languages: List[str], storyboard_path: Path) -> Path:
        import subprocess
        cmd, output_dir = self.build_command(video_id, languages, storyboard_path)
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(settings.backend_root),
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"Rendering fehlgeschlagen (Code {result.returncode}):\n"
                f"{result.stderr[-3000:]}"
            )
        return output_dir
