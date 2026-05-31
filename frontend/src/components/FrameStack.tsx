import React, { useEffect, useRef, useState } from "react";
import { api, FrameStack as FrameStackData, FrameInfo, subscribeToJob, JobEvent } from "../api/backendClient";
import FrameCarousel from "./FrameCarousel";
import CustomFrameCarousel from "./CustomFrameCarousel";
import FrameEditor from "./FrameEditor";

interface Props {
  videoId: string;
  onDone: (selectedFrames: string[]) => void;
  disableExtract?: boolean;
}

export default function FrameStack({ videoId, onDone, disableExtract = false }: Props): React.ReactElement {
  const [frameStack, setFrameStack] = useState<FrameStackData | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState(0);
  const [extractMsg, setExtractMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedScene, setSelectedScene] = useState<number | null>(null);

  // Eigene Frame-Auswahl
  const [customFrames, setCustomFrames] = useState<FrameInfo[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [showCustomCarousel, setShowCustomCarousel] = useState(false);
  const [expandedScenes, setExpandedScenes] = useState<Set<number>>(new Set());

  // Hover-Zoom Zustand
  const [hoveredThumb, setHoveredThumb] = useState<string | null>(null);
  // Carousel: Startindex pro Szene (gesetzt wenn Thumbnail angeklickt wird)
  const [carouselInitialIndex, setCarouselInitialIndex] = useState<number>(0);

  // Lokale Reihenfolge pro Szene (per Drag & Drop umsortierbar)
  const [localSceneFrames, setLocalSceneFrames] = useState<Map<number, FrameInfo[]>>(new Map());
  // Frame-Editor (Blur / Verpixeln / Schwärzen)
  const [editingFrame, setEditingFrame] = useState<FrameInfo | null>(null);
  const [frameEditError, setFrameEditError] = useState<string | null>(null);
  // Drag-Zustand für das Szenenraster
  const [sceneDragInfo, setSceneDragInfo] = useState<{ sceneIdx: number; frameIdx: number } | null>(null);
  const [sceneDragOver, setSceneDragOver] = useState<{ sceneIdx: number; frameIdx: number } | null>(null);

  // Upload eigener Bilder
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      const updated = await api.uploadCustomFrames(videoId, files);
      setFrameStack(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
      if (e.target) e.target.value = "";
    }
  }

  useEffect(() => {
    api.getFrameStack(videoId).then(setFrameStack).catch(console.error);
  }, [videoId]);

  // Lokale Szenen-Reihenfolge initialisieren / aktualisieren
  useEffect(() => {
    if (!frameStack) return;
    const map = new Map<number, FrameInfo[]>();
    for (const f of frameStack.frames) {
      const s = f.scene_index ?? 0;
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(f);
    }
    setLocalSceneFrames(map);
  }, [frameStack]);

  async function runExtract() {
    setExtracting(true);
    setError(null);
    try {
      const { job_id } = await api.extractFrames(videoId);
      subscribeToJob(job_id, (ev: JobEvent) => {
        setExtractMsg(ev.message);
        setExtractProgress(ev.percent);
        if (ev.type === "completed") {
          setExtracting(false);
          api.getFrameStack(videoId).then(setFrameStack).catch(console.error);
        } else if (ev.type === "error") {
          setExtracting(false);
          setError(ev.message);
        }
      });
    } catch (e: unknown) {
      setExtracting(false);
      setError(e instanceof Error ? e.message : "Fehler bei Frame-Extraktion");
    }
  }

  const customFilenames = new Set(customFrames.map((f) => f.filename));

  function toggleFrame(frame: FrameInfo) {
    setCustomFrames((prev) =>
      prev.some((f) => f.filename === frame.filename)
        ? prev.filter((f) => f.filename !== frame.filename)
        : [...prev, frame]
    );
  }

  function addToCustom(frame: FrameInfo) {
    setCustomFrames((prev) =>
      prev.some((f) => f.filename === frame.filename) ? prev : [...prev, frame]
    );
  }

  function selectAllInScene(frames: FrameInfo[]) {
    setCustomFrames((prev) => {
      const existing = new Set(prev.map((f) => f.filename));
      const toAdd = frames.filter((f) => !existing.has(f.filename));
      return [...prev, ...toAdd];
    });
  }

  function deselectAllInScene(frames: FrameInfo[]) {
    const sceneFilenames = new Set(frames.map((f) => f.filename));
    setCustomFrames((prev) => prev.filter((f) => !sceneFilenames.has(f.filename)));
  }

  function toggleSceneExpand(sceneIdx: number) {
    setExpandedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(sceneIdx)) next.delete(sceneIdx); else next.add(sceneIdx);
      return next;
    });
  }

  // ── Szenenraster Drag & Drop ───────────────────────────────────────────────

  function handleSceneFrameDragStart(e: React.DragEvent, sceneIdx: number, frameIdx: number) {
    setSceneDragInfo({ sceneIdx, frameIdx });
    setHoveredThumb(null);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleSceneFrameDrop(e: React.DragEvent, sceneIdx: number, toIdx: number) {
    e.preventDefault();
    const drag = sceneDragInfo;
    setSceneDragInfo(null);
    setSceneDragOver(null);
    if (!drag || drag.sceneIdx !== sceneIdx || drag.frameIdx === toIdx) return;
    const cur = localSceneFrames.get(sceneIdx) ?? [];
    const next = [...cur];
    const [moved] = next.splice(drag.frameIdx, 1);
    next.splice(toIdx, 0, moved);
    setLocalSceneFrames(new Map(localSceneFrames).set(sceneIdx, next));
  }

  // ── Frame-Editor ──────────────────────────────────────────────────────────

  async function handleFrameEditSave(dataUrl: string) {
    if (!editingFrame) return;
    setFrameEditError(null);
    try {
      await api.updateFrame(videoId, editingFrame.filename, dataUrl);
      const sceneIdx = editingFrame.scene_index ?? 0;
      const sceneFrames = localSceneFrames.get(sceneIdx) ?? [];
      const updatedFrames = sceneFrames.map((f) =>
        f.filename === editingFrame.filename ? { ...f, dataUrl } : f
      );
      setLocalSceneFrames(new Map(localSceneFrames).set(sceneIdx, updatedFrames));
      setCustomFrames((prev) =>
        prev.map((f) => (f.filename === editingFrame.filename ? { ...f, dataUrl } : f))
      );
      setEditingFrame(null);
    } catch (e) {
      setFrameEditError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
      setEditingFrame(null);
    }
  }

  // Frames nach Szene gruppieren
  const scenes: Map<number, FrameInfo[]> = localSceneFrames.size > 0 ? localSceneFrames : (() => {
    const m = new Map<number, FrameInfo[]>();
    if (frameStack) {
      for (const f of frameStack.frames) {
        const s = f.scene_index ?? 0;
        if (!m.has(s)) m.set(s, []);
        m.get(s)!.push(f);
      }
    }
    return m;
  })();

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      {/* Frame-Editor Modal */}
      {editingFrame !== null && (
        <FrameEditor
          key={editingFrame.filename}
          imageSrc={editingFrame.dataUrl ?? api.frameImageUrl(videoId, editingFrame.filename)}
          onSave={(dataUrl) => { void handleFrameEditSave(dataUrl); }}
          onClose={() => setEditingFrame(null)}
        />
      )}
      {frameEditError && (
        <p role="alert" style={{ color: "#ef5350", fontSize: 12, margin: "4px 0" }}>⚠ {frameEditError}</p>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0, color: "#4fc3f7" }}>Frame-Extraktion</h2>

        {!frameStack && !extracting && (
          <>
            <p style={{ color: "#aaa" }}>Noch keine Frames extrahiert.</p>
            {!disableExtract && (
              <button className="btn btn-primary" onClick={runExtract}>Frames extrahieren</button>
            )}
          </>
        )}

        {extracting && (
          <div aria-live="polite">
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${extractProgress}%` }} />
            </div>
            <p style={{ color: "#4fc3f7", fontSize: 13 }}>{extractMsg}</p>
          </div>
        )}

        {error && <p role="alert" style={{ color: "#ef5350" }}>Fehler: {error}</p>}

        {frameStack && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ color: "#90caf9" }}>
                {frameStack.total_frames} Frames in {scenes.size} Szene(n)
              </span>
              {!disableExtract && (
                <button className="btn btn-ghost" onClick={runExtract} disabled={extracting}>
                  Neu extrahieren
                </button>
              )}
              <button
                className={`btn ${selectionMode ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setSelectionMode((v) => !v)}
                style={{ fontSize: 12 }}
                title="Einzelne Frames per Klick auswaehlen und ins eigene Carousel uebernehmen"
              >
                {selectionMode ? "✓ Auswahlmodus aktiv" : "☐ Frames auswaehlen"}
              </button>
              {/* Upload eigener Bilder */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                aria-label="Eigene Bilder als Frames hochladen"
                style={{ display: "none" }}
                onChange={handleImageUpload}
              />
              <button
                className="btn btn-ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={{ fontSize: 12 }}
                title="Eigene Bilder als Frames hochladen"
              >
                {uploading ? "Lädt hoch..." : "📷 Bilder hochladen"}
              </button>
              <button
                className="btn btn-success"
                onClick={() => {
                  const frames = customFrames.length > 0
                    ? customFrames.map((f) => f.filename)
                    : [];
                  onDone(frames);
                }}
                style={{ marginLeft: "auto" }}
              >
                Weiter → Storyboard
              </button>
            </div>

            {/* Eigene Auswahl-Leiste */}
            {customFrames.length > 0 && (
              <div
                style={{
                  marginTop: 14,
                  background: "#0d1f30",
                  border: "1px solid #1a4a6a",
                  borderRadius: 6,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ color: "#4fc3f7", fontSize: 13, flexShrink: 0 }}>
                  🎞 Eigene Auswahl: {customFrames.length} Frame(s)
                </span>
                <div style={{ display: "flex", gap: 4, overflowX: "auto", flex: 1, minWidth: 0 }}>
                  {customFrames.slice(0, 12).map((f, i) => (
                    <img
                      key={f.filename}
                      src={f.dataUrl ?? api.frameImageUrl(videoId, f.filename)}
                      alt={`Auswahl ${i + 1}`}
                      style={{
                        width: 48,
                        height: 27,
                        objectFit: "cover",
                        borderRadius: 3,
                        border: "1px solid #4fc3f7",
                        flexShrink: 0,
                      }}
                    />
                  ))}
                  {customFrames.length > 12 && (
                    <span style={{ color: "#666", fontSize: 11, alignSelf: "center", flexShrink: 0 }}>
                      +{customFrames.length - 12}
                    </span>
                  )}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={() => setShowCustomCarousel((v) => !v)}
                  style={{ fontSize: 12, padding: "4px 12px", flexShrink: 0 }}
                >
                  {showCustomCarousel ? "Carousel schliessen" : "Carousel oeffnen"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setCustomFrames([]); setShowCustomCarousel(false); }}
                  style={{ fontSize: 12, padding: "4px 10px", flexShrink: 0, color: "#ef9090" }}
                >
                  Auswahl leeren
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Eigenes Carousel Panel */}
      {showCustomCarousel && customFrames.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <CustomFrameCarousel
            videoId={videoId}
            frames={customFrames}
            onFramesChange={setCustomFrames}
            onClose={() => setShowCustomCarousel(false)}
          />
        </div>
      )}

      {/* Szenen-Uebersicht */}
      {frameStack && (
        <div>
          {Array.from(scenes.entries()).map(([sceneIdx, frames]) => {
            const isExpanded = expandedScenes.has(sceneIdx);
            const showAll = selectionMode || isExpanded;
            const visibleFrames = showAll ? frames : frames.slice(0, 8);
            const hasMore = !showAll && frames.length > 8;
            const selectedInScene = frames.filter((f) => customFilenames.has(f.filename)).length;

            return (
              <div key={sceneIdx} className="card" style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <h3 style={{ margin: 0, color: "#90caf9", fontSize: 15 }}>Szene {sceneIdx + 1}</h3>
                  <span style={{ color: "#666", fontSize: 12 }}>{frames.length} Frames</span>
                  {selectionMode && (
                    <span style={{ color: selectedInScene > 0 ? "#4fc3f7" : "#556", fontSize: 12 }}>
                      {selectedInScene} / {frames.length} ausgewaehlt
                    </span>
                  )}
                  {selectionMode && (
                    <>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 10, padding: "1px 7px", color: "#4fc3f7" }}
                        onClick={() => selectAllInScene(frames)}
                        title="Alle Frames dieser Szene auswaehlen"
                      >
                        Alle ✓
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 10, padding: "1px 7px", color: "#ef9090" }}
                        onClick={() => deselectAllInScene(frames)}
                        title="Alle Frames dieser Szene abwaehlen"
                      >
                        Keine ✗
                      </button>
                    </>
                  )}
                  {!selectionMode && frames.length > 8 && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: "2px 8px" }}
                      onClick={() => toggleSceneExpand(sceneIdx)}
                    >
                      {isExpanded ? "Weniger" : `Alle ${frames.length} anzeigen`}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost"
                    style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}
                    onClick={() => setSelectedScene(selectedScene === sceneIdx ? null : sceneIdx)}
                  >
                    {selectedScene === sceneIdx ? "Schliessen" : "Carousel"}
                  </button>
                </div>

                {/* Thumbnail-Raster */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, overflow: "visible" }}>
                  {visibleFrames.map((f, visIdx) => {
                    const actualIdx = frames.indexOf(f);
                    const isDragging = sceneDragInfo?.sceneIdx === sceneIdx && sceneDragInfo?.frameIdx === actualIdx;
                    const isDragOver = sceneDragOver?.sceneIdx === sceneIdx && sceneDragOver?.frameIdx === actualIdx && sceneDragInfo?.frameIdx !== actualIdx;
                    const isSelected = customFilenames.has(f.filename);
                    const isHovered = hoveredThumb === f.filename && !sceneDragInfo;
                    const frameSrc = f.dataUrl ?? api.frameImageUrl(videoId, f.filename);
                    return (
                      <div
                        key={f.filename}
                        draggable
                        style={{
                          position: "relative",
                          cursor: selectionMode ? "pointer" : sceneDragInfo?.sceneIdx === sceneIdx ? "grabbing" : "pointer",
                          borderRadius: 4,
                          outline: isDragOver ? "2px solid #4fc3f7" : isSelected ? "2px solid #4fc3f7" : "none",
                          outlineOffset: isDragOver ? 3 : 1,
                          zIndex: isHovered ? 20 : 1,
                          opacity: isDragging ? 0.35 : 1,
                          transition: "opacity 0.15s",
                        }}
                        onClick={() => {
                          if (selectionMode) {
                            toggleFrame(f);
                          } else {
                            // Carousel oeffnen und zum angeklickten Frame springen
                            setSelectedScene(sceneIdx);
                            setCarouselInitialIndex(actualIdx);
                          }
                        }}
                        onDragStart={(e) => handleSceneFrameDragStart(e, sceneIdx, actualIdx)}
                        onDragOver={(e) => { e.preventDefault(); setSceneDragOver({ sceneIdx, frameIdx: actualIdx }); }}
                        onDrop={(e) => handleSceneFrameDrop(e, sceneIdx, actualIdx)}
                        onDragEnd={() => { setSceneDragInfo(null); setSceneDragOver(null); }}
                        onMouseEnter={() => { if (!sceneDragInfo) setHoveredThumb(f.filename); }}
                        onMouseLeave={() => setHoveredThumb(null)}
                        title={selectionMode ? (isSelected ? "Aus Auswahl entfernen" : "Zur Auswahl hinzufügen") : "Ziehen zum Umsortieren"}
                      >
                        <img
                          src={frameSrc}
                          alt={`Frame ${visIdx + 1}`}
                          draggable={false}
                          style={{
                            width: 110,
                            height: 62,
                            objectFit: "cover",
                            borderRadius: 4,
                            border: "1px solid #333",
                            display: "block",
                            opacity: selectionMode && !isSelected ? 0.5 : 1,
                            transition: "opacity 0.15s",
                          }}
                          loading="lazy"
                        />

                        {/* Bearbeiten-Button (immer sichtbar, unten links) */}
                        <div
                          onClick={(e) => { e.stopPropagation(); setEditingFrame(f); }}
                          title="Frame bearbeiten (Blur / Verpixeln / Schwärzen)"
                          style={{
                            position: "absolute",
                            bottom: 2,
                            left: 2,
                            background: "rgba(0,0,0,0.72)",
                            color: f.dataUrl ? "#4fc3f7" : "#90caf9",
                            borderRadius: 3,
                            fontSize: 9,
                            padding: "1px 4px",
                            cursor: "pointer",
                            userSelect: "none",
                          }}
                        >
                          ✏
                        </div>

                        {/* Hover-Zoom Popup */}
                        {isHovered && (
                          <div
                            style={{
                              position: "absolute",
                              bottom: "calc(100% + 8px)",
                              left: "50%",
                              transform: "translateX(-50%)",
                              zIndex: 50,
                              pointerEvents: "none",
                              border: "2px solid #4fc3f7",
                              borderRadius: 6,
                              background: "#0a0a18",
                              boxShadow: "0 6px 24px rgba(0,0,0,0.8)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <img
                              src={frameSrc}
                              alt="Vorschau"
                              style={{
                                width: 280,
                                height: 158,
                                objectFit: "cover",
                                borderRadius: 4,
                                display: "block",
                              }}
                            />
                            <div
                              style={{
                                textAlign: "center",
                                color: "#7090b0",
                                fontSize: 10,
                                padding: "3px 0 5px",
                                fontFamily: "monospace",
                              }}
                            >
                              {f.timestamp_seconds.toFixed(2)}s
                            </div>
                          </div>
                        )}

                        {selectionMode && isSelected && (
                          <div
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 4,
                              background: "#4fc3f7",
                              color: "#000",
                              borderRadius: "50%",
                              width: 18,
                              height: 18,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              fontWeight: "bold",
                            }}
                          >
                            ✓
                          </div>
                        )}
                        {selectionMode && !isSelected && (
                          <div
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 4,
                              background: "rgba(0,0,0,0.45)",
                              border: "1px solid #555",
                              borderRadius: "50%",
                              width: 18,
                              height: 18,
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                  {hasMore && (
                    <div
                      style={{
                        width: 110,
                        height: 62,
                        background: "#2a2a4a",
                        borderRadius: 4,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#aaa",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                      onClick={() => toggleSceneExpand(sceneIdx)}
                    >
                      +{frames.length - 8}
                    </div>
                  )}
                </div>

                {selectedScene === sceneIdx && (
                  <div style={{ marginTop: 12 }}>
                    <FrameCarousel
                      videoId={videoId}
                      frames={frames}
                      onAddToCustom={addToCustom}
                      customFrameFilenames={customFilenames}
                      initialIndex={carouselInitialIndex}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
