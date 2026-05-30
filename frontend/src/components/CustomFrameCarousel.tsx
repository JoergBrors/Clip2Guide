import React, { useRef, useState } from "react";
import { api, FrameInfo } from "../api/backendClient";
import FrameEditor from "./FrameEditor";

interface Props {
  videoId: string;
  frames: FrameInfo[];
  onFramesChange: (frames: FrameInfo[]) => void;
  onClose: () => void;
}

export default function CustomFrameCarousel({ videoId, frames, onFramesChange, onClose }: Props): React.ReactElement {
  const [idx, setIdx] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [editingFrame, setEditingFrame] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const safeIdx = Math.min(idx, Math.max(0, frames.length - 1));
  const current = frames[safeIdx];

  /** Gibt die Anzeige-URL eines Frames zurück (dataUrl hat Vorrang). */
  function frameSrc(f: FrameInfo): string {
    return f.dataUrl ?? api.frameImageUrl(videoId, f.filename);
  }

  if (!frames.length) {
    return (
      <div style={{ textAlign: "center", padding: 20 }}>
        <p style={{ color: "#aaa" }}>Keine Frames in der Auswahl.</p>
        <button className="btn btn-ghost" onClick={onClose}>Schliessen</button>
      </div>
    );
  }

  function remove(filename: string) {
    const next = frames.filter((f) => f.filename !== filename);
    onFramesChange(next);
    setIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
  }

  function moveLeft() {
    if (safeIdx === 0) return;
    const next = [...frames];
    [next[safeIdx - 1], next[safeIdx]] = [next[safeIdx], next[safeIdx - 1]];
    onFramesChange(next);
    setIdx(safeIdx - 1);
  }

  function moveRight() {
    if (safeIdx >= frames.length - 1) return;
    const next = [...frames];
    [next[safeIdx], next[safeIdx + 1]] = [next[safeIdx + 1], next[safeIdx]];
    onFramesChange(next);
    setIdx(safeIdx + 1);
  }

  // ── Drag & Drop Reorder ────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, i: number) {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (i !== dragIdx) setDragOverIdx(i);
  }

  function onDrop(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) { setDragIdx(null); setDragOverIdx(null); return; }
    const next = [...frames];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    onFramesChange(next);
    setIdx(targetIdx);
    setDragIdx(null);
    setDragOverIdx(null);
  }

  function onDragEnd() {
    setDragIdx(null);
    setDragOverIdx(null);
  }

  // ── File / Clipboard Import ────────────────────────────────────────────────

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const newFrame: FrameInfo = {
        filename: `import-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
        timestamp_seconds: 0,
        scene_index: null,
        dataUrl,
      };
      onFramesChange([...frames, newFrame]);
      setIdx(frames.length);
    };
    reader.onerror = () => setImportError("Datei konnte nicht gelesen werden.");
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleClipboardImport() {
    setImportError(null);
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target!.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const newFrame: FrameInfo = {
            filename: `clipboard-${Date.now()}.png`,
            timestamp_seconds: 0,
            scene_index: null,
            dataUrl,
          };
          onFramesChange([...frames, newFrame]);
          setIdx(frames.length);
          return;
        }
      }
      setImportError("Kein Bild in der Zwischenablage gefunden.");
    } catch {
      setImportError("Zwischenablage-Zugriff verweigert oder kein Bild vorhanden.");
    }
  }

  // ── Frame bearbeiten (Blur-Editor) ─────────────────────────────────────────

  function handleSaveEdit(dataUrl: string) {
    if (editingFrame === null) return;
    const next = [...frames];
    next[editingFrame] = { ...next[editingFrame], dataUrl };
    onFramesChange(next);
    setEditingFrame(null);
  }

  return (
    <div>
      {/* Blur-Editor Modal */}
      {editingFrame !== null && (
        <FrameEditor
          imageSrc={frameSrc(frames[editingFrame])}
          onSave={handleSaveEdit}
          onClose={() => setEditingFrame(null)}
        />
      )}

      {/* Verstecktes File-Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileImport}
        aria-label="Bild aus Datei importieren"
      />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <h3 style={{ margin: 0, color: "#4fc3f7", fontSize: 16 }}>
          Eigenes Carousel
          <span style={{ marginLeft: 8, color: "#666", fontWeight: "normal", fontSize: 13 }}>
            {frames.length} Frame(s)
          </span>
        </h3>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            style={{ fontSize: 11, padding: "4px 10px" }}
            title="Bild aus Datei oder Datei-Explorer hinzufuegen"
          >
            📁 Aus Datei
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => { void handleClipboardImport(); }}
            style={{ fontSize: 11, padding: "4px 10px" }}
            title="Bild aus Zwischenablage einfuegen (Strg+C eines Screenshots)"
          >
            📋 Aus Zwischenablage
          </button>
          <button
            className="btn btn-ghost"
            onClick={onClose}
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            ✕ Schliessen
          </button>
        </div>
      </div>

      {importError && (
        <p role="alert" style={{ color: "#ef9090", fontSize: 12, marginBottom: 8 }}>⚠ {importError}</p>
      )}

      {/* Hauptbild */}
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ position: "relative", display: "inline-block" }}>
          <img
            src={frameSrc(current)}
            alt={`Auswahl Frame ${safeIdx + 1}`}
            style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 6, border: "2px solid #4fc3f7" }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 10,
              background: "rgba(0,0,0,0.65)",
              color: "#ccc",
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            {safeIdx + 1} / {frames.length} · {current.timestamp_seconds.toFixed(2)}s
            {current.dataUrl && <span style={{ color: "#4fc3f7", marginLeft: 6 }}>✏ bearbeitet</span>}
          </div>
        </div>
      </div>

      {/* Steuerelemente */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <button
          className="btn btn-ghost"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={safeIdx === 0}
          aria-label="Vorheriger Frame"
        >
          ◀ Zurück
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => setIdx((i) => Math.min(frames.length - 1, i + 1))}
          disabled={safeIdx >= frames.length - 1}
          aria-label="Nächster Frame"
        >
          Weiter ▶
        </button>

        <span style={{ width: 1, height: 20, background: "#333", display: "inline-block" }} />

        <button
          className="btn btn-ghost"
          onClick={moveLeft}
          disabled={safeIdx === 0}
          title="Eine Position nach vorne verschieben"
          style={{ fontSize: 12 }}
        >
          ← Nach vorne
        </button>
        <button
          className="btn btn-ghost"
          onClick={moveRight}
          disabled={safeIdx >= frames.length - 1}
          title="Eine Position nach hinten verschieben"
          style={{ fontSize: 12 }}
        >
          Nach hinten →
        </button>

        <span style={{ width: 1, height: 20, background: "#333", display: "inline-block" }} />

        <button
          className="btn btn-ghost"
          onClick={() => setEditingFrame(safeIdx)}
          title="Blur-Bereiche zeichnen, sensible Stellen unscharf machen"
          style={{ fontSize: 12, color: "#90caf9" }}
        >
          ✏ Bearbeiten
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => remove(current.filename)}
          style={{ fontSize: 12, color: "#ef5350" }}
        >
          ✕ Entfernen
        </button>
      </div>

      {/* Thumbnail-Streifen mit Drag & Drop */}
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          paddingBottom: 6,
          paddingTop: 2,
        }}
        role="list"
        aria-label="Frame-Reihenfolge – Frames per Drag & Drop neu anordnen"
      >
        {frames.map((f, i) => {
          const isDragging = dragIdx === i;
          const isDragOver = dragOverIdx === i && dragIdx !== i;
          return (
            <div
              key={f.filename}
              role="listitem"
              draggable
              onDragStart={(e) => onDragStart(e, i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={(e) => onDrop(e, i)}
              onDragEnd={onDragEnd}
              onClick={() => setIdx(i)}
              style={{
                position: "relative",
                cursor: "grab",
                flexShrink: 0,
                opacity: isDragging ? 0.35 : 1,
                outline: isDragOver ? "2px solid #4fc3f7" : "none",
                outlineOffset: 2,
                borderRadius: 4,
                transition: "opacity 0.15s",
              }}
              title={`Frame ${i + 1} · ${f.timestamp_seconds.toFixed(2)}s — Ziehen zum Umsortieren`}
            >
              <img
                src={frameSrc(f)}
                alt={`Thumbnail ${i + 1}`}
                draggable={false}
                style={{
                  width: 80,
                  height: 45,
                  objectFit: "cover",
                  borderRadius: 3,
                  border: i === safeIdx ? "2px solid #4fc3f7" : "2px solid #333",
                  opacity: i === safeIdx ? 1 : 0.6,
                  transition: "opacity 0.15s",
                  display: "block",
                  userSelect: "none",
                }}
              />
              {/* Bearbeitet-Indikator */}
              {f.dataUrl && (
                <div
                  style={{
                    position: "absolute",
                    top: 2,
                    left: 2,
                    background: "#4fc3f7",
                    color: "#000",
                    borderRadius: 3,
                    fontSize: 8,
                    padding: "1px 3px",
                    fontWeight: "bold",
                  }}
                >
                  ✏
                </div>
              )}
              <div
                style={{
                  position: "absolute",
                  bottom: 2,
                  right: 2,
                  background: "rgba(0,0,0,0.7)",
                  color: "#ccc",
                  fontSize: 9,
                  padding: "1px 4px",
                  borderRadius: 2,
                }}
              >
                {i + 1}
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ color: "#445566", fontSize: 11, marginTop: 8, marginBottom: 0 }}>
        Tipp: Thumbnails per Drag &amp; Drop in der Leiste umsortieren · ✏ = Frame wurde bearbeitet
      </p>
    </div>
  );
}
