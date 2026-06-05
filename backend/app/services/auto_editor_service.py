"""
Auto-Editor-Service: Entfernt Pausen/Stille aus einem normalisierten Video.
"""
from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path
from typing import Awaitable, Callable, List, Optional

from app.config import settings

LogCallback = Callable[[str], Awaitable[None]]


class AutoEditorService:
    def _format_failure(self, returncode: int, lines: list[str] | str) -> str:
        text = "\n".join(lines) if isinstance(lines, list) else lines
        if "decoder not found" in text.lower():
            return (
                f"Auto-Editor fehlgeschlagen (Code {returncode}): Decoder not found. "
                "Die Eingabedatei nutzt vermutlich einen Audio-/Container-Codec, den Auto-Editor "
                "nicht direkt decodieren kann."
            )
        tail = text[-2000:] if isinstance(text, str) else ""
        return f"Auto-Editor fehlgeschlagen (Code {returncode}):\n{tail}"

    def cut_video(
        self,
        input_file: Path,
        output_file: Path,
        edit_expr: Optional[str] = None,
        margin: Optional[str] = None,
        has_audio: bool = True,
    ) -> Path:
        """
        Ruft Auto-Editor auf und speichert das geschnittene Video.

        :param edit_expr:  z.B. 'audio:threshold=0.03' oder '(or audio:0.03 motion:0.08)'
        :param margin:     z.B. '0.5s'
        """
        output_file.parent.mkdir(parents=True, exist_ok=True)

        if edit_expr is None:
            if has_audio:
                edit_expr = settings.auto_editor_audio_edit
            else:
                edit_expr = settings.auto_editor_motion_edit

        if margin is None:
            margin = settings.auto_editor_margin

        cmd: List[str] = [
            str(settings.auto_editor_path),
            str(input_file),
            "--edit", edit_expr,
            "--margin", margin,
            "--output", str(output_file),
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        if result.returncode != 0:
            raise RuntimeError(self._format_failure(result.returncode, result.stderr))

        if not output_file.exists():
            raise RuntimeError(f"Auto-Editor erzeugte keine Ausgabedatei: {output_file}")

        return output_file

    async def cut_video_async(
        self,
        input_file: Path,
        output_file: Path,
        edit_expr: Optional[str] = None,
        margin: Optional[str] = None,
        has_audio: bool = True,
        log_cb: Optional[LogCallback] = None,
    ) -> Path:
        """Async-Variante: stdout+stderr werden zeilenweise an log_cb geliefert.

        Verwendet run_in_executor + blocking subprocess.Popen, da
        asyncio.create_subprocess_exec auf Windows mit SelectorEventLoop
        (uvicorn --reload) NotImplementedError wirft.
        """
        output_file.parent.mkdir(parents=True, exist_ok=True)

        if edit_expr is None:
            edit_expr = settings.auto_editor_audio_edit if has_audio else settings.auto_editor_motion_edit
        if margin is None:
            margin = settings.auto_editor_margin

        cmd: List[str] = [
            str(settings.auto_editor_path),
            str(input_file),
            "--edit", edit_expr,
            "--margin", margin,
            "--output", str(output_file),
        ]

        loop = asyncio.get_running_loop()
        log_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

        def _run_blocking() -> int:
            """Laeuft im Thread-Pool; schreibt Log-Zeilen thread-sicher in die Queue."""
            with subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=1,
            ) as proc:
                assert proc.stdout is not None
                for raw in proc.stdout:
                    line = raw.decode("utf-8", errors="replace").rstrip()
                    if line:
                        loop.call_soon_threadsafe(log_queue.put_nowait, line)
                proc.wait()
                returncode = proc.returncode
            loop.call_soon_threadsafe(log_queue.put_nowait, None)  # Sentinel
            return returncode

        future = loop.run_in_executor(None, _run_blocking)

        log_lines: list[str] = []
        while True:
            item = await log_queue.get()
            if item is None:
                break
            log_lines.append(item)
            if log_cb:
                await log_cb(item)

        returncode = await future

        if returncode != 0:
            raise RuntimeError(self._format_failure(returncode, log_lines))
        if not output_file.exists():
            raise RuntimeError(f"Auto-Editor erzeugte keine Ausgabedatei: {output_file}")
        return output_file
