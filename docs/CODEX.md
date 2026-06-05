# Clip2Guide – Codex-Kontext (Exakte Code-Referenz)

Dieses Dokument ist der **vollständige, maschinenlesbare Kontext** für automatisierte
Code-Änderungen (OpenAI Codex, GitHub Copilot Agent, etc.).
Es beschreibt Dateistruktur, genaue Signaturen, Konventionen und Muster.

> Stand: 2025-06-05 · Basis-Branch: `main`

---

## 1. Stack-Übersicht

| Schicht | Technologie | Version | Einstiegspunkt |
|---|---|---|---|
| Desktop-Shell | Electron | 35.x | `frontend/electron/main.ts` |
| Frontend | React 18 + TypeScript + Vite | Node 20 LTS | `frontend/src/App.tsx` |
| Backend | FastAPI + Python | 3.13 | `backend/app/main.py` |
| Video-Tools | FFmpeg, Auto-Editor | lokal gebündelt | `tools/` |
| KI-Provider | Gemini / OpenAI / Azure | Cloud (optional) | `backend/app/services/` |

---

## 2. Vollständige Verzeichnisstruktur

```
Clip2Guide/
├── frontend/
│   ├── index.html
│   ├── electron/
│   │   ├── main.ts          # Electron Main: Backend-Spawn, IPC-Handler
│   │   ├── preload.ts       # contextBridge: window.clip2guide / window.setupAPI / window.appAPI
│   │   └── ipc.ts           # Typdefinitionen IPC-Kanäle
│   ├── public/
│   └── src/
│       ├── App.tsx           # Haupt-Workflow (Step-Enum, renderStep())
│       ├── main.tsx          # React-Root
│       ├── api/
│       │   └── backendClient.ts   # REST-/SSE-Wrapper (Typen + Fetch-Funktionen)
│       ├── components/
│       │   ├── VideoUpload.tsx        # Schritt 1: Video/Bild-Upload
│       │   ├── ProcessingWizard.tsx   # Schritt 2: Normalisierung + Auto-Editor
│       │   ├── ImageAdjust.tsx        # Schritt 2b: Bild-Modus Größenanpassung
│       │   ├── FrameStack.tsx         # Schritt 3: Frame-Auswahl
│       │   ├── FrameCarousel.tsx      # Frame-Vorschau
│       │   ├── CustomFrameCarousel.tsx
│       │   ├── FrameEditor.tsx        # Einzelbild-Bearbeitung
│       │   ├── SceneEditor.tsx        # Schritt 4: Storyboard-Editor
│       │   ├── ImageStoryboard.tsx    # Storyboard-Vorschau
│       │   ├── JsonPreview.tsx        # Rohes JSON anzeigen
│       │   ├── ImageHoverZoom.tsx     # Zoom-Overlay
│       │   ├── RenderPanel.tsx        # Schritt 5: Rendering
│       │   └── SetupWizard.tsx        # Erststart-Einrichtung
│       └── styles/
│
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── __init__.py
│       ├── main.py           # FastAPI-App, CORS, Router, SSE /api/jobs/{job_id}/events
│       ├── config.py         # Settings (pydantic BaseModel), .env laden
│       ├── models.py         # Pydantic-Modelle (Request / Response / Domain)
│       ├── job_store.py      # asyncio.Queue pro job_id
│       ├── routers/
│       │   ├── __init__.py
│       │   ├── upload.py     # POST /api/upload/video + GET /api/upload/{id}/events
│       │   ├── processing.py # POST /api/videos/{id}/normalize + /cut
│       │   ├── frames.py     # POST /api/videos/{id}/extract-frames + GET frame-stack + GET frames/{filename} + PUT frames/{filename}
│       │   ├── ai.py         # GET /api/ai/providers + /ai/models + POST /api/videos/{id}/analyze + /rewrite-scene + /enrich-scenes + GET/PUT storyboard
│       │   ├── images.py     # POST /api/images/upload + /normalize + /to-frames
│       │   └── render.py     # POST /api/videos/{id}/render + GET /api/videos/{id}/output/{filename}
│       ├── services/
│       │   ├── __init__.py
│       │   ├── ai_provider_base.py       # ABC: analyze_frames() + complete_text()
│       │   ├── gemini_provider.py        # GeminiProvider
│       │   ├── openai_provider.py        # OpenAiProvider
│       │   ├── azure_openai_provider.py  # AzureOpenAiProvider
│       │   ├── azure_cognitive_provider.py  # AzureCognitiveProvider
│       │   ├── auto_editor_service.py    # AutoEditorService
│       │   ├── ffmpeg_service.py         # FfmpegService (ffprobe-Metadaten)
│       │   ├── frame_extractor.py        # FrameExtractor
│       │   ├── frame_stack_service.py    # FrameStackService (JSON persist.)
│       │   ├── storyboard_service.py     # StoryboardService + build_analysis_prompt() + build_enrich_prompt()
│       │   ├── video_normalizer.py       # VideoNormalizer (async)
│       │   ├── pause_detector.py         # OpenCV Pause-Erkennung
│       │   └── render_service.py         # RenderService.build_command()
│       └── scripts/
│           ├── __init__.py
│           └── create_tutorial.py        # Standalone-Renderer (MoviePy + gTTS + PIL)
│
├── tools/
│   ├── ffmpeg/bin/ffmpeg.exe
│   ├── ffmpeg/bin/ffprobe.exe
│   └── auto-editor/auto-editor-windows-x86_64.exe
│
├── workspace/           # Laufzeit-Daten (nicht in Git)
│   ├── uploads/
│   ├── normalized/
│   ├── cut/
│   ├── frames/
│   ├── ai-output/
│   ├── output/
│   └── logs/
│
├── localstuff/env.example
├── electron-builder.yml
├── package.json          # version, scripts, dependencies
├── vite.config.ts        # root=frontend, outDir=dist/renderer
├── tsconfig.json         # Renderer (ESNext)
├── tsconfig.electron.json # Main/Preload (ES2022 → CommonJS → dist/electron/)
├── initial.ps1
└── initial.sh
```

---

## 3. Backend: Exakte Modell-Definitionen (`backend/app/models.py`)

```python
class EditMode(str, Enum):
    AUDIO = "audio"
    MOTION = "motion"
    COMBINED = "combined"

class AiProvider(str, Enum):
    GEMINI = "gemini"
    OPENAI = "openai"
    AZURE_OPENAI = "azure_openai"
    AZURE_COGNITIVE = "azure_cognitive"

class TextPanel(BaseModel):
    heading: str = ""
    body: str = ""
    speaker_notes: str = ""

class Scene(BaseModel):
    scene_id: str
    start_frame: str
    end_frame: Optional[str] = None
    image_group: List[str] = []
    image_prompts: Dict[str, str] = {}
    texts: Dict[str, TextPanel] = {}         # Sprachcode → TextPanel
    slide_panels: Dict[str, List[TextPanel]] = {}  # Sprachcode → TextPanel je Bild
    render_hints: Dict[str, Any] = {}        # transition, image_durations, text_scroll_speed
    duration_seconds: float = Field(default=5.0, ge=0.5)

class StoryboardJson(BaseModel):
    video_id: str
    source_video: str
    cut_video: Optional[str] = None
    languages: List[str] = []
    scenes: List[Scene] = []
    metadata: Dict[str, Any] = {}

class FrameInfo(BaseModel):
    filename: str
    timestamp_seconds: float
    scene_index: Optional[int] = None

class FrameStack(BaseModel):
    video_id: str
    frames: List[FrameInfo] = []
    total_frames: int = 0

class JobEvent(BaseModel):
    type: str                    # "progress" | "completed" | "error" | "log" | "throttled" | "debug"
    step: str = ""
    message: str = ""
    percent: int = Field(default=0, ge=0, le=100)
    data: Optional[Dict[str, Any]] = None

class ProcessingRequest(BaseModel):
    video_id: str
    edit_mode: EditMode = EditMode.AUDIO
    margin: Optional[str] = None
    has_audio: bool = True
    audio_threshold: Optional[float] = None
    motion_threshold: Optional[float] = None

class AnalyzeRequest(BaseModel):
    video_id: str
    languages: List[str] = ["de"]
    ai_provider: Optional[AiProvider] = None
    ai_model: Optional[str] = None
    selected_frames: List[str] = []
    scene_groups: Optional[List[List[str]]] = None

class RenderRequest(BaseModel):
    video_id: str
    languages: List[str] = ["de"]
    fps: int = Field(default=25, ge=10, le=60)
    quality: str = "ausgewogen"        # schnell | ausgewogen | beste
    tts_slow: bool = False

class StoryboardUpdateRequest(BaseModel):
    storyboard: StoryboardJson

class RewriteSceneRequest(BaseModel):
    scene_id: str
    image_group: List[str] = []
    languages: List[str] = ["de"]
    ai_provider: Optional[AiProvider] = None
    ai_model: Optional[str] = None
    current_texts: Optional[Dict[str, TextPanel]] = None
    image_prompts: Optional[Dict[str, str]] = None
    duration_seconds: Optional[float] = None

class EnrichRequest(BaseModel):
    languages: List[str] = ["de"]
    scene_ids: Optional[List[str]] = None
    ai_provider: Optional[AiProvider] = None
    ai_model: Optional[str] = None

class UploadResponse(BaseModel):
    video_id: str
    filename: str
    path: str
    has_audio: bool
    metadata: Dict[str, Any] = {}

class JobStartResponse(BaseModel):
    job_id: str
    video_id: str
    message: str = "Job gestartet"

class HealthResponse(BaseModel):
    status: str
    version: str
```

---

## 4. Backend: Settings (`backend/app/config.py`)

```python
class Settings(BaseModel):
    # Server
    app_env: str                     # APP_ENV, default "development"
    app_host: str                    # APP_HOST, default "127.0.0.1"
    app_port: int                    # APP_PORT, default 8787

    # AI
    ai_provider: str                 # AI_PROVIDER, kommagetrennt, default "gemini"
    gemini_api_key: str              # GEMINI_API_KEY
    gemini_model: str                # GEMINI_MODEL, default "gemini-2.5-flash"
    openai_api_key: str              # OPENAI_API_KEY
    openai_model: str                # OPENAI_MODEL, default "gpt-4.1"
    azure_openai_api_key: str        # AZURE_OPENAI_API_KEY
    azure_openai_endpoint: str       # AZURE_OPENAI_ENDPOINT
    azure_openai_deployment: str     # AZURE_OPENAI_DEPLOYMENT, default "gpt-4.1-mini"
    azure_openai_api_version: str    # AZURE_OPENAI_API_VERSION, default "2025-01-01-preview"
    azure_cognitive_api_key: str     # AZURE_COGNITIVE_API_KEY
    azure_cognitive_endpoint: str    # AZURE_COGNITIVE_ENDPOINT
    azure_cognitive_deployment: str  # AZURE_COGNITIVE_DEPLOYMENT, default "gpt-5-mini"
    azure_cognitive_api_version: str # AZURE_COGNITIVE_API_VERSION, default "2025-04-01-preview"

    # Tools (Path-Objekte, relativ zu PROJECT_ROOT aufgelöst)
    ffmpeg_path: Path
    ffprobe_path: Path
    auto_editor_path: Path

    # Workspace (Path-Objekte)
    workspace_root: Path
    upload_dir: Path
    normalized_dir: Path
    cut_dir: Path
    frames_dir: Path
    ai_output_dir: Path
    render_output_dir: Path

    # Video / Rendering
    default_language: str            # DEFAULT_LANGUAGE, default "de"
    output_video_width: int          # OUTPUT_VIDEO_WIDTH, default 1920
    output_video_height: int         # OUTPUT_VIDEO_HEIGHT, default 1080
    frame_extraction_fps: float      # FRAME_EXTRACTION_FPS, default 0.333
    scene_diff_threshold: float      # SCENE_DIFF_THRESHOLD, default 0.08
    min_scene_seconds: float         # MIN_SCENE_SECONDS, default 1.0

    # Auto-Editor defaults
    auto_editor_audio_edit: str      # AUTO_EDITOR_AUDIO_EDIT
    auto_editor_motion_edit: str     # AUTO_EDITOR_MOTION_EDIT
    auto_editor_combined_edit: str   # AUTO_EDITOR_COMBINED_EDIT
    auto_editor_margin: str          # AUTO_EDITOR_MARGIN, default "0.5s"

    # Parallelism
    max_parallel_languages: int      # MAX_PARALLEL_LANGUAGES, default 4
    ffmpeg_threads_per_job: int      # FFMPEG_THREADS_PER_JOB, default 2

    # KI-Retry
    ai_retry_max_attempts: int       # AI_RETRY_MAX_ATTEMPTS, default 3
    ai_retry_initial_delay: float    # AI_RETRY_INITIAL_DELAY, default 10
    ai_retry_backoff_factor: float   # AI_RETRY_BACKOFF_FACTOR, default 2.0
    ai_retry_max_delay: float        # AI_RETRY_MAX_DELAY, default 60

    @property
    def project_root(self) -> Path: ...
    @property
    def backend_root(self) -> Path: ...
    @property
    def ai_providers(self) -> list[str]: ...   # kommagetrennte ai_provider-Liste

settings = Settings()   # Singleton-Instanz, überall importierbar
```

---

## 5. Backend: KI-Provider-Interface (`backend/app/services/ai_provider_base.py`)

```python
class AiProviderBase(ABC):
    @abstractmethod
    def analyze_frames(
        self,
        frame_paths: List[Path],   # sortierte Liste der Frame-JPG-Pfade
        languages: List[str],       # z.B. ["de", "en"]
        video_id: str,
        prompt_extra: str = "",
    ) -> StoryboardJson: ...

    @abstractmethod
    def complete_text(self, prompt: str) -> str: ...
```

**Implementierungen:**

| Klasse | Datei | SDK | Modell-Quelle |
|---|---|---|---|
| `GeminiProvider` | `gemini_provider.py` | `google-genai` | Dynamisch via `client.models.list()` |
| `OpenAiProvider` | `openai_provider.py` | `openai` | Feste Liste `OPENAI_VISION_MODELS` |
| `AzureOpenAiProvider` | `azure_openai_provider.py` | `openai` (AzureOpenAI) | Feste Liste `AZURE_OPENAI_VISION_MODELS` |
| `AzureCognitiveProvider` | `azure_cognitive_provider.py` | `openai` (AzureOpenAI) | Feste Liste `AZURE_COGNITIVE_VISION_MODELS` |

**Modell-Listen in `backend/app/routers/ai.py`:**
```python
OPENAI_VISION_MODELS = ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o4-mini", "o3"]
AZURE_OPENAI_VISION_MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini"]
AZURE_COGNITIVE_VISION_MODELS = ["gpt-5-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-4o"]
```

---

## 6. Backend: Alle HTTP-Endpunkte (exakte Pfade + Methoden)

```
GET  /health                                     → HealthResponse
GET  /api/jobs/{job_id}/events                   → SSE (text/event-stream)
GET  /api/upload/{upload_id}/events              → SSE (text/event-stream)
POST /api/upload/video                           → UploadResponse
     Query: upload_id (str, opt), file_size (int, opt)
     Body: multipart/form-data, file=UploadFile
POST /api/videos/{video_id}/cut                  → JobStartResponse (BackgroundTask)
     Body: ProcessingRequest (video_id, edit_mode, margin, has_audio, ...)
POST /api/videos/{video_id}/normalize            → JobStartResponse (BackgroundTask)
     Body: leer
POST /api/videos/{video_id}/extract-frames       → JobStartResponse (BackgroundTask)
     Body: leer
GET  /api/videos/{video_id}/frame-stack          → FrameStack
GET  /api/videos/{video_id}/frames/{filename}    → FileResponse (JPEG)
PUT  /api/videos/{video_id}/frames/{filename}    → dict (nach Editor-Upload)
     Body: multipart/form-data, file=UploadFile
GET  /api/ai/providers                           → {"providers": [{"id":..,"label":..}], "default": ..}
GET  /api/ai/models                              → {"provider":..,"models":[..],"default":..}
     Query: provider (str)
POST /api/videos/{video_id}/analyze              → JobStartResponse (BackgroundTask)
     Body: AnalyzeRequest
GET  /api/videos/{video_id}/storyboard           → StoryboardJson
PUT  /api/videos/{video_id}/storyboard           → StoryboardJson
     Body: StoryboardUpdateRequest
POST /api/videos/{video_id}/rewrite-scene        → JobStartResponse (BackgroundTask)
     Body: RewriteSceneRequest
POST /api/videos/{video_id}/enrich-scenes        → JobStartResponse (BackgroundTask)
     Body: EnrichRequest
POST /api/videos/{video_id}/render               → JobStartResponse (BackgroundTask)
     Body: RenderRequest
GET  /api/videos/{video_id}/output/{filename}    → FileResponse (MP4)
POST /api/images/upload                          → ImageSetResponse
POST /api/images/normalize                       → dict
POST /api/images/to-frames                       → dict
```

---

## 7. Backend: SSE-Event-Format

```json
{
  "type": "progress | completed | error | log | throttled | debug",
  "step": "upload | normalize | cut | extract | analyze | rewrite | enrich | render",
  "message": "Beschreibung",
  "percent": 0,
  "data": null
}
```

**SSE-Bus (job_store.py):**
```python
job_queues: Dict[str, asyncio.Queue] = {}
async def send_event(job_id: str, event: dict) -> None: ...
def create_queue(job_id: str) -> asyncio.Queue: ...
def remove_queue(job_id: str) -> None: ...
```

**Keepalive:** `: keepalive\n\n` alle 15 Sekunden
**Timeout:** 3600 Sekunden → automatisches `error`-Event

---

## 8. Backend: Router-interne Patterns

Jeder Router folgt diesem Muster für BackgroundTasks:

```python
# 1. Hilfsfunktion
async def _send(job_id, type_, step, message, percent=0, data=None):
    await job_store.send_event(job_id, {"type": type_, "step": step,
        "message": message, "percent": percent, **({"data": data} if data else {})})

# 2. Async Worker-Funktion
async def _run_xyz(video_id: str, job_id: str, req: ...) -> None:
    try:
        await _send(job_id, "progress", "xyz", "Starte...", 5)
        # ... Verarbeitung ...
        await _send(job_id, "completed", "xyz", "Fertig.", 100, {...})
    except Exception as exc:
        await _send(job_id, "error", "xyz", str(exc))

# 3. Endpunkt
@router.post("/videos/{video_id}/xyz", response_model=JobStartResponse)
async def xyz(video_id: str, req: ..., background_tasks: BackgroundTasks = BackgroundTasks()):
    job_id = str(uuid.uuid4())
    job_store.create_queue(job_id)
    background_tasks.add_task(_run_xyz, video_id, job_id, req)
    return JobStartResponse(job_id=job_id, video_id=video_id, message="...")
```

---

## 9. Backend: Render-Pipeline Details

### Render-Worker (`backend/app/routers/render.py`)

- Pro Sprache wird ein separater `subprocess.Popen` gestartet (echter Parallelismus)
- Läuft in `loop.run_in_executor(None, _render_lang_worker, ...)`
- Progress-Events via `loop.call_soon_threadsafe(q.put_nowait, event)`
- Stderr wird in Daemon-Thread gedrained; `[config]`-Zeilen werden gefiltert

**Regex-Parsing von `create_tutorial.py`-Stdout:**
```python
_RE_SCENE    = re.compile(r"Szene\s+(\d+)/(\d+)", re.IGNORECASE)
_RE_ENCODING = re.compile(r"Encoding:\s*Frame\s+(\d+)/(\d+)\s*\((\d+)%\)", re.IGNORECASE)
_RE_ENCODE_START = re.compile(r"Kodiere Video", re.IGNORECASE)
```

### Szenen-Dauern-Heuristik (vor dem Render)
```python
_TTS_CHARS_PER_SEC = 13.0
_MIN_SCENE_DURATION = 2.0
# duration_seconds = max(len(speaker_notes) / 13.0, 2.0)
```

### Qualitäts-Presets (in `create_tutorial.py`)
| Stufe | CRF | FFmpeg-Preset |
|---|---|---|
| `schnell` | 28 | veryfast |
| `ausgewogen` | 23 | faster |
| `beste` | 18 | medium |

### Ausgabe-Layout (1920 × 1080 px)
```
┌────────────────────────────┬──────────────────────┐
│   Screenshot / Frame       │  Heading (52 pt)      │
│   (1320 px breit)          │  Body (36 pt)         │
│                            │  Hintergrund: #141414 │
└────────────────────────────┴──────────────────────┘
```

### `RenderService.build_command()` Signatur
```python
def build_command(
    self,
    video_id: str,
    languages: List[str],
    storyboard_path: Path,
    fps: int = 25,
    quality: str = "ausgewogen",
    tts_slow: bool = False,
) -> Tuple[List[str], Path]:
    # Gibt (cmd, output_dir) zurück
```

---

## 10. Frontend: TypeScript-Typen (`frontend/src/api/backendClient.ts`)

```typescript
interface UploadResponse {
  video_id: string; filename: string; path: string;
  has_audio: boolean; metadata: Record<string, unknown>;
}
interface JobStartResponse { job_id: string; video_id: string; message: string; }
interface FrameInfo { filename: string; timestamp_seconds: number; scene_index: number | null; dataUrl?: string; }
interface FrameStack { video_id: string; frames: FrameInfo[]; total_frames: number; }
interface TextPanel { heading: string; body: string; speaker_notes: string; }
interface RenderHints { transition?: "fade" | "cut"; image_durations?: number[]; text_scroll_speed?: number; }
interface Scene {
  scene_id: string; start_frame: string; end_frame: string | null;
  image_group: string[]; image_prompts: Record<string, string>;
  texts: Record<string, TextPanel>;
  slide_panels?: Record<string, TextPanel[]>;
  render_hints?: RenderHints;
  duration_seconds: number;
}
interface StoryboardJson {
  video_id: string; source_video: string; cut_video: string | null;
  languages: string[]; scenes: Scene[]; metadata: Record<string, unknown>;
}
interface JobEvent {
  type: "progress" | "completed" | "error" | "log" | "throttled" | "debug";
  step: string; message: string; percent: number; data?: Record<string, unknown>;
}
interface ImageInfo { image_id: string; filename: string; width: number; height: number; }
interface ImageSetResponse { session_id: string; images: ImageInfo[]; }
```

**Basis-URL:** `window.clip2guide?.backendUrl ?? "http://localhost:8787"`

---

## 11. Electron: IPC-Kanäle (`frontend/electron/preload.ts` + `main.ts`)

```typescript
// window.clip2guide
backendUrl: "http://localhost:8787"
openPath(filePath: string): Promise<void>          // Kanal: "open-path"
openFileDialog(filters?): Promise<string | null>   // Kanal: "open-file-dialog"
saveFileDialog(defaultName?): Promise<string|null> // Kanal: "save-file-dialog"
getVersion(): Promise<string>                      // Kanal: "get-version"

// window.setupAPI
isComplete(): Promise<boolean>                     // Kanal: "setup:is-complete"
runInitial(): Promise<void>                        // Kanal: "setup:run-initial"
onLog(cb: (msg: string) => void): () => void       // Kanal: "setup:log" (on)
writeEnv(values: Record<string, string>): Promise<string>  // Kanal: "setup:write-env"
readEnv(): Promise<Record<string, string>>         // Kanal: "setup:read-env"
complete(): void                                   // Kanal: "setup:completed" (send)

// window.appAPI
uninstall(deleteUserData: boolean): Promise<{confirmed: boolean}>  // Kanal: "app:uninstall"
```

**Pfad-Konstanten in `main.ts`:**
```typescript
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const BACKEND_PORT = 8787;
const VITE_PORT = 5173;

// Dev: Projektroot/.env | Prod: userData/.env
USER_ENV_FILE: string

// Dev: Projektroot | Win Prod: %LOCALAPPDATA%\Clip2Guide | Mac/Lin: userData
USER_LOCAL_DIR: string
```

---

## 12. Datenpfade pro `video_id`

| Pfad | Inhalt | Erzeugt durch |
|---|---|---|
| `workspace/uploads/{uuid}.{ext}` | Original-Upload | `upload.py` |
| `workspace/cut/{uuid}.mp4` | Auto-Editor-Schnitt | `processing.py` |
| `workspace/normalized/{uuid}.mp4` | FFmpeg-normalisiert | `processing.py` |
| `workspace/frames/{uuid}/frame_NNN.jpg` | Extrahierte Frames | `frames.py` |
| `workspace/ai-output/{uuid}/frame_stack.json` | FrameStack-Metadaten | `frames.py` |
| `workspace/ai-output/{uuid}/storyboard.json` | Storyboard (editierbar) | `ai.py` |
| `workspace/output/{uuid}/tutorial_{lang}.mp4` | Fertige Tutorial-Videos | `render.py` |

---

## 13. Konventionen für Code-Änderungen

### Python (Backend)

- Alle Dateien beginnen mit `"""Modulbeschreibung."""` + `from __future__ import annotations`
- Imports: stdlib → fastapi → pydantic → app.* (alphabetisch innerhalb jeder Gruppe)
- Typen: immer vollständig annotiert (`-> None`, `-> dict | None`)
- Async/Sync-Grenze: FastAPI-Router immer `async`; blocking-Code in `loop.run_in_executor(None, fn, *args)`
- `_send()` Hilfsfunktion: in jedem Router gleich definiert (copy-paste pattern)
- Fehler: immer `try/except Exception as exc` → `await _send(job_id, "error", step, str(exc))`
- KI-Provider-Factory: `_get_provider(req: AnalyzeRequest)` in `ai.py`

### TypeScript / React (Frontend)

- `backendClient.ts`: alle API-Calls als named exports (keine default exports)
- Komponenten: funktionale Komponenten, React Hooks
- Props-Interface: `interface XxxProps { ... }` direkt über der Komponente
- State: `const [state, setState] = useState<Typ>(initialwert)`
- SSE: `new EventSource(url)` → `source.onmessage = (e) => { const ev: JobEvent = JSON.parse(e.data); ... }`

### Neue Dateien anlegen

- Python-Service: `backend/app/services/{name}_service.py` oder `{name}_provider.py`
- Python-Router: `backend/app/routers/{name}.py` → in `main.py` per `app.include_router()` registrieren
- React-Komponente: `frontend/src/components/{Name}.tsx` → in `App.tsx` importieren

---

## 14. Häufige Änderungsmuster

### Neues Backend-Feld in `Scene` hinzufügen

1. `backend/app/models.py` → Feld zu `Scene` hinzufügen
2. `frontend/src/api/backendClient.ts` → Feld zu `Scene` interface hinzufügen
3. `docs/ARCHITECTURE.md` → Pydantic-Modell-Abschnitt aktualisieren

### Neuen KI-Provider hinzufügen

1. `backend/app/services/{name}_provider.py` erstellen, von `AiProviderBase` erben
2. `backend/app/models.py` → `AiProvider`-Enum ergänzen
3. `backend/app/config.py` → Settings-Felder ergänzen
4. `backend/app/routers/ai.py` → in `_get_provider()`, `list_models()`, `_list_providers()`, `PROVIDER_LABELS` ergänzen
5. `docs/CONFIGURATION.md` + `docs/ARCHITECTURE.md` + `docs/CODEX.md` aktualisieren

### Neuen Workflow-Schritt im Frontend

1. `frontend/src/components/{Name}.tsx` erstellen
2. `frontend/src/App.tsx` → `Step`-Enum + Steps-Array + `renderStep()` ergänzen
3. Falls neue API-Calls: `frontend/src/api/backendClient.ts` ergänzen

### Neuen API-Endpunkt hinzufügen

1. Passendes Router-Modul öffnen
2. Endpunkt-Funktion mit BackgroundTask-Pattern implementieren (siehe Abschnitt 8)
3. Request/Response-Modell in `models.py` ergänzen (falls nötig)
4. Frontend-Wrapper in `backendClient.ts` ergänzen
5. `docs/API.md` + `docs/CODEX.md` aktualisieren

---

## 15. Sicherheitsmodell

| Maßnahme | Details |
|---|---|
| Backend-Bindung | Ausschließlich `127.0.0.1:8787` |
| CORS | `allow_origins=["*"]` — durch Loopback-Bindung abgesichert |
| API-Keys | Electron setzt `APP_ENV_FILE` → `userData/.env` — nie im Installationsverzeichnis |
| Renderer-Isolation | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` |
| IPC | Ausschließlich über `contextBridge` (preload.ts) |
| Dateiformat | Upload-Router: Whitelist `.mp4 .mov .avi .mkv .webm` |
| Path-Traversal | `frames.py` und `render.py`: `if "/" in filename or "\\" in filename or ".." in filename: raise 400` |
