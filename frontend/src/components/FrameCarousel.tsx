import React, { useEffect, useRef, useState } from "react";
import { api, FrameInfo } from "../api/backendClient";

interface Props {
  videoId: string;
  frames: FrameInfo[];
  onAddToCustom?: (frame: FrameInfo) => void;
  customFrameFilenames?: Set<string>;
  initialIndex?: number;
  onIndexChange?: (index: number, frame: FrameInfo) => void;
}

export default function FrameCarousel({ videoId, frames, onAddToCustom, customFrameFilenames, initialIndex, onIndexChange }: Props): React.ReactElement {
  const [idx, setIdx] = useState(initialIndex ?? 0);
  const [hovered, setHovered] = useState(false);
  const onIndexChangeRef = useRef(onIndexChange);

  useEffect(() => {
    onIndexChangeRef.current = onIndexChange;
  }, [onIndexChange]);

  useEffect(() => {
    if (initialIndex !== undefined) setIdx(Math.min(initialIndex, frames.length - 1));
  }, [initialIndex, frames.length]);
  const current = frames[idx];

  useEffect(() => {
    if (current) onIndexChangeRef.current?.(idx, current);
  }, [idx, current]);

  if (!frames.length) return <p style={{ color: "#aaa" }}>Keine Frames vorhanden.</p>;

  const isInCustom = customFrameFilenames?.has(current.filename) ?? false;

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ position: "relative", display: "inline-block" }}>
        <img
          src={current.dataUrl ?? api.frameImageUrl(videoId, current.filename)}
          alt={`Frame ${idx + 1} von ${frames.length}`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{
            maxWidth: "100%",
            maxHeight: 360,
            borderRadius: 6,
            border: "1px solid #444",
            transform: hovered ? "scale(1.07)" : "scale(1)",
            transformOrigin: "center center",
            transition: "transform 0.18s ease",
            cursor: "zoom-in",
            display: "block",
          }}
        />
        <div style={{ position: "absolute", bottom: 8, right: 10, background: "rgba(0,0,0,0.65)", color: "#ccc", fontSize: 11, padding: "2px 8px", borderRadius: 4 }}>
          {current.timestamp_seconds.toFixed(2)}s
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
        <button
          className="btn btn-ghost"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          aria-label="Vorheriger Frame"
        >◀</button>

        <span style={{ color: "#aaa", fontSize: 13 }}>{idx + 1} / {frames.length}</span>

        <button
          className="btn btn-ghost"
          onClick={() => setIdx((i) => Math.min(frames.length - 1, i + 1))}
          disabled={idx === frames.length - 1}
          aria-label="Naechster Frame"
        >▶</button>

        {onAddToCustom && (
          <>
            <span style={{ width: 1, height: 20, background: "#333", display: "inline-block" }} />
            <button
              className="btn btn-ghost"
              onClick={() => onAddToCustom(current)}
              style={{
                fontSize: 12,
                padding: "4px 12px",
                color: isInCustom ? "#4fc3f7" : "#aaa",
                border: `1px solid ${isInCustom ? "#4fc3f7" : "#333"}`,
              }}
            >
              {isInCustom ? "✓ In Auswahl" : "＋ Zur Auswahl"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
