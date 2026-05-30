import React, { useEffect, useRef, useState } from "react";

interface BlurRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  imageSrc: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

/** Normalisiert ein Rechteck mit moeglicherweise negativer Breite/Hoehe. */
function normalizeRect(r: BlurRegion): { ax: number; ay: number; aw: number; ah: number } {
  return {
    ax: r.w < 0 ? r.x + r.w : r.x,
    ay: r.h < 0 ? r.y + r.h : r.y,
    aw: Math.abs(r.w),
    ah: Math.abs(r.h),
  };
}

export default function FrameEditor({ imageSrc, onSave, onClose }: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef<number>(1);
  const startPosRef = useRef({ x: 0, y: 0 });

  const [regions, setRegions] = useState<BlurRegion[]>([]);
  const [blurAmount, setBlurAmount] = useState(14);
  const [drawing, setDrawing] = useState(false);
  const [liveRect, setLiveRect] = useState<BlurRegion | null>(null);
  const [loaded, setLoaded] = useState(false);

  const CANVAS_MAX_W = 780;

  // Bild laden und Canvas initialisieren
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      const scale = Math.min(1, CANVAS_MAX_W / img.naturalWidth);
      scaleRef.current = scale;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
      }
      setLoaded(true);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // Canvas neu zeichnen bei jeder Aenderung
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !loaded) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = scaleRef.current;
    const cw = canvas.width;
    const ch = canvas.height;

    // 1. Basisbild
    ctx.filter = "none";
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);

    // 2. Blur-Bereiche anwenden
    for (const r of regions) {
      const { ax, ay, aw, ah } = normalizeRect(r);
      ctx.save();
      ctx.beginPath();
      ctx.rect(ax * scale, ay * scale, aw * scale, ah * scale);
      ctx.clip();
      ctx.filter = `blur(${blurAmount}px)`;
      ctx.drawImage(img, 0, 0, cw, ch);
      ctx.restore();
      // Roter Rahmen
      ctx.filter = "none";
      ctx.strokeStyle = "rgba(239,83,80,0.85)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ax * scale, ay * scale, aw * scale, ah * scale);
    }

    // 3. Aktives Zeichenrechteck
    ctx.filter = "none";
    if (liveRect) {
      const { ax, ay, aw, ah } = normalizeRect(liveRect);
      ctx.strokeStyle = "#4fc3f7";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(ax * scale, ay * scale, aw * scale, ah * scale);
      ctx.setLineDash([]);
    }
  }, [regions, liveRect, blurAmount, loaded]);

  function getCanvasPos(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    // CSS-Skalierung des Canvas beruecksichtigen
    const csW = rect.width;
    const csH = rect.height;
    const scale = scaleRef.current;
    return {
      x: ((e.clientX - rect.left) / csW * canvas.width) / scale,
      y: ((e.clientY - rect.top) / csH * canvas.height) / scale,
    };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const pos = getCanvasPos(e);
    startPosRef.current = pos;
    setDrawing(true);
    setLiveRect({ x: pos.x, y: pos.y, w: 0, h: 0 });
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const pos = getCanvasPos(e);
    setLiveRect({
      x: startPosRef.current.x,
      y: startPosRef.current.y,
      w: pos.x - startPosRef.current.x,
      h: pos.y - startPosRef.current.y,
    });
  }

  function onMouseUp() {
    if (!drawing || !liveRect) return;
    setDrawing(false);
    if (Math.abs(liveRect.w) > 5 && Math.abs(liveRect.h) > 5) {
      setRegions((prev) => [...prev, { ...liveRect }]);
    }
    setLiveRect(null);
  }

  function handleSave() {
    const img = imgRef.current;
    if (!img) return;
    // In voller natuerlicher Aufloesung rendern
    const offscreen = document.createElement("canvas");
    offscreen.width = img.naturalWidth;
    offscreen.height = img.naturalHeight;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    for (const r of regions) {
      const { ax, ay, aw, ah } = normalizeRect(r);
      ctx.save();
      ctx.beginPath();
      ctx.rect(ax, ay, aw, ah);
      ctx.clip();
      ctx.filter = `blur(${blurAmount}px)`;
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
    ctx.filter = "none";
    onSave(offscreen.toDataURL("image/png"));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Frame bearbeiten"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.88)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#12122a",
          borderRadius: 12,
          border: "1px solid #2a2a5a",
          padding: 20,
          width: "100%",
          maxWidth: 860,
          maxHeight: "90vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 12 }}>
          <h3 style={{ margin: 0, color: "#4fc3f7", fontSize: 16 }}>Frame bearbeiten</h3>
          <span style={{ color: "#556677", fontSize: 12 }}>
            Ziehe Rechtecke über Bereiche die unscharf gemacht werden sollen
          </span>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}
            aria-label="Schliessen"
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <label style={{ color: "#aaa", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
            Unschärfe
            <input
              type="range"
              min={2}
              max={40}
              step={1}
              value={blurAmount}
              onChange={(e) => setBlurAmount(Number(e.target.value))}
              aria-label="Unschärfe-Stärke in Pixel"
              aria-valuetext={`${blurAmount}px`}
              style={{ width: 120, accentColor: "#4fc3f7" }}
            />
            <code style={{ color: "#4fc3f7", minWidth: 38, fontFamily: "monospace" }}>{blurAmount}px</code>
          </label>
          {regions.length > 0 && (
            <button
              className="btn btn-ghost"
              onClick={() => setRegions([])}
              style={{ fontSize: 12, color: "#ef9090", padding: "4px 10px" }}
            >
              Alle Bereiche entfernen
            </button>
          )}
        </div>

        {!loaded && (
          <p style={{ color: "#667", fontSize: 13, textAlign: "center", padding: 40 }}>Bild wird geladen…</p>
        )}

        {/* Zeichen-Canvas */}
        <canvas
          ref={canvasRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          style={{
            cursor: "crosshair",
            maxWidth: "100%",
            borderRadius: 6,
            border: "1px solid #2a2a5a",
            display: loaded ? "block" : "none",
            userSelect: "none",
          }}
        />

        {/* Bereichs-Liste */}
        {regions.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {regions.map((r, i) => {
              const { aw, ah } = normalizeRect(r);
              return (
                <button
                  key={i}
                  onClick={() => setRegions((prev) => prev.filter((_, j) => j !== i))}
                  title="Klicken zum Entfernen"
                  style={{
                    background: "#1e1e3a",
                    border: "1px solid #ef5350",
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 11,
                    color: "#ef9090",
                    cursor: "pointer",
                  }}
                >
                  Bereich {i + 1} · {Math.round(aw)}×{Math.round(ah)}px ✕
                </button>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={regions.length === 0}
            title={regions.length === 0 ? "Zeichne zuerst einen Bereich" : ""}
          >
            Blur anwenden & Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
