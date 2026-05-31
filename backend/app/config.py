"""
Clip2Guide – Settings
Alle konfigurierbaren Pfade und Parameter kommen aus der .env-Datei
im Projektverzeichnis. Relative Pfade werden gegen das Projektverzeichnis
aufgeloest (2 Ebenen ueber backend/app/config.py).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict

# Projektverzeichnis = ../../.. relativ zu backend/app/config.py
_PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent.parent

# ── .env-Pfad ermitteln ────────────────────────────────────────────────────────
# Im paketierten Electron-Betrieb setzt der Haupt-Prozess APP_ENV_FILE auf
# app.getPath('userData')/.env, damit Keys nie im Installationsverzeichnis liegen.
# Im Dev-Modus / CI fehlt APP_ENV_FILE → klassischer Fallback auf Projektroot.
_env_override = os.environ.get("APP_ENV_FILE", "")
_env_file: Path = Path(_env_override) if _env_override else (_PROJECT_ROOT / ".env")

# ── .env laden ────────────────────────────────────────────────────────────────
# override=True stellt sicher, dass .env-Werte System-Umgebungsvariablen
# ueberschreiben (verhindert das stille Ignorieren bei leerem Systemwert).
_env_loaded: bool = load_dotenv(_env_file, override=True)

# Diagnose-Ausgabe beim Start (landet im uvicorn-Log)
print(
    f"[config] Projektverzeichnis : {_PROJECT_ROOT}",
    file=sys.stderr,
)
print(
    f"[config] .env-Datei         : {_env_file}  (gefunden={_env_file.exists()}, geladen={_env_loaded})",
    file=sys.stderr,
)

_gemini_key = os.getenv("GEMINI_API_KEY", "")
if _gemini_key:
    print(
        f"[config] GEMINI_API_KEY      : gesetzt ({len(_gemini_key)} Zeichen)",
        file=sys.stderr,
    )
else:
    print(
        "[config] GEMINI_API_KEY      : NICHT GESETZT – pruefe .env",
        file=sys.stderr,
    )

_azure_key = os.getenv("AZURE_OPENAI_API_KEY", "")
if _azure_key:
    print(
        f"[config] AZURE_OPENAI_API_KEY: gesetzt ({len(_azure_key)} Zeichen)",
        file=sys.stderr,
    )
else:
    print(
        "[config] AZURE_OPENAI_API_KEY: nicht gesetzt (optional)",
        file=sys.stderr,
    )


def _resolve(raw: str, fallback: str) -> Path:
    """Gibt einen absoluten Path zurueck. Relative Werte werden gegen PROJECT_ROOT aufgeloest."""
    p = Path(os.getenv(raw, fallback))
    return p if p.is_absolute() else (_PROJECT_ROOT / p).resolve()


class Settings(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    # Server
    app_env: str = os.getenv("APP_ENV", "development")
    app_host: str = os.getenv("APP_HOST", "127.0.0.1")
    app_port: int = int(os.getenv("APP_PORT", "8787"))

    # AI
    # Kommagetrennte Liste aktiver Provider, z.B. "gemini,azure_openai"
    ai_provider: str = os.getenv("AI_PROVIDER", "gemini")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4.1")
    # Azure OpenAI
    azure_openai_api_key: str = os.getenv("AZURE_OPENAI_API_KEY", "")
    azure_openai_endpoint: str = os.getenv("AZURE_OPENAI_ENDPOINT", "")
    azure_openai_deployment: str = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4.1-mini")
    azure_openai_api_version: str = os.getenv("AZURE_OPENAI_API_VERSION", "2025-01-01-preview")

    # Tools
    ffmpeg_path: Path = _resolve("FFMPEG_PATH", "./tools/ffmpeg/bin/ffmpeg.exe")
    ffprobe_path: Path = _resolve("FFPROBE_PATH", "./tools/ffmpeg/bin/ffprobe.exe")
    auto_editor_path: Path = _resolve("AUTO_EDITOR_PATH", "./tools/auto-editor/auto-editor-windows-x86_64.exe")

    # Workspace
    workspace_root: Path = _resolve("WORKSPACE_ROOT", "./workspace")
    upload_dir: Path = _resolve("UPLOAD_DIR", "./workspace/uploads")
    normalized_dir: Path = _resolve("NORMALIZED_DIR", "./workspace/normalized")
    cut_dir: Path = _resolve("CUT_DIR", "./workspace/cut")
    frames_dir: Path = _resolve("FRAMES_DIR", "./workspace/frames")
    ai_output_dir: Path = _resolve("AI_OUTPUT_DIR", "./workspace/ai-output")
    render_output_dir: Path = _resolve("RENDER_OUTPUT_DIR", "./workspace/output")

    # Video / Rendering
    default_language: str = os.getenv("DEFAULT_LANGUAGE", "de")
    output_video_width: int = int(os.getenv("OUTPUT_VIDEO_WIDTH", "1920"))
    output_video_height: int = int(os.getenv("OUTPUT_VIDEO_HEIGHT", "1080"))
    frame_extraction_fps: float = float(os.getenv("FRAME_EXTRACTION_FPS", "0.333"))
    scene_diff_threshold: float = float(os.getenv("SCENE_DIFF_THRESHOLD", "0.08"))
    min_scene_seconds: float = float(os.getenv("MIN_SCENE_SECONDS", "1.0"))

    # Auto-Editor defaults
    auto_editor_audio_edit: str = os.getenv("AUTO_EDITOR_AUDIO_EDIT", "audio:threshold=0.03")
    auto_editor_motion_edit: str = os.getenv("AUTO_EDITOR_MOTION_EDIT", "motion:threshold=0.08")
    auto_editor_combined_edit: str = os.getenv("AUTO_EDITOR_COMBINED_EDIT", "(or audio:0.03 motion:0.08)")
    auto_editor_margin: str = os.getenv("AUTO_EDITOR_MARGIN", "0.5s")

    # Parallelism
    max_parallel_languages: int = int(os.getenv("MAX_PARALLEL_LANGUAGES", "4"))
    ffmpeg_threads_per_job: int = int(os.getenv("FFMPEG_THREADS_PER_JOB", "2"))

    @property
    def project_root(self) -> Path:
        return _PROJECT_ROOT

    @property
    def ai_providers(self) -> list[str]:
        """Liste aller in AI_PROVIDER konfigurierten Provider (kommagetrennt)."""
        return [p.strip() for p in self.ai_provider.split(",") if p.strip()]


settings = Settings()
