# Clip2Guide

Automatische Tutorial-Erstellung aus Bildschirmaufnahmen oder Bildserien.

Electron + React/TypeScript Frontend · Python FastAPI Backend

---

## Was ist Clip2Guide?

Clip2Guide wandelt Bildschirmaufnahmen oder einzelne Screenshots automatisch in
strukturierte Tutorials um. Eine integrierte KI analysiert die Bilder, gliedert
sie in Szenen, schreibt Überschriften, Erklärungstexte und Sprecher-Notizen –
und rendert daraus ein Tutorial-Video, ein DOCX-Handbuch oder beides.

---

## Kernfunktionen

### KI-gestützte Storyboard-Erstellung

Die KI (Gemini, OpenAI oder Azure) analysiert alle Frames in einem Schritt,
erkennt Szenenübergänge und erzeugt vollständige Texte in einer oder mehreren Sprachen.
Ein **Master-Prompt** steuert Ton, Stil und Zielgruppe für die gesamte Analyse.

### Interaktiver KI-Assistent (Chat)

Im Storyboard-Editor ist ein schwebendes **Chat-Panel** integriert. Dort lässt sich
in natürlicher Sprache mit der KI kommunizieren:

- Fragen stellen: *"Was zeigt Szene 3?"* → KI antwortet, ändert nichts
- Texte anpassen: *"Schreibe die Überschrift von Szene 2 kürzer"* → KI ändert nur dieses Feld
- Bilder analysieren: *"Beschreibe Bild 4 aus Szene 1"* → KI schickt das tatsächliche Bild per Vision-API mit
- Der Chat nutzt denselben Provider und dasselbe Modell wie die Storyboard-Erstellung
- Der Gesprächsverlauf bleibt in der KI-Session erhalten und ist Teil des Projektarchivs

### Szene-für-Szene Handbuch-Optimierung

Beim DOCX-Handbuch mit aktivierter KI-Optimierung wird jede Szene einzeln
an die KI gesendet. Die KI verteilt `body` und `speaker_notes` auf die Bilder
der Szene. Die Session mit bereits verarbeiteten Szenen wird als Kontext
mitgegeben, damit Ton und Formatierung konsistent bleiben.

### Projektsicherung (ZIP)

Ein vollständiger Projektstand – Frames, Storyboard, KI-Session (Chat-Verlauf,
Szenenübersicht, Analyse-Historie) – lässt sich als ZIP exportieren und
auf einem anderen Rechner oder zu einem späteren Zeitpunkt vollständig
wiederherstellen.

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
| --- | --- |
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
2. **Verarbeitung** — optionaler Auto-Editor-Schnitt mit Decode-Prüfung, danach Normalisierung
3. **Frames** — Schlüsselframes extrahieren, Bilder hochladen, Szenen entwerfen, Frames rotieren/anpassen
4. **Storyboard** — KI-Analyse mit Master-Prompt; KI-Assistent für interaktive Textbearbeitung
5. **Rendering** — Tutorial-Video, DOCX-Handbuch oder beides; Projektstand als ZIP sichern

---

## KI-Assistent im Storyboard-Editor

Das Chat-Panel öffnet sich über den **"Chat"**-Button in der Storyboard-Toolbar.

| Eingabe | Verhalten |
| --- | --- |
| Frage ohne Aktionsworte | KI antwortet, Storyboard bleibt unverändert |
| "Schreibe / Ändere / Setze um / Erstelle / Überarbeite …" | KI ändert die genannten Felder direkt im Storyboard |
| "Beschreibe Bild 3 aus Szene 2" | KI analysiert das tatsächliche Bild per Vision-API |

Stil-Einstellungen (Anrede, Schreibstil, Detailtiefe) aus dem Storyboard-Editor
gelten auch im Chat. Provider und Modell können im Chat-Panel unabhängig gewählt werden.

Der Gesprächsverlauf wird in der KI-Session gespeichert und beim ZIP-Export mitgesichert.

---

## Handbuch (DOCX)

Das DOCX-Handbuch wird im Rendering-Schritt erzeugt (`output_formats: manual`).

**Format:**

- A5-Querformat, Calibri 10 pt, 1 cm Ränder
- Deckblatt mit Titel, Quellvideo, Metadaten und Inhaltsverzeichnis
- Pro Szene ein Abschnitt; pro Bild eine eigene Seite (Bild oben, Text unten)

**KI-Optimierung** (`handbook_optimize: true`):

- Jede Szene wird einzeln an die KI gesendet
- `body` und `speaker_notes` werden auf die Bilder der Szene verteilt
- Szene 1 erhält zusätzlich einen Handbuch-Titel
- Bereits verarbeitete Szenen fließen als Kontext in die nächste Szene ein
- Das Original-Storyboard wird nicht überschrieben

---

## Architektur

```text
Clip2Guide/
├── backend/
│   ├── app/
│   │   ├── config.py          # Einstellungen via .env
│   │   ├── models.py          # Pydantic-Modelle
│   │   ├── job_store.py       # SSE-Job-Queues
│   │   ├── main.py            # FastAPI-App + SSE + Startup-Cache-Cleanup
│   │   ├── routers/           # Upload, Verarbeitung, Frames, KI (inkl. Chat), Bilder, Rendering
│   │   └── services/
│   │       ├── ai_provider_base.py      # ABC: analyze_frames() + complete_text() + complete_text_with_images()
│   │       ├── session_store.py         # KI-Session pro video_id (Chat-Verlauf, Szenenübersicht)
│   │       └── manual_render_service.py # DOCX-Handbuch + szenenweise KI-Optimierung
│   └── requirements.txt
├── frontend/
│   ├── electron/
│   │   ├── main.ts            # Electron-Hauptprozess
│   │   ├── preload.ts         # contextBridge-API
│   │   └── ipc.ts             # IPC-Handler
│   └── src/
│       ├── App.tsx            # Wizard-Shell
│       ├── api/
│       │   └── backendClient.ts
│       └── components/
│           ├── SceneEditor.tsx      # Storyboard-Editor
│           ├── ChatFloatPanel.tsx   # Schwebendes KI-Chat-Panel
│           ├── RenderPanel.tsx      # Rendering + ZIP-Export/Import
│           └── ...
├── tools/                     # FFmpeg, Auto-Editor (von initial.* befüllt)
├── workspace/                 # Arbeitsverzeichnis (Uploads, Frames, Output ...)
├── localstuff/env.example
├── initial.ps1                # Windows-Setup
├── initial.sh                 # macOS/Linux-Setup
├── package.json
└── vite.config.ts
```

---

## Lizenz

Siehe [LICENSE](LICENSE).
