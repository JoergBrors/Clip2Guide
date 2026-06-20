import React, { useState } from "react";
import { api, ImageInfo, NormalizeRequest, FolderGroup } from "../api/backendClient";
import ImageHoverZoom from "./ImageHoverZoom";

type NormalizeMode = "crop" | "fit" | "stretch";

interface Props {
  sessionId: string;
  images: ImageInfo[];
  folderGroups?: FolderGroup[];
  onDone: (sessionId: string, images: ImageInfo[]) => void;
}

export default function ImageAdjust({ sessionId, images, folderGroups, onDone }: Props): React.ReactElement {
  // Häufigste Bildgröße als Vorschlag ermitteln
  function detectCommonSize(): { w: number; h: number } {
    if (!images.length) return { w: 1920, h: 1080 };
    const counts = new Map<string, number>();
    for (const img of images) {
      const key = `${img.width}x${img.height}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let bestKey = `${images[0].width}x${images[0].height}`;
    let bestCount = 0;
    counts.forEach((count, key) => {
      if (count > bestCount) { bestCount = count; bestKey = key; }
    });
    const [w, h] = bestKey.split("x").map(Number);
    return { w, h };
  }

  const common = detectCommonSize();
  const allSameSize = images.every(
    (img) => img.width === images[0].width && img.height === images[0].height,
  );

  const [targetW, setTargetW] = useState(common.w);
  const [targetH, setTargetH] = useState(common.h);
  const [normalizeMode, setNormalizeMode] = useState<NormalizeMode>("crop");
  const [processing, setProcessing] = useState(false);
  const [normalized, setNormalized] = useState<ImageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const isDone = normalized.length > 0;
  const displayImages = isDone ? normalized : images;
  const useNormalized = isDone;

  async function handleNormalize() {
    setError(null);
    setProcessing(true);
    try {
      const req: NormalizeRequest = {
        session_id: sessionId,
        target_width: targetW,
        target_height: targetH,
        mode: normalizeMode,
      };
      const result = await api.normalizeImages(req);
      setNormalized(result.images);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Fehler bei der Normalisierung");
    } finally {
      setProcessing(false);
    }
  }

  const presets = [
    { label: "16:9 HD", w: 1920, h: 1080 },
    { label: "16:9 720p", w: 1280, h: 720 },
    { label: "4:3", w: 1024, h: 768 },
    { label: "1:1", w: 1080, h: 1080 },
  ];

  return (
    <div className="card" style={{ maxWidth: 940, margin: "24px auto" }}>
      <h2 style={{ marginTop: 0, color: "#4fc3f7" }}>Bilder anpassen</h2>

      {/* Status */}
      <p style={{ color: "#aaa", marginBottom: folderGroups ? 8 : 20 }}>
        {images.length} Bild{images.length !== 1 ? "er" : ""} hochgeladen.{" "}
        {allSameSize
          ? `Alle haben bereits die Größe ${images[0].width}×${images[0].height} px.`
          : "Die Bilder haben unterschiedliche Größen – bitte Zielgröße festlegen."}
      </p>
      {folderGroups && (
        <div style={{
          background: "#0d2137",
          border: "1px solid #1e4976",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 12,
          color: "#90caf9",
          marginBottom: 20,
        }}>
          📁 {folderGroups.length} Ordner werden im nächsten Schritt als Scenes vorbelegt:&nbsp;
          {folderGroups.map((g) => g.folderName).join(", ")}
        </div>
      )}

      {/* Einstellungen */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-end",
          marginBottom: 16,
          padding: "16px",
          background: "#0d1117",
          borderRadius: 8,
        }}
      >
        {/* Breite */}
        <div>
          <label style={{ fontSize: 12, color: "#90caf9", display: "block", marginBottom: 4 }}>
            Breite (px)
          </label>
          <input
            type="number"
            min={1}
            max={7680}
            value={targetW}
            onChange={(e) => setTargetW(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ width: 100 }}
          />
        </div>

        <span style={{ color: "#555", paddingBottom: 4, fontSize: 20 }}>×</span>

        {/* Höhe */}
        <div>
          <label style={{ fontSize: 12, color: "#90caf9", display: "block", marginBottom: 4 }}>
            Höhe (px)
          </label>
          <input
            type="number"
            min={1}
            max={4320}
            value={targetH}
            onChange={(e) => setTargetH(Math.max(1, parseInt(e.target.value) || 1))}
            style={{ width: 100 }}
          />
        </div>

        {/* Modus */}
        <div>
          <label style={{ fontSize: 12, color: "#90caf9", display: "block", marginBottom: 4 }}>
            Modus
          </label>
          <select
            value={normalizeMode}
            onChange={(e) => setNormalizeMode(e.target.value as NormalizeMode)}
            style={{ width: 180 }}
          >
            <option value="crop">Zuschneiden (crop)</option>
            <option value="fit">Einpassen (letterbox)</option>
            <option value="stretch">Strecken</option>
          </select>
        </div>

        {/* Voreinstellungen */}
        <div>
          <label style={{ fontSize: 12, color: "#90caf9", display: "block", marginBottom: 4 }}>
            Voreinstellungen
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: "4px 8px" }}
              onClick={() => { setTargetW(common.w); setTargetH(common.h); }}
              title="Häufigste Bildgröße verwenden"
            >
              Häufigste ({common.w}×{common.h})
            </button>
            {presets.map((p) => (
              <button
                key={p.label}
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: "4px 8px" }}
                onClick={() => { setTargetW(p.w); setTargetH(p.h); }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Modus-Beschreibung */}
      <p style={{ fontSize: 12, color: "#666", marginBottom: 20, marginTop: 0 }}>
        {normalizeMode === "crop" &&
          "Bild wird skaliert, sodass es die Zielgröße abdeckt, und dann mittig zugeschnitten – kein schwarzer Rand."}
        {normalizeMode === "fit" &&
          "Bild wird vollständig in die Zielgröße eingepasst; Ränder werden schwarz aufgefüllt (Letterbox)."}
        {normalizeMode === "stretch" &&
          "Bild wird auf die Zielgröße gestreckt – das Seitenverhältnis wird nicht bewahrt."}
      </p>

      {/* Aktions-Buttons */}
      {!isDone ? (
        <button
          className="btn btn-primary"
          onClick={handleNormalize}
          disabled={processing}
          style={{ marginBottom: 20 }}
        >
          {processing
            ? `Wird angepasst… (${images.length} Bilder)`
            : `Alle ${images.length} Bilder auf ${targetW}×${targetH} px anpassen`}
        </button>
      ) : (
        <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#66bb6a" }}>
            ✓ {normalized.length} Bilder auf {targetW}×{targetH} px normalisiert
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => { setNormalized([]); setError(null); }}
          >
            Nochmal anpassen
          </button>
          <button
            className="btn btn-success"
            onClick={() => onDone(sessionId, normalized)}
          >
            Weiter →
          </button>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "#ef5350", fontSize: 14, marginBottom: 16 }}>
          Fehler: {error}
        </p>
      )}

      {/* Bild-Raster */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 10,
          maxHeight: 520,
          overflowY: "auto",
        }}
      >
        {displayImages.map((img) => (
          <div key={img.image_id}>
            <div style={{ position: "relative" }}>
              <ImageHoverZoom
                src={api.imageUrl(sessionId, img.image_id, useNormalized)}
                alt={img.filename}
                aspectRatio={`${targetW} / ${targetH}`}
              />
              {useNormalized && (
                <div
                  style={{
                    position: "absolute",
                    top: 5,
                    right: 5,
                    background: "#2e7d32",
                    borderRadius: "50%",
                    width: 22,
                    height: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    color: "#fff",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
                  }}
                >
                  ✓
                </div>
              )}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#666",
                marginTop: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={img.filename}
            >
              {img.filename}
            </div>
            <div style={{ fontSize: 10, color: "#555" }}>
              {img.width}×{img.height}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
