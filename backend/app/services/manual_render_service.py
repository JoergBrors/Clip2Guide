"""
DOCX-Handbuch-Renderer fuer Storyboards.
"""
from __future__ import annotations

import json
import re
from copy import deepcopy
from datetime import date
from pathlib import Path
from typing import Any, Callable

from app.config import settings
from app.models import AiProvider, Scene, StoryboardJson, TextPanel
from app.services.storyboard_service import StoryboardService


class ManualRenderService:
    """Erzeugt bearbeitbare DOCX-Handbuecher aus bestehenden Storyboards."""

    def __init__(self) -> None:
        self._storyboard_svc = StoryboardService()

    def render_manual(
        self,
        video_id: str,
        lang: str,
        optimize: bool = False,
        ai_provider: AiProvider | None = None,
        ai_model: str | None = None,
        debug_callback: Callable[[str, str], None] | None = None,
    ) -> Path:
        storyboard = self._storyboard_svc.load(video_id)
        manual_storyboard = deepcopy(storyboard)
        if optimize:
            manual_storyboard = self._optimize_for_manual(
                storyboard,
                lang,
                ai_provider=ai_provider,
                ai_model=ai_model,
                debug_callback=debug_callback,
            )
            self._save_manual_storyboard(video_id, lang, manual_storyboard)

        output_dir = settings.render_output_dir / video_id
        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / f"manual_{lang}.docx"
        self._write_docx(manual_storyboard, lang, out_path)
        return out_path

    def _get_provider(self, provider: AiProvider | None, model: str | None):
        provider_name = provider.value if provider else settings.ai_provider
        if provider_name == AiProvider.GEMINI.value:
            from app.services.gemini_provider import GeminiProvider
            return GeminiProvider(model=model)
        if provider_name == AiProvider.OPENAI.value:
            from app.services.openai_provider import OpenAiProvider
            return OpenAiProvider(model=model)
        if provider_name == AiProvider.AZURE_OPENAI.value:
            from app.services.azure_openai_provider import AzureOpenAiProvider
            return AzureOpenAiProvider(model=model)
        if provider_name == AiProvider.AZURE_COGNITIVE.value:
            from app.services.azure_cognitive_provider import AzureCognitiveProvider
            return AzureCognitiveProvider(model=model)
        raise ValueError(f"Unbekannter AI-Provider: {provider_name}")

    def _optimize_for_manual(
        self,
        storyboard: StoryboardJson,
        lang: str,
        ai_provider: AiProvider | None,
        ai_model: str | None,
        debug_callback: Callable[[str, str], None] | None = None,
    ) -> StoryboardJson:
        provider = self._get_provider(ai_provider, ai_model)
        prompt = self._build_manual_prompt(storyboard, lang)
        if debug_callback:
            debug_callback("manual-prompt", prompt)
            debug_callback("manual-status", "KI-Anfrage fuer Handbuch-Segmentierung wurde gesendet. Warte auf Antwort.")
        raw = provider.complete_text(prompt)
        if debug_callback:
            debug_callback("manual-response", raw)
        data = self._parse_json(raw)
        optimized = deepcopy(storyboard)
        scenes_raw = data.get("scenes")
        if not isinstance(scenes_raw, list):
            raise ValueError("Handbuch-KI-Antwort enthaelt keine scenes-Liste.")
        if len(scenes_raw) != len(storyboard.scenes):
            raise ValueError("Handbuch-KI-Antwort veraendert die Szenenanzahl.")

        for idx, (source_scene, raw_scene) in enumerate(zip(storyboard.scenes, scenes_raw)):
            if not isinstance(raw_scene, dict):
                raise ValueError(f"Handbuch-KI-Antwort Szene {idx + 1} ist kein Objekt.")
            if raw_scene.get("scene_id") != source_scene.scene_id:
                raise ValueError(f"Handbuch-KI-Antwort veraendert scene_id in Szene {idx + 1}.")
            if raw_scene.get("image_group") != source_scene.image_group:
                raise ValueError(f"Handbuch-KI-Antwort veraendert image_group in Szene {idx + 1}.")
            segments_raw = raw_scene.get("segments")
            if isinstance(segments_raw, list) and len(segments_raw) == len(source_scene.image_group):
                if not all(isinstance(segment, dict) for segment in segments_raw):
                    raise ValueError(f"Handbuch-KI-Antwort Szene {idx + 1} enthaelt ungueltige Segmente.")
                optimized.scenes[idx].slide_panels[lang] = [
                    TextPanel(
                        heading=source_scene.texts.get(lang, TextPanel()).heading,
                        body=str(segment.get("description", segment.get("text", ""))),
                        speaker_notes=str(segment.get("speaker_text", segment.get("text", ""))),
                    )
                    for segment in segments_raw
                ][:len(source_scene.image_group)]
        optimized.metadata = {
            **optimized.metadata,
            "manual_optimization": {
                "language": lang,
                "mode": "structure_only",
                "instruction": (
                    "KI-Antwort wurde nur zur Sprechertext-Segmentierung genutzt. "
                    "Szenenstruktur und Bildreferenzen stammen unveraendert aus dem Storyboard."
                ),
            },
        }
        return optimized

    def _build_manual_prompt(self, storyboard: StoryboardJson, lang: str) -> str:
        scenes_payload: list[dict[str, Any]] = []
        for scene in storyboard.scenes:
            text = scene.texts.get(lang, TextPanel())
            slide_panels = scene.slide_panels.get(lang, []) if scene.slide_panels else []
            scenes_payload.append({
                "scene_id": scene.scene_id,
                "image_group": scene.image_group,
                "text": text.model_dump(),
                "slide_panels": [
                    panel.model_dump() if hasattr(panel, "model_dump") else panel
                    for panel in slide_panels
                ],
            })

        return (
            "Du erhaeltst ein bereits fertiges Storyboard. Die Szenenstruktur ist final.\n"
            "Du darfst keine Szenen erzeugen, loeschen, zusammenfuehren, aufteilen, verschieben "
            "oder Bildreferenzen aendern.\n"
            "Wichtig: Du darfst den Textinhalt NICHT umschreiben, nicht kuerzen, nicht erweitern "
            "und keine neuen Aussagen hinzufuegen. Keine Paraphrasen. Keine Halluzinationen. "
            "Nutze ausschliesslich die vorhandenen Texte und Bildreferenzen.\n"
            "Deine Aufgabe ist nur, den vorhandenen body-Text als Bild-Erklaerung und den "
            "vorhandenen speaker_notes-Text als Textbaustein pro Szene auf die Bilder derselben "
            "Szene aufzuteilen. Kleine Uebergangsanpassungen sind erlaubt, wenn der Inhalt identisch "
            "bleibt. scene_id und image_group muessen exakt identisch zur Eingabe zurueckgegeben werden.\n"
            "Das Ergebnis muss dieselbe Anzahl Szenen enthalten. Alle scene_id- und image_group-Werte "
            "muessen unveraendert bleiben. Gib ausschliesslich valides JSON zurueck.\n\n"
            "Rueckgabeformat:\n"
            '{"scenes":[{"scene_id":"scene_001","image_group":["frame_001.jpg"],'
            '"segments":[{"image":"frame_001.jpg","description":"Teil des vorhandenen body-Texts",'
            '"speaker_text":"Teil des vorhandenen Sprechertexts"}]}]}\n\n'
            f"Sprache: {lang}\n"
            f"Storyboard:\n{json.dumps({'scenes': scenes_payload}, ensure_ascii=False)}"
        )

    def _parse_json(self, raw: str) -> dict[str, Any]:
        cleaned = raw.strip()
        match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", cleaned)
        if match:
            cleaned = match.group(1).strip()
        start = cleaned.find("{")
        end = cleaned.rfind("}") + 1
        if start >= 0 and end > start:
            cleaned = cleaned[start:end]
        data = json.loads(cleaned)
        if not isinstance(data, dict):
            raise ValueError("Handbuch-KI-Antwort ist kein JSON-Objekt.")
        return data

    def _save_manual_storyboard(self, video_id: str, lang: str, storyboard: StoryboardJson) -> Path:
        out_dir = settings.ai_output_dir / video_id
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"manual_storyboard_{lang}.json"
        path.write_text(storyboard.model_dump_json(indent=2), encoding="utf-8")
        return path

    def _write_docx(self, storyboard: StoryboardJson, lang: str, out_path: Path) -> None:
        try:
            from docx import Document
            from docx.enum.section import WD_ORIENT
            from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
            from docx.enum.text import WD_BREAK
            from docx.oxml import OxmlElement
            from docx.oxml.ns import qn
            from docx.shared import Cm, Mm, Pt
        except ImportError as exc:
            raise RuntimeError("python-docx ist nicht installiert. Bitte requirements installieren.") from exc

        def shade_cell(cell, fill: str) -> None:
            tc_pr = cell._tc.get_or_add_tcPr()
            shd = OxmlElement("w:shd")
            shd.set(qn("w:fill"), fill)
            tc_pr.append(shd)

        def set_cell_width(cell, width_cm: float) -> None:
            cell.width = Cm(width_cm)
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.first_child_found_in("w:tcW")
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(int(width_cm * 567)))
            tc_w.set(qn("w:type"), "dxa")

        def add_label(paragraph, label: str) -> None:
            run = paragraph.add_run(label)
            run.bold = True
            run.font.size = Pt(9)

        def split_sentences(text: str) -> list[str]:
            normalized = " ".join(text.split())
            if not normalized:
                return []
            parts = re.split(r"(?<=[.!?])\s+", normalized)
            return [part.strip() for part in parts if part.strip()]

        def distribute_text(parts: list[str], count: int) -> list[str]:
            if count <= 0:
                return []
            if not parts:
                return ["" for _ in range(count)]
            buckets = [[] for _ in range(count)]
            for idx, part in enumerate(parts):
                bucket_idx = min(int(idx * count / max(len(parts), 1)), count - 1)
                buckets[bucket_idx].append(part)
            return [" ".join(bucket).strip() for bucket in buckets]

        def manual_segments(scene: Scene, language: str, image_count: int) -> list[tuple[str, str]]:
            text = scene.texts.get(language, TextPanel())
            slide_panels = scene.slide_panels.get(language, []) if scene.slide_panels else []
            if len(slide_panels) >= image_count:
                panel_segments = [
                    ((panel.body or "").strip(), (panel.speaker_notes or "").strip())
                    for panel in slide_panels[:image_count]
                ]
                if any(body or speaker for body, speaker in panel_segments):
                    return panel_segments
            body_segments = distribute_text(split_sentences(text.body), image_count)
            speaker_segments = distribute_text(split_sentences(text.speaker_notes or text.body), image_count)
            return list(zip(body_segments, speaker_segments))

        doc = Document()
        section = doc.sections[0]
        section.orientation = WD_ORIENT.LANDSCAPE
        section.page_width = Mm(210)
        section.page_height = Mm(148)
        section.top_margin = Cm(1)
        section.bottom_margin = Cm(1)
        section.left_margin = Cm(1)
        section.right_margin = Cm(1)

        styles = doc.styles
        styles["Normal"].font.name = "Calibri"
        styles["Normal"].font.size = Pt(10)

        title = doc.add_heading("Clip2Guide-Handbuch", level=0)
        title.runs[0].font.size = Pt(22)
        meta = doc.add_paragraph()
        meta.add_run("Sprache: ").bold = True
        meta.add_run(lang)
        meta.add_run("\nErstellt am: ").bold = True
        meta.add_run(date.today().isoformat())
        meta.add_run("\nAnzahl Szenen: ").bold = True
        meta.add_run(str(len(storyboard.scenes)))
        meta.add_run("\nClip2Guide-Version: ").bold = True
        meta.add_run("0.1.0")

        frames_dir = settings.frames_dir / storyboard.video_id
        for scene_idx, scene in enumerate(storyboard.scenes, 1):
            if scene_idx > 1:
                doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
            text = scene.texts.get(lang, TextPanel())
            doc.add_heading(f"{scene_idx}. {text.heading or scene.scene_id}", level=1)
            image_group = scene.image_group or ([scene.start_frame] if scene.start_frame else [])
            segments = manual_segments(scene, lang, max(len(image_group), 1))

            for img_idx, filename in enumerate(image_group or [""]):
                table = doc.add_table(rows=1, cols=2)
                table.alignment = WD_TABLE_ALIGNMENT.CENTER
                table.autofit = False
                table.style = "Table Grid"
                row = table.rows[0]
                img_cell = row.cells[0]
                panel_cell = row.cells[1]
                set_cell_width(img_cell, 8.2)
                set_cell_width(panel_cell, 9.8)
                img_cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
                panel_cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
                shade_cell(img_cell, "F3F6FA")
                shade_cell(panel_cell, "FFFFFF")
                img_path = frames_dir / filename
                if filename and img_path.exists():
                    add_label(img_cell.paragraphs[0], f"Abbildung {scene_idx}.{img_idx + 1}")
                    img_cell.paragraphs[0].add_run("\n")
                    run = img_cell.paragraphs[0].add_run()
                    run.add_picture(str(img_path), width=Cm(7.8))
                else:
                    img_cell.text = filename or "(kein Bild)"

                description_text, speaker_text = segments[img_idx] if img_idx < len(segments) else ("", "")
                p = panel_cell.paragraphs[0]
                add_label(p, "Bild-Erklaerung")
                p.add_run("\n")
                if text.heading:
                    p.add_run(text.heading).bold = True
                    p.add_run("\n")
                p.add_run(description_text or text.body)
                p.add_run("\n\n")
                add_label(p, "Textbaustein")
                p.add_run("\n")
                p.add_run(speaker_text or description_text or text.speaker_notes or text.body)
                doc.add_paragraph()

        out_path.parent.mkdir(parents=True, exist_ok=True)
        doc.save(str(out_path))
