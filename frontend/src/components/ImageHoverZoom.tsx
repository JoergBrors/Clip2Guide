import React, { useRef, useState } from "react";

interface Props {
  src: string;
  alt: string;
  /** CSS aspect-ratio value, e.g. "4/3" or "16 / 9" */
  aspectRatio?: string;
}

/** Thumbnail with hover-zoom: shows an enlarged floating preview on mouse-over. */
export default function ImageHoverZoom({ src, alt, aspectRatio = "4/3" }: Props): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  function handleMouseEnter(e: React.MouseEvent) {
    setHovered(true);
    updatePos(e);
  }

  function handleMouseMove(e: React.MouseEvent) {
    updatePos(e);
  }

  function updatePos(e: React.MouseEvent) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const POPUP_W = 320;
    const POPUP_H = 240;
    const OFFSET = 16;

    let x = e.clientX + OFFSET;
    let y = e.clientY + OFFSET;

    if (x + POPUP_W > vw - 8) x = e.clientX - POPUP_W - OFFSET;
    if (y + POPUP_H > vh - 8) y = e.clientY - POPUP_H - OFFSET;

    setPos({ x, y });
  }

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHovered(false)}
      style={{ position: "relative", cursor: "zoom-in" }}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{
          width: "100%",
          aspectRatio,
          objectFit: "cover",
          borderRadius: 6,
          background: "#111",
          display: "block",
          transition: "opacity 0.15s",
          opacity: hovered ? 0.85 : 1,
        }}
      />

      {/* Floating enlarged preview rendered at document root via fixed positioning */}
      {hovered && (
        <div
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            width: 320,
            zIndex: 9999,
            pointerEvents: "none",
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.8), 0 0 0 1px rgba(79,195,247,0.3)",
            background: "#111",
            animation: "imgZoomIn 0.12s ease",
          }}
        >
          <img
            src={src}
            alt={alt}
            style={{
              width: "100%",
              display: "block",
              objectFit: "contain",
              maxHeight: 300,
            }}
          />
          <div
            style={{
              padding: "6px 10px",
              fontSize: 11,
              color: "#aaa",
              background: "#0d1117",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {alt}
          </div>
        </div>
      )}

      <style>{`
        @keyframes imgZoomIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
