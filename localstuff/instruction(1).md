# instruction.md – Video Instruction Builder mit Electron, Python, Auto-Editor, FFmpeg und KI

## 1. Projektziel

Baue eine lokale Desktop-Anwendung, die aus einem Video automatisch eine strukturierte, editierbare Schritt-für-Schritt-Anleitung erzeugt und daraus auf Wunsch ein neues kommentiertes Anleitungsvideo rendert.

Das Video kann Ton enthalten oder komplett tonlos sein. Die Anwendung muss beide Fälle sauber unterstützen.

Die Anwendung besteht aus:

- Electron GUI
- React/TypeScript Frontend
- Python Backend mit FastAPI
- FFmpeg für Normalisierung, Metadaten und Frame-Extraktion
- Auto-Editor Binary für automatische Kürzung langer Pausen
- OpenCV für zusätzliche Frame-/Motion-Analyse
- Google Gemini API oder OpenAI ChatGPT API für KI-Analyse
- MoviePy/Pillow/gTTS für Rendering der finalen Anleitungsvideos

Das vorhandene Setup-Skript aus der Zwischenablage initialisiert bereits Python 3.13, FFmpeg, MoviePy 2.x und kopiert Projektdateien. Dieses Projekt erweitert diesen Ansatz um Auto-Editor und eine vollständige Produktstruktur. Die vorhandene Grundlage war ein PowerShell-Setup mit Parametern wie `Root`, `PythonVersion`, `SkipFFmpeg` und `ForceFFmpegDownload`; daran soll `initial.ps1` anschließen. Die Basisidee dieses Setups ist im bereitgestellten Skript enthalten. 

## 2. Wichtigste Anforderungen

Die Anwendung soll folgenden Ablauf abbilden:

1. Benutzer lädt ein Video über die GUI hoch.
2. Backend prüft das Video mit `ffprobe`.
3. Backend normalisiert das Video mit FFmpeg.
4. Backend kürzt das Video automatisch:
   - bei Ton bevorzugt audio-basiert mit Auto-Editor
   - ohne Ton bevorzugt motion-basiert mit Auto-Editor
   - optional kombiniert audio + motion
5. Backend erzeugt aus dem gekürzten Video Frames.
6. UI zeigt den Frame-Stapel sortiert und barrierefrei an.
7. Benutzer kann Frames entfernen, ergänzen, manuell schneiden und sortieren.
8. KI analysiert den finalen Frame-Stapel.
9. KI erzeugt JSON mit Image-Groups, Titeln, Beschreibungen und Sprechertext.
10. UI zeigt je Image-Group ein Carousel und editierbare Texte.
11. Benutzer korrigiert Gruppen und Texte.
12. Backend rendert auf Basis des JSON ein neues Anleitungsvideo.
13. Optional: mehrere Sprachversionen rendern.

## 3. Muss-Tools

### 3.1 FFmpeg

FFmpeg ist zwingend erforderlich für:

- Video-Metadaten
- Normalisierung
- Re-Encoding
- Extraktion einzelner Frames
- Extraktion manueller Screenshots
- technische Reparatur fehlerhafter MP4-Zeitstempel

Pfad aus `.env`:

```env
FFMPEG_PATH=./tools/ffmpeg/bin/ffmpeg.exe
FFPROBE_PATH=./tools/ffmpeg/bin/ffprobe.exe
```

### 3.2 Auto-Editor

Auto-Editor ist zwingend einzubauen für die automatische Videokürzung.

Auto-Editor ist laut offizieller Dokumentation bevorzugt als offizielles Binary von GitHub Releases zu installieren. Die Pip-Version ist laut Installationshinweis nicht mehr der empfohlene Weg.

Zielpfad:

```env
AUTO_EDITOR_PATH=./tools/auto-editor/auto-editor-windows-x86_64.exe
```

Das Initialisierungsskript muss Auto-Editor herunterladen nach:

```text
tools/auto-editor/auto-editor-windows-x86_64.exe
```

Standard-Download-URL im `initial.ps1`:

```text
https://github.com/WyattBlue/auto-editor/releases/latest/download/auto-editor-windows-x86_64.exe
```

Wenn sich das Release-Asset künftig ändert, muss der Download-Teil entsprechend angepasst werden.

## 4. Initialisierung

Lege im Projektroot `initial.ps1` an.

Aufrufbeispiele:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\initial.ps1
```

```powershell
.\initial.ps1 -Root "J:\VideoInstructionBuilder" -PythonVersion "3.13"
```

```powershell
.\initial.ps1 -Root "D:\VideoInstructionBuilder" -ForceFFmpegDownload -ForceAutoEditorDownload
```

Das Skript muss:

- Root-Verzeichnis erstellen
- Unterordner erstellen
- Python 3.13 prüfen
- Python venv erstellen
- Python-Module installieren
- FFmpeg herunterladen
- Auto-Editor herunterladen
- `.env.example` erzeugen
- `.env` erzeugen, falls nicht vorhanden
- `instruction.md` kopieren
- vorhandene `.py`-Skripte kopieren
- vorhandene `frame_*.jpg` in Workspace übernehmen
- Installation testen

Die vollständige Datei `initial.ps1` liegt als Artefakt neben dieser `instruction.md`.

## 5. Python-Module und Zweck

Installiere im Backend-Venv mindestens:

```powershell
python -m pip install --upgrade `
    fastapi `
    "uvicorn[standard]" `
    pydantic `
    python-dotenv `
    python-multipart `
    aiofiles `
    requests `
    httpx `
    numpy `
    opencv-python `
    moviepy `
    pillow `
    gtts `
    imageio `
    imageio-ffmpeg `
    google-generativeai `
    openai
```

### Modulverwendung

#### fastapi

Für REST API und WebSocket-Endpunkte.

#### uvicorn

ASGI-Server zum lokalen Starten des Backends.

#### pydantic

Für alle Request-/Response-Modelle und Storyboard-JSON-Validierung.

#### python-dotenv

Lädt `.env`.

#### python-multipart

Für Video-Uploads per `multipart/form-data`.

#### aiofiles

Für asynchrones Speichern großer Uploads.

#### requests / httpx

Für KI-API-Aufrufe und interne HTTP-Aufrufe. Bevorzugt `httpx` für async.

#### numpy

Für OpenCV-Framevergleiche und Bilddifferenzen.

#### opencv-python

Für visuelle Motion-Analyse, Frame-Deduplizierung und Thumbnail-Erzeugung.

#### moviepy

Für das finale Rendering aus Frame-Gruppen, Textpanels und Audio.

Wichtig: Verwende MoviePy 2.x Syntax:

```python
from moviepy import ImageClip, AudioFileClip, concatenate_videoclips, CompositeVideoClip
```

Nicht mehr:

```python
from moviepy.editor import ...
```

Verwende:

```python
clip.with_duration(...)
clip.with_position(...)
clip.with_audio(...)
```

Nicht mehr:

```python
clip.set_duration(...)
clip.set_position(...)
clip.set_audio(...)
```

#### pillow

Für Textpanels, Bildskalierung, Canvas-Erstellung und barrierearme visuelle Layouts.

#### gtts

Für einfache Text-to-Speech-Erzeugung. Später optional durch Azure Speech oder OpenAI TTS ersetzbar.

#### imageio / imageio-ffmpeg

Unterstützung für MoviePy/FFmpeg-Integration.

#### google-generativeai

Gemini Provider.

#### openai

OpenAI Provider.

## 6. .env

`.env` enthält alle lokalen Pfade und API-Schlüssel.

Beispiel:

```env
APP_ENV=development
APP_HOST=127.0.0.1
APP_PORT=8787

AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-pro

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1

FFMPEG_PATH=./tools/ffmpeg/bin/ffmpeg.exe
FFPROBE_PATH=./tools/ffmpeg/bin/ffprobe.exe
AUTO_EDITOR_PATH=./tools/auto-editor/auto-editor-windows-x86_64.exe

WORKSPACE_ROOT=./workspace
UPLOAD_DIR=./workspace/uploads
NORMALIZED_DIR=./workspace/normalized
CUT_DIR=./workspace/cut
FRAMES_DIR=./workspace/frames
AI_OUTPUT_DIR=./workspace/ai-output
RENDER_OUTPUT_DIR=./workspace/output

DEFAULT_LANGUAGE=de
OUTPUT_VIDEO_WIDTH=1920
OUTPUT_VIDEO_HEIGHT=1080
FRAME_EXTRACTION_FPS=0.333
SCENE_DIFF_THRESHOLD=0.08
MIN_SCENE_SECONDS=1.0

AUTO_EDITOR_AUDIO_EDIT=audio:threshold=0.03
AUTO_EDITOR_MOTION_EDIT=motion:threshold=0.08
AUTO_EDITOR_COMBINED_EDIT=(or audio:0.03 motion:0.08)
AUTO_EDITOR_MARGIN=0.5s

MAX_PARALLEL_LANGUAGES=4
FFMPEG_THREADS_PER_JOB=2
```

Regeln:

- `.env` niemals committen.
- `.env.example` committen.
- Frontend darf API-Schlüssel nie lesen.
- Nur Backend lädt `.env`.

## 7. Projektstruktur

```text
video-instruction-builder/
│
├── instruction.md
├── initial.ps1
├── .env
├── .env.example
├── README.md
├── package.json
│
├── frontend/
│   ├── electron/
│   │   ├── main.ts
│   │   ├── preload.ts
│   │   └── ipc.ts
│   │
│   └── src/
│       ├── App.tsx
│       ├── api/
│       │   └── backendClient.ts
│       ├── components/
│       │   ├── VideoUpload.tsx
│       │   ├── ProcessingWizard.tsx
│       │   ├── FrameStack.tsx
│       │   ├── FrameCarousel.tsx
│       │   ├── SceneEditor.tsx
│       │   ├── JsonPreview.tsx
│       │   └── RenderPanel.tsx
│       └── styles/
│           └── accessibility.css
│
├── backend/
│   ├── .venv/
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── models.py
│       │
│       ├── routers/
│       │   ├── upload.py
│       │   ├── processing.py
│       │   ├── frames.py
│       │   ├── ai.py
│       │   └── render.py
│       │
│       ├── services/
│       │   ├── ffmpeg_service.py
│       │   ├── auto_editor_service.py
│       │   ├── video_normalizer.py
│       │   ├── pause_detector.py
│       │   ├── frame_extractor.py
│       │   ├── frame_stack_service.py
│       │   ├── ai_provider_base.py
│       │   ├── gemini_provider.py
│       │   ├── openai_provider.py
│       │   ├── storyboard_service.py
│       │   └── render_service.py
│       │
│       └── scripts/
│           └── create_tutorial.py
│
├── tools/
│   ├── ffmpeg/
│   └── auto-editor/
│       └── auto-editor-windows-x86_64.exe
│
└── workspace/
    ├── uploads/
    ├── normalized/
    ├── cut/
    ├── frames/
    ├── ai-output/
    ├── output/
    ├── jobs/
    └── logs/
```

## 8. Backend-Konfiguration

`backend/app/config.py`

Anforderungen:

- `.env` laden
- alle Pfade als `Path` bereitstellen
- Tools prüfen
- Fehlermeldungen verständlich ausgeben

Beispielstruktur:

```python
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv
import os

load_dotenv()

class Settings(BaseModel):
    app_host: str = os.getenv("APP_HOST", "127.0.0.1")
    app_port: int = int(os.getenv("APP_PORT", "8787"))

    ai_provider: str = os.getenv("AI_PROVIDER", "gemini")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-1.5-pro")
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4.1")

    ffmpeg_path: Path = Path(os.getenv("FFMPEG_PATH", "./tools/ffmpeg/bin/ffmpeg.exe"))
    ffprobe_path: Path = Path(os.getenv("FFPROBE_PATH", "./tools/ffmpeg/bin/ffprobe.exe"))
    auto_editor_path: Path = Path(os.getenv("AUTO_EDITOR_PATH", "./tools/auto-editor/auto-editor-windows-x86_64.exe"))

    workspace_root: Path = Path(os.getenv("WORKSPACE_ROOT", "./workspace"))
    upload_dir: Path = Path(os.getenv("UPLOAD_DIR", "./workspace/uploads"))
    normalized_dir: Path = Path(os.getenv("NORMALIZED_DIR", "./workspace/normalized"))
    cut_dir: Path = Path(os.getenv("CUT_DIR", "./workspace/cut"))
    frames_dir: Path = Path(os.getenv("FRAMES_DIR", "./workspace/frames"))
    ai_output_dir: Path = Path(os.getenv("AI_OUTPUT_DIR", "./workspace/ai-output"))
    render_output_dir: Path = Path(os.getenv("RENDER_OUTPUT_DIR", "./workspace/output"))

    auto_editor_audio_edit: str = os.getenv("AUTO_EDITOR_AUDIO_EDIT", "audio:threshold=0.03")
    auto_editor_motion_edit: str = os.getenv("AUTO_EDITOR_MOTION_EDIT", "motion:threshold=0.08")
    auto_editor_combined_edit: str = os.getenv("AUTO_EDITOR_COMBINED_EDIT", "(or audio:0.03 motion:0.08)")
    auto_editor_margin: str = os.getenv("AUTO_EDITOR_MARGIN", "0.5s")

settings = Settings()
```

## 9. Auto-Editor Service

Datei:

```text
backend/app/services/auto_editor_service.py
```

Aufgaben:

- Auto-Editor-Binary aus `.env` verwenden
- Audio-Modus ausführen
- Motion-Modus ausführen
- Combined-Modus ausführen
- Preview ausführen
- Fehler robust erfassen
- Output-Datei eindeutig erzeugen
- Logs speichern

### Auto-Editor-Kommandos

#### Audio-basiert

Für Videos mit Ton:

```powershell
auto-editor-windows-x86_64.exe input.mp4 `
  --edit audio:threshold=0.03 `
  --margin 0.5s `
  --output output.mp4
```

#### Motion-basiert

Für tonlose Screenrecordings:

```powershell
auto-editor-windows-x86_64.exe input.mp4 `
  --edit motion:threshold=0.08 `
  --margin 0.5s `
  --output output.mp4
```

#### Kombiniert

Wenn Ton vorhanden ist, aber Bildänderung wichtig ist:

```powershell
auto-editor-windows-x86_64.exe input.mp4 `
  --edit "(or audio:0.03 motion:0.08)" `
  --margin 0.5s `
  --output output.mp4
```

### Python-Beispiel

```python
import subprocess
from pathlib import Path
from backend.app.config import settings

class AutoEditorService:
    def __init__(self):
        self.exe = settings.auto_editor_path

    def cut_video(
        self,
        input_file: Path,
        output_file: Path,
        mode: str = "auto",
        has_audio: bool = False,
        margin: str | None = None,
    ) -> Path:
        if not self.exe.exists():
            raise FileNotFoundError(f"Auto-Editor nicht gefunden: {self.exe}")

        if mode == "audio":
            edit_expr = settings.auto_editor_audio_edit
        elif mode == "motion":
            edit_expr = settings.auto_editor_motion_edit
        elif mode == "combined":
            edit_expr = settings.auto_editor_combined_edit
        else:
            edit_expr = settings.auto_editor_audio_edit if has_audio else settings.auto_editor_motion_edit

        margin = margin or settings.auto_editor_margin

        cmd = [
            str(self.exe),
            str(input_file),
            "--edit",
            edit_expr,
            "--margin",
            margin,
            "--output",
            str(output_file),
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        if result.returncode != 0:
            raise RuntimeError(
                "Auto-Editor Fehler\n"
                f"Command: {' '.join(cmd)}\n"
                f"STDOUT:\n{result.stdout}\n"
                f"STDERR:\n{result.stderr}"
            )

        if not output_file.exists():
            raise RuntimeError(f"Auto-Editor hat keine Output-Datei erzeugt: {output_file}")

        return output_file
```

### Wichtige Fehlerfälle

Wenn Auto-Editor meldet:

```text
Error! Timeline is empty, nothing to do.
```

Dann:

1. niedrigeren Threshold testen
2. bei tonlosem Video Motion verwenden
3. bei zu empfindlichem Motion-Threshold höheren Wert nutzen
4. als Fallback FFmpeg/OpenCV-Frame-Extraktion verwenden

Empfohlene Schwellenwerte:

```text
audio:threshold=0.01 bis 0.05
motion:threshold=0.03 bis 0.20
margin=0.3s bis 1.0s
```

Für Screenrecordings häufig sinnvoll:

```text
motion:threshold=0.08
```

Wenn zu viele Mini-Clips entstehen:

```text
motion:threshold=0.15
motion:threshold=0.20
```

## 10. Processing Pipeline

Implementiere eine Pipeline:

```text
upload
  ↓
ffprobe metadata
  ↓
normalize with ffmpeg
  ↓
auto-editor cut
  ↓
fallback OpenCV cut detection if needed
  ↓
extract frames
  ↓
manual frame stack
  ↓
AI analysis
  ↓
JSON validation
  ↓
scene editor
  ↓
render final video
```

### Video normalisieren

```bash
ffmpeg -y -i input.mp4 ^
  -vf "scale=1280:-2,fps=30" ^
  -c:v libx264 ^
  -preset veryfast ^
  -crf 23 ^
  -c:a aac ^
  -movflags +faststart ^
  normalized.mp4
```

Wenn das Video keine Audiospur hat:

```bash
ffmpeg -y -i input.mp4 ^
  -vf "scale=1280:-2,fps=30" ^
  -c:v libx264 ^
  -preset veryfast ^
  -crf 23 ^
  -an ^
  -movflags +faststart ^
  normalized.mp4
```

### Frames extrahieren

```bash
ffmpeg -y -i cut.mp4 ^
  -vf "fps=1/3,scale=1280:-2" ^
  workspace/frames/frame_%03d.jpg
```

### Einzelnen Frame aus Video schneiden

```bash
ffmpeg -y -ss 00:01:23.000 -i cut.mp4 -frames:v 1 workspace/frames/frame_022.jpg
```

## 11. Frame Stack

Der Frame Stack ist die zentrale Arbeitsgrundlage.

Eigenschaften:

- sortierte Liste von Frames
- jeder Frame hat Nummer, Dateiname, Zeitstempel, Quelle
- Frames können gelöscht, verschoben, ersetzt werden
- Gruppen können manuell erstellt werden
- Änderungen müssen in `frame_stack.json` gespeichert werden

Beispiel:

```json
{
  "video_id": "abc123",
  "frames": [
    {
      "name": "frame_001.jpg",
      "path": "workspace/frames/frame_001.jpg",
      "order": 1,
      "timestamp": 0.0,
      "selected": true
    }
  ]
}
```

## 12. KI-Prompt

Standardprompt:

```text
Analysiere diese frames sortiert nach nummer aus einem tonlosen Video.
Erstelle eine kurze deutsche Schritt-für-Schritt-Anleitung.
Beschreibe nur sichtbare Aktionen und Oberflächen.
Erfinde keine Funktionen.
Erzeuge zusätzlich einen Sprechertext für ein kurzes Anleitungsvideo.
```

Erweiterter JSON-Prompt:

```text
Gib das Ergebnis ausschließlich als valides JSON zurück.
Keine Markdown-Codeblöcke.
Keine Erklärungen außerhalb des JSON.

Das JSON muss diese Struktur haben:

{
  "language": "de",
  "title": "Kurzer Titel der Anleitung",
  "image_groups": [
    {
      "id": "scene_001",
      "title": "1. Kurzer Szenentitel",
      "frames": ["frame_001.jpg", "frame_002.jpg"],
      "description": "Kurze Beschreibung der sichtbaren Aktion.",
      "speaker_text": "Sprechertext für diese Szene."
    }
  ]
}

Regeln:
- Nutze nur sichtbare Informationen.
- Erfinde keine Funktionen, Namen oder technischen Details.
- Wenn etwas nicht eindeutig sichtbar ist, formuliere neutral.
- Gruppiere zusammengehörige Frames.
- Behalte die zeitliche Reihenfolge der Frames bei.
- Verwende kurze, klare Titel.
- Der speaker_text soll natürlich gesprochen klingen.
```

## 13. Ziel-JSON

```json
{
  "language": "de",
  "title": "RevPi Provisioning Anleitung",
  "image_groups": [
    {
      "id": "scene_001",
      "title": "1. Anmeldung & Sicherheit",
      "frames": ["frame_001.jpg", "frame_002.jpg"],
      "description": "Die sichtbaren Screens zeigen eine Anmeldung und eine Sicherheitsbestätigung.",
      "speaker_text": "Starten Sie die Provisionierung mit dem SharePoint-Login. Bestätigen Sie die Anmeldung sicher über Ihre Microsoft Authenticator-App."
    }
  ]
}
```

Das JSON ist der zentrale Vertrag zwischen:

- KI
- UI
- Renderer

## 14. Pydantic-Modelle

```python
from pydantic import BaseModel, Field, field_validator
from typing import List, Dict

class LocalizedText(BaseModel):
    title: str
    description: str
    speaker_text: str

class ImageGroup(BaseModel):
    id: str = Field(..., pattern=r"^scene_[0-9]{3}$")
    title: str
    frames: List[str]
    description: str
    speaker_text: str
    texts: Dict[str, LocalizedText] | None = None

    @field_validator("frames")
    @classmethod
    def frames_must_not_be_empty(cls, value):
        if not value:
            raise ValueError("frames darf nicht leer sein")
        return value

class StoryboardJson(BaseModel):
    language: str = "de"
    title: str
    image_groups: List[ImageGroup]
```

## 15. KI-Provider

Abstraktion:

```python
from abc import ABC, abstractmethod
from pathlib import Path
from typing import List

class AiProvider(ABC):
    @abstractmethod
    async def analyze_frames(self, frames: List[Path], prompt: str) -> dict:
        pass
```

Gemini:

- nutzt `GEMINI_API_KEY`
- nutzt `GEMINI_MODEL`
- sendet Bilder multimodal
- verlangt JSON

OpenAI:

- nutzt `OPENAI_API_KEY`
- nutzt `OPENAI_MODEL`
- sendet Bilder multimodal
- verlangt JSON

Fehlerbehandlung:

- ungültiges JSON reparieren lassen
- bei zu vielen Frames batchen
- bei Timeout verständliche UI-Meldung
- niemals unvalidierte KI-Antwort übernehmen

## 16. API-Endpunkte

### Upload

```http
POST /api/upload/video
```

### Normalisieren

```http
POST /api/videos/{video_id}/normalize
```

### Kürzen mit Auto-Editor

```http
POST /api/videos/{video_id}/auto-editor/cut
```

Body:

```json
{
  "mode": "auto",
  "audio_edit": "audio:threshold=0.03",
  "motion_edit": "motion:threshold=0.08",
  "combined_edit": "(or audio:0.03 motion:0.08)",
  "margin": "0.5s"
}
```

### Preview mit Auto-Editor

```http
POST /api/videos/{video_id}/auto-editor/preview
```

Body:

```json
{
  "mode": "motion",
  "edit": "motion:threshold=0.08"
}
```

### Frames erzeugen

```http
POST /api/videos/{video_id}/extract-frames
```

### Frames listen

```http
GET /api/videos/{video_id}/frames
```

### Frame aus Video extrahieren

```http
POST /api/videos/{video_id}/frames/extract-single
```

Body:

```json
{
  "timestamp": "00:01:23.000"
}
```

### Frame löschen

```http
DELETE /api/videos/{video_id}/frames/{frame_name}
```

### Frames sortieren

```http
POST /api/videos/{video_id}/frames/reorder
```

### KI-Analyse

```http
POST /api/videos/{video_id}/ai/analyze
```

### Storyboard speichern

```http
PUT /api/videos/{video_id}/storyboard
```

### Video rendern

```http
POST /api/videos/{video_id}/render
```

## 17. WebSocket Progress

Lange Jobs müssen Fortschritt melden.

```http
WS /api/jobs/{job_id}/events
```

Beispiele:

```json
{
  "type": "progress",
  "step": "auto_editor_cut",
  "message": "Auto-Editor kürzt das Video",
  "percent": 35
}
```

```json
{
  "type": "completed",
  "step": "extract_frames",
  "message": "Frames wurden erzeugt"
}
```

```json
{
  "type": "error",
  "step": "auto_editor_cut",
  "message": "Auto-Editor konnte keine Timeline erzeugen. Bitte Threshold anpassen."
}
```

## 18. Barrierefreie UI

Die UI muss so barrierefrei wie möglich sein.

### Grundregeln

- vollständige Tastaturbedienung
- sichtbarer Fokus
- semantische HTML-Elemente
- verständliche Labels
- Statusmeldungen als Text
- keine reine Farbcodierung
- keine reine Drag-and-drop-Bedienung
- alternative Buttons für jede Drag-and-drop-Funktion
- Carousel rotiert niemals automatisch
- Screenreader-Status für aktuelle Szene und Frame

### Frame Carousel

Pflichten:

- Button „Vorheriger Frame“
- Button „Nächster Frame“
- Anzeige „Frame 2 von 5“
- Pfeiltastensteuerung
- `aria-live="polite"` für Status
- Alt-Text je Bild: `Frame 001 aus dem Video`

### Frame Stack

Jeder Frame braucht:

- Checkbox
- Dateiname
- Nummer
- Button „nach links“
- Button „nach rechts“
- Button „löschen“
- Button „vergrößern“

### Szeneneditor

Pro Szene:

- Titel editierbar
- Beschreibung editierbar
- Sprechertext editierbar
- Image-Group editierbar
- Szene teilen
- Szene zusammenführen
- neue Szene einfügen

## 19. Renderer

Das vorhandene Python-Rendering nutzt:

- MoviePy
- Pillow
- gTTS
- parallele Sprachverarbeitung
- Image Groups
- Scenes by language

Das hochgeladene Skript enthält bereits Konfigurationen für `IMAGE_GROUPS`, `SCENES_BY_LANGUAGE`, MoviePy, Pillow, gTTS und parallele Verarbeitung. Diese Logik soll nicht hart codiert bleiben, sondern aus dem Storyboard-JSON gespeist werden.

Zielaufruf:

```powershell
python backend/app/scripts/create_tutorial.py `
  --storyboard workspace/ai-output/storyboard.json `
  --languages de,en,tr,el,ro,pl
```

Renderer-Regeln:

- JSON laden
- Frames prüfen
- Image Groups daraus erzeugen
- Sprechertexte verwenden
- optional Übersetzungen erzeugen
- Ausgabe nach `workspace/output`
- Fortschritt an Backend melden

## 20. Mehrsprachigkeit

Zielsprachen:

- Deutsch `de`
- Englisch `en`
- Türkisch `tr`
- Griechisch `el`
- Rumänisch `ro`
- Polnisch `pl`

Das JSON soll später mehrsprachige Texte aufnehmen können:

```json
{
  "id": "scene_001",
  "frames": ["frame_001.jpg", "frame_002.jpg"],
  "texts": {
    "de": {
      "title": "1. Anmeldung & Sicherheit",
      "description": "Die Anmeldung erfolgt über Microsoft.",
      "speaker_text": "Starten Sie die Provisionierung mit dem SharePoint-Login."
    },
    "en": {
      "title": "1. Login & Security",
      "description": "The login is performed using Microsoft.",
      "speaker_text": "Start the provisioning process with the SharePoint login."
    }
  }
}
```

## 21. Akzeptanzkriterien

### Initialisierung

- `initial.ps1` erstellt Projektstruktur.
- Python 3.13 venv wird erstellt.
- FFmpeg wird heruntergeladen.
- Auto-Editor wird heruntergeladen.
- `.env` wird erzeugt.
- Module werden installiert.
- Installation wird getestet.

### Upload

- Video kann ausgewählt werden.
- Metadaten werden angezeigt.
- Fehlerhafte Videos werden verständlich gemeldet.

### Auto-Editor

- Kürzung mit Audio funktioniert.
- Kürzung mit Motion funktioniert.
- Combined-Modus funktioniert.
- Preview liefert verwertbare Analyse.
- Fehler „Timeline is empty“ wird verständlich erklärt.

### Frames

- Frames werden nummeriert erstellt.
- Benutzer kann Frames bearbeiten.
- Frame Stack wird gespeichert.

### KI

- Frames werden sortiert übergeben.
- KI antwortet mit validem JSON.
- JSON wird validiert.
- Keine erfundenen Funktionen werden übernommen.

### UI

- Image Groups als Carousel.
- Texte editierbar.
- Tastaturbedienung.
- Screenreader-taugliche Statusmeldungen.

### Rendering

- Finales Video wird aus JSON erstellt.
- Ausgaben landen in `workspace/output`.
- Mehrsprachigkeit wird unterstützt.

## 22. Qualitätsregeln für GitHub Copilot Agent / Sonnet 5.6

Arbeite strikt nach diesen Regeln:

- Keine Secrets hardcoden.
- Keine API-Schlüssel im Frontend.
- Keine unvalidierten KI-Antworten speichern.
- Keine Halluzinationen in generierten Anleitungen.
- KI darf nur sichtbare Inhalte beschreiben.
- Frame Stack ist die Wahrheit.
- JSON ist der Vertrag zwischen KI, UI und Renderer.
- Auto-Editor ist primäres Tool für Kürzung.
- FFmpeg ist primäres Tool für technische Videooperationen.
- OpenCV ist Fallback/Analysewerkzeug.
- UI immer barrierearm bauen.
- Lange Jobs nie im UI blockieren.
- Fortschritt per WebSocket melden.
- Services klein und testbar halten.
- Jede externe Tool-Ausführung mit stdout/stderr loggen.
- Keine Pfade hart im Code verdrahten, immer Config verwenden.
- Windows-Pfade und Leerzeichen in Pfaden berücksichtigen.

## 23. Erste Aufgaben für den Agent

1. `initial.ps1` übernehmen.
2. `.env.example` übernehmen.
3. Python Backend mit FastAPI anlegen.
4. `config.py` implementieren.
5. `ffmpeg_service.py` implementieren.
6. `auto_editor_service.py` implementieren.
7. Upload-Endpunkt implementieren.
8. Normalize-Endpunkt implementieren.
9. Auto-Editor-Cut-Endpunkt implementieren.
10. Frame-Extraction-Endpunkt implementieren.
11. Frame-Stack-Modell implementieren.
12. Gemini/OpenAI Provider implementieren.
13. JSON-Schema validieren.
14. Electron/React UI mit Upload-Wizard bauen.
15. Frame Stack UI bauen.
16. Scene Editor mit Carousel bauen.
17. Renderer an Storyboard-JSON anbinden.
18. WebSocket-Fortschritt implementieren.
19. Accessibility-Check durchführen.

## 24. Minimaler Testablauf

Nach `initial.ps1`:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload
```

Auto-Editor prüfen:

```powershell
..\tools\auto-editor\auto-editor-windows-x86_64.exe --version
```

FFmpeg prüfen:

```powershell
..\tools\ffmpeg\bin\ffmpeg.exe -version
```

Testvideo kürzen:

```powershell
..\tools\auto-editor\auto-editor-windows-x86_64.exe `
  workspace\uploads\test.mp4 `
  --edit motion:threshold=0.08 `
  --margin 0.5s `
  --output workspace\cut\test_cut.mp4
```

Frames erzeugen:

```powershell
..\tools\ffmpeg\bin\ffmpeg.exe `
  -i workspace\cut\test_cut.mp4 `
  -vf "fps=1/3,scale=1280:-2" `
  workspace\frames\frame_%03d.jpg
```

Dann die Frames per KI analysieren und das JSON in der UI bearbeiten.

## 25. Definition of Done

Das Projekt gilt als erster MVP, wenn:

- initial.ps1 läuft auf einem frischen Windows-Rechner.
- FFmpeg und Auto-Editor werden automatisch installiert.
- Backend kann Video hochladen.
- Backend kann Video normalisieren.
- Backend kann Video mit Auto-Editor kürzen.
- Backend kann Frames erzeugen.
- UI kann Frames anzeigen und sortieren.
- KI erzeugt validiertes JSON.
- UI kann JSON bearbeiten.
- Renderer erzeugt mindestens ein deutsches MP4.
- API-Schlüssel liegen nur in `.env`.
- Bedienung ist per Tastatur möglich.
