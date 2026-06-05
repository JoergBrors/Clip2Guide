# Clip2Guide – Konfigurationsreferenz

Alle Konfigurationsparameter werden über eine **`.env`-Datei** gesteuert.

## Speicherort der .env-Datei

| Modus | Pfad |
|---|---|
| **Produktion** (gepackte App) | `%APPDATA%\Clip2Guide\.env` (Windows) / `~/Library/Application Support/Clip2Guide/.env` (macOS) |
| **Entwicklung** | Projekt-Root `E:\Repro\Clip2Guide\.env` |

Die Datei wird vom Electron Main-Prozess über die Umgebungsvariable
`APP_ENV_FILE` an das Python-Backend übergeben. Das Backend lädt sie
über `pydantic-settings` (Klasse `Settings` in `backend/app/config.py`).

Vorlage: `localstuff/env.example`

---

## Server

| Variable | Standard | Beschreibung |
|---|---|---|
| `APP_HOST` | `127.0.0.1` | Bind-Adresse für den FastAPI-Server |
| `APP_PORT` | `8787` | Port für den FastAPI-Server |

> Hinweis: Port-Änderung erfordert auch Anpassung in `frontend/electron/main.ts`
> (Konstante `BACKEND_PORT`).

---

## KI-Provider

### Provider-Auswahl

| Variable | Beispiel | Beschreibung |
|---|---|---|
| `AI_PROVIDER` | `gemini` | Kommagetrennte Liste aktiver Provider. Mögliche Werte: `gemini`, `openai`, `azure_openai`, `azure_cognitive`. Der erste Eintrag ist der Vorausgewählte im UI. |

Beispiel mit mehreren Providern:
```
AI_PROVIDER=gemini,azure_openai
```

### Google Gemini

| Variable | Standard | Beschreibung |
|---|---|---|
| `GEMINI_API_KEY` | *(leer)* | API-Key aus [Google AI Studio](https://aistudio.google.com/) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Standard-Modell (wird von der UI überschrieben) |

Verfügbare Modelle werden **dynamisch** per `client.models.list()` abgerufen —
keine Konfiguration nötig, hängt allein vom API-Key ab.

### OpenAI

| Variable | Standard | Beschreibung |
|---|---|---|
| `OPENAI_API_KEY` | *(leer)* | API-Key von [platform.openai.com](https://platform.openai.com/) |
| `OPENAI_MODEL` | `gpt-4.1` | Standard-Modell |

Verfügbare Modelle (fest im Code):
`gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini`, `o4-mini`, `o3`

### Azure OpenAI

| Variable | Standard | Beschreibung |
|---|---|---|
| `AZURE_OPENAI_API_KEY` | *(leer)* | API-Key des Azure OpenAI Service |
| `AZURE_OPENAI_ENDPOINT` | *(leer)* | Endpunkt-URL, z.B. `https://my-resource.openai.azure.com/` |
| `AZURE_OPENAI_DEPLOYMENT` | `gpt-4.1-mini` | Deployment-Name (= Modell-Name) |
| `AZURE_OPENAI_API_VERSION` | `2025-01-01-preview` | API-Version |

Verfügbare Modelle (fest im Code):
`gpt-4.1-mini`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`

### Azure Cognitive Services

| Variable | Standard | Beschreibung |
|---|---|---|
| `AZURE_COGNITIVE_API_KEY` | *(leer)* | API-Key des Azure Cognitive Services |
| `AZURE_COGNITIVE_ENDPOINT` | *(leer)* | Endpunkt-URL, z.B. `https://my-resource.cognitiveservices.azure.com/` |
| `AZURE_COGNITIVE_DEPLOYMENT` | `gpt-5-mini` | Deployment-Name |
| `AZURE_COGNITIVE_API_VERSION` | `2025-04-01-preview` | API-Version |

Verfügbare Modelle (fest im Code):
`gpt-5-mini`, `gpt-4.1-mini`, `gpt-4.1`, `gpt-4o`

---

## Tool-Pfade

Alle Pfade sind relativ zum **Projekt-Root** anzugeben (= `PROJECT_ROOT`-Umgebungsvariable).
In gepackten Apps werden sie relativ zu `USER_LOCAL_DIR` aufgelöst.

| Variable | Standard (Windows) | Beschreibung |
|---|---|---|
| `FFMPEG_PATH` | `tools/ffmpeg/bin/ffmpeg.exe` | Pfad zur FFmpeg-Binary |
| `FFPROBE_PATH` | `tools/ffmpeg/bin/ffprobe.exe` | Pfad zur FFprobe-Binary |
| `AUTO_EDITOR_PATH` | `tools/auto-editor/auto-editor-windows-x86_64.exe` | Pfad zur Auto-Editor-Binary |

> Auf macOS / Linux typischerweise:
> ```
> FFMPEG_PATH=tools/ffmpeg/bin/ffmpeg
> FFPROBE_PATH=tools/ffmpeg/bin/ffprobe
> AUTO_EDITOR_PATH=tools/auto-editor/auto-editor
> ```

---

## Workspace-Verzeichnisse

Alle Verzeichnisse werden automatisch angelegt, wenn sie fehlen.
Im Produktionsbetrieb liegen sie unter `USER_LOCAL_DIR/workspace/` (Windows: `%LOCALAPPDATA%\Clip2Guide\workspace\`).

| Variable | Standard | Beschreibung |
|---|---|---|
| `WORKSPACE_ROOT` | `./workspace` | Basis-Verzeichnis für alle Laufzeit-Daten |
| `UPLOAD_DIR` | `./workspace/uploads` | Originalaufnahmen nach dem Upload |
| `NORMALIZED_DIR` | `./workspace/normalized` | FFmpeg-normalisierte Videos |
| `CUT_DIR` | `./workspace/cut` | Auto-Editor-Ausgabe |
| `FRAMES_DIR` | `./workspace/frames` | Extrahierte JPG-Frames |
| `AI_OUTPUT_DIR` | `./workspace/ai-output` | storyboard.json + frame_stack.json |
| `RENDER_OUTPUT_DIR` | `./workspace/output` | Fertige Tutorial-Videos |

---

## Video- und Frame-Einstellungen

| Variable | Standard | Beschreibung |
|---|---|---|
| `OUTPUT_VIDEO_WIDTH` | `1920` | Ausgabebreite (Pixel) |
| `OUTPUT_VIDEO_HEIGHT` | `1080` | Ausgabehöhe (Pixel) |
| `FRAME_EXTRACTION_FPS` | `0.333` | Frames/Sekunde bei der Extraktion (0.333 = 1 Frame alle ~3 s) |
| `SCENE_DIFF_THRESHOLD` | `0.08` | Threshold für Szenen-Erkennung per OpenCV |
| `MIN_SCENE_SECONDS` | `1.0` | Mindestlänge einer Szene (Sekunden) |
| `DEFAULT_LANGUAGE` | `de` | Standard-Sprache für neue Storyboards |

---

## Auto-Editor-Defaults

Diese Werte werden als Standard verwendet, wenn die App kein explizites Body-Feld erhält.

| Variable | Standard | Beschreibung |
|---|---|---|
| `AUTO_EDITOR_AUDIO_EDIT` | `audio:threshold=0.03` | Audio-Erkennungs-Argument |
| `AUTO_EDITOR_MOTION_EDIT` | `motion:threshold=0.08` | Bewegungs-Erkennungs-Argument |
| `AUTO_EDITOR_COMBINED_EDIT` | `(or audio:0.03 motion:0.08)` | Kombinierter Modus |
| `AUTO_EDITOR_MARGIN` | `0.5s` | Puffer vor/nach erkannten aktiven Abschnitten |

---

## Parallelisierung

| Variable | Standard | Beschreibung |
|---|---|---|
| `MAX_PARALLEL_LANGUAGES` | `4` | Maximale Anzahl parallel gerenderter Sprachen |
| `FFMPEG_THREADS_PER_JOB` | `2` | FFmpeg-Threads pro Normalisierungs-Job |

---

## KI-Retry-Konfiguration

Bei Throttling (HTTP 429 / 503) werden KI-Aufrufe automatisch wiederholt.

| Variable | Standard | Beschreibung |
|---|---|---|
| `AI_RETRY_MAX_ATTEMPTS` | `3` | Maximale Wiederholungsversuche (0 = kein Retry) |
| `AI_RETRY_INITIAL_DELAY` | `10` | Wartezeit in Sekunden vor dem ersten Retry |
| `AI_RETRY_BACKOFF_FACTOR` | `2.0` | Exponential-Backoff-Multiplikator |
| `AI_RETRY_MAX_DELAY` | `60` | Maximale Wartezeit zwischen zwei Retries (Sekunden) |

---

## Komplettes Beispiel (`.env`)

```ini
# ── Server ──────────────────────────────────────────────────────────
APP_HOST=127.0.0.1
APP_PORT=8787

# ── KI-Provider ─────────────────────────────────────────────────────
AI_PROVIDER=gemini

# Gemini
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-2.5-flash

# OpenAI (optional)
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4.1

# Azure OpenAI (optional)
# AZURE_OPENAI_API_KEY=...
# AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com/
# AZURE_OPENAI_DEPLOYMENT=gpt-4.1-mini
# AZURE_OPENAI_API_VERSION=2025-01-01-preview

# Azure Cognitive Services (optional)
# AZURE_COGNITIVE_API_KEY=...
# AZURE_COGNITIVE_ENDPOINT=https://my-resource.cognitiveservices.azure.com/
# AZURE_COGNITIVE_DEPLOYMENT=gpt-5-mini
# AZURE_COGNITIVE_API_VERSION=2025-04-01-preview

# ── Tool-Pfade ───────────────────────────────────────────────────────
FFMPEG_PATH=tools/ffmpeg/bin/ffmpeg.exe
FFPROBE_PATH=tools/ffmpeg/bin/ffprobe.exe
AUTO_EDITOR_PATH=tools/auto-editor/auto-editor-windows-x86_64.exe

# ── Workspace ────────────────────────────────────────────────────────
WORKSPACE_ROOT=./workspace
UPLOAD_DIR=./workspace/uploads
NORMALIZED_DIR=./workspace/normalized
CUT_DIR=./workspace/cut
FRAMES_DIR=./workspace/frames
AI_OUTPUT_DIR=./workspace/ai-output
RENDER_OUTPUT_DIR=./workspace/output

# ── Video / Frames ────────────────────────────────────────────────────
OUTPUT_VIDEO_WIDTH=1920
OUTPUT_VIDEO_HEIGHT=1080
FRAME_EXTRACTION_FPS=0.333
DEFAULT_LANGUAGE=de

# ── Auto-Editor ──────────────────────────────────────────────────────
AUTO_EDITOR_AUDIO_EDIT=audio:threshold=0.03
AUTO_EDITOR_MOTION_EDIT=motion:threshold=0.08
AUTO_EDITOR_MARGIN=0.5s

# ── Parallelisierung ──────────────────────────────────────────────────
MAX_PARALLEL_LANGUAGES=4
FFMPEG_THREADS_PER_JOB=2

# ── KI-Retry ─────────────────────────────────────────────────────────
AI_RETRY_MAX_ATTEMPTS=3
AI_RETRY_INITIAL_DELAY=10
AI_RETRY_BACKOFF_FACTOR=2.0
AI_RETRY_MAX_DELAY=60
```
