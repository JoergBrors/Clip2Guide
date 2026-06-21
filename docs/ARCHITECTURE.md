# Clip2Guide – Systemarchitektur

> Stand: 2026-06-21 · Version: 0.3.6+

## Überblick

Clip2Guide ist eine Desktop-Anwendung (Electron), die aus einer Bildschirmaufnahme
automatisch ein annotiertes Tutorial-Video und ein DOCX-Handbuch erzeugt.
Die Anwendung besteht aus drei Schichten, die ausschließlich lokal auf dem Rechner laufen:
```text
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
│  upload │ processing │ frames │ ai (+ chat) │ images │ render    │
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
```text
Clip2Guide/
├── frontend/
│   ├── index.html
│   ├── electron/
│   │   ├── main.ts             # App-Start, Backend-Spawn, IPC-Handler, Setup-Wizard
│   │   ├── preload.ts          # contextBridge: window.clip2guide + window.setupAPI
│   │   └── ipc.ts              # IPC-Kanal-Typdefinitionen
│   ├── public/
│   └── src/
│       ├── App.tsx             # Haupt-Workflow, Step-Navigation (5 Schritte)
│       ├── main.tsx            # React-Root
│       ├── api/
│       │   └── backendClient.ts    # Typsichere REST- und SSE-Wrapper
│       └── components/
│           ├── VideoUpload.tsx       # Schritt 1: Datei-Upload (Video oder Bilder)
│           ├── ProcessingWizard.tsx  # Schritt 2: Normalisierung + Auto-Editor
│           ├── ImageAdjust.tsx       # Schritt 2b: Groessenanpassung (Bild-Modus)
│           ├── FrameStack.tsx        # Schritt 3: Frame-Extraktion + Auswahl
│           ├── FrameCarousel.tsx     # Frame-Vorschau (Karussell)
│           ├── CustomFrameCarousel.tsx
│           ├── FrameEditor.tsx       # Einzelbild-Bearbeitung: Rotation, Format, Blur/Pixelate
│           ├── SceneEditor.tsx       # Schritt 4: Storyboard bearbeiten
│           ├── ChatFloatPanel.tsx    # Schwebendes KI-Chat-Panel (unabhaengig verschiebbar)
│           ├── ImageStoryboard.tsx   # Storyboard-Vorschau
│           ├── JsonPreview.tsx       # Rohes JSON anzeigen
│           ├── ImageHoverZoom.tsx    # Zoom-Overlay
│           ├── RenderPanel.tsx       # Schritt 5: Rendering + Download
│           ├── SetupWizard.tsx       # Erststart-Einrichtung
│           └── DebugPanel.tsx        # Debug & Diagnose
│
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py             # FastAPI-App, CORS, Router-Einbindung, SSE-Endpunkt
│       ├── config.py           # Settings (pydantic BaseModel), .env-Laden
│       ├── models.py           # Pydantic-Datenmodelle (Request / Response / Domain)
│       ├── job_store.py        # asyncio.Queue pro job_id (interner SSE-Bus)
│       ├── routers/
│       │   ├── upload.py       # POST /api/upload/video
│       │   ├── processing.py   # POST /api/videos/{id}/normalize + /cut
│       │   ├── frames.py       # POST /api/videos/{id}/extract-frames
│       │   ├── ai.py           # POST /api/videos/{id}/analyze + /rewrite-scene + /enrich + /chat
│       │   ├── images.py       # POST /api/upload/images + Bild-Normalisierung
│       │   ├── render.py       # POST /api/videos/{id}/render
│       │   └── projects.py     # Projekt-ZIP Export/Import
│       └── services/
│           ├── ai_provider_base.py       # ABC: analyze_frames() + complete_text() + complete_text_with_images()
│           ├── gemini_provider.py        # GeminiProvider (Vision: Part.from_bytes)
│           ├── openai_provider.py        # OpenAiProvider (Vision: base64 data URL)
│           ├── azure_openai_provider.py  # AzureOpenAiProvider
│           ├── azure_cognitive_provider.py  # AzureCognitiveProvider
│           ├── session_store.py          # KI-Session pro video_id (In-Memory, thread-sicher)
│           ├── auto_editor_service.py
│           ├── ffmpeg_service.py
│           ├── frame_extractor.py
│           ├── frame_stack_service.py
│           ├── storyboard_service.py
│           ├── manual_render_service.py  # DOCX-Handbuch + szenenweise KI-Optimierung
│           ├── project_archive_service.py # ZIP Export/Import inkl. KI-Session
│           ├── video_normalizer.py
│           ├── pause_detector.py
│           └── render_service.py
│
├── tools/
│   ├── ffmpeg/bin/ffmpeg[.exe]
│   ├── ffmpeg/bin/ffprobe[.exe]
│   └── auto-editor/auto-editor-{platform}[.exe]
│
└── workspace/
    ├── uploads/
    ├── normalized/
    ├── cut/
    ├── frames/
    ├── ai-output/
    ├── output/
    └── tmp/
```
---

## Workflow-Diagramm (Video-Modus)
```text
[1] Upload
    POST /api/upload/video → UUID, ffprobe-Metadaten
  │
[2] Verarbeitung
    POST /api/videos/{id}/cut    → Auto-Editor-Schnitt
    POST /api/videos/{id}/normalize → FFmpeg H.264/AAC
  │
[3] Frame-Extraktion
    POST /api/videos/{id}/extract-frames → frame_NNN.jpg
  │
[3b] Frame-Auswahl im UI
    Szenen entwerfen, Frames sortieren, FrameEditor (Rotation, Format, Blur)
  │
[4] KI-Analyse
    POST /api/videos/{id}/analyze
    → Frames komprimiert (max. 768 px, JPEG 40) an KI-Provider
    → Storyboard mit Texten pro Sprache + KI-Session angelegt
  │
[4b] Storyboard-Editor
    PUT  /api/videos/{id}/storyboard    (manuelle Bearbeitung)
    POST /api/videos/{id}/rewrite-scene (Einzel-Szene KI-Rewrite)
    POST /api/videos/{id}/chat          (interaktiver KI-Assistent)
      → liest Bildreferenzen aus Nachricht ("Bild 3 aus Szene 2")
      → schickt Frames per Vision-API mit (complete_text_with_images)
      → aktualisiert Storyboard-Felder nur bei expliziten Aktionswörtern
  │
[5] Rendering
    POST /api/videos/{id}/render
    → output_formats: video | manual | beide
    → Video: create_tutorial.py als Subprocess (MoviePy + gTTS)
    → Handbuch: ManualRenderService → DOCX A5-Querformat
       mit KI-Optimierung: szenenweise complete_text_with_images-Aufrufe,
       jede Szene erhält Kontext aus bereits verarbeiteten Szenen

[6] Projektstand sichern
    POST /api/videos/{id}/export-project
    → ZIP mit Frames, Storyboard, Outputs und session/ki_session.json
    POST /api/projects/import
    → Manifest prüfen, SHA256 validieren, KI-Session in session_store laden
```
---

## Workflow-Diagramm (Bild-Modus)
```text
[1] Bilder hochladen    POST /api/upload/images
[2] Normalisieren       POST /api/images/normalize
[3] → FrameStack        POST /api/images/{session_id}/to-frames
→ ab hier identisch mit Video-Modus Schritt 3b
```
---

## KI-Session (session_store.py)

Pro `video_id` wird eine `KiSession` in einem thread-sicheren In-Memory-Store gehalten.
```python
@dataclass
class KiSession:
    video_id: str
    created_at: str
    master_prompt: str
    languages: list[str]
    provider: str           # zuletzt verwendeter Provider
    model: str              # zuletzt verwendetes Modell
    scene_headings: dict[str, str]       # scene_id → heading (kompakt)
    events: list[SessionEvent]           # max. 200 Ereignisse (analyze/rewrite/enrich)
    last_prompt_extra: str
    chat_history: list[dict[str, str]]   # max. 100 Nachrichten {role, content, ts}
```text
`context_summary()` erzeugt einen kompakten Text (<500 Zeichen/Szene) für KI-Prompts.

**Persistenz:** Die Session wird beim ZIP-Export als `session/ki_session.json` gesichert
und beim Import über `KiSession.from_archive_dict()` in den Store zurückgeladen.

**Provider-Priorität im Chat:**
```text
expliziter Override aus ChatFloatPanel
  > ki_session.provider / ki_session.model (aus letzter Analyse)
    > settings.ai_provider / settings.*_model (globaler Fallback)
```text
---

## KI-Provider-Abstraktion
```text
AiProviderBase (ABC)           ← ai_provider_base.py
│
│  analyze_frames(frame_paths, languages, video_id, prompt_extra) → StoryboardJson
│    Frames als JPEG komprimiert (max. 768 px, Qualität 40) via compress_frame_for_ki()
│
│  complete_text(prompt) → str
│    Text-only, für Rewrite/Enrich/Chat ohne Bildreferenzen
│
│  complete_text_with_images(prompt, image_paths) → str
│    Text + Bilder (Vision), für Chat mit Bildreferenzen und Handbuch-KI
│    Standard-Fallback: ruft complete_text() auf
│
├── GeminiProvider             ← gemini_provider.py
│     Part.from_bytes (inline JPEG)
│     Modell-Liste dynamisch via client.models.list()
│
├── OpenAiProvider             ← openai_provider.py
│     base64 data URL (data:image/jpeg;base64,...)
│     Modelle: gpt-4.1, gpt-4.1-mini, gpt-4o, gpt-4o-mini, o4-mini, o3
│
├── AzureOpenAiProvider        ← azure_openai_provider.py
│     openai SDK mit azure_endpoint + api_version
│     Modelle: gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-4o-mini
│
└── AzureCognitiveProvider     ← azure_cognitive_provider.py
      cognitiveservices.azure.com-Endpunkt
      max_completion_tokens=16000 (Reasoning-Modell)
      Modelle: gpt-5-mini, gpt-4.1-mini, gpt-4.1, gpt-4o
```text
---

## Interaktiver KI-Assistent (Chat-Endpoint)
```text
POST /api/videos/{video_id}/chat   Body: ChatRequest
  ↓
_run_chat() [BackgroundTask]
  1. KI-Session laden (enthält Provider/Modell aus Analyse)
  2. Provider bestimmen (Override > Session > Default)
  3. Storyboard laden (heading/body/speaker_notes aller Szenen als Kontext)
  4. Bildreferenzen aus req.message extrahieren:
       Regex: "Bild X [aus|in] [Szene Y]"
       → frames_dir / video_id / image_group[X-1]
       → compress_frame_for_ki(path) → bytes
  5. KI aufrufen:
       mit Bildreferenzen  → complete_text_with_images(prompt, paths)
       ohne Bildreferenzen → complete_text(prompt)
  6. JSON parsen: {reply, updates: [{scene_id, lang, field, value}]}
     Felder werden NUR geändert bei expliziten Aktionswörtern
     (schreibe / ändere / setze um / erstelle / formuliere / überarbeite …)
  7. SSE "completed": {reply, updates}
  8. Chat-History in KI-Session speichern (max. 100 Einträge)
```text
**ChatRequest:**
```python
class ChatRequest(BaseModel):
    message: str
    languages: list[str]
    ai_provider: Optional[AiProvider] = None
    ai_model: Optional[str] = None
    address_style: str = "sie"        # du | sie | neutral
    writing_style: str = "sachlich"   # sachlich | leicht_verstaendlich | technisch_detailliert
    detail_level: str = "standard"    # kurz | standard | ausfuehrlich
```text
---

## Handbuch-Rendering (ManualRenderService)
```text
POST /api/videos/{id}/render  (output_formats enthält "manual")
  ↓
_render_manual_worker()
  ├── ohne handbook_optimize: _write_docx() direkt
  └── mit handbook_optimize:
        _HandbuchSession anlegen (leere completed-Liste)
        für jede Szene:
          _build_scene_prompt(scene, options, session, scene_num)
            Szene 1: fordert Titel + Segmente JSON an
            Szene N: fordert nur Segmente JSON + session.context_summary()
          complete_text(prompt)    ← kein Vision-Call, Bilder sind referenziert im Text
          validieren: Segment-Anzahl == len(image_group)
          session.completed.append(entry)
        _write_docx(optimized_storyboard)
```text
**DOCX-Format:**

- A5-Querformat, Calibri 10 pt, 1 cm Ränder
- Deckblatt: Titel (28 pt), Quellvideo, Metadaten-Tabelle, Inhaltsverzeichnis
- Pro Szene ein Abschnitt; pro Bild eine eigene Seite (Tabelle: Bild oben, Text unten)
- Frames werden vor Einbettung per Pillow als JPEG nach `workspace/tmp/manual-docx-images/` validiert

---

## Datenpfade pro video_id

| Pfad | Inhalt | Erzeugt durch |
| --- | --- | --- |
| `workspace/uploads/{uuid}.{ext}` | Original-Upload | upload.py |
| `workspace/cut/{uuid}.mp4` | Auto-Editor-Schnitt | processing.py |
| `workspace/normalized/{uuid}.mp4` | FFmpeg-normalisiert | processing.py |
| `workspace/frames/{uuid}/frame_NNN.jpg` | Extrahierte Frames | frames.py |
| `workspace/ai-output/{uuid}/frame_stack.json` | Frame-Metadaten | frames.py |
| `workspace/ai-output/{uuid}/storyboard.json` | KI-Storyboard (editierbar) | ai.py |
| `workspace/ai-output/{uuid}/manual_storyboard_{lang}.json` | Handbuch-optimiertes Storyboard | manual_render_service.py |
| `workspace/output/{uuid}/tutorial_{lang}.mp4` | Fertiges Tutorial | render.py |
| `workspace/output/{uuid}/manual_{lang}.docx` | Fertiges DOCX-Handbuch | manual_render_service.py |
| `workspace/output/{uuid}/project_{uuid}.zip` | Projektarchiv (inkl. KI-Session) | project_archive_service.py |
| `workspace/tmp/` | Temporaere Arbeitsdateien, Startup-Cleanup | main.py / services |

---

## Echtzeit-Kommunikation: Server-Sent Events (SSE)

Alle lang laufenden Operationen laufen als **FastAPI BackgroundTask**.
Fortschritt kommt über **Server-Sent Events** an den Client.
```text
GET /api/jobs/{job_id}/events   → text/event-stream

data: {"type":"progress","step":"analyze","message":"...","percent":42}
data: {"type":"completed","step":"chat","message":"...","percent":100,"data":{"reply":"...","updates":[...]}}
data: {"type":"error","step":"...","message":"...","percent":0}
data: {"type":"debug","step":"chat-images","message":"Vision: Bild 3 aus scene_002 (frame_009.jpg)"}
```text
Event-Typen: `progress` | `completed` | `error` | `log` | `throttled` | `debug`

Keepalive alle 15 s: `: keepalive`
Timeout nach 3600 s: automatisches `error`-Event

---

## Render-Pipeline (create_tutorial.py)

Läuft als separater Subprocess, schreibt Fortschritt auf `stdout` (unbuffered via `-u`).

### Qualitäts-Presets

| Stufe | CRF | FFmpeg-Preset |
| --- | --- | --- |
| `schnell` | 28 | veryfast |
| `ausgewogen` (default) | 23 | faster |
| `beste` | 18 | medium |

### Ausgabe-Layout (1920 × 1080 px)
```text
┌────────────────────────────┬──────────────────────┐
│                            │  Heading (52 pt)      │
│   Screenshot / Frame       │  Body (36 pt)         │
│   (1320 px breit)          │  (600 px breit)       │
│                            │  Hintergrund: #141414 │
└────────────────────────────┴──────────────────────┘
```text
### TTS-Dauern-Heuristik

- Geschätzte Sprechgeschwindigkeit: **13 Zeichen/Sekunde**
- Minimale Szenen-Dauer: **2,0 Sekunden**

---

## Pydantic-Datenmodelle (models.py)
```text
StoryboardJson
├── video_id / source_video / cut_video / languages / metadata
└── scenes: List[Scene]
    └── Scene
        ├── scene_id / start_frame / end_frame
        ├── image_group: List[str]
        ├── image_prompts: Dict[str, str]
        ├── texts: Dict[str, TextPanel]
        │   └── TextPanel: heading / body / speaker_notes
        ├── slide_panels: Dict[str, List[TextPanel]]
        ├── render_hints: Dict[str, Any]
        └── duration_seconds: float

ChatRequest:  message, languages, ai_provider, ai_model, address_style, writing_style, detail_level
```
---

## Sicherheitsmodell

| Maßnahme | Details |
| --- | --- |
| Backend-Bindung | Ausschließlich `127.0.0.1:8787`, nie öffentlich |
| CORS | `allow_origins=["*"]` — durch Loopback-Bindung geschützt |
| API-Key-Speicherort | `app.getPath("userData")/.env` — nie im Installationsverzeichnis |
| Renderer-Isolation | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` |
| IPC | Alle nativen Aktionen ausschließlich über `contextBridge` (preload.ts) |
| Dateiformat-Validierung | Upload: Suffix-Whitelist; ZIP-Import: Manifest + SHA256 + Pfad-Traversal-Schutz |

---

## Electron-IPC-Kanäle

| Kanal | Richtung | Beschreibung |
| --- | --- | --- |
| `open-path` | invoke | Datei/Ordner im System-Explorer öffnen |
| `open-file-dialog` | invoke | Nativer Öffnen-Dialog |
| `save-file-dialog` | invoke | Nativer Speichern-Dialog |
| `get-version` | invoke | App-Version aus `package.json` |
| `setup:is-complete` | invoke | Prüft ob `.env` im userData existiert |
| `setup:run-initial` | invoke | Startet `initial.ps1` / `initial.sh` |
| `setup:log` | on | Log-Zeilen aus dem Setup-Prozess |
| `setup:write-env` | invoke | Schreibt Key-Value-Paare in die `.env` |
| `setup:read-env` | invoke | Liest aktuelle `.env`-Werte |
| `setup:completed` | send | Signalisiert: Setup fertig |
| `app:uninstall` | invoke | Deinstallations-Dialog |
| `debug:info` | invoke | Systeminfos, Backend-Status, Pfade, venv-Architektur |
| `debug:clear-cache` | invoke | Electron-Cache + workspace/tmp leeren |
| `debug:open-log-dir` | invoke | Log-Verzeichnis öffnen |
| `debug:open-env-file` | invoke | `.env` im Texteditor öffnen |