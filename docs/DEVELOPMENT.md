# Clip2Guide – Entwicklungshandbuch

## Voraussetzungen

| Software | Mindestversion | Hinweis |
|---|---|---|
| Python | 3.13 | Wird für das Backend (FastAPI) benötigt |
| Node.js | 20 LTS | npm ist inbegriffen |
| npm | 10+ | Kommt mit Node.js 20 |
| Git | beliebig | Für Versionskontrolle |
| FFmpeg | 7.x | Wird durch `initial.ps1` / `initial.sh` in `tools/ffmpeg/` installiert |
| Auto-Editor | Windows-Binary | Wird durch `initial.ps1` in `tools/auto-editor/` installiert |

> Auf macOS / Linux werden FFmpeg und Auto-Editor durch `initial.sh` heruntergeladen.

---

## Ersteinrichtung (einmalig)

### Windows

```powershell
# PowerShell (als normaler Benutzer, nicht Administrator)
cd E:\Repro\Clip2Guide
.\initial.ps1
```

Das Skript erledigt:
1. Python-`venv` anlegen in `backend/.venv/`
2. `pip install -r backend/requirements.txt`
3. FFmpeg-Binary nach `tools/ffmpeg/` laden (aus GitHub-Release)
4. Auto-Editor-Binary nach `tools/auto-editor/` laden

### macOS / Linux

```bash
cd ~/Repro/Clip2Guide
chmod +x initial.sh
./initial.sh
```

### .env-Datei anlegen

```bash
cp localstuff/env.example .env
```

Mindestens diese Werte eintragen (für den KI-Provider, der genutzt werden soll):

```
AI_PROVIDER=gemini
GEMINI_API_KEY=...
```

Alle verfügbaren Variablen sind in [CONFIGURATION.md](CONFIGURATION.md) dokumentiert.

---

## Entwicklungs-Server starten

Drei Prozesse müssen gleichzeitig laufen. Am einfachsten via VS Code Tasks.

### Option A: VS Code Tasks (empfohlen)

In VS Code `Terminal → Run Task...` → `dev: prepare`

Dies startet parallel:
- `compile: electron` (TypeScript-Kompilierung für Main/Preload)
- `serve: backend` (FastAPI auf 127.0.0.1:8787)
- `serve: vite` (Vite Dev-Server auf 127.0.0.1:5173)

Anschließend Electron starten:

```powershell
npm run dev:electron
```

### Option B: Manuell (drei separate Terminals)

**Terminal 1 – Backend:**
```powershell
cd E:\Repro\Clip2Guide\backend
..\.venv\Scripts\Activate.ps1
uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload
```

**Terminal 2 – Vite Dev-Server:**
```powershell
cd E:\Repro\Clip2Guide
npm run dev:vite
```

**Terminal 3 – Electron:**
```powershell
cd E:\Repro\Clip2Guide
npx tsc -p tsconfig.electron.json   # falls nicht durch VS Code Task aktiv
npm run dev:electron
```

### Umgebungsvariablen im Dev-Modus

Im Entwicklungsmodus sucht Electron die `.env`-Datei im **Projekt-Root**
(nicht in `userData`). `main.ts` setzt dazu `USER_ENV_FILE=<Projektroot>/.env`.

---

## npm-Skripte

Alle Skripte werden im **Projekt-Root** ausgeführt (nicht im `frontend/` Ordner).

| Skript | Befehl | Beschreibung |
|---|---|---|
| `dev:vite` | `vite --config vite.config.ts` | Vite Dev-Server (Hot Reload für React) |
| `dev:electron` | `electron .` | Startet Electron (erwartet kompiliertes `dist/electron/`) |
| `build` | `vite build && tsc -p tsconfig.electron.json` | Kompiliert React + TypeScript |
| `build:dist` | `npm run build && electron-builder` | Vollständiger Produktions-Build |
| `lint` | `eslint frontend/src` | ESLint für den Renderer |

---

## TypeScript-Konfigurationen

Das Projekt verwendet **zwei separate** `tsconfig.json`-Dateien.

### `tsconfig.json` (Renderer / Vite)

- Ziel: `ESNext`, Modul: `ESNext`
- Root: `frontend/src`
- JSX: `react-jsx`
- Wird von Vite intern genutzt, kein expliziter `tsc`-Aufruf nötig

### `tsconfig.electron.json` (Main + Preload)

- Ziel: `ES2022`, Modul: `CommonJS`
- Einschlussmuster: `frontend/electron/**/*.ts`
- Ausgabe: `dist/electron/`
- Wird explizit aufgerufen: `npx tsc -p tsconfig.electron.json`

---

## Python-Abhängigkeiten (backend/requirements.txt)

| Paket | Verwendung |
|---|---|
| `fastapi` | HTTP-Framework |
| `uvicorn[standard]` | ASGI-Server |
| `pydantic` | Datenvalidierung (Settings, Modelle) |
| `pydantic-settings` | Settings aus .env |
| `python-multipart` | Datei-Upload (multipart/form-data) |
| `google-genai` | Gemini-API-Client |
| `openai` | OpenAI- und Azure-OpenAI-Client |
| `moviepy` | Video-Komposition (≥ 2.x) |
| `Pillow` | Bild-Manipulation (Text-Panels) |
| `gTTS` | Text-to-Speech (Google TTS) |
| `opencv-python` | Pause-Erkennung (pause_detector.py) |
| `httpx` | Async HTTP (intern genutzt) |

---

## Typische Entwicklungsaufgaben

### Neuen KI-Provider hinzufügen

1. Neue Datei `backend/app/services/{name}_provider.py` anlegen
2. Von `AiProviderBase` erben, `analyze_frames()` **und** `complete_text()` implementieren
3. In `backend/app/routers/ai.py` in `_get_provider()` registrieren
4. In `OPENAI_VISION_MODELS` / `AZURE_OPENAI_VISION_MODELS` o.ä. eine neue Konstante anlegen oder das Modell-Listing erweitern
5. Neue `AiProvider`-Enum-Konstante in `backend/app/models.py` hinzufügen
6. Neue Umgebungsvariablen in `backend/app/config.py` (Settings) ergänzen
7. `localstuff/env.example` und `docs/CONFIGURATION.md` aktualisieren

### Neuen Backend-Endpunkt hinzufügen

1. Passendes Router-Modul öffnen (oder neues anlegen unter `backend/app/routers/`)
2. Endpunkt-Funktion mit FastAPI-Decorator implementieren
3. Falls neuer Router: in `backend/app/main.py` per `app.include_router()` einbinden
4. Request/Response-Modelle in `backend/app/models.py` ergänzen
5. Frontend-Wrapper in `frontend/src/api/backendClient.ts` ergänzen

### Neuen Workflow-Schritt im Frontend hinzufügen

1. Neue Komponente in `frontend/src/components/` anlegen
2. In `App.tsx` den `Step`-Enum und die jeweilige Steps-Array-Konstante ergänzen
3. Im `renderStep()`-Switch-Case die neue Komponente rendern

### Backend-Tests ausführen

Derzeit gibt es keine automatisierten Tests. Manuelle Prüfung per FastAPI-Swagger:

```
http://127.0.0.1:8787/docs
```

### Workspace vollständig zurücksetzen

```powershell
# Alle generierten Artefakte löschen (nicht die Tools oder venv)
Remove-Item -Recurse -Force workspace\uploads\*, workspace\normalized\*, `
  workspace\cut\*, workspace\frames\*, workspace\ai-output\*, workspace\output\*
```

---

## Build und Paketierung

### Lokaler Test-Build (Windows)

```powershell
npm run build:dist
```

Erzeugt unter `dist/`:
- `Clip2Guide Setup 0.1.0.exe` (NSIS-Installer)

### Lokaler Test-Build (macOS)

```bash
npm run build:dist
```

Erzeugt unter `dist/`:
- `Clip2Guide-0.1.0.dmg` (DMG für aktuelle Architektur)

### Plattformübergreifend via CI

Siehe [RELEASE.md](RELEASE.md).

---

## Projektstruktur verstehen

### Daten-Lebensdauer

Der `workspace/`-Ordner enthält alle Laufzeit-Daten. Er wird **nicht** bereinigt,
da der Benutzer auf frühere Ergebnisse zugreifen können soll. Für Tests ist
manuelles Löschen oder ein separates `WORKSPACE_DIR` in `.env` sinnvoll.

### Backend-Neustart im Dev-Modus

`uvicorn --reload` überwacht alle `.py`-Dateien unter `backend/app/`.
Änderungen an Python-Code werden automatisch neu geladen.
`create_tutorial.py` wird als Subprocess gestartet und **nicht** von `--reload` erfasst –
nach Änderungen dort muss kein Neustart erfolgen.

### Frontend-Hot-Reload

Vite HMR ist aktiv. Änderungen an React-Komponenten werden sofort im
laufenden Electron-Fenster reflektiert, ohne Neustart.

### Electron-Änderungen

Änderungen an `main.ts` oder `preload.ts` erfordern:
1. `npx tsc -p tsconfig.electron.json` (oder VS Code Task `compile: electron`)
2. Electron-Prozess neu starten (`npm run dev:electron`)
