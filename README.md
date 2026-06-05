# Clip2Guide

Automatische Tutorial-Erstellung aus Bildschirmaufnahmen oder Bildserien.

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
| `AI_PROVIDER` | Kommagetrennte Provider-Liste: `gemini`, `openai`, `azure_openai`, `azure_cognitive` |
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

1. **Upload** — Video hochladen, Bilder hochladen oder Projekt-ZIP wiederherstellen
2. **Verarbeitung** — optionaler Auto-Editor-Schnitt mit Decode-Pruefung, danach Normalisierung
3. **Frames** — Schluesselframes extrahieren, Bilder hochladen, Szenen entwerfen, Frames rotieren/an Zielformat anpassen
4. **Storyboard** — KI-Analyse (Gemini / OpenAI / Azure) mit Master-Prompt, Szenenbeschreibungen und Bild-Anweisungen
5. **Rendering** — Tutorial-Video, DOCX-Handbuch oder beides generieren; Projektstand als ZIP sichern

---

## Architektur

```
Clip2Guide/
├── backend/
│   ├── app/
│   │   ├── config.py          # Einstellungen via .env
│   │   ├── models.py          # Pydantic-Modelle
│   │   ├── job_store.py       # SSE-Job-Queues
│   │   ├── main.py            # FastAPI-App + SSE + Startup-Cache-Cleanup
│   │   ├── routers/           # Upload, Verarbeitung, Frames, KI, Bilder, Rendering, Projekte
│   │   ├── services/          # FFmpeg, KI, Render, Handbuch, Projektarchiv …
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
│   │   ├── components/        # React-Komponenten fuer Workflow, Editor, Rendering, Setup
│   │   └── styles/
│   │       └── accessibility.css
│   └── index.html
├── tools/                     # FFmpeg, Auto-Editor (von initial.* befüllt)
├── workspace/                 # Arbeitsverzeichnis (Uploads, Frames, Output …)
├── localstuff/env.example
├── initial.ps1                # Windows-Setup
├── initial.sh                 # macOS/Linux-Setup
├── package.json
└── vite.config.ts
```

---

## Lizenz

Siehe [LICENSE](LICENSE).
