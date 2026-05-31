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
| `HOST` | `127.0.0.1` | Bind-Adresse für den FastAPI-Server |
| `PORT` | `8787` | Port für den FastAPI-Server |

> Hinweis: Werte hier ändern erfordert auch Anpassung in `frontend/electron/main.ts`,
> da der Port dort als Standard-Fallback fest eingetragen ist.

---

## KI-Provider

### Provider-Auswahl

| Variable | Beispiel | Beschreibung |
|---|---|---|
| `AI_PROVIDER` | `gemini` | Kommagetrennte Liste aktiver Provider. Mögliche Werte: `gemini`, `openai`, `azure_openai`. Der erste Eintrag ist der Vorausgewählte im UI. |

Beispiel mit mehreren Providern:
```
AI_PROVIDER=gemini,openai
```

### Google Gemini

| Variable | Standard | Beschreibung |
|---|---|---|
| `GEMINI_API_KEY` | *(leer)* | API-Key aus [Google AI Studio](https://aistudio.google.com/) |

Verfügbare Modelle werden **dynamisch** per `client.models.list()` abgerufen —
keine Konfiguration nötig, hängt allein vom API-Key ab.

### OpenAI

| Variable | Standard | Beschreibung |
|---|---|---|
| `OPENAI_API_KEY` | *(leer)* | API-Key von [platform.openai.com](https://platform.openai.com/) |

Verfügbare Modelle (fest im Code):
`gpt-4.1`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4o-mini`, `o4-mini`, `o3`

### Azure OpenAI

| Variable | Standard | Beschreibung |
|---|---|---|
| `AZURE_OPENAI_API_KEY` | *(leer)* | API-Key des Azure OpenAI Service |
| `AZURE_OPENAI_ENDPOINT` | *(leer)* | Endpunkt-URL, z.B. `https://my-resource.openai.azure.com/` |
| `AZURE_OPENAI_API_VERSION` | `2024-12-01-preview` | API-Version |

Verfügbare Modelle (fest im Code):
`gpt-4.1-mini`, `gpt-4.1`, `gpt-4o`, `gpt-4o-mini`

---

## Tool-Pfade

Alle Pfade sind relativ zum **Projekt-Root** anzugeben.
In gepackten Apps werden sie relativ zu `process.resourcesPath` aufgelöst.

| Variable | Standard | Beschreibung |
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
Auf dem Produktions-System liegen diese unter `userData/workspace/`.

| Variable | Standard | Beschreibung |
|---|---|---|
| `UPLOAD_DIR` | `workspace/uploads` | Originalaufnahmen nach dem Upload |
| `NORMALIZED_DIR` | `workspace/normalized` | FFmpeg-normalisierte Videos |
| `CUT_DIR` | `workspace/cut` | Auto-Editor-Ausgabe |
| `FRAMES_DIR` | `workspace/frames` | Extrahierte JPG-Frames |
| `AI_OUTPUT_DIR` | `workspace/ai-output` | storyboard.json + frame_stack.json |
| `OUTPUT_DIR` | `workspace/output` | Fertige Tutorial-Videos |
| `LOG_DIR` | `workspace/logs` | Backend-Logs |

---

## Video-Einstellungen

| Variable | Standard | Beschreibung |
|---|---|---|
| `TARGET_WIDTH` | `1920` | Zielbreite bei FFmpeg-Normalisierung (Pixel) |
| `TARGET_HEIGHT` | `1080` | Zielhöhe bei FFmpeg-Normalisierung (Pixel) |
| `TARGET_FPS` | `30` | Ziel-Framerate bei Normalisierung |
| `FRAME_RATE` | `0.333` | Frames pro Sekunde bei der Frame-Extraktion (Standard: 1 Frame alle ~3 s) |

---

## Rendering

| Variable | Standard | Beschreibung |
|---|---|---|
| `RENDER_QUALITY` | `ausgewogen` | Qualitätsstufe: `schnell` / `ausgewogen` / `beste` |

| Stufe | CRF | FFmpeg-Preset | Dateigröße |
|---|---|---|---|
| `schnell` | 28 | veryfast | klein |
| `ausgewogen` | 23 | faster | mittel |
| `beste` | 18 | medium | groß |

---

## Auto-Editor-Parameter

| Variable | Standard | Beschreibung |
|---|---|---|
| `AUTO_EDITOR_EDIT_MODE` | `audio` | Erkennungsmodus: `audio` / `motion` / `combined` |
| `AUTO_EDITOR_MARGIN` | `0.3sec` | Puffer vor/nach erkannten aktiven Abschnitten |
| `AUTO_EDITOR_SILENT_THRESHOLD` | `0.04` | Lautstärke-Schwellwert für Stille-Erkennung (0.0–1.0) |
| `AUTO_EDITOR_MOTION_THRESHOLD` | `0.02` | Bewegungs-Schwellwert (0.0–1.0) |

---

## Parallelisierung

| Variable | Standard | Beschreibung |
|---|---|---|
| `MAX_CONCURRENT_JOBS` | `2` | Maximale Anzahl gleichzeitiger Hintergrund-Jobs |

---

## Komplettes Beispiel (`.env`)

```ini
# ── Server ──────────────────────────────────────────────────────────
HOST=127.0.0.1
PORT=8787

# ── KI-Provider ─────────────────────────────────────────────────────
AI_PROVIDER=gemini

# Gemini
GEMINI_API_KEY=AIzaSy...

# OpenAI (optional)
# OPENAI_API_KEY=sk-...

# Azure OpenAI (optional)
# AZURE_OPENAI_API_KEY=...
# AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com/
# AZURE_OPENAI_API_VERSION=2024-12-01-preview

# ── Tool-Pfade ───────────────────────────────────────────────────────
FFMPEG_PATH=tools/ffmpeg/bin/ffmpeg.exe
FFPROBE_PATH=tools/ffmpeg/bin/ffprobe.exe
AUTO_EDITOR_PATH=tools/auto-editor/auto-editor-windows-x86_64.exe

# ── Workspace ────────────────────────────────────────────────────────
UPLOAD_DIR=workspace/uploads
NORMALIZED_DIR=workspace/normalized
CUT_DIR=workspace/cut
FRAMES_DIR=workspace/frames
AI_OUTPUT_DIR=workspace/ai-output
OUTPUT_DIR=workspace/output
LOG_DIR=workspace/logs

# ── Video ────────────────────────────────────────────────────────────
TARGET_WIDTH=1920
TARGET_HEIGHT=1080
TARGET_FPS=30
FRAME_RATE=0.333

# ── Rendering ────────────────────────────────────────────────────────
RENDER_QUALITY=ausgewogen

# ── Auto-Editor ──────────────────────────────────────────────────────
AUTO_EDITOR_EDIT_MODE=audio
AUTO_EDITOR_MARGIN=0.3sec
AUTO_EDITOR_SILENT_THRESHOLD=0.04
AUTO_EDITOR_MOTION_THRESHOLD=0.02

# ── Parallelisierung ──────────────────────────────────────────────────
MAX_CONCURRENT_JOBS=2
```
