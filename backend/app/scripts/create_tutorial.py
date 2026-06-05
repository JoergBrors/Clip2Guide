"""
Clip2Guide – Tutorial-Renderer
Erstellt Tutorial-Videos aus einem Storyboard-JSON mit MoviePy 2.x.

Nutzung (aus Projektverzeichnis):
    python backend/app/scripts/create_tutorial.py \\
        --storyboard workspace/ai-output/<video_id>/storyboard.json \\
        --languages de,en \\
        --output-dir workspace/output/<video_id> \\
        --frames-dir workspace/frames/<video_id>
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import List

# Stelle sicher dass 'app' importierbar ist (backend/ ins sys.path)
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from app.config import settings
from app.models import Scene, StoryboardJson, TextPanel

# MoviePy 2.x
from moviepy import (
    AudioFileClip,
    CompositeVideoClip,
    ImageClip,
    concatenate_videoclips,
)
from PIL import Image, ImageDraw, ImageFont

try:
    import proglog as _proglog
    class _StdoutLogger(_proglog.ProgressBarLogger):
        """Leitet MoviePy-Frame-Fortschritt auf stdout weiter (fuer SSE-Streaming).
        MoviePy 2.x verwendet iter_bar(frame_index=...) -> bar-Name ist 'frame_index'.
        """
        def __init__(self, lang: str) -> None:
            super().__init__(init_state=None)
            self._lang = lang
            self._last_pct = -1

        def bars_callback(self, bar, attr, value, old_value=None):
            # MoviePy 2.x: bar="frame_index", attr="index"
            if bar != "frame_index" or attr != "index":
                return
            bar_state = self.bars.get(bar) or {}
            total = bar_state.get("total") or 1
            pct = int(100 * value / max(total, 1))
            # Nur bei 5%-Schritten oder am Ende ausgeben (reduziert SSE-Traffic)
            if pct >= self._last_pct + 5 or value >= total - 1:
                self._last_pct = pct
                print(f"  [{self._lang}] Encoding: Frame {value}/{total} ({pct}%)", flush=True)
    _HAS_PROGLOG = True
except Exception:
    _HAS_PROGLOG = False

# gTTS fuer TTS-Audio
from gtts import gTTS

# ── Konfiguration ──────────────────────────────────────────────────────────────

W = settings.output_video_width
H = settings.output_video_height
FPS = 25  # wird per CLI-Argument ueberschrieben

QUALITY_PRESETS = {
    "schnell":     {"crf": 28, "preset": "veryfast"},
    "ausgewogen":  {"crf": 23, "preset": "faster"},
    "beste":       {"crf": 18, "preset": "medium"},
}

FONT_SIZE_HEADING = 52
FONT_SIZE_BODY = 36
TEXT_PANEL_WIDTH = 600   # Breite des rechten Textbereichs (bei 1920 px: 600 Bild = 1320)
TEXT_BG_COLOR = (20, 20, 20)
TEXT_FG_COLOR = (255, 255, 255)
TEXT_PADDING = 30

# ── Hilfsfunktionen ────────────────────────────────────────────────────────────

def _load_font(size: int):
    """Laedt einen System-Font, faellt auf PIL-Standard zurueck."""
    for font_path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]:
        if Path(font_path).exists():
            try:
                return ImageFont.truetype(font_path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _wrap_text(text: str, font, max_width: int, draw: ImageDraw.Draw) -> str:
    """Bricht langen Text auf mehrere Zeilen um (passend zu max_width Pixel)."""
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        test = " ".join(current + [word])
        bbox = draw.textbbox((0, 0), test, font=font)
        if bbox[2] - bbox[0] > max_width and current:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return "\n".join(lines) if lines else text


def create_text_panel_image(heading: str, body: str, width: int, height: int) -> Image.Image:
    """Erstellt ein PIL-Bild mit Ueberschrift und Body-Text (mit Zeilenumbruch)."""
    img = Image.new("RGB", (width, height), TEXT_BG_COLOR)
    draw = ImageDraw.Draw(img)

    font_h = _load_font(FONT_SIZE_HEADING)
    font_b = _load_font(FONT_SIZE_BODY)
    max_w = width - 2 * TEXT_PADDING

    y = TEXT_PADDING
    wrapped_h = _wrap_text(heading, font_h, max_w, draw)
    draw.multiline_text((TEXT_PADDING, y), wrapped_h, fill=TEXT_FG_COLOR, font=font_h, spacing=6)
    h_line_count = wrapped_h.count("\n") + 1
    y += h_line_count * (FONT_SIZE_HEADING + 6) + 16

    wrapped_b = _wrap_text(body, font_b, max_w, draw)
    draw.multiline_text((TEXT_PADDING, y), wrapped_b, fill=(200, 200, 200), font=font_b, spacing=8)

    return img


def _render_text_to_image(heading: str, body: str, width: int) -> Image.Image:
    """Erstellt ein PIL-Bild dessen Hoehe sich dem Inhalt anpasst (kein Abschneiden)."""
    font_h = _load_font(FONT_SIZE_HEADING)
    font_b = _load_font(FONT_SIZE_BODY)
    max_w = width - 2 * TEXT_PADDING

    # Dummy-Draw fuer Texthoehenmessung
    tmp = Image.new("RGB", (width, 100), TEXT_BG_COLOR)
    draw = ImageDraw.Draw(tmp)
    wrapped_h = _wrap_text(heading, font_h, max_w, draw)
    wrapped_b = _wrap_text(body, font_b, max_w, draw)

    bbox_h = draw.multiline_textbbox((TEXT_PADDING, TEXT_PADDING), wrapped_h, font=font_h, spacing=6)
    y_after_heading = bbox_h[3] + 16
    bbox_b = draw.multiline_textbbox((TEXT_PADDING, y_after_heading), wrapped_b, font=font_b, spacing=8)
    total_h = max(bbox_b[3] + TEXT_PADDING, 120)

    img = Image.new("RGB", (width, total_h), TEXT_BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw.multiline_text((TEXT_PADDING, TEXT_PADDING), wrapped_h, fill=TEXT_FG_COLOR, font=font_h, spacing=6)
    draw.multiline_text((TEXT_PADDING, y_after_heading), wrapped_b, fill=(200, 200, 200), font=font_b, spacing=8)
    return img


def _build_scrolling_panel_clip(
    heading: str,
    body: str,
    panel_width: int,
    panel_height: int,
    x_offset: int,
    duration: float,
    tmp_path: Path,
) -> "ImageClip":
    """Erstellt einen (ggf. scrollenden) Panel-Clip fuer einen Text.

    - Passt Text in Panelhoehe: statischer Clip.
    - Text hoeher als Panel: scrollt vertikal von oben nach unten (Text wandert nach oben).
    """
    full_img = _render_text_to_image(heading, body, panel_width)
    full_h = full_img.height

    if full_h <= panel_height:
        # Auf volle Panelhoehe mit Hintergrundfarbe auffuellen
        bg = Image.new("RGB", (panel_width, panel_height), TEXT_BG_COLOR)
        bg.paste(full_img, (0, 0))
        bg.save(str(tmp_path))
        return (
            ImageClip(str(tmp_path))
            .with_duration(duration)
            .with_position((x_offset, 0))
        )

    # Text laenger als Panel – scrollend
    full_img.save(str(tmp_path))
    scroll_dist = full_h - panel_height
    wait_start = min(1.0, duration * 0.1)
    wait_end   = min(0.5, duration * 0.05)
    scroll_time = max(duration - wait_start - wait_end, 0.5)

    def _make_pos(sd: float, px: int, ws: float, x: int):
        def _pos(t: float):
            if t <= ws:
                return (x, 0)
            progress = min((t - ws) / sd, 1.0)
            return (x, -int(progress * px))
        return _pos

    return (
        ImageClip(str(tmp_path))
        .with_duration(duration)
        .with_position(_make_pos(scroll_time, scroll_dist, wait_start, x_offset))
    )


def create_tts_audio(text: str, lang: str, out_path: Path, slow: bool = False) -> Path:
    """Erzeugt eine MP3-Datei via gTTS."""
    tts = gTTS(text=text, lang=lang[:2], slow=slow)
    tts.save(str(out_path))
    return out_path


def build_scene_clip(
    scene: Scene,
    frames_dir: Path,
    lang: str,
    tmp_dir: Path,
    scene_idx: int,
    tts_slow: bool = False,
):
    """Erstellt einen zusammengesetzten MoviePy-Clip fuer eine Szene.

    Layout  : Bild links (W - TEXT_PANEL_WIDTH), Textbereich rechts (TEXT_PANEL_WIDTH).
    Dauer   : mindestens scene.duration_seconds, aber nie kuerzer als das TTS-Audio
              (Szenenwechsel erst wenn der gesprochene Text fertig ist).
    """
    text_panel: TextPanel = scene.texts.get(lang, TextPanel())
    IMAGE_W = W - TEXT_PANEL_WIDTH

    # ── 1. TTS zuerst generieren – bestimmt die tatsaechliche Szenen-Dauer ────
    audio_clip = None
    actual_duration = scene.duration_seconds
    speaker_text = text_panel.speaker_notes or text_panel.body
    if speaker_text.strip():
        try:
            tts_path = tmp_dir / f"tts_{scene_idx}_{lang}.mp3"
            create_tts_audio(speaker_text, lang, tts_path, slow=tts_slow)
            raw_audio = AudioFileClip(str(tts_path))
            audio_clip = raw_audio
            # Szene dauert mindestens so lang wie das gesprochene Audio
            actual_duration = max(scene.duration_seconds, raw_audio.duration)
        except Exception as exc:
            print(f"  [WARN] TTS fehlgeschlagen fuer Szene {scene.scene_id}: {exc}", file=sys.stderr)

    # ── 2. Frames als Slideshow (links) mit optionalen slide_panels ─────────
    image_group = scene.image_group or (
        [scene.start_frame] if scene.start_frame else []
    )
    hints = scene.render_hints or {}
    transition = hints.get("transition", "cut")
    img_durations_hint: list = hints.get("image_durations", [])
    slide_panels = (scene.slide_panels or {}).get(lang, [])
    use_slide_panels = bool(slide_panels) and len(slide_panels) >= len(image_group)

    # TTS neu berechnen wenn nur slide_panels Speaker-Texte enthalten.
    # Muss vor der Bilddauer-Berechnung passieren, damit Bild-/Panel-Clips
    # die komplette spaetere Audio-/Szenendauer abdecken.
    if use_slide_panels and audio_clip is None:
        full_speaker = " ".join(
            (sp.get("speaker_notes", "") if isinstance(sp, dict) else sp.speaker_notes)
            for sp in slide_panels
        ).strip()
        if full_speaker:
            try:
                tts_path2 = tmp_dir / f"tts_{scene_idx}_{lang}_slides.mp3"
                create_tts_audio(full_speaker, lang, tts_path2, slow=tts_slow)
                raw2 = AudioFileClip(str(tts_path2))
                audio_clip = raw2
                actual_duration = max(actual_duration, raw2.duration)
            except Exception as exc:
                print(f"  [WARN] TTS (slide_panels) fehlgeschlagen: {exc}", file=sys.stderr)

    # Bildzeiten bestimmen
    def _img_dur(idx: int, fallback: float) -> float:
        if idx < len(img_durations_hint):
            try:
                return max(float(img_durations_hint[idx]), 2.0)
            except (TypeError, ValueError):
                pass
        return fallback

    def _normalized_image_durations(count: int, target_duration: float) -> list[float]:
        """Liefert Bilddauern, die zusammen mindestens die Szenendauer abdecken."""
        if count <= 0:
            return []
        fallback = target_duration / count
        durations = [_img_dur(i, fallback) for i in range(count)]
        total = sum(durations)
        if total <= 0:
            return [fallback for _ in range(count)]
        if total < target_duration:
            scale = target_duration / total
            durations = [max(d * scale, 0.1) for d in durations]
            # Rundungsfehler auf dem letzten Bild ausgleichen, damit kein Composite zu kurz ist.
            diff = target_duration - sum(durations)
            durations[-1] += diff
        return durations

    image_durations = _normalized_image_durations(len(image_group), actual_duration)
    frame_dur_default = actual_duration / max(len(image_group), 1)
    frame_clips = []
    panel_clips = []

    for img_idx, fname in enumerate(image_group):
        fp = frames_dir / fname
        if not fp.exists():
            continue
        fdur = image_durations[img_idx] if img_idx < len(image_durations) else frame_dur_default

        img_clip = ImageClip(str(fp)).with_duration(fdur).resized((IMAGE_W, H))
        if transition == "fade" and img_idx > 0:
            try:
                img_clip = img_clip.with_effects([__import__("moviepy").video.fx.CrossFadeIn(0.4)])
            except Exception:
                pass  # CrossFadeIn nicht verfuegbar – ignorieren
        frame_clips.append(img_clip)

        if use_slide_panels:
            sp = slide_panels[img_idx]
            tmp_p = tmp_dir / f"panel_{scene_idx}_{lang}_{img_idx}.jpg"
            panel_clips.append(_build_scrolling_panel_clip(
                sp.get("heading", text_panel.heading) if isinstance(sp, dict) else sp.heading,
                sp.get("body", text_panel.body) if isinstance(sp, dict) else sp.body,
                TEXT_PANEL_WIDTH, H, IMAGE_W, fdur, tmp_p,
            ))

    if not frame_clips:
        placeholder = Image.new("RGB", (IMAGE_W, H), (0, 0, 0))
        tmp_ph = tmp_dir / f"placeholder_{scene_idx}.jpg"
        placeholder.save(str(tmp_ph))
        frame_clips = [ImageClip(str(tmp_ph)).with_duration(actual_duration)]

    if use_slide_panels:
        # Jedes Bild mit eigenem Panel als separates CompositeVideoClip zusammenbauen
        sub_clips = []
        for img_clip, pan_clip in zip(frame_clips, panel_clips):
            sub = CompositeVideoClip(
                [img_clip.with_position((0, 0)), pan_clip],
                size=(W, H)
            ).with_duration(img_clip.duration)
            sub_clips.append(sub)
        composite = concatenate_videoclips(sub_clips, method="chain")
    else:
        slideshow = concatenate_videoclips(frame_clips).with_position((0, 0))
        # ── 3. Text-Panel (rechts, ggf. scrollend) ───────────────────────────
        tmp_panel = tmp_dir / f"panel_{scene_idx}_{lang}.jpg"
        panel_clip = _build_scrolling_panel_clip(
            text_panel.heading, text_panel.body,
            TEXT_PANEL_WIDTH, H, IMAGE_W, actual_duration, tmp_panel,
        )
        composite = CompositeVideoClip([slideshow, panel_clip], size=(W, H))

    composite = composite.with_duration(actual_duration)

    # ── 4. Audio anheften ─────────────────────────────────────────────────────
    if audio_clip is not None:
        composite = composite.with_audio(audio_clip)

    return composite


def render_language(
    storyboard: StoryboardJson,
    frames_dir: Path,
    output_path: Path,
    lang: str,
    fps: int = 25,
    quality: str = "ausgewogen",
    tts_slow: bool = False,
) -> None:
    """Rendert das gesamte Tutorial fuer eine Sprache."""
    q = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["ausgewogen"])

    # Gesamt-Frame-Anzahl vorberechnen
    total_frames = sum(
        len(s.image_group) if s.image_group else (1 if s.start_frame else 0)
        for s in storyboard.scenes
    )
    frames_done = 0

    with tempfile.TemporaryDirectory() as tmp_str:
        tmp_dir = Path(tmp_str)
        clips = []

        for i, scene in enumerate(storyboard.scenes):
            scene_frames = len(scene.image_group) if scene.image_group else (1 if scene.start_frame else 0)
            frames_remaining = total_frames - frames_done
            print(
                f"  Szene {i+1}/{len(storyboard.scenes)}: {scene.scene_id} [{lang}]"
                f" – {scene_frames} Frame(s), noch {frames_remaining} Frame(s) übrig gesamt",
                flush=True,
            )
            clip = build_scene_clip(scene, frames_dir, lang, tmp_dir, i, tts_slow=tts_slow)
            clips.append(clip)
            frames_done += scene_frames

        if not clips:
            raise ValueError("Keine Szenen zum Rendern gefunden.")

        final = concatenate_videoclips(clips, method="chain")
        output_path.parent.mkdir(parents=True, exist_ok=True)

        total_video_frames = int(final.duration * fps)
        print(f"  Schreibe Video: {output_path} (FPS={fps}, CRF={q['crf']}, Preset={q['preset']}, Frames={total_video_frames})", flush=True)
        print(f"  Kodiere Video ({fps} fps, CRF={q['crf']}, Preset={q['preset']})...", flush=True)
        _logger = _StdoutLogger(lang) if _HAS_PROGLOG else None
        final.write_videofile(
            str(output_path),
            fps=fps,
            codec="libx264",
            audio_codec="aac",
            ffmpeg_params=["-crf", str(q["crf"]), "-preset", q["preset"], "-threads", "0"],
            logger=_logger,
        )
        print(f"  [{lang}] Videoencoding abgeschlossen ({total_video_frames} Frames).", flush=True)
        # Alle Clips explizit schliessen damit Windows die Datei-Handles freigibt
        for clip in clips:
            try:
                clip.close()
            except Exception:
                pass
        try:
            final.close()
        except Exception:
            pass
        print(f"  => Gespeichert: {output_path}", flush=True)


# ── CLI ────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Clip2Guide Tutorial-Renderer")
    parser.add_argument("--storyboard", required=True, help="Pfad zu storyboard.json")
    parser.add_argument("--languages", default="de", help="Komma-getrennte Sprachcodes, z.B. de,en")
    parser.add_argument("--output-dir", default=None, help="Ausgabe-Verzeichnis")
    parser.add_argument("--frames-dir", default=None, help="Verzeichnis mit Frame-JPGs")
    parser.add_argument("--fps", type=int, default=25, help="Frames pro Sekunde (Standard: 25)")
    parser.add_argument("--quality", default="ausgewogen",
                        choices=["schnell", "ausgewogen", "beste"],
                        help="Render-Qualitaet: schnell / ausgewogen / beste")
    parser.add_argument("--tts-slow", action="store_true", help="TTS langsam sprechen")
    args = parser.parse_args()

    storyboard_path = Path(args.storyboard)
    if not storyboard_path.exists():
        print(f"Fehler: Storyboard nicht gefunden: {storyboard_path}", file=sys.stderr)
        sys.exit(1)

    storyboard = StoryboardJson.model_validate(json.loads(storyboard_path.read_text(encoding="utf-8")))

    languages: List[str] = [l.strip() for l in args.languages.split(",") if l.strip()]

    frames_dir = Path(args.frames_dir) if args.frames_dir else settings.frames_dir / storyboard.video_id
    output_dir = Path(args.output_dir) if args.output_dir else settings.render_output_dir / storyboard.video_id

    # Gesamt-Frames vorberechnen fuer Headline
    total_frames = sum(
        len(s.image_group) if s.image_group else (1 if s.start_frame else 0)
        for s in storyboard.scenes
    )

    print(f"Storyboard  : {storyboard_path}", flush=True)
    print(f"Frames-Dir  : {frames_dir}", flush=True)
    print(f"Output-Dir  : {output_dir}", flush=True)
    print(f"Sprachen    : {', '.join(languages)}", flush=True)
    print(f"Szenen      : {len(storyboard.scenes)}", flush=True)
    print(f"Frames ges. : {total_frames}", flush=True)
    print(f"FPS         : {args.fps}", flush=True)
    print(f"Qualitaet   : {args.quality}", flush=True)
    print(f"TTS langsam : {args.tts_slow}", flush=True)
    print(flush=True)

    for lang in languages:
        print(f"=== Rendern: [{lang}] ===", flush=True)
        out_file = output_dir / f"tutorial_{lang}.mp4"
        render_language(storyboard, frames_dir, out_file, lang,
                        fps=args.fps, quality=args.quality, tts_slow=args.tts_slow)

    print("\nFertig.", flush=True)


if __name__ == "__main__":
    main()
