# Clip2Guide – API-Referenz

Das FastAPI-Backend läuft auf `http://127.0.0.1:8787`.
Interaktive Swagger-Dokumentation: `http://127.0.0.1:8787/docs`

Alle Endpunkte haben das Präfix `/api`.

---

## Health-Check

### `GET /health`

Gibt Betriebsbereitschaft und App-Version zurück.

**Response** `200 OK`
```json
{ "status": "ok", "version": "0.1.0" }
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
```text
data: {"type": "progress", "step": "normalize", "message": "...", "percent": 42, "data": null}

data: {"type": "completed", "step": "normalize", "message": "...", "percent": 100, "data": {...}}

data: {"type": "error", "step": "normalize", "message": "Fehlermeldung", "percent": 0, "data": null}

data: {"type": "log", "step": "auto_editor", "message": "Rohausgabe ...", "percent": 0, "data": null}
```
**Keepalive:** `: keepalive` alle 15 Sekunden
**Timeout:** 3600 Sekunden (dann automatisch `error`-Event)

**Event-Typen:**

| Typ | Bedeutung |
| --- | --- |
| `progress` | Zwischenstand, `percent` 0–99 |
| `completed` | Job abgeschlossen, `percent` = 100, `data` enthält Ergebnis |
| `error` | Fehler aufgetreten, Job beendet |
| `log` | Rohausgabe eines Subprozesses (Auto-Editor, FFmpeg, create_tutorial.py) |
| `throttled` | Modell überlastet (429/503); `data.alternatives` enthält alternative Provider/Modelle |
| `debug` | Prompt-Details und Debugging-Informationen (Analyse, Rewrite, Handbuch-KI) |

---

## Upload

### `POST /api/upload/video`

Video hochladen (Multipart). Akzeptierte Formate: `.mp4 .mov .avi .mkv .webm`
Maximale Chunk-Größe intern: 1 MB.

**Body:** `multipart/form-data`
- `file` – Videodatei

**Query-Parameter:**
- `upload_id` *(optional)* – UUID für SSE-Fortschritts-Tracking; wird automatisch generiert falls nicht angegeben
- `file_size` *(optional)* – Dateigröße in Bytes; ermöglicht prozentgenauen Fortschritt

**Response** `200 OK`
```json
{
  "video_id": "b8b5ae7e-f824-4130-b07b-7e3654107210",
  "filename": "screen_recording.mp4",
  "path": "/abs/path/workspace/uploads/b8b5ae7e-....mp4",
  "has_audio": true,
  "metadata": {
    "duration_seconds": 142.5,
    "width": 2560,
    "height": 1440,
    "fps": 60.0,
    "file_size": 104857600
  }
}
```
SSE-Events (über `/api/upload/{upload_id}/events`):
- `progress`: 0–80 % (Datei-Chunks), 88 % (ffprobe-Analyse)
- `completed`: Upload abgeschlossen

> **Hinweis:** Der SSE-Endpunkt für den Upload lautet `/api/upload/{upload_id}/events`
> (nicht `/api/jobs/{job_id}/events`).

---

## Verarbeitung

### `POST /api/videos/{video_id}/cut`

Auto-Editor-Schnitt: Stille / Bewegung entfernen.
Läuft als FastAPI `BackgroundTask`, Fortschritt via SSE.

**Path-Parameter:** `video_id` – UUID aus Upload

**Body:** `application/json`
```json
{
  "video_id": "...",
  "edit_mode": "audio",
  "margin": "0.5s",
  "has_audio": true,
  "audio_threshold": 0.03,
  "motion_threshold": 0.08
}
```
Alle Felder außer `video_id` sind optional – Defaults aus `.env` werden verwendet.

`edit_mode`-Werte: `audio` | `motion` | `combined`

**Response** `200 OK`
```json
{ "job_id": "...", "video_id": "...", "message": "Job gestartet" }
```
SSE-Events (über `/api/jobs/{job_id}/events`):
- `log`: Rohausgabe von Auto-Editor (zeilenweise)
- `progress`: beinhaltet vor dem Schnitt eine Audio-Decoder-Pruefung; bei `Decoder not found` wird automatisch eine AAC-kompatible Arbeitsdatei erzeugt und der Schnitt einmal wiederholt
- `completed`: `data.cut_path` enthält absoluten Pfad der Ausgabe

---

### `POST /api/videos/{video_id}/normalize`

FFmpeg-Normalisierung: H.264, AAC, konstante Framerate, Zielauflösung.
Läuft als FastAPI `BackgroundTask`, Fortschritt via SSE.
Eingabe: bevorzugt `cut/`, sonst `uploads/`.

**Path-Parameter:** `video_id`

**Body:** leer

**Response** `200 OK`
```json
{ "job_id": "...", "video_id": "...", "message": "Job gestartet" }
```
SSE-Events (über `/api/jobs/{job_id}/events`):
- `progress`: 0–100 %, aus FFmpeg `-progress pipe:1`-Ausgabe (frame-basiert)
- `completed`: `data.normalized_path`

---

## Frames

### `POST /api/videos/{video_id}/extract-frames`

Frames aus dem Video extrahieren.
Priorität: `cut/` → `normalized/` → `uploads/`.

**Path-Parameter:** `video_id`

**Body:** leer (Frame-Rate wird aus `.env`-Variable `FRAME_EXTRACTION_FPS` gelesen, Default: `0.333`)

**Response** `200 OK`
```json
{ "job_id": "...", "video_id": "...", "message": "Frame-Extraktion gestartet" }
```
SSE-Events (über `/api/jobs/{job_id}/events`):
- `progress`: 0–100 %
- `completed`:
```json
{
  "data": {
    "video_id": "...",
    "total_frames": 47
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

### `PUT /api/videos/{video_id}/frames/{filename}`

Bestehendes Frame-Bild ersetzen, z.B. nach Rotation, Zielformat-Anpassung oder Blur/Pixelate/Schwaerzen im Frame-Editor.

**Body:** `multipart/form-data`
- `file` – neues Bild (`image/jpeg`, `image/png`, `image/webp`, `image/gif`)

**Response** `200 OK`
```json
{ "ok": true, "filename": "frame_001.jpg", "video_id": "..." }
```
---

### `POST /api/videos/{video_id}/frames/upload`

Eigene Bilder als Frames in einen bestehenden FrameStack hochladen.

**Body:** `multipart/form-data`
- `files` – mehrere Bilddateien

**Response** `200 OK` – aktualisierter `FrameStack`

---

## KI / Analyse

### `GET /api/ai/providers`

Liste aller in `AI_PROVIDER` (.env) konfigurierten KI-Provider.

**Response** `200 OK`
```json
{
  "providers": [
    { "id": "gemini", "label": "Google Gemini" },
    { "id": "openai", "label": "OpenAI" }
  ],
  "default": "gemini"
}
```
---

### `GET /api/ai/models`

Verfügbare Modelle für einen Provider.

**Query-Parameter:** `provider` – `gemini` | `openai` | `azure_openai` | `azure_cognitive`

**Response** `200 OK`
```json
{
  "provider": "gemini",
  "models": [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro"
  ],
  "default": "gemini-2.5-flash"
}
```
Für Gemini: dynamisch per `client.models.list()` abgerufen.
Für OpenAI / Azure OpenAI / Azure Cognitive: feste Liste im Code.

---

### `POST /api/videos/{video_id}/analyze`

Frames an KI-Provider senden, Storyboard generieren.
Läuft als FastAPI `BackgroundTask`, Fortschritt via SSE.

**Path-Parameter:** `video_id`

**Body:** `application/json`
```json
{
  "video_id": "...",
  "languages": ["de", "en"],
  "ai_provider": "gemini",
  "ai_model": "gemini-2.5-flash",
  "master_prompt": "Erstelle ein zusammenhaengendes Tutorial-Storyboard fuer Einsteiger.",
  "selected_frames": ["frame_001.jpg", "frame_004.jpg"],
  "scene_groups": [["frame_001.jpg", "frame_004.jpg"]],
  "scene_descriptions": ["Kurze Beschreibung der Szene als Nutzerhinweis."],
  "image_prompts": {
    "frame_001.jpg": "Fokussiere auf das geoeffnete Menue."
  }
}
```
| Feld | Typ | Beschreibung |
| --- | --- | --- |
| `video_id` | string | UUID des Videos |
| `languages` | string[] | Zielsprachen (ISO-639-1), min. eine |
| `ai_provider` | string\|null | `gemini` \| `openai` \| `azure_openai` \| `azure_cognitive`; null = Default aus .env |
| `ai_model` | string\|null | Modellname; null = Default des Providers |
| `master_prompt` | string | Allgemein vorangestellte Gesamtanweisung fuer die initiale Storyboard-Erstellung; wird in `metadata.ai_master_context` gespeichert |
| `selected_frames` | string[] | Dateinamen der Frames die an die KI übergeben werden; leer = alle |
| `scene_groups` | string[][]\|null | Vom Nutzer vordefinierte Szenen-Gruppen; die KI wird je Gruppe separat aufgerufen |
| `scene_descriptions` | string[] | Optional: kurze Nutzerbeschreibung pro `scene_groups`-Eintrag |
| `image_prompts` | object | Optional: Dateiname → KI-Anweisung pro Bild für die Erst-Analyse |

**Response** `200 OK`
```json
{ "job_id": "...", "video_id": "...", "message": "KI-Analyse gestartet" }
```
SSE-Events (über `/api/jobs/{job_id}/events`):
- `progress`: Analyse-Fortschritt
- `debug`: Prompt-Details (nur für Debugging-Zwecke)
- `throttled`: Modell überlastet; `data.alternatives` enthält alternative Provider/Modelle
- `completed`: `data.scenes` = Anzahl erkannter Szenen

---

### `GET /api/videos/{video_id}/storyboard`

Gespeichertes Storyboard abrufen.

**Response** `200 OK` – vollständiges `StoryboardJson` (Struktur siehe ARCHITECTURE.md)

---

### `PUT /api/videos/{video_id}/storyboard`

Storyboard vollständig überschreiben (nach manuellem Bearbeiten im UI).

**Body:** `application/json`
```json
{
  "storyboard": { ...StoryboardJson... }
}
```
**Response** `200 OK` – das gespeicherte `StoryboardJson`

---

### `POST /api/videos/{video_id}/rewrite-scene`

Eine einzelne Szene durch die KI neu analysieren und Texte überschreiben.
Verwendet die Frames in `req.image_group` in der vom Nutzer festgelegten Reihenfolge.
Läuft als FastAPI `BackgroundTask`, Fortschritt via SSE.

**Body:** `application/json`
```json
{
  "scene_id": "scene_003",
  "image_group": ["frame_010.jpg", "frame_012.jpg"],
  "languages": ["de"],
  "ai_provider": "gemini",
  "ai_model": null,
  "current_texts": {
    "de": {
      "heading": "Meine Überschrift",
      "body": "Mein Text",
      "speaker_notes": "Meine Sprechernotizen"
    }
  },
  "image_prompts": {
    "frame_010.jpg": "Fokussiere auf das rote Symbol oben links."
  },
  "duration_seconds": 8.0,
  "storyboard_context": {
    "master_context": {},
    "change_history": [],
    "scenes": []
  },
  "change_summary": "Bild frame_010.jpg wurde zu Szene 3 hinzugefuegt."
}
```
| Feld | Beschreibung |
| --- | --- |
| `scene_id` | ID der Szene (z.B. `scene_003`) |
| `image_group` | Frames für die Analyse (Reihenfolge wie vom Nutzer festgelegt) |
| `current_texts` | Optional: Bestehende Texte als Kontext für die KI |
| `image_prompts` | Optional: Dateiname → KI-Anweisung pro Bild |
| `duration_seconds` | Optional: Ziel-Szenenläng in Sekunden (bestimmt speaker_notes-Länge) |
| `storyboard_context` | Optional: aktueller Gesamtzustand des Storyboards fuer kontextbewusste Rewrites; `master_context` darf den aus dem Editor aktualisierten `ai_master_context` inklusive aktueller Szenenbeschreibungen enthalten |
| `change_summary` | Optional: Kurzbeschreibung der Änderung; wird in `metadata.ai_change_history` fortgeschrieben |

**Response** `200 OK`
```json
{ "job_id": "...", "video_id": "...", "message": "Szene wird neu analysiert" }
```
SSE `completed`:
```json
{
  "data": {
    "texts": { "de": {"heading": "...", "body": "...", "speaker_notes": "..."} },
    "scene_id": "scene_003"
  }
}
```
---

### `POST /api/videos/{video_id}/chat`

Interaktiver KI-Assistent für das Storyboard.
Läuft als FastAPI `BackgroundTask`, Fortschritt via SSE.

**Body:** `application/json`
```json
{
  "message": "Schreibe die Überschrift von Szene 2 kürzer",
  "languages": ["de"],
  "ai_provider": null,
  "ai_model": null,
  "address_style": "sie",
  "writing_style": "sachlich",
  "detail_level": "standard"
}
```
| Feld | Default | Beschreibung |
| --- | --- | --- |
| `message` | — | Nutzer-Nachricht in natürlicher Sprache |
| `ai_provider` | `null` | Override; null = Session-Provider oder settings-Default |
| `ai_model` | `null` | Override; null = Session-Modell oder Provider-Default |
| `address_style` | `sie` | `du` \| `sie` \| `neutral` |
| `writing_style` | `sachlich` | `sachlich` \| `leicht_verstaendlich` \| `technisch_detailliert` |
| `detail_level` | `standard` | `kurz` \| `standard` \| `ausfuehrlich` |

**Bildreferenzen:** Enthält die Nachricht Phrasen wie `"Bild 3 aus Szene 2"`, wird der Frame
automatisch per Vision-API an das Modell geschickt (compress_frame_for_ki, max. 768 px JPEG 40).

**Felder werden NUR geändert** bei expliziten Aktionswörtern:
`schreibe`, `ändere`, `passe an`, `setze um`, `erstelle`, `formuliere`, `überarbeite`, `aktualisiere`, `mach`.
Fragen und Diskussionen geben nur `reply` zurück mit `updates: []`.

**Response** `200 OK`
```json
{ "job_id": "...", "video_id": "...", "message": "Chat gestartet" }
```
SSE `completed`:
```json
{
  "data": {
    "reply": "Ich habe die Überschrift von Szene 2 gekürzt.",
    "updates": [
      { "scene_id": "scene_002", "lang": "de", "field": "heading", "value": "Kürzere Überschrift" }
    ]
  }
}
```
Erlaubte `field`-Werte: `heading`, `body`, `speaker_notes`.

---

### `POST /api/videos/{video_id}/enrich-scenes`

`slide_panels` und `render_hints` für Szenen mit mehreren Bildern durch die KI befüllen.
Überspringt Szenen, die bereits angereichert wurden (es sei denn `scene_ids` ist gesetzt).
Läuft als FastAPI `BackgroundTask`, Fortschritt via SSE.

**Body:** `application/json`
```json
{
  "languages": ["de"],
  "scene_ids": null,
  "ai_provider": null,
  "ai_model": null
}
```
`scene_ids` = null → alle Szenen mit `len(image_group) > 1` und leerem `slide_panels`.

**Response** `200 OK`
```json
{ "job_id": "...", "video_id": "...", "message": "Anreicherung gestartet" }
```
---

## Rendering

### `POST /api/videos/{video_id}/render`

Tutorial-Video erstellen. Läuft als FastAPI `BackgroundTask` (Subprocess pro Sprache, parallel).
Fortschritt via SSE.

**Path-Parameter:** `video_id`

**Body:** `application/json`
```json
{
  "video_id": "...",
  "languages": ["de", "en"],
  "output_formats": ["video"],
  "handbook_optimize": false,
  "ai_provider": null,
  "ai_model": null,
  "fps": 25,
  "quality": "ausgewogen",
  "tts_slow": false
}
```
| Feld | Default | Beschreibung |
| --- | --- | --- |
| `languages` | `["de"]` | Sprachen die gerendert werden sollen |
| `output_formats` | `["video"]` | Ausgabeformate: `video`, `manual` oder beide |
| `handbook_optimize` | `false` | Optional: KI-Segmentierung fuer das DOCX-Handbuch; `body` wird als Bild-Erklaerung und `speaker_notes` als Textbausteine auf Bilder verteilt, Inhalte werden nicht umgeschrieben, Szenenstruktur bleibt unveraendert |
| `ai_provider` | `null` | KI-Provider fuer Handbuch-Optimierung; null = Default aus `.env` |
| `ai_model` | `null` | Modell fuer Handbuch-Optimierung; null = Provider-Default |
| `fps` | `25` | Frames pro Sekunde (10–60) |
| `quality` | `ausgewogen` | `schnell` \| `ausgewogen` \| `beste` |
| `tts_slow` | `false` | Langsame TTS-Sprechgeschwindigkeit (gTTS `slow=True`) |

Vor dem Render werden die Szenen-Dauern automatisch neu berechnet:
- Schätzung: 13 Zeichen/Sekunde
- Minimale Szenen-Dauer: 2,0 Sekunden

**Response** `200 OK`
```json
{ "job_id": "...", "video_id": "...", "message": "Rendering gestartet" }
```
SSE-Events (über `/api/jobs/{job_id}/events`):
- `progress`: 10–100 %, aus `stdout` von `create_tutorial.py` (Regex-Parsing)
- `log`: Roh-Stdout-/Stderr-Zeilen
- `debug`: Prompt und KI-Antwort bei aktivierter Handbuch-Optimierung
- `error`: Nicht-leere Fehlermeldung; beim Handbuch-Rendering enthält sie die betroffene Sprache
- `completed`:
```json
{
  "data": {
    "output_dir": "workspace/output/...",
    "files": ["workspace/output/.../tutorial_de.mp4"],
    "manual_files": ["workspace/output/.../manual_de.docx"]
  }
}
```
---

### `GET /api/videos/{video_id}/output/{filename}`

Fertige Tutorial-Video-Datei herunterladen.

**Path-Parameter:**
- `video_id` – UUID des Videos
- `filename` – z.B. `tutorial_de.mp4`

**Response** `200 OK` – MP4-Video (`video/mp4`)

---

### `GET /api/videos/{video_id}/manual/{filename}`

Fertige DOCX-Handbuch-Datei herunterladen.

Beim DOCX-Aufbau werden Frames vor dem Einfügen in Word validiert und als
DOCX-kompatible JPEG-Arbeitsdateien unter `workspace/tmp/manual-docx-images/`
geschrieben. Dadurch funktionieren auch restaurierte oder bearbeitete Frames,
deren Dateiendung nicht zuverlässig zum Bildinhalt passt.

**Path-Parameter:**
- `video_id` – UUID des Videos
- `filename` – z.B. `manual_de.docx`

**Response** `200 OK` – DOCX-Datei (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`)

---

## Projektarchiv

### `POST /api/videos/{video_id}/export-project`

Exportiert den aktuellen Projektstand als ZIP.

**Response** `200 OK`
```json
{
  "video_id": "...",
  "filename": "project_....zip",
  "path": "workspace/output/.../project_....zip",
  "message": "Projektstand exportiert"
}
```
### `GET /api/videos/{video_id}/project/{filename}`

Projekt-ZIP herunterladen.

**Response** `200 OK` – ZIP-Datei (`application/zip`)

### `POST /api/projects/import`

Projektstand aus ZIP wiederherstellen.

**Body:** `multipart/form-data`
- `file` – ZIP-Datei
- `restore_mode` – `new_id` oder `overwrite`, Default `new_id`

**Response** `200 OK`
```json
{
  "video_id": "new-or-existing-id",
  "original_video_id": "...",
  "restored_files": 42,
  "message": "Projektstand wiederhergestellt"
}
```
---

## Bilder (Bild-Modus)

### `POST /api/upload/images`

Mehrere Screenshots hochladen (Bild-Modus, kein Video).

**Body:** `multipart/form-data`
- `files` – Mehrere Bilddateien (JPEG, PNG, WebP, BMP)

**Response** `200 OK`
```json
{
  "session_id": "...",
  "images": [
    { "image_id": "...", "filename": "screenshot_01.png", "width": 2560, "height": 1440 },
    { "image_id": "...", "filename": "screenshot_02.png", "width": 2560, "height": 1440 }
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
{
  "session_id": "...",
  "images": [
    { "image_id": "...", "filename": "....jpg", "width": 1920, "height": 1080 }
  ]
}
```
---

### `POST /api/images/{session_id}/to-frames`

Normalisierte Bilder in einen FrameStack umwandeln (Einstieg in den Video-Workflow).

**Path-Parameter:** `session_id`

**Body:** leer

**Response** `200 OK`
```json
{
  "video_id": "...",
  "total_frames": 12,
  "frames": [
    { "filename": "frame_001.jpg", "timestamp_seconds": 0.0, "scene_index": null }
  ]
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
| --- | --- |
| `400` | Ungültige Anfrage (z.B. falsches Dateiformat) |
| `404` | Ressource nicht gefunden (z.B. video_id unbekannt) |
| `429` | Zu viele gleichzeitige Jobs (SSE-Event `throttled`) |
| `500` | Interner Fehler (Subprocess-Absturz, Tool nicht gefunden etc.) |