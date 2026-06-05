# Clip2Guide – Systemarchitektur

## Überblick

Clip2Guide ist eine Desktop-Anwendung (Electron), die aus einer Bildschirmaufnahme
automatisch ein annotiertes Tutorial-Video erzeugt. Die Anwendung besteht aus drei
Schichten, die ausschließlich lokal auf dem Rechner des Benutzers laufen:

```
┌──────────────────────────────────────────────────────────────────┐
│                        Electron Shell                            │
│  ┌────────────────────────┐   ┌──────────────────────────────┐  │
│  │   Renderer-Prozess     │   │      Main-Prozess            │  │
│  │   (React 18 / Vite)    │◄──►  (Node.js / IPC)            │  │
│  │   Port 5173 (dev)      │   │  startet Backend-Prozess     │  │
│  └───────────┬────────────┘   └──────────────────────────────┘  │
│              │ HTTP REST + Server-Sent Events                     │
└──────────────┼───────────────────────────────────────────────────┘
               │ localhost:8787
┌──────────────▼───────────────────────────────────────────────────┐
│               FastAPI Backend (Python 3.13 / uvicorn)            │
│  upload │ processing │ frames │ ai │ images │ render │ projects  │
└──────────────────────────────────────────────────────────────────┘
               │ subprocess / sys.executable
┌──────────────▼───────────────────────────────────────────────────┐
│              Externe Tools (lokal gebündelt)                      │
│  FFmpeg  │  Auto-Editor  │  gTTS (TTS)  │  MoviePy (Komposition) │
└──────────────────────────────────────────────────────────────────┘
               │ HTTPS (ausgehend, extern)
┌──────────────▼───────────────────────────────────────────────────┐
│              KI-Provider (Cloud, optional)                        │
│  Google Gemini API  │  OpenAI API  │  Azure OpenAI Service       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Verzeichnisstruktur

```
Clip2Guide/
├── frontend/
│   ├── index.html                    # Vite Entry-Point
│   ├── electron/                     # Electron-Prozesse (TypeScript)
│   │   ├── main.ts                   # App-Start, Backend-Spawn, IPC-Handler, Setup-Wizard
│   │   ├── preload.ts                # contextBridge: window.clip2guide + window.setupAPI
│   │   └── ipc.ts                    # IPC-Kanal-Typdefinitionen
│   ├── public/                       # Statische Assets
│   └── src/                          # React-Anwendung (Renderer-Prozess)
│       ├── App.tsx                   # Haupt-Workflow, Step-Navigation (5 Schritte)
│       ├── main.tsx                  # React-Root
│       ├── api/
│       │   └── backendClient.ts      # Typsichere REST- und SSE-Wrapper
│       ├── components/               # UI-Komponenten (eine pro Workflow-Schritt)
│       │   ├── VideoUpload.tsx       # Schritt 1: Datei-Upload (Video oder Bilder)
│       │   ├── ProcessingWizard.tsx  # Schritt 2: Normalisierung + Auto-Editor
│       │   ├── ImageAdjust.tsx       # Schritt 2b: Größenanpassung (Bild-Modus)
│       │   ├── FrameStack.tsx        # Schritt 3: Frame-Extraktion + Auswahl
│       │   ├── FrameCarousel.tsx     # Frame-Vorschau (Karussell)
│       │   ├── CustomFrameCarousel.tsx
│       │   ├── FrameEditor.tsx       # Einzelbild-Bearbeitung: Rotation, Format, Blur/Pixelate/Schwaerzen
│       │   ├── SceneEditor.tsx       # Schritt 4: Storyboard bearbeiten
│       │   ├── ImageStoryboard.tsx   # Storyboard-Vorschau
│       │   ├── JsonPreview.tsx       # Rohes JSON anzeigen
│       │   ├── ImageHoverZoom.tsx    # Zoom-Overlay
│       │   ├── RenderPanel.tsx       # Schritt 5: Rendering + Download
│       │   └── SetupWizard.tsx       # Erststart-Einrichtung
│       └── styles/
│
├── backend/
│   ├── requirements.txt              # Python-Abhängigkeiten (ohne feste Versionen)
│   └── app/
│       ├── __init__.py
│       ├── main.py                   # FastAPI-App, CORS, Router-Einbindung, SSE-Endpunkt
│       ├── config.py                 # Settings (pydantic BaseModel), .env-Laden
│       ├── models.py                 # Pydantic-Datenmodelle (Request / Response / Domain)
│       ├── job_store.py              # asyncio.Queue pro job_id (interner SSE-Bus)
│       ├── routers/                  # HTTP-Router (je einer pro Fachgebiet)
│       │   ├── __init__.py
│       │   ├── upload.py             # POST /api/upload/video
│       │   ├── processing.py         # POST /api/videos/{id}/normalize + /cut
│       │   ├── frames.py             # POST /api/videos/{id}/extract-frames
│       │   ├── ai.py                 # POST /api/videos/{id}/analyze + Storyboard-CRUD
│       │   ├── images.py             # POST /api/upload/images + Bild-Normalisierung
│       │   ├── render.py             # POST /api/videos/{id}/render
│       │   └── projects.py           # Projekt-ZIP Export/Import
│       ├── services/                 # Fachlogik, ohne HTTP-Wissen
│       │   ├── __init__.py
│       │   ├── ai_provider_base.py   # Abstrakte Basisklasse AiProviderBase (ABC)
│       │   ├── gemini_provider.py    # Implementierung: Google Gemini
│       │   ├── openai_provider.py    # Implementierung: OpenAI (direkt)
│       │   ├── azure_openai_provider.py  # Implementierung: Azure OpenAI
│       │   ├── auto_editor_service.py    # Wrapper für Auto-Editor-Binary
│       │   ├── ffmpeg_service.py         # ffprobe-Metadaten, Audio-Check
│       │   ├── frame_extractor.py        # FFmpeg-basierte Frame-Extraktion
│       │   ├── frame_stack_service.py    # FrameStack laden / speichern (JSON)
│       │   ├── storyboard_service.py     # Prompt-Bau, JSON-Parsing, Persistenz
│       │   ├── manual_render_service.py  # DOCX-Handbuch aus Storyboard, optionale KI-Textoptimierung
│       │   ├── project_archive_service.py # ZIP Export/Import kompletter Projektstaende
│       │   ├── video_normalizer.py       # FFmpeg H.264/AAC-Normalisierung (async)
│       │   ├── pause_detector.py         # OpenCV-basierte Pause-Erkennung
│       │   └── render_service.py         # Subprocess-Befehl für create_tutorial.py
│       └── scripts/
│           ├── __init__.py
│           └── create_tutorial.py    # Standalone-Renderer (MoviePy 2.x + gTTS + PIL)
│
├── tools/                            # Binaries (nicht in Git, via initial.ps1 geladen)
│   ├── ffmpeg/
│   │   └── bin/
│   │       ├── ffmpeg.exe
│   │       └── ffprobe.exe
│   └── auto-editor/
│       └── auto-editor-windows-x86_64.exe
│
├── workspace/                        # Laufzeit-Daten (nicht in Git)
│   ├── uploads/                      # Originale Upload-Videos
│   ├── normalized/                   # H.264/AAC-normalisierte Videos
│   ├── cut/                          # Auto-Editor-Ergebnisse
│   ├── frames/                       # Extrahierte JPG-Frames (pro video_id/)
│   ├── ai-output/                    # storyboard.json + frame_stack.json (pro video_id/)
│   ├── output/                       # Fertige Videos, DOCX-Handbuecher, Projekt-ZIPs (pro video_id/)
│   ├── tmp/                          # Temporaere Arbeitsdateien, wird beim Backend-Start bereinigt
│   └── logs/
│
├── icon/                             # App-Icons (PNG-Quellen, .icns wird im CI gebaut)
├── localstuff/
│   └── env.example                   # Vorlage für .env
├── .github/
│   └── workflows/
│       └── release.yml               # CI/CD: Build + GitHub Release
├── electron-builder.yml              # Paketierungs-Konfiguration
├── package.json                      # Node-Abhängigkeiten + npm-Skripte
├── vite.config.ts                    # Vite (root=frontend, outDir=dist/renderer)
├── tsconfig.json                     # TypeScript-Basis (Renderer)
├── tsconfig.electron.json            # TypeScript für Electron Main/Preload
├── initial.ps1                       # Windows-Setup-Skript (Python-venv, FFmpeg, Auto-Editor)
└── initial.sh                        # macOS/Linux-Setup-Skript
```

---

## Workflow-Diagramm (Video-Modus)

```
Benutzer
  │
  ▼
[1] Upload
    POST /api/upload/video (multipart)
    → UUID generieren, Datei in workspace/uploads/ speichern
    → ffprobe: Metadaten + Audio-Check
    → SSE-Fortschritt über upload_id
  │
  ▼
[2] Verarbeitung (optional: Auto-Editor-Schnitt)
    POST /api/videos/{id}/cut
    → FFmpeg-Audio-Decode-Pruefung; bei Bedarf AAC-kompatible Temp-Eingabe
    → auto-editor-binary: Stille / Bewegung entfernen
    → Ausgabe: workspace/cut/{video_id}.mp4
    POST /api/videos/{id}/normalize
    → FFmpeg: H.264, 1080p, AAC 44100 Hz, konstante Framerate
    → Eingabe bevorzugt: cut/ → sonst uploads/
    → Ausgabe: workspace/normalized/{video_id}.mp4
  │
  ▼
[3] Frame-Extraktion
    POST /api/videos/{id}/extract-frames
    → FFmpeg: fps=0.333 (1 Frame ≈ alle 3 s)
    → Ausgabe: workspace/frames/{video_id}/frame_NNN.jpg
    → FrameStack-Metadaten in workspace/ai-output/{video_id}/frame_stack.json
  │
  ▼
[3b] Frame-Auswahl im UI
    Benutzer entwirft Szenen, loescht/verschiebt Szenen, sortiert Bilder per Drag-and-drop
    → geloeschte Szenen legen Bilder in "Eigene Auswahl"; Bilder koennen daraus neu eingefuegt werden
    → FrameEditor: Rotation, Ziel-Frame-Format (z.B. 16:3), Crop/Fit/Stretch, Blur/Pixelate/Schwaerzen
    → selected_frames, scene_groups, scene_descriptions und image_prompts werden an Analyse uebergeben
  │
  ▼
[4] KI-Analyse
    POST /api/videos/{id}/analyze
    → Frames als base64 + strukturierter Prompt an KI-Provider
    → KI antwortet mit JSON: scenes, texts (Sprachen), durations
    → Storyboard validieren + speichern: workspace/ai-output/{video_id}/storyboard.json
  │
  ▼
[4b] Storyboard-Editor (optional)
    Benutzer bearbeitet Texte, Szenen-Reihenfolge, Dauern
    PUT /api/videos/{id}/storyboard
  │
  ▼
[5] Rendering
    POST /api/videos/{id}/render
    → output_formats: video, manual oder beide
    → Video: Szenen-Dauern aus TTS-Textlänge neu berechnen (~13 Zeichen/s)
    → Video-Subprocess: python -u create_tutorial.py
       Pro Szene + Sprache:
         1. speaker_notes → gTTS → temp MP3
         2. PIL: Screenshot links (1320 px) + Textpanel rechts (600 px) → PNG
         3. MoviePy: ImageClip + AudioFileClip → Szenen-Clip
       4. concatenate_videoclips → Gesamtvideo
       5. FFmpeg-Encoding (H.264, CRF/Preset, 25 fps)
    → SSE: Fortschritt aus stdout per Regex-Parsing
    → Video-Ausgabe: workspace/output/{video_id}/tutorial_{lang}.mp4
    → Handbuch-Ausgabe: workspace/output/{video_id}/manual_{lang}.docx

[6] Projektstand sichern / wiederherstellen
    POST /api/videos/{id}/export-project
    → ZIP mit storyboard.json, frame_stack.json, Frames, Uploads, Outputs und manifest.json
    POST /api/projects/import
    → Manifest pruefen, Hashes validieren, Zip-Slip verhindern, standardmaessig neue video_id erzeugen
```

## Workflow-Diagramm (Bild-Modus)

Der Bild-Modus ist ein Sonderpfad: Statt eines Videos lädt der Benutzer
einzelne Screenshots hoch. Ab dem Frame-Stack-Schritt ist der Ablauf identisch
mit dem Video-Modus.

```
[1] Upload mehrerer Bilder
    POST /api/upload/images (multipart, mehrere files)
    → session_id + ImageInfo-Liste

[2] Größenanpassung
    POST /api/images/normalize
    → mode: crop | fit | stretch
    → Zielgröße: target_width × target_height

[3] Bilder → FrameStack
    POST /api/images/{session_id}/to-frames
    → synthetische video_id, frame_stack.json

→ ab hier identisch mit Video-Modus Schritt 3b
```

---

## Datenpfade pro video_id

Alle Artefakte einer Verarbeitungssitzung leben unter derselben UUID:

| Pfad | Inhalt | Erzeugt durch |
|---|---|---|
| `workspace/uploads/{uuid}.{ext}` | Original-Upload | upload.py |
| `workspace/cut/{uuid}.mp4` | Auto-Editor-Schnitt | processing.py |
| `workspace/normalized/{uuid}.mp4` | FFmpeg-normalisiert | processing.py |
| `workspace/frames/{uuid}/frame_NNN.jpg` | Extrahierte Frames | frames.py |
| `workspace/ai-output/{uuid}/frame_stack.json` | Frame-Metadaten | frames.py |
| `workspace/ai-output/{uuid}/storyboard.json` | KI-Storyboard (editierbar) | ai.py |
| `workspace/ai-output/{uuid}/manual_storyboard_{lang}.json` | Handbuch-optimiertes Storyboard | manual_render_service.py |
| `workspace/output/{uuid}/tutorial_{lang}.mp4` | Fertiges Tutorial | render.py |
| `workspace/output/{uuid}/manual_{lang}.docx` | Fertiges DOCX-Handbuch | manual_render_service.py |
| `workspace/output/{uuid}/project_{uuid}.zip` | Projektarchiv | project_archive_service.py |
| `workspace/tmp/` | Temporaere Export-/Auto-Editor-Arbeitsdateien, Startup-Cleanup | main.py / services |

---

## Echtzeit-Kommunikation: Server-Sent Events (SSE)

Alle lang laufenden Operationen (Upload, Normalisierung, Schnitt, Frame-Extraktion,
KI-Analyse, Rendering) werden als **FastAPI BackgroundTask** gestartet.
Der Fortschritt wird über **Server-Sent Events** übermittelt.

### Interner Bus: job_store

```python
# job_store.py
job_queues: Dict[str, asyncio.Queue] = {}

async def send_event(job_id: str, event: dict) -> None: ...
def create_queue(job_id: str) -> asyncio.Queue: ...
def remove_queue(job_id: str) -> None: ...
```

Jeder Job bekommt eine eigene `asyncio.Queue`. Der SSE-Generator in
`main.py` (`GET /api/jobs/{job_id}/events`) liest daraus und sendet:

```
data: {"type":"progress","step":"normalize","message":"Starte FFmpeg...","percent":10}

data: {"type":"log","step":"normalize","message":"frame=  450 fps= 60 ..."}

data: {"type":"completed","step":"normalize","message":"Abgeschlossen.","percent":100,"data":{...}}

data: {"type":"error","step":"...","message":"Fehlermeldung","percent":0}
```

Keepalive alle 15 Sekunden: `: keepalive\n\n`
Timeout nach 3600 Sekunden: automatisches `error`-Event.

Event-Typen: `progress` | `completed` | `error` | `log` | `throttled` | `debug`

---

## KI-Provider-Abstraktion

```
AiProviderBase (ABC)          ← app/services/ai_provider_base.py
│   analyze_frames(frame_paths, languages, video_id, prompt_extra) → StoryboardJson
│   complete_text(prompt) → str   ← Text-only Aufruf, für Enrich-Aufgaben
│
├── GeminiProvider            ← gemini_provider.py
│     google-genai SDK
│     Bilder als inline_data (JPEG, base64)
│     Modell-Liste dynamisch via client.models.list()
│
├── OpenAiProvider            ← openai_provider.py
│     openai SDK
│     Bilder als base64 data URL (data:image/jpeg;base64,...)
│     Modelle: gpt-4.1, gpt-4.1-mini, gpt-4o, gpt-4o-mini, o4-mini, o3
│
├── AzureOpenAiProvider       ← azure_openai_provider.py
│     openai SDK mit azure_endpoint + api_version
│     Endpunkt: openai.azure.com (AZURE_OPENAI_ENDPOINT)
│     Modelle: gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-4o-mini
│
└── AzureCognitiveProvider    ← azure_cognitive_provider.py
      openai SDK mit cognitiveservices.azure.com-Endpunkt
      Eigene Konfigurationsvariablen: AZURE_COGNITIVE_*
      Modelle: gpt-5-mini, gpt-4.1-mini, gpt-4.1, gpt-4o
```

Der aktive Provider wird aus `settings.ai_providers` bestimmt
(kommagetrennte Liste `AI_PROVIDER` in `.env`).
Der Benutzer kann Provider und Modell im UI pro Analyse-Lauf wählen.

---

## Render-Pipeline (create_tutorial.py)

Das Skript `backend/app/scripts/create_tutorial.py` wird als separater
Subprocess gestartet (`python -u create_tutorial.py ...`). Es läuft
**außerhalb des FastAPI-Event-Loops**, schreibt Fortschritt auf `stdout`
(unbuffered via `-u`), der vom `render`-Router zeilenweise per Regex
geparst und als SSE-Events an den Client weitergeleitet wird.

### Qualitäts-Presets

| Stufe | CRF | FFmpeg-Preset |
|---|---|---|
| `schnell` | 28 | veryfast |
| `ausgewogen` (default) | 23 | faster |
| `beste` | 18 | medium |

### Ausgabe-Layout pro Frame (1920 × 1080 px)

```
┌────────────────────────────┬──────────────────────┐
│                            │  Heading (52 pt)      │
│   Screenshot / Frame       │  Body (36 pt)         │
│   (1320 px breit)          │  (600 px breit)       │
│                            │  Hintergrund: #141414 │
└────────────────────────────┴──────────────────────┘
```

### TTS-Dauern-Heuristik

Vor dem Render-Start berechnet `render.py` die Szenen-Dauern neu:
- Geschätzte Sprechgeschwindigkeit: **13 Zeichen/Sekunde**
- Minimale Szenen-Dauer: **2,0 Sekunden**
- `duration_seconds = max(len(speaker_notes) / 13, 2.0)`

---

## Sicherheitsmodell

| Maßnahme | Details |
|---|---|
| Backend-Bindung | Ausschließlich `127.0.0.1:8787`, nie öffentlich |
| CORS | `allow_origins=["*"]` — durch Loopback-Bindung geschützt |
| API-Key-Speicherort | Electron setzt `APP_ENV_FILE` auf `app.getPath("userData")/.env` — nie im Installationsverzeichnis |
| Renderer-Isolation | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` |
| IPC | Alle nativen Aktionen ausschließlich über `contextBridge` (preload.ts) |
| Dateiformat-Validierung | Upload-Router prüft Suffix gegen Whitelist: `.mp4 .mov .avi .mkv .webm` |

---

## Electron-IPC-Kanäle

Definiert in `preload.ts`, implementiert in `main.ts`:

| Kanal | Richtung | Beschreibung |
|---|---|---|
| `open-path` | invoke | Datei/Ordner im System-Explorer öffnen |
| `open-file-dialog` | invoke | Nativer Öffnen-Dialog |
| `save-file-dialog` | invoke | Nativer Speichern-Dialog |
| `get-version` | invoke | App-Version aus `package.json` |
| `setup:is-complete` | invoke | Prüft ob `.env` im userData existiert |
| `setup:run-initial` | invoke | Startet `initial.ps1` / `initial.sh` |
| `setup:log` | on (Renderer-Listener) | Log-Zeilen aus dem Setup-Prozess |
| `setup:write-env` | invoke | Schreibt Key-Value-Paare in die `.env` |
| `setup:read-env` | invoke | Liest aktuelle `.env`-Werte |
| `setup:completed` | send | Signalisiert dem Main-Prozess: Setup fertig |
| `app:uninstall` | invoke | Deinstallations-Dialog; `deleteUserData: boolean` |

**contextBridge-Objekte:**
- `window.clip2guide` – `backendUrl`, `openPath`, `openFileDialog`, `saveFileDialog`, `getVersion`
- `window.setupAPI` – `isComplete`, `runInitial`, `onLog`, `writeEnv`, `readEnv`, `complete`
- `window.appAPI` – `uninstall(deleteUserData)`

---

## Pydantic-Datenmodelle (models.py)

```
StoryboardJson
├── video_id: str
├── source_video: str
├── cut_video: str | None
├── languages: List[str]
├── metadata: Dict[str, Any]
└── scenes: List[Scene]
    └── Scene
        ├── scene_id: str              (z.B. "scene_001")
        ├── start_frame: str           (Dateiname des ersten Frames)
        ├── end_frame: str | None      (Dateiname des letzten Frames)
        ├── image_group: List[str]     (alle Frames dieser Szene)
        ├── image_prompts: Dict[str, str]   (Dateiname → KI-Anweisung pro Bild)
        ├── texts: Dict[str, TextPanel]     (Sprachcode → Text)
        │   └── TextPanel
        │       ├── heading: str
        │       ├── body: str
        │       └── speaker_notes: str     (TTS-Vorlese-Text)
        ├── slide_panels: Dict[str, List[TextPanel]]  (Sprachcode → TextPanel je Bild)
        ├── render_hints: Dict[str, Any]   (transition, image_durations, text_scroll_speed)
        └── duration_seconds: float   (≥ 0.5)

FrameStack
├── video_id: str
├── total_frames: int
└── frames: List[FrameInfo]
    └── FrameInfo
        ├── filename: str
        ├── timestamp_seconds: float
        └── scene_index: int | None

JobEvent
├── type: "progress" | "completed" | "error" | "log" | "throttled" | "debug"
├── step: str
├── message: str
├── percent: int (0–100)
└── data: Dict | None

# Request-Modelle
ProcessingRequest      (video_id, edit_mode, margin, has_audio, audio_threshold, motion_threshold)
AnalyzeRequest         (video_id, languages, ai_provider, ai_model, master_prompt, selected_frames, scene_groups, scene_descriptions, image_prompts)
RewriteSceneRequest    (scene_id, image_group, languages, ai_provider, ai_model, current_texts, image_prompts, duration_seconds, storyboard_context, change_summary)
EnrichRequest          (languages, scene_ids, ai_provider, ai_model)
RenderRequest          (video_id, languages, output_formats, handbook_optimize, ai_provider, ai_model, fps, quality, tts_slow)

# Response-Modelle
UploadResponse         (video_id, filename, path, has_audio, metadata)
JobStartResponse       (job_id, video_id, message)
HealthResponse         (status, version)
```
