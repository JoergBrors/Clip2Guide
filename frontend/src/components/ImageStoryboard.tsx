import React, { useState } from "react";
import { api, ImageInfo } from "../api/backendClient";
import ImageHoverZoom from "./ImageHoverZoom";

interface SlideTexts {
  heading: string;
  body: string;
  speakerNotes: string;
}

type SlidesData = Record<string, Record<string, SlideTexts>>; // imageId → lang → texts

const DEFAULT_LANGUAGES = ["de", "en"];

interface Props {
  sessionId: string;
  images: ImageInfo[]; // normalized images
  onDone: () => void;
}

function emptySlide(): SlideTexts {
  return { heading: "", body: "", speakerNotes: "" };
}

function initSlides(images: ImageInfo[], langs: string[]): SlidesData {
  const data: SlidesData = {};
  for (const img of images) {
    data[img.image_id] = {};
    for (const l of langs) {
      data[img.image_id][l] = emptySlide();
    }
  }
  return data;
}

export default function ImageStoryboard({ sessionId, images, onDone }: Props): React.ReactElement {
  const [languages, setLanguages] = useState<string[]>(DEFAULT_LANGUAGES);
  const [newLang, setNewLang] = useState("");
  const [activeLang, setActiveLang] = useState(DEFAULT_LANGUAGES[0]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [slides, setSlides] = useState<SlidesData>(() => initSlides(images, DEFAULT_LANGUAGES));

  const activeImg = images[activeIdx];

  function updateSlide(field: keyof SlideTexts, value: string) {
    setSlides((prev) => ({
      ...prev,
      [activeImg.image_id]: {
        ...prev[activeImg.image_id],
        [activeLang]: {
          ...prev[activeImg.image_id]?.[activeLang],
          [field]: value,
        },
      },
    }));
  }

  function addLanguage() {
    const l = newLang.trim().toLowerCase();
    if (!l || languages.includes(l)) return;
    setLanguages((prev) => [...prev, l]);
    setActiveLang(l);
    setNewLang("");
    // Leere Slides für neue Sprache anlegen
    setSlides((prev) => {
      const next = { ...prev };
      for (const img of images) {
        next[img.image_id] = { ...next[img.image_id], [l]: emptySlide() };
      }
      return next;
    });
  }

  const currentSlide = slides[activeImg?.image_id]?.[activeLang] ?? emptySlide();
  const filledCount = images.filter((img) => {
    const s = slides[img.image_id]?.[activeLang];
    return s?.heading.trim() || s?.body.trim();
  }).length;

  return (
    <div style={{ maxWidth: 1100, margin: "24px auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, color: "#4fc3f7" }}>Storyboard</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#666" }}>
            {filledCount}/{images.length} beschriftet
          </span>
          <button className="btn btn-success" onClick={onDone}>
            Weiter →
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16 }}>
        {/* ── Thumbnail-Leiste links ── */}
        <div
          style={{
            width: 148,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            maxHeight: "calc(100vh - 180px)",
            overflowY: "auto",
          }}
        >
          {images.map((img, idx) => {
            const s = slides[img.image_id]?.[activeLang];
            const filled = s?.heading.trim() || s?.body.trim();
            return (
              <button
                key={img.image_id}
                onClick={() => setActiveIdx(idx)}
                style={{
                  padding: 0,
                  border: `2px solid ${activeIdx === idx ? "#4fc3f7" : "transparent"}`,
                  borderRadius: 8,
                  background: "transparent",
                  cursor: "pointer",
                  position: "relative",
                }}
                title={img.filename}
              >
                <img
                  src={api.imageUrl(sessionId, img.image_id, true)}
                  alt={img.filename}
                  style={{
                    width: "100%",
                    aspectRatio: "16/9",
                    objectFit: "cover",
                    borderRadius: 6,
                    display: "block",
                    background: "#111",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    bottom: 2,
                    left: 2,
                    background: "rgba(0,0,0,0.65)",
                    borderRadius: 3,
                    fontSize: 9,
                    color: "#aaa",
                    padding: "1px 4px",
                  }}
                >
                  {idx + 1}
                </div>
                {filled && (
                  <div
                    style={{
                      position: "absolute",
                      top: 2,
                      right: 2,
                      background: "#2e7d32",
                      borderRadius: "50%",
                      width: 14,
                      height: 14,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 9,
                      color: "#fff",
                    }}
                  >
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Haupt-Editor ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Sprach-Tabs */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {languages.map((l) => (
              <button
                key={l}
                className={`btn ${activeLang === l ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: 12, padding: "4px 12px" }}
                onClick={() => setActiveLang(l)}
              >
                {l.toUpperCase()}
              </button>
            ))}
            <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
              <input
                value={newLang}
                onChange={(e) => setNewLang(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLanguage()}
                placeholder="z.B. fr"
                style={{ width: 60, fontSize: 12, padding: "3px 6px" }}
              />
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 8px" }} onClick={addLanguage}>
                + Sprache
              </button>
            </div>
          </div>

          {/* Bild-Vorschau + Formular */}
          {activeImg && (
            <div style={{ display: "flex", gap: 16 }}>
              {/* Vorschau */}
              <div style={{ width: 380, flexShrink: 0 }}>
                <ImageHoverZoom
                  src={api.imageUrl(sessionId, activeImg.image_id, true)}
                  alt={activeImg.filename}
                  aspectRatio="16/9"
                />
                <div style={{ fontSize: 11, color: "#555", marginTop: 4, textAlign: "center" }}>
                  {activeIdx + 1} / {images.length} – {activeImg.filename}
                </div>
                {/* Prev / Next */}
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                  <button
                    className="btn btn-ghost"
                    disabled={activeIdx === 0}
                    onClick={() => setActiveIdx((i) => i - 1)}
                    style={{ padding: "6px 16px" }}
                  >
                    ← Zurück
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={activeIdx === images.length - 1}
                    onClick={() => setActiveIdx((i) => i + 1)}
                    style={{ padding: "6px 16px" }}
                  >
                    Weiter →
                  </button>
                </div>
              </div>

              {/* Textfelder */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#90caf9", display: "block", marginBottom: 4 }}>
                    Titel ({activeLang.toUpperCase()})
                  </label>
                  <input
                    value={currentSlide.heading}
                    onChange={(e) => updateSlide("heading", e.target.value)}
                    placeholder="Folientitel …"
                    style={{ width: "100%", fontSize: 15, padding: "8px 10px" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#90caf9", display: "block", marginBottom: 4 }}>
                    Beschreibung ({activeLang.toUpperCase()})
                  </label>
                  <textarea
                    value={currentSlide.body}
                    onChange={(e) => updateSlide("body", e.target.value)}
                    placeholder="Erklärender Text zur Folie …"
                    rows={5}
                    style={{ width: "100%", fontSize: 14, padding: "8px 10px", resize: "vertical" }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#90caf9", display: "block", marginBottom: 4 }}>
                    Sprechernotizen ({activeLang.toUpperCase()})
                  </label>
                  <textarea
                    value={currentSlide.speakerNotes}
                    onChange={(e) => updateSlide("speakerNotes", e.target.value)}
                    placeholder="Notizen für den Sprecher …"
                    rows={3}
                    style={{ width: "100%", fontSize: 13, padding: "8px 10px", resize: "vertical" }}
                  />
                </div>

                {/* Schnell-Navigation per Tastatur-Hint */}
                <p style={{ fontSize: 11, color: "#444", margin: 0 }}>
                  Tipp: Navigiere mit den Pfeilen zwischen den Folien.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
