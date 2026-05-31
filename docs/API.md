# Clip2Guide – API-Referenz

Das FastAPI-Backend läuft auf `http://127.0.0.1:8787`.
Interaktive Swagger-Dokumentation: `http://127.0.0.1:8787/docs`

Alle Endpunkte haben das Präfix `/api`.

---

## Health-Check

### `GET /`

Gibt Betriebsbereitschaft zurück.

**Response** `200 OK`
```json
{ "status": "ok" }
```

---

## Server-Sent Events (SSE)

### `GET /api/jobs/{job_id}/events`

Echtzeit-Fortschritt für lang laufende Operationen.
Muss *vor* oder gleichzeitig mit dem auslösenden POST geöffnet werden.

**Path-Parameter:**
- `job_id` – UUID des Jobs (entspricht der `video_id` oder `session_id`)

**Response:** `text/event-stream`

**Event-Format:**
```
data: {"type": "progress", "step": "normalize", "message": "...", "percent": 42, "data": null}

data: {"type": "completed", "step": "normalize", "message": "...", "percent": 100, "data": {...}}

data: {"type": "error", "step": "normalize", "message": "Fehlermeldung", "percent": 0, "data": null}

data: {"type": "log", "step": "auto_editor", "message": "Rohausgabe ...", "percent": 0, "data": null}
```

**Keepalive:** `: keepalive` alle 15 Sekunden
**Timeout:** 3600 Sekunden (dann automatisch `error`-Event)

**Event-Typen:**

| Typ | Bedeutung |
|---|---|
| `progress` | Zwischenstand, `percent` 0–99 |
| `completed` | Job abgeschlossen, `percent` = 100, `data` enthält Ergebnis |
| `error` | Fehler aufgetreten, Job beendet |
| `log` | Rohausgabe eines Subprozesses (Auto-Editor, FFmpeg) |
| `throttled` | Zu viele gleichzeitige Jobs; Request abgewiesen |

---

## Upload

### `POST /api/upload/video`

Video hochladen (Multipart). Akzeptierte Formate: `.mp4 .mov .avi .mkv .webm`
Maximale Chunk-Größe intern: 1 MB.

**Body:** `multipart/form-data`
- `file` – Videodatei
- `job_id` *(optional)* – UUID; wird automatisch generiert falls nicht angegeben

**Response** `200 OK`
```json
{
  "video_id": "b8b5ae7e-f824-4130-b07b-7e3654107210",
  "filename": "screen_recording.mp4",
  "file_size": 104857600,
  "duration_seconds": 142.5,
  "width": 2560,
  "height": 1440,
  "fps": 60.0,
  "has_audio": true
}
```

SSE-Events (über `/api/jobs/{video_id}/events`):
- `progress`: 0–80 % (Datei-Chunks), 88 % (ffprobe-Analyse)
- `completed`: Upload abgeschlossen

---

## Verarbeitung

### `POST /api/videos/{video_id}/cut`

Auto-Editor-Schnitt: Stille / Bewegung entfernen.
Läuft als FastAPI `BackgroundTask`, Fortschritt via SSE.

**Path-Parameter:** `video_id` – UUID aus Upload

**Body:** `application/json`
```json
{
  "edit_mode": "audio",
  "margin": "0.3sec",
  "silent_threshold": 0.04,
  "motion_threshold": 0.02
}
```

Alle Felder sind optional – Defaults aus `.env` werden verwendet.

`edit_mode`-Werte: `audio` | `motion` | `combined`

**Response** `200 OK`
```json
{ "message": "Schnitt gestartet", "video_id": "..." }
```

SSE-Events:
- `log`: Rohausgabe von Auto-Editor (zeilenweise)
- `completed`: `data.cut_video_path` enthält absoluten Pfad der Ausgabe

---

### `POST /api/videos/{video_id}/normalize`

FFmpeg-Normalisierung: H.264, AAC, konstante Framerate, Zielauflösung.
Läuft als FastAPI `BackgroundTask`, Fortschritt via SSE.
Eingabe: bevorzugt `cut/`, sonst `uploads/`.

**Path-Parameter:** `video_id`

**Body:** leer

**Response** `200 OK`
```json
{ "message": "Normalisierung gestartet", "video_id": "..." }
```

SSE-Events:
- `progress`: 0–100 %, aus FFmpeg `-progress pipe:1`-Ausgabe (frame-basiert)
- `completed`: `data.normalized_video_path`

---

## Frames

### `POST /api/videos/{video_id}/extract-frames`

Frames aus dem normalisierten Video extrahieren.

**Path-Parameter:** `video_id`

**Body:** `application/json`
```json
{
  "frame_rate": 0.333
}
```

`frame_rate` ist optional (Default aus `.env`).

**Response** `200 OK`
```json
{ "message": "Frame-Extraktion gestartet", "video_id": "..." }
```

SSE-Events:
- `progress`: 0–100 %
- `completed`:
```json
{
  "data": {
    "video_id": "...",
    "frame_count": 47,
    "frames_dir": "workspace/frames/..."
  }
}
```

---

### `GET /api/videos/{video_id}/frame-stack`

Gespeicherten FrameStack laden.

**Response** `200 OK` – FrameStack-JSON (siehe Datenmodelle in ARCHITECTURE.md)

---

### `GET /api/videos/{video_id}/frames/{filename}`

Einzelnes Frame-Bild liefern.

**Path-Parameter:** `filename` – z.B. `frame_001.jpg`

**Response** `200 OK` – JPEG-Bild

---

## KI / Analyse

### `GET /api/ai/providers`

Liste aller aktiven KI-Provider.

**Response** `200 OK`
```json
{
  "providers": ["gemini", "openai"]
}
```

---

### `GET /api/ai/models`

Verfügbare Modelle für einen Provider.

**Query-Parameter:** `provider` – `gemini` | `openai` | `azure_openai`

**Response** `200 OK`
```json
{
  "provider": "gemini",
  "models": [
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.0-flash",
    "gemini-1.5-pro"
  ]
}
```

Für Gemini: dynamisch per API abgerufen.
Für OpenAI / Azure: feste Liste im Code.

---

### `POST /api/videos/{video_id}/analyze`

Frames an KI-Provider senden, Storyboard generieren.

**Path-Parameter:** `video_id`

**Body:** `application/json`
```json
{
  "provider": "gemini",
  "model": "gemini-2.5-flash-preview-05-20",
  "languages": ["de", "en"],
  "selected_frames": ["frame_001.jpg", "frame_004.jpg", "frame_007.jpg"],
  "prompt_extra": "Erkläre jeden Schritt so, als würde ich dem Benutzer das Produkt zeigen."
}
```

- `languages` – mindestens eine Sprache (ISO-639-1-Codes)
- `selected_frames` – Frames, die an die KI übergeben werden (leer = alle)
- `prompt_extra` – optionaler Zusatztext am Ende des System-Prompts

**Response** `200 OK`
```json
{ "message": "Analyse gestartet", "video_id": "..." }
```

SSE-Events:
- `progress`: Beginn der Analyse
- `completed`: Storyboard wurde gespeichert unter `workspace/ai-output/{video_id}/storyboard.json`

---

### `GET /api/videos/{video_id}/storyboard`

Gespeichertes Storyboard abrufen.

**Response** `200 OK` – StoryboardJson (vollständige Struktur, siehe ARCHITECTURE.md)

---

### `PUT /api/videos/{video_id}/storyboard`

Storyboard überschreiben (nach manuellem Bearbeiten im UI).

**Body:** `application/json` – StoryboardJson (vollständig)

**Response** `200 OK`
```json
{ "message": "Storyboard gespeichert" }
```

---

## Rendering

### `POST /api/videos/{video_id}/render`

Tutorial-Video erstellen. Läuft als FastAPI `BackgroundTask` (Subprocess).
Fortschritt via SSE.

**Path-Parameter:** `video_id`

**Body:** `application/json`
```json
{
  "quality": "ausgewogen",
  "languages": ["de"]
}
```

- `quality`: `schnell` | `ausgewogen` | `beste` (optional, Default aus `.env`)
- `languages`: Liste der zu rendernden Sprachen (muss Teilmenge der Storyboard-Sprachen sein)

**Response** `200 OK`
```json
{ "message": "Rendering gestartet", "video_id": "..." }
```

SSE-Events:
- `progress`: 0–100 %, aus `stdout` von `create_tutorial.py` (Regex-Parsing)
- `log`: Roh-Stdout-Zeilen
- `completed`:
```json
{
  "data": {
    "output_files": [
      "workspace/output/.../tutorial_de.mp4"
    ]
  }
}
```

---

## Bilder (Bild-Modus)

### `POST /api/images/upload`

Mehrere Screenshots hochladen (Bild-Modus, kein Video).

**Body:** `multipart/form-data`
- `files` – Mehrere Bilddateien (JPEG, PNG)
- `session_id` *(optional)* – UUID

**Response** `200 OK`
```json
{
  "session_id": "...",
  "images": [
    { "filename": "screenshot_01.png", "width": 2560, "height": 1440 },
    { "filename": "screenshot_02.png", "width": 2560, "height": 1440 }
  ]
}
```

---

### `POST /api/images/normalize`

Hochgeladene Bilder auf einheitliche Größe bringen.

**Body:** `application/json`
```json
{
  "session_id": "...",
  "mode": "fit",
  "target_width": 1920,
  "target_height": 1080
}
```

`mode`-Werte: `crop` | `fit` | `stretch`

**Response** `200 OK`
```json
{ "session_id": "...", "message": "Normalisierung abgeschlossen" }
```

---

### `POST /api/images/to-frames`

Normalisierte Bilder in einen FrameStack umwandeln (Einstieg in den Video-Workflow).

**Body:** `application/json`
```json
{
  "session_id": "..."
}
```

**Response** `200 OK`
```json
{
  "video_id": "...",
  "frame_count": 12
}
```

Ab diesem Punkt wird die `video_id` für alle weiteren Endpunkte genutzt
(Storyboard-Generierung, Rendering etc.).

---

## Fehler-Antworten

Alle Endpunkte folgen dem FastAPI-Standard für Fehler:

```json
{
  "detail": "Beschreibung des Fehlers"
}
```

| HTTP-Status | Bedeutung |
|---|---|
| `400` | Ungültige Anfrage (z.B. falsches Dateiformat) |
| `404` | Ressource nicht gefunden (z.B. video_id unbekannt) |
| `429` | Zu viele gleichzeitige Jobs (SSE-Event `throttled`) |
| `500` | Interner Fehler (Subprocess-Absturz, Tool nicht gefunden etc.) |
