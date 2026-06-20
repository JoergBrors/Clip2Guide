"""
Clip2Guide – Pydantic-Datenmodelle
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Enums ─────────────────────────────────────────────────────────────────────

class EditMode(str, Enum):
    AUDIO = "audio"
    MOTION = "motion"
    COMBINED = "combined"


class AiProvider(str, Enum):
    GEMINI = "gemini"
    OPENAI = "openai"
    AZURE_OPENAI = "azure_openai"
    AZURE_COGNITIVE = "azure_cognitive"


# ── Storyboard / Szenenstruktur ───────────────────────────────────────────────

class TextPanel(BaseModel):
    """Texteinblendung fuer eine Szene."""
    heading: str = Field(default="", description="Ueberschrift / Schritt-Bezeichnung")
    body: str = Field(default="", description="Erklaerungstext")
    speaker_notes: str = Field(default="", description="Vorlese-Text fuer TTS")


class Scene(BaseModel):
    """Eine einzelne Szene im Storyboard."""
    scene_id: str = Field(..., description="Eindeutige Szenen-ID, z.B. 'scene_001'")
    start_frame: str = Field(..., description="Dateiname des ersten Frames, z.B. 'frame_001.jpg'")
    end_frame: Optional[str] = Field(None, description="Dateiname des letzten Frames (inklusiv)")
    image_group: List[str] = Field(default_factory=list, description="Liste aller Frame-Dateinamen dieser Szene")
    image_prompts: Dict[str, str] = Field(
        default_factory=dict,
        description="Dateiname -> optionale KI-Anweisung, die beim Neu-Schreiben in den Prompt einfließt."
    )
    texts: Dict[str, TextPanel] = Field(
        default_factory=dict,
        description="Sprachcode -> TextPanel, z.B. {'de': TextPanel(...)}"
    )
    slide_panels: Dict[str, List[TextPanel]] = Field(
        default_factory=dict,
        description="Sprachcode -> Liste von TextPanel je Bild in image_group. "
                    "Wenn befüllt, bekommt jedes Bild seinen eigenen Text-Panel."
    )
    render_hints: Dict[str, Any] = Field(
        default_factory=dict,
        description="KI-generierte Render-Hinweise: transition (fade|cut), "
                    "image_durations (List[float] in Sekunden), "
                    "text_scroll_speed (float px/s, 0=auto)."
    )
    duration_seconds: float = Field(default=5.0, ge=0.5, description="Gewuenschte Laenge dieser Szene in Sekunden")


class StoryboardJson(BaseModel):
    """Vollstaendiges Storyboard eines Videos."""
    video_id: str
    source_video: str = Field(description="Dateiname des Quellvideos")
    cut_video: Optional[str] = Field(None, description="Dateiname des geschnittenen Videos")
    languages: List[str] = Field(default_factory=list, description="Liste der Zielsprachen")
    scenes: List[Scene] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


# ── Frame Stack ───────────────────────────────────────────────────────────────

class FrameInfo(BaseModel):
    """Metadaten zu einem extrahierten Frame."""
    filename: str
    timestamp_seconds: float
    scene_index: Optional[int] = None


class FrameStack(BaseModel):
    """Alle Frames eines Videos mit optionaler Szenen-Zuordnung."""
    video_id: str
    frames: List[FrameInfo] = Field(default_factory=list)
    total_frames: int = 0


# ── Job-Status ────────────────────────────────────────────────────────────────

class JobEvent(BaseModel):
    """WebSocket-Event fuer laufende Jobs."""
    type: str = Field(..., description="'progress', 'completed' oder 'error'")
    step: str = Field(default="", description="Aktueller Verarbeitungsschritt")
    message: str = Field(default="")
    percent: int = Field(default=0, ge=0, le=100)
    data: Optional[Dict[str, Any]] = None


# ── Request-Modelle ───────────────────────────────────────────────────────────

class ProcessingRequest(BaseModel):
    video_id: str
    edit_mode: EditMode = EditMode.AUDIO
    margin: Optional[str] = None          # z.B. "0.5s" – None = Config-Default
    has_audio: bool = True
    audio_threshold: Optional[float] = None   # 0.01-0.30, None = 0.03
    motion_threshold: Optional[float] = None  # 0.01-0.30, None = 0.08


class AnalyzeRequest(BaseModel):
    video_id: str
    languages: List[str] = Field(default_factory=lambda: ["de"])
    ai_provider: Optional[AiProvider] = None
    ai_model: Optional[str] = None  # Wenn gesetzt, ueberschreibt den Default-Modellnamen
    master_prompt: str = Field(
        default="",
        description="Allgemein vorangestellter Nutzer-Prompt fuer die initiale Storyboard-Erstellung."
    )
    selected_frames: List[str] = Field(
        default_factory=list,
        description="Dateinamen der ausgewaehlten Frames. Leer = alle Frames verwenden."
    )
    scene_groups: Optional[List[List[str]]] = Field(
        None,
        description="Vom Nutzer vordefinierte Szenen-Gruppen (Liste von Frame-Dateinamen pro Szene). "
                    "Wenn gesetzt, wird die KI je Gruppe separat aufgerufen und die Szenen-Erkennung uebersprungen."
    )
    scene_descriptions: List[str] = Field(
        default_factory=list,
        description="Optionale kurze Nutzerbeschreibung pro scene_groups-Eintrag."
    )
    image_prompts: Dict[str, str] = Field(
        default_factory=dict,
        description="Dateiname -> optionale KI-Anweisung pro Bild fuer die Erst-Analyse."
    )


class RenderRequest(BaseModel):
    video_id: str
    languages: List[str] = Field(default_factory=lambda: ["de"])
    output_formats: List[str] = Field(
        default_factory=lambda: ["video"],
        description="Ausgabeformate: video, manual oder beide."
    )
    handbook_optimize: bool = Field(
        default=False,
        description="Wenn true, werden Texte fuer das DOCX-Handbuch per KI optimiert."
    )
    handbook_address_style: str = Field(
        default="sie",
        description="Anredeform fuer Handbuch-Texte: du | sie | neutral"
    )
    handbook_writing_style: str = Field(
        default="sachlich",
        description="Schreibstil: sachlich | leicht_verstaendlich | technisch_detailliert"
    )
    handbook_detail_level: str = Field(
        default="standard",
        description="Detailtiefe: kurz | standard | ausfuehrlich"
    )
    ai_provider: Optional[AiProvider] = None
    ai_model: Optional[str] = None
    fps: int = Field(default=25, ge=10, le=60)
    quality: str = Field(default="ausgewogen")   # schnell | ausgewogen | beste
    tts_slow: bool = Field(default=False)


class StoryboardUpdateRequest(BaseModel):
    storyboard: StoryboardJson


class RewriteSceneRequest(BaseModel):
    scene_id: str
    image_group: List[str] = Field(default_factory=list)
    languages: List[str] = Field(default_factory=lambda: ["de"])
    ai_provider: Optional[AiProvider] = None
    ai_model: Optional[str] = None
    address_style: str = Field(default="sie", description="Anredeform: du | sie | neutral")
    writing_style: str = Field(default="sachlich", description="Schreibstil: sachlich | leicht_verstaendlich | technisch_detailliert")
    detail_level: str = Field(default="standard", description="Detailtiefe: kurz | standard | ausfuehrlich")
    current_texts: Optional[Dict[str, TextPanel]] = Field(
        None,
        description="Vom Nutzer manuell bearbeitete Texte der Szene (heading/body/speaker_notes je Sprache)."
    )
    image_prompts: Optional[Dict[str, str]] = Field(
        None,
        description="Dateiname -> optionale KI-Anweisung pro Bild."
    )
    duration_seconds: Optional[float] = Field(
        None,
        description="Gewuenschte Szenenlaenge in Sekunden – bestimmt die angestrebte Laenge der speaker_notes."
    )
    storyboard_context: Optional[Dict[str, Any]] = Field(
        None,
        description="Aktueller Gesamt-Kontext des Storyboards fuer kontextbewusste Rewrites."
    )
    change_summary: Optional[str] = Field(
        None,
        description="Kurzbeschreibung der Aenderung, die diesen Rewrite ausgeloest hat."
    )


class ChatMessage(BaseModel):
    role: str = Field(..., description="'user' oder 'assistant'")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., description="Neue Nachricht des Nutzers")
    languages: List[str] = Field(default_factory=lambda: ["de"])
    ai_provider: Optional[AiProvider] = None
    ai_model: Optional[str] = None
    address_style: str = Field(default="sie", description="Anredeform: du | sie | neutral")
    writing_style: str = Field(default="sachlich", description="Schreibstil: sachlich | leicht_verstaendlich | technisch_detailliert")
    detail_level: str = Field(default="standard", description="Detailtiefe: kurz | standard | ausfuehrlich")


class EnrichRequest(BaseModel):
    languages: List[str] = Field(default_factory=lambda: ["de"])
    scene_ids: Optional[List[str]] = Field(
        None,
        description="Nur diese Szenen anreichern. None = alle Szenen ohne slide_panels anreichern."
    )
    ai_provider: Optional[AiProvider] = None
    ai_model: Optional[str] = None


# ── Response-Modelle ──────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    video_id: str
    filename: str
    path: str
    has_audio: bool
    metadata: Dict[str, Any] = Field(default_factory=dict)


class JobStartResponse(BaseModel):
    job_id: str
    video_id: str
    message: str = "Job gestartet"


class HealthResponse(BaseModel):
    status: str
    version: str
