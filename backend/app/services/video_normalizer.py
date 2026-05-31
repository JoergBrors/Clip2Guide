"""
Video-Normalizer: Konvertiert Upload-Video in ein einheitliches Format
(H.264 1080p, AAC 44100 Hz, konstante Frame-Rate).
"""
from __future__ import annotations

import asyncio
import subprocess
import threading
from pathlib import Path
from typing import Awaitable, Callable, List, Optional

from app.config import settings

ProgressCallback = Callable[[int, str], Awaitable[None]]
LogCallback = Callable[[str], Awaitable[None]]


class VideoNormalizer:

    def normalize(
        self,
        input_path: Path,
        output_path: Path,
        has_audio: bool = True,
        target_fps: int = 30,
    ) -> Path:
        """
        Blockierende Variante (ohne Progress). Wird nur noch als Fallback verwendet.
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = self._build_cmd(input_path, output_path, has_audio, target_fps)
        result = subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        if result.returncode != 0:
            raise RuntimeError(f"Normalisierung fehlgeschlagen:\n{result.stderr[-2000:]}")
        return output_path

    async def normalize_async(
        self,
        input_path: Path,
        output_path: Path,
        has_audio: bool = True,
        target_fps: int = 30,
        progress_cb: Optional[ProgressCallback] = None,
        log_cb: Optional[LogCallback] = None,
    ) -> Path:
        """
        Async-Variante mit Echtzeit-Fortschrittsrueckmeldung und Live-Log.

        Verwendet run_in_executor + blocking subprocess.Popen, da
        asyncio.create_subprocess_exec auf Windows mit SelectorEventLoop
        (uvicorn --reload) NotImplementedError wirft.

        stdout: -progress key=value fuer Fortschritt
        stderr: rohe FFmpeg-Ausgabe wird zeilenweise an log_cb geliefert
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        total_us = await self._get_duration_us(input_path)

        cmd = self._build_cmd(input_path, output_path, has_audio, target_fps)
        cmd = cmd[:-1] + ["-progress", "pipe:1", "-stats_period", "2", cmd[-1]]

        loop = asyncio.get_running_loop()

        # Queue-Eintraege: ("stdout", line) | ("stderr", line) | None (Sentinel)
        Event = Optional[tuple[str, str]]
        q: asyncio.Queue[Event] = asyncio.Queue()

        def _read_stdout(proc: subprocess.Popen) -> None:
            assert proc.stdout is not None
            for raw in proc.stdout:
                line = raw.decode("utf-8", errors="replace").strip()
                if line:
                    loop.call_soon_threadsafe(q.put_nowait, ("stdout", line))

        def _read_stderr(proc: subprocess.Popen) -> None:
            assert proc.stderr is not None
            for raw in proc.stderr:
                line = raw.decode("utf-8", errors="replace").rstrip()
                if line:
                    loop.call_soon_threadsafe(q.put_nowait, ("stderr", line))

        def _run_blocking() -> int:
            with subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                bufsize=1,
            ) as proc:
                t_out = threading.Thread(target=_read_stdout, args=(proc,), daemon=True)
                t_err = threading.Thread(target=_read_stderr, args=(proc,), daemon=True)
                t_out.start()
                t_err.start()
                t_out.join()
                t_err.join()
                proc.wait()
                returncode = proc.returncode
            loop.call_soon_threadsafe(q.put_nowait, None)  # Sentinel
            return returncode

        future = loop.run_in_executor(None, _run_blocking)

        speed = ""
        fps = ""
        out_time_us = 0.0
        stderr_lines: list[str] = []

        while True:
            item = await q.get()
            if item is None:
                break
            channel, line = item

            if channel == "stderr":
                stderr_lines.append(line)
                if log_cb:
                    await log_cb(line)

            else:  # stdout: key=value progress-Format
                if "=" not in line:
                    continue
                key, _, value = line.partition("=")
                if key == "out_time_us":
                    try:
                        out_time_us = float(value)
                    except ValueError:
                        pass
                elif key == "fps":
                    fps = value
                elif key == "speed":
                    speed = value
                elif key == "progress" and progress_cb:
                    if total_us > 0:
                        pct = min(int(out_time_us / total_us * 88) + 10, 98)
                    else:
                        pct = 50
                    secs = out_time_us / 1_000_000
                    h, rem = divmod(int(secs), 3600)
                    m, s = divmod(rem, 60)
                    detail = f"{h:02d}:{m:02d}:{s:02d}"
                    parts = [f"Kodiere {detail}"]
                    if fps:
                        parts.append(f"{fps} fps")
                    if speed:
                        parts.append(f"{speed}x")
                    await progress_cb(pct, "  ·  ".join(parts))

        returncode = await future

        if returncode != 0:
            raise RuntimeError(
                f"Normalisierung fehlgeschlagen:\n"
                + "\n".join(stderr_lines[-50:])
            )
        return output_path

    # ── Hilfsmethoden ────────────────────────────────────────────────────────

    def _build_cmd(
        self,
        input_path: Path,
        output_path: Path,
        has_audio: bool,
        target_fps: int = 30,
    ) -> List[str]:
        video_filter = (
            f"scale={settings.output_video_width}:{settings.output_video_height}"
            ":force_original_aspect_ratio=decrease,"
            f"pad={settings.output_video_width}:{settings.output_video_height}"
            ":(ow-iw)/2:(oh-ih)/2:black,"
            f"fps={target_fps}"
        )
        cmd: List[str] = [
            str(settings.ffmpeg_path),
            "-y",
            "-i", str(input_path),
            "-vf", video_filter,
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "20",
            "-threads", str(settings.ffmpeg_threads_per_job),
        ]
        if has_audio:
            cmd += ["-c:a", "aac", "-b:a", "192k", "-ar", "44100"]
        else:
            cmd += ["-an"]
        cmd.append(str(output_path))
        return cmd

    async def _get_duration_us(self, video_path: Path) -> float:
        """Gibt die Videodauer in Mikrosekunden zurueck (0 wenn nicht ermittelbar)."""
        cmd = [
            str(settings.ffprobe_path),
            "-v", "quiet",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ]
        try:
            result = await asyncio.get_running_loop().run_in_executor(
                None,
                lambda: subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                ),
            )
            return float(result.stdout.strip()) * 1_000_000
        except (ValueError, OSError):
            return 0.0
