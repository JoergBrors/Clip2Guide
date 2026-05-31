import React, { useEffect, useRef, useState } from "react";

type EditMode = "blur" | "pixelate" | "black";

interface EditRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  type: EditMode;
}

interface Props {
  imageSrc: string;
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

function normalizeRect(r: { x: number; y: number; w: number; h: number }): { ax: number; ay: number; aw: number; ah: number } {
  return {
    ax: r.w < 0 ? r.x + r.w : r.x,
    ay: r.h < 0 ? r.y + r.h : r.y,
    aw: Math.abs(r.w),
    ah: Math.abs(r.h),
  };
}

/** Pixelierungseffekt auf einen Bereich des Canvas anwenden. scale=1 fuer Offscreen-Canvas. */
function applyPixelate(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  ax: number, ay: number, aw: number, ah: number,
  pixelSize: number,
  scale: number,
) {
  if (aw < 1 || ah < 1) return;
  const tiny = document.createElement("canvas");
  tiny.width = Math.max(1, Math.round(aw / pixelSize));
  tiny.height = Math.max(1, Math.round(ah / pixelSize));
  const tCtx = tiny.getContext("2d")!;
  tCtx.drawImage(img, ax, ay, aw, ah, 0, 0, tiny.width, tiny.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tiny.width, tiny.height, ax * scale, ay * scale, aw * scale, ah * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.restore();
}

export default function FrameEditor({ imageSrc, onSave, onClose }: Props): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const scaleRef = useRef<number>(1);
  const startPosRef = useRef({ x: 0, y: 0 });

  const [regions, setRegions] = useState<EditRegion[]>([]);
  const [mode, setMode] = useState<EditMode>("blur");
  const [blurAmount, setBlurAmount] = useState(14);
  const [pixelSize, setPixelSize] = useState(12);
  const [drawing, setDrawing] = useState(false);
  const [liveRect, setLiveRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const CANVAS_MAX_W = 780;

  // Bild laden und Canvas initialisieren
  useEffect(() => {
    const img = new Image();
    // crossOrigin nur für echte URLs setzen – bei data:-URLs verhindert das Attribut onload
    if (!imageSrc.startsWith("data:")) {
      img.crossOrigin = "anonymous";
    }
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

    // 2. Bereiche anwenden
    for (const r of regions) {
      const { ax, ay, aw, ah } = normalizeRect(r);
      if (aw < 1 || ah < 1) continue;
      if (r.type === "blur") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ax * scale, ay * scale, aw * scale, ah * scale);
        ctx.clip();
        ctx.filter = `blur(${blurAmount}px)`;
        ctx.drawImage(img, 0, 0, cw, ch);
        ctx.restore();
        ctx.filter = "none";
        ctx.strokeStyle = "rgba(239,83,80,0.85)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ax * scale, ay * scale, aw * scale, ah * scale);
      } else if (r.type === "pixelate") {
        applyPixelate(ctx, img, ax, ay, aw, ah, pixelSize, scale);
        ctx.filter = "none";
        ctx.strokeStyle = "rgba(255,152,0,0.85)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ax * scale, ay * scale, aw * scale, ah * scale);
      } else if (r.type === "black") {
        ctx.filter = "none";
        ctx.fillStyle = "#000000";
        ctx.fillRect(ax * scale, ay * scale, aw * scale, ah * scale);
        ctx.strokeStyle = "rgba(160,160,160,0.7)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ax * scale, ay * scale, aw * scale, ah * scale);
      }
    }

    // 3. Aktives Zeichenrechteck
    ctx.filter = "none";
    if (liveRect) {
      const { ax, ay, aw, ah } = normalizeRect(liveRect);
      const liveColor = mode === "blur" ? "#4fc3f7" : mode === "pixelate" ? "#ff9800" : "#9e9e9e";
      ctx.strokeStyle = liveColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(ax * scale, ay * scale, aw * scale, ah * scale);
      ctx.setLineDash([]);
    }
  }, [regions, liveRect, blurAmount, pixelSize, loaded, mode]);

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
      setRegions((prev) => [...prev, { ...liveRect, type: mode }]);
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
      if (aw < 1 || ah < 1) continue;
      if (r.type === "blur") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ax, ay, aw, ah);
        ctx.clip();
        ctx.filter = `blur(${blurAmount}px)`;
        ctx.drawImage(img, 0, 0);
        ctx.restore();
        ctx.filter = "none";
      } else if (r.type === "pixelate") {
        applyPixelate(ctx, img, ax, ay, aw, ah, pixelSize, 1);
      } else if (r.type === "black") {
        ctx.filter = "none";
        ctx.fillStyle = "#000000";
        ctx.fillRect(ax, ay, aw, ah);
      }
    }
    ctx.filter = "none";
    onSave(offscreen.toDataURL("image/jpeg", 0.92));
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
            Werkzeug wählen, dann Rechtecke über die zu bearbeitenden Bereiche ziehen
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

        {/* Werkzeug-Auswahl */}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "#778", fontSize: 12 }}>Werkzeug:</span>
          {(["blur", "pixelate", "black"] as EditMode[]).map((m) => {
            const labels: Record<EditMode, string> = { blur: "🌫 Weichzeichnen", pixelate: "▦ Verpixeln", black: "▬ Schwärzen" };
            const colors: Record<EditMode, string> = { blur: "#4fc3f7", pixelate: "#ff9800", black: "#9e9e9e" };
            const active = mode === m;
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  fontSize: 12,
                  padding: "4px 12px",
                  borderRadius: 6,
                  border: `1.5px solid ${active ? colors[m] : "#333"}`,
                  background: active ? `${colors[m]}22` : "transparent",
                  color: active ? colors[m] : "#778",
                  cursor: "pointer",
                  fontWeight: active ? 700 : 400,
                }}
              >
                {labels[m]}
              </button>
            );
          })}
        </div>

        {/* Modus-abhängige Einstellungen */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          {mode === "blur" && (
            <label style={{ color: "#aaa", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              Stärke
              <input
                type="range" min={2} max={40} step={1} value={blurAmount}
                onChange={(e) => setBlurAmount(Number(e.target.value))}
                aria-label="Unschärfe-Stärke in Pixel"
                style={{ width: 110, accentColor: "#4fc3f7" }}
              />
              <code style={{ color: "#4fc3f7", minWidth: 38, fontFamily: "monospace" }}>{blurAmount}px</code>
            </label>
          )}
          {mode === "pixelate" && (
            <label style={{ color: "#aaa", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              Pixelgröße
              <input
                type="range" min={4} max={40} step={2} value={pixelSize}
                onChange={(e) => setPixelSize(Number(e.target.value))}
                aria-label="Pixelgröße"
                style={{ width: 110, accentColor: "#ff9800" }}
              />
              <code style={{ color: "#ff9800", minWidth: 38, fontFamily: "monospace" }}>{pixelSize}px</code>
            </label>
          )}
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
              const borderColors: Record<EditMode, string> = { blur: "#ef5350", pixelate: "#ff9800", black: "#666" };
              const textColors: Record<EditMode, string> = { blur: "#ef9090", pixelate: "#ffcc80", black: "#aaa" };
              const typeLabels: Record<EditMode, string> = { blur: "Blur", pixelate: "Pixel", black: "Schwarz" };
              return (
                <button
                  key={i}
                  onClick={() => setRegions((prev) => prev.filter((_, j) => j !== i))}
                  title="Klicken zum Entfernen"
                  style={{
                    background: "#1e1e3a",
                    border: `1px solid ${borderColors[r.type]}`,
                    borderRadius: 4,
                    padding: "2px 8px",
                    fontSize: 11,
                    color: textColors[r.type],
                    cursor: "pointer",
                  }}
                >
                  {typeLabels[r.type]} {i + 1} · {Math.round(aw)}×{Math.round(ah)}px ✕
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
            Anwenden & Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
