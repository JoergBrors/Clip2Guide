# Clip2Guide

Automatische Tutorial-Erstellung aus Bildschirmaufnahmen.

**Electron + React/TypeScript Frontend · Python FastAPI Backend**

---

## Voraussetzungen

- **Windows**: PowerShell 5+, Node.js ≥ 20, Python ≥ 3.10
- **macOS**: zsh/bash, Node.js ≥ 20, Python ≥ 3.10, Homebrew (optional)

---

## Einrichtung

### Windows

```powershell
# Im Projektverzeichnis:
.\initial.ps1
```

Das Skript lädt FFmpeg und Auto-Editor herunter, erstellt eine virtuelle Python-Umgebung,
installiert alle Abhängigkeiten und generiert die `.env`-Konfiguration.

### macOS / Linux

```bash
chmod +x initial.sh
./initial.sh
```

---

## Konfiguration

Bearbeite die erzeugte `.env`-Datei:

| Variable | Beschreibung |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API-Schlüssel |
| `OPENAI_API_KEY` | OpenAI API-Schlüssel (alternativ) |
| `AI_PROVIDER` | `gemini` oder `openai` |
| `FFMPEG_PATH` | Pfad zu `ffmpeg.exe` / `ffmpeg` |
| `FFPROBE_PATH` | Pfad zu `ffprobe.exe` / `ffprobe` |
| `AUTO_EDITOR_PATH` | Pfad zum Auto-Editor-Binary |

---

## Starten

### Backend (FastAPI)

```bash
cd backend
.venv\Scripts\activate   # Windows
# oder: source .venv/bin/activate  # macOS/Linux
uvicorn app.main:app --host 127.0.0.1 --port 8787
```

### Frontend (Electron + Vite Dev-Modus)

```bash
npm install
npm run dev
```

### Produktions-Build

```bash
npm run build
npm run dev:electron
```

---

## Workflow

1. **Upload** — Bildschirmaufnahme hochladen (MP4, MOV, AVI, MKV, WebM)
2. **Verarbeitung** — Normalisierung + automatischer Schnitt mit Auto-Editor
3. **Frames** — Schlüsselframes extrahieren und nach Szenen gruppieren
4. **Storyboard** — KI-Analyse (Gemini / OpenAI) → Texte bearbeiten
5. **Rendering** — Tutorial-Videos mit Text-Panels und TTS-Audio generieren

---

## Architektur

```
Clip2Guide/
├── backend/
│   ├── app/
│   │   ├── config.py          # Einstellungen via .env
│   │   ├── models.py          # Pydantic-Modelle
│   │   ├── job_store.py       # WebSocket-Job-Queues
│   │   ├── main.py            # FastAPI-App + WebSocket
│   │   ├── routers/           # 5 API-Router
│   │   ├── services/          # 11 Dienste (FFmpeg, KI, Render …)
│   │   └── scripts/
│   │       └── create_tutorial.py  # Tutorial-Renderer (MoviePy)
│   └── requirements.txt
├── frontend/
│   ├── electron/
│   │   ├── main.ts            # Electron-Hauptprozess
│   │   ├── preload.ts         # contextBridge-API
│   │   └── ipc.ts             # IPC-Handler
│   ├── src/
│   │   ├── App.tsx            # Wizard-Shell
│   │   ├── api/
│   │   │   └── backendClient.ts
│   │   ├── components/        # 7 React-Komponenten
│   │   └── styles/
│   │       └── accessibility.css
│   └── index.html
├── tools/                     # FFmpeg, Auto-Editor (von initial.* befüllt)
├── workspace/                 # Arbeitsverzeichnis (Uploads, Frames, Output …)
├── .env.example
├── initial.ps1                # Windows-Setup
├── initial.sh                 # macOS/Linux-Setup
├── package.json
└── vite.config.ts
```

---

## Lizenz

Siehe [LICENSE](LICENSE).
