import React, { useEffect, useRef, useState } from "react";
import {
  api,
  FrameStack as FrameStackData,
  FrameInfo,
  FolderGroup,
  subscribeToJob,
  JobEvent,
  StoryboardDraftHints,
} from "../api/backendClient";
import FrameCarousel from "./FrameCarousel";
import CustomFrameCarousel from "./CustomFrameCarousel";
import FrameEditor from "./FrameEditor";

interface Props {
  videoId: string;
  onDone: (selectedFrames: string[], sceneGroups: string[][], draftHints: StoryboardDraftHints) => void;
  disableExtract?: boolean;
  initialFolderGroups?: FolderGroup[];
}

export default function FrameStack({ videoId, onDone, disableExtract = false, initialFolderGroups }: Props): React.ReactElement {
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
  const [carouselActiveFrame, setCarouselActiveFrame] = useState<Record<number, string>>({});

  // Lokale Reihenfolge pro Szene (per Drag & Drop umsortierbar)
  const [localSceneFrames, setLocalSceneFrames] = useState<Map<number, FrameInfo[]>>(new Map());
      // Frame-Editor (Rotation, Zielformat, Blur / Verpixeln / Schwärzen)
  const [editingFrame, setEditingFrame] = useState<FrameInfo | null>(null);
  const [frameEditError, setFrameEditError] = useState<string | null>(null);
  // Drag-Zustand für das Szenenraster
  const [sceneDragInfo, setSceneDragInfo] = useState<{ sceneIdx: number; frameIdx: number } | null>(null);
  const [paletteDragFilename, setPaletteDragFilename] = useState<string | null>(null);
  const [sceneDragOver, setSceneDragOver] = useState<{ sceneIdx: number; frameIdx: number } | null>(null);
  // Cross-Szenen-Drag (welche Szenen-Karte ist Ziel)
  const [sceneCrossDragOver, setSceneCrossDragOver] = useState<number | null>(null);
  // Drag-Zustand fuer Szenen-Karten im Entwurf
  const [draftSceneDragKey, setDraftSceneDragKey] = useState<number | null>(null);
  const [sceneDescriptions, setSceneDescriptions] = useState<Record<number, string>>({});
  const [imagePrompts, setImagePrompts] = useState<Record<string, string>>({});

  // Upload eigener Bilder
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const skipNextFrameStackSyncRef = useRef(false);

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
    if (skipNextFrameStackSyncRef.current) {
      skipNextFrameStackSyncRef.current = false;
      return;
    }

    // Ordner-Gruppen: Frames in Upload-Reihenfolge auf Ordner aufteilen.
    // imagesToFrames kopiert Bilder als frame_001.jpg, frame_002.jpg, … in Upload-Reihenfolge.
    // FolderGroup.imageIds ist ebenfalls in Upload-Reihenfolge → globaler Index = Position in flat list.
    if (initialFolderGroups && initialFolderGroups.length > 0) {
      const sortedFrames = [...frameStack.frames].sort((a, b) => a.timestamp_seconds - b.timestamp_seconds);
      // Globale Reihenfolge aller imageIds aufbauen (entspricht Frame-Index)
      const allImageIds = initialFolderGroups.flatMap((g) => g.imageIds);
      const map = new Map<number, FrameInfo[]>();
      const descriptions: Record<number, string> = {};
      initialFolderGroups.forEach((group, sceneIdx) => {
        map.set(sceneIdx, []);
        descriptions[sceneIdx] = group.folderName;
      });
      sortedFrames.forEach((frame, frameIdx) => {
        const imageId = allImageIds[frameIdx];
        if (!imageId) {
          // Überzählige Frames landen in der letzten Szene
          const lastIdx = initialFolderGroups.length - 1;
          map.get(lastIdx)!.push(frame);
          return;
        }
        const groupIdx = initialFolderGroups.findIndex((g) => g.imageIds.includes(imageId));
        if (groupIdx < 0) return;
        map.get(groupIdx)!.push(frame);
      });
      setLocalSceneFrames(map);
      setSceneDescriptions(descriptions);
      return;
    }

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

  function addFramesToCustom(frames: FrameInfo[]) {
    if (!frames.length) return;
    setCustomFrames((prev) => {
      const existing = new Set(prev.map((f) => f.filename));
      return [...prev, ...frames.filter((f) => !existing.has(f.filename))];
    });
  }

  // ── Szenen-Gruppen-Operationen ─────────────────────────────────────────────

  function applySceneEntries(entries: Array<[number, FrameInfo[]]>, descriptions = sceneDescriptions) {
    setLocalSceneFrames(new Map(entries.map(([, frames], i) => [i, frames] as [number, FrameInfo[]])));
    setSceneDescriptions(Object.fromEntries(
      entries.map(([oldKey], i) => [i, oldKey >= 0 ? descriptions[oldKey] ?? "" : ""])
    ));
  }

  function moveFrameBetweenScenes(fromKey: number, toKey: number, filename: string) {
    const fromFrames = localSceneFrames.get(fromKey) ?? [];
    const toFrames = localSceneFrames.get(toKey) ?? [];
    const frame = fromFrames.find((f) => f.filename === filename);
    if (!frame) return;
    const newFrom = fromFrames.filter((f) => f.filename !== filename);
    const newTo = [...toFrames, frame];
    const allEntries = Array.from(localSceneFrames.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([key, frames]) => {
        if (key === fromKey) return [key, newFrom] as [number, FrameInfo[]];
        if (key === toKey) return [key, newTo] as [number, FrameInfo[]];
        return [key, frames] as [number, FrameInfo[]];
      })
    applySceneEntries(allEntries);
  }

  function insertPaletteFrameIntoScene(toKey: number, filename: string, toIdx?: number) {
    const frame = customFrames.find((f) => f.filename === filename)
      ?? frameStack?.frames.find((f) => f.filename === filename);
    if (!frame) return;
    const allEntries = Array.from(localSceneFrames.entries()).sort((a, b) => a[0] - b[0]);
    const nextEntries = (allEntries.length > 0 ? allEntries : [[0, []] as [number, FrameInfo[]]])
      .map(([key, frames]) => [key, frames.filter((f) => f.filename !== filename)] as [number, FrameInfo[]]);
    const targetIdx = nextEntries.findIndex(([key]) => key === toKey);
    if (targetIdx < 0) return;
    const [key, frames] = nextEntries[targetIdx];
    const nextFrames = [...frames];
    const insertAt = toIdx === undefined ? nextFrames.length : Math.max(0, Math.min(toIdx, nextFrames.length));
    nextFrames.splice(insertAt, 0, frame);
    nextEntries[targetIdx] = [key, nextFrames];
    applySceneEntries(nextEntries);
  }

  function reorderFrame(sceneKey: number, fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const cur = localSceneFrames.get(sceneKey) ?? [];
    const next = [...cur];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    setLocalSceneFrames(new Map(localSceneFrames).set(sceneKey, next));
  }

  function splitSceneAt(sceneKey: number, frameIdx: number) {
    const allEntries = Array.from(localSceneFrames.entries()).sort((a, b) => a[0] - b[0]);
    const newEntries: [number, FrameInfo[]][] = [];
    for (const [key, frames] of allEntries) {
      if (key === sceneKey && frameIdx > 0 && frameIdx < frames.length) {
        newEntries.push([key, frames.slice(0, frameIdx)]);
        newEntries.push([-1, frames.slice(frameIdx)]);
      } else {
        newEntries.push([key, frames]);
      }
    }
    applySceneEntries(newEntries);
  }

  function addSceneAfter(sceneKey?: number) {
    const allEntries = Array.from(localSceneFrames.entries()).sort((a, b) => a[0] - b[0]);
    if (allEntries.length === 0) {
      setLocalSceneFrames(new Map([[0, []]]));
      return;
    }
    const insertAfter = sceneKey === undefined
      ? allEntries.length - 1
      : allEntries.findIndex(([key]) => key === sceneKey);
    const nextEntries: Array<[number, FrameInfo[]]> = [];
    allEntries.forEach((entry, index) => {
      nextEntries.push(entry);
      if (index === insertAfter) nextEntries.push([-1, []]);
    });
    if (insertAfter < 0) nextEntries.push([-1, []]);
    applySceneEntries(nextEntries);
  }

  function deleteScene(sceneKey: number) {
    const allEntries = Array.from(localSceneFrames.entries()).sort((a, b) => a[0] - b[0]);
    const deletePos = allEntries.findIndex(([key]) => key === sceneKey);
    if (deletePos < 0) return;
    const [, framesToKeep] = allEntries[deletePos];
    addFramesToCustom(framesToKeep);
    const remaining = allEntries.filter((_, index) => index !== deletePos);
    if (remaining.length === 0) {
      setLocalSceneFrames(new Map());
      setSceneDescriptions({});
      setSelectedScene(null);
      return;
    }
    applySceneEntries(remaining);
    setSelectedScene((prev) => prev === sceneKey ? null : prev);
  }

  function moveScene(sceneKey: number, direction: -1 | 1) {
    const allEntries = Array.from(localSceneFrames.entries()).sort((a, b) => a[0] - b[0]);
    const fromIdx = allEntries.findIndex(([key]) => key === sceneKey);
    const toIdx = fromIdx + direction;
    if (fromIdx < 0 || toIdx < 0 || toIdx >= allEntries.length) return;
    const nextEntries = [...allEntries];
    const [moved] = nextEntries.splice(fromIdx, 1);
    nextEntries.splice(toIdx, 0, moved);
    applySceneEntries(nextEntries);
    setSelectedScene(toIdx);
  }

  function moveDraggedScene(toKey: number) {
    if (draftSceneDragKey === null || draftSceneDragKey === toKey) return;
    const allEntries = Array.from(localSceneFrames.entries()).sort((a, b) => a[0] - b[0]);
    const fromIdx = allEntries.findIndex(([key]) => key === draftSceneDragKey);
    const toIdx = allEntries.findIndex(([key]) => key === toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    const nextEntries = [...allEntries];
    const [moved] = nextEntries.splice(fromIdx, 1);
    nextEntries.splice(toIdx, 0, moved);
    applySceneEntries(nextEntries);
    setSelectedScene(toIdx);
  }

  function mergeWithNext(sceneKey: number) {
    const allEntries = Array.from(localSceneFrames.entries()).sort((a, b) => a[0] - b[0]);
    const keyPos = allEntries.findIndex(([k]) => k === sceneKey);
    if (keyPos < 0 || keyPos >= allEntries.length - 1) return;
    const [, curFrames] = allEntries[keyPos];
    const [, nextFrames] = allEntries[keyPos + 1];
    const merged = [...curFrames, ...nextFrames];
    const filtered = allEntries.filter((_, i) => i !== keyPos + 1);
    const newEntries: [number, FrameInfo[]][] = filtered.map(([, frames], i) =>
      [i, i === keyPos ? merged : frames] as [number, FrameInfo[]]
    );
    applySceneEntries(newEntries);
  }

  // ── Frame-Editor ──────────────────────────────────────────────────────────

  async function handleFrameEditSave(dataUrl: string) {
    if (!editingFrame) return;
    setFrameEditError(null);
    try {
      await api.updateFrame(videoId, editingFrame.filename, dataUrl);
      const updateEditedFrame = (frame: FrameInfo): FrameInfo =>
        frame.filename === editingFrame.filename ? { ...frame, dataUrl } : frame;
      const updatedSceneFrames = new Map<number, FrameInfo[]>();
      for (const [sceneIdx, frames] of localSceneFrames.entries()) {
        updatedSceneFrames.set(sceneIdx, frames.map(updateEditedFrame));
      }
      setLocalSceneFrames(updatedSceneFrames);
      skipNextFrameStackSyncRef.current = true;
      setFrameStack((prev) => prev ? { ...prev, frames: prev.frames.map(updateEditedFrame) } : prev);
      setCustomFrames((prev) =>
        prev.map(updateEditedFrame)
      );
      setEditingFrame(null);
    } catch (e) {
      setFrameEditError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
      setEditingFrame(null);
    }
  }

  // Frames nach Szene gruppieren. Ein leerer Map ist ein gueltiger Zustand:
  // Alle Szenen koennen geloescht und spaeter aus der Auswahl neu aufgebaut werden.
  const scenes: Map<number, FrameInfo[]> = localSceneFrames;
  const sortedScenes = Array.from(scenes.entries()).sort((a, b) => a[0] - b[0]);

  function formatTime(seconds: number): string {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const rest = safeSeconds - minutes * 60;
    return minutes > 0 ? `${minutes}:${rest.toFixed(1).padStart(4, "0")} min` : `${rest.toFixed(1)}s`;
  }

  function sceneTimeRange(frames: FrameInfo[]): { start: number; end: number; duration: number } {
    const timestamps = frames.map((f) => f.timestamp_seconds).sort((a, b) => a - b);
    const start = timestamps[0] ?? 0;
    const end = timestamps[timestamps.length - 1] ?? start;
    return { start, end, duration: Math.max(0, end - start) };
  }

  function finishWithCurrentScenes() {
    const cleanedImagePrompts = Object.fromEntries(
      Object.entries(imagePrompts).filter(([, prompt]) => prompt.trim()).map(([filename, prompt]) => [filename, prompt.trim()])
    );
    if (customFrames.length > 0) {
      const customSet = new Set(customFrames.map((f) => f.filename));
      const sceneGroups: string[][] = [];
      const sceneDescriptionsForGroups: string[] = [];
      for (const [sceneIdx, frames] of sortedScenes) {
        const group = frames.filter((f) => customSet.has(f.filename)).map((f) => f.filename);
        if (group.length > 0) {
          sceneGroups.push(group);
          sceneDescriptionsForGroups.push((sceneDescriptions[sceneIdx] ?? "").trim());
        }
      }
      onDone(customFrames.map((f) => f.filename), sceneGroups, {
        sceneDescriptions: sceneDescriptionsForGroups,
        imagePrompts: cleanedImagePrompts,
      });
      return;
    }

    const sceneGroups: string[][] = [];
    const sceneDescriptionsForGroups: string[] = [];
    for (const [sceneIdx, frames] of sortedScenes) {
      const group = frames.map((f) => f.filename);
      if (group.length > 0) {
        sceneGroups.push(group);
        sceneDescriptionsForGroups.push((sceneDescriptions[sceneIdx] ?? "").trim());
      }
    }
    onDone(sceneGroups.flat(), sceneGroups, {
      sceneDescriptions: sceneDescriptionsForGroups,
      imagePrompts: cleanedImagePrompts,
    });
  }

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
                onClick={finishWithCurrentScenes}
                style={{ marginLeft: "auto" }}
              >
                Weiter → Storyboard
              </button>
            </div>

            {frameStack && (
              <div
                style={{
                  marginTop: 14,
                  border: "1px solid #1f3f5f",
                  background: "#0b1726",
                  borderRadius: 6,
                  padding: "12px 14px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                  <span style={{ color: "#4fc3f7", fontWeight: 700, fontSize: 14 }}>
                    Szenen-Entwurf
                  </span>
                  <span style={{ color: "#6f8aa5", fontSize: 12 }}>
                    Wird so an das Storyboard uebergeben
                  </span>
                  <button
                    className="btn btn-ghost"
                    style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px", color: "#4fc3f7" }}
                    onClick={() => addSceneAfter()}
                    title="Leere Szene am Ende hinzufuegen"
                  >
                    + Szene
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                  {sortedScenes.map(([sceneIdx, frames], draftIdx) => {
                    const range = sceneTimeRange(frames);
                    const isSceneDragOver = draftSceneDragKey !== null && draftSceneDragKey !== sceneIdx;
                    const isFrameDropTarget = sceneCrossDragOver === sceneIdx;
                    return (
                      <div
                        key={sceneIdx}
                        onDragOver={(e) => {
                          if (draftSceneDragKey !== null || sceneDragInfo || paletteDragFilename) {
                            e.preventDefault();
                            if (sceneDragInfo && sceneDragInfo.sceneIdx !== sceneIdx) setSceneCrossDragOver(sceneIdx);
                            if (paletteDragFilename) setSceneCrossDragOver(sceneIdx);
                          }
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) setSceneCrossDragOver(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setSceneCrossDragOver(null);
                          if (paletteDragFilename) {
                            insertPaletteFrameIntoScene(sceneIdx, paletteDragFilename);
                            setPaletteDragFilename(null);
                            return;
                          }
                          if (sceneDragInfo && sceneDragInfo.sceneIdx !== sceneIdx) {
                            const srcFrames = localSceneFrames.get(sceneDragInfo.sceneIdx) ?? [];
                            const fn = srcFrames[sceneDragInfo.frameIdx]?.filename;
                            if (fn) moveFrameBetweenScenes(sceneDragInfo.sceneIdx, sceneIdx, fn);
                            setSceneDragInfo(null);
                            setSceneDragOver(null);
                            return;
                          }
                          moveDraggedScene(sceneIdx);
                          setDraftSceneDragKey(null);
                        }}
                        style={{
                          minWidth: 0,
                          background: "#0f2133",
                          border: isFrameDropTarget || isSceneDragOver ? "1px dashed #4fc3f7" : "1px solid #203b56",
                          borderRadius: 6,
                          padding: 8,
                          transition: "border 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7, flexWrap: "wrap" }}>
                          <span
                            draggable
                            title="Szene ziehen zum Verschieben"
                            onDragStart={(e) => {
                              setDraftSceneDragKey(sceneIdx);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => setDraftSceneDragKey(null)}
                            style={{
                              color: "#4fc3f7",
                              cursor: "grab",
                              fontSize: 13,
                              userSelect: "none",
                            }}
                          >
                            ↕
                          </span>
                          <strong style={{ color: "#90caf9", fontSize: 13 }}>Szene {draftIdx + 1}</strong>
                          <span style={{ color: "#6f8aa5", fontSize: 11 }}>{frames.length} Frames</span>
                          <button
                            className="btn btn-ghost"
                            style={{ marginLeft: "auto", fontSize: 10, padding: "1px 6px" }}
                            onClick={() => moveScene(sceneIdx, -1)}
                            disabled={draftIdx === 0}
                            title="Szene nach oben verschieben"
                          >
                            ↑
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 10, padding: "1px 6px" }}
                            onClick={() => moveScene(sceneIdx, 1)}
                            disabled={draftIdx === sortedScenes.length - 1}
                            title="Szene nach unten verschieben"
                          >
                            ↓
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 10, padding: "1px 6px", color: "#4fc3f7" }}
                            onClick={() => addSceneAfter(sceneIdx)}
                            title="Neue Szene nach dieser Szene einfuegen"
                          >
                            +
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 10, padding: "1px 6px", color: "#ef9090" }}
                            onClick={() => deleteScene(sceneIdx)}
                            title={frames.length > 0 ? "Szene loeschen und Bilder in die eigene Auswahl legen" : "Leere Szene loeschen"}
                          >
                            ×
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: 4, marginBottom: 7, minHeight: 34, flexWrap: "wrap" }}>
                          {frames.length === 0 && (
                            <span style={{ color: "#6f8aa5", fontSize: 11, fontStyle: "italic", alignSelf: "center" }}>
                              Bilder hier ablegen
                            </span>
                          )}
                          {frames.map((f, frameIdx) => {
                            const isDragging = sceneDragInfo?.sceneIdx === sceneIdx && sceneDragInfo.frameIdx === frameIdx;
                            const isDropTarget = sceneDragOver?.sceneIdx === sceneIdx && sceneDragOver.frameIdx === frameIdx;
                            const isCarouselActive = carouselActiveFrame[sceneIdx] === f.filename;
                            return (
                            <div
                              key={f.filename}
                              draggable
                              title="Bild ziehen zum Anordnen oder in andere Szene verschieben"
                              onDragStart={(e) => handleSceneFrameDragStart(e, sceneIdx, frameIdx)}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setSceneDragOver({ sceneIdx, frameIdx });
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (sceneDragInfo?.sceneIdx === sceneIdx) {
                                  reorderFrame(sceneIdx, sceneDragInfo.frameIdx, frameIdx);
                                } else if (paletteDragFilename) {
                                  insertPaletteFrameIntoScene(sceneIdx, paletteDragFilename, frameIdx);
                                } else if (sceneDragInfo) {
                                  const srcFrames = localSceneFrames.get(sceneDragInfo.sceneIdx) ?? [];
                                  const fn = srcFrames[sceneDragInfo.frameIdx]?.filename;
                                  if (fn) moveFrameBetweenScenes(sceneDragInfo.sceneIdx, sceneIdx, fn);
                                }
                                setSceneDragInfo(null);
                                setPaletteDragFilename(null);
                                setSceneDragOver(null);
                              }}
                              onDragEnd={() => { setSceneDragInfo(null); setPaletteDragFilename(null); setSceneDragOver(null); }}
                              style={{
                                position: "relative",
                                cursor: "grab",
                                outline: isDropTarget
                                  ? "2px solid #4fc3f7"
                                  : isCarouselActive
                                    ? "3px solid #ff8a80"
                                    : "none",
                                outlineOffset: isCarouselActive ? 3 : 1,
                                opacity: isDragging ? 0.35 : 1,
                              }}
                            >
                              <img
                                src={f.dataUrl ?? api.frameImageUrl(videoId, f.filename)}
                                alt=""
                                draggable={false}
                                style={{
                                  width: 52,
                                  height: 30,
                                  objectFit: "cover",
                                  borderRadius: 3,
                                  border: isCarouselActive ? "1px solid #ffcdd2" : "1px solid #2a4a6a",
                                  display: "block",
                                }}
                                loading="lazy"
                              />
                              <textarea
                                value={imagePrompts[f.filename] ?? ""}
                                placeholder="KI-Anweisung..."
                                rows={2}
                                draggable={false}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                onDragStart={(e) => e.preventDefault()}
                                onChange={(e) => setImagePrompts((prev) => ({
                                  ...prev,
                                  [f.filename]: e.target.value,
                                }))}
                                style={{
                                  width: 72,
                                  boxSizing: "border-box",
                                  marginTop: 3,
                                  padding: "2px 4px",
                                  fontSize: 9,
                                  lineHeight: 1.25,
                                  background: "#0a1724",
                                  color: "#c8e6ff",
                                  border: (imagePrompts[f.filename] ?? "").trim()
                                    ? "1px solid #4fc3f7"
                                    : "1px solid #203b56",
                                  borderRadius: 3,
                                  resize: "vertical",
                                  fontFamily: "inherit",
                                  cursor: "text",
                                }}
                              />
                            </div>
                            );
                          })}
                        </div>
                        <div style={{ color: "#9fb4c8", fontSize: 11, lineHeight: 1.45 }}>
                          {formatTime(range.start)} bis {formatTime(range.end)}
                          <br />
                          Dauer ca. {formatTime(range.duration || 5)}
                        </div>
                        <textarea
                          value={sceneDescriptions[sceneIdx] ?? ""}
                          onChange={(e) => setSceneDescriptions((prev) => ({ ...prev, [sceneIdx]: e.target.value }))}
                          rows={2}
                          placeholder="Kurze Szenenbeschreibung..."
                          onClick={(e) => e.stopPropagation()}
                          onDragStart={(e) => e.preventDefault()}
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            marginTop: 7,
                            padding: "5px 6px",
                            minHeight: 44,
                            fontSize: 11,
                            lineHeight: 1.35,
                            background: "#0a1724",
                            color: "#c8e6ff",
                            border: (sceneDescriptions[sceneIdx] ?? "").trim()
                              ? "1px solid #4fc3f7"
                              : "1px solid #203b56",
                            borderRadius: 4,
                            resize: "vertical",
                            fontFamily: "inherit",
                          }}
                        />
                      </div>
                    );
                  })}
                  {sortedScenes.length === 0 && (
                    <div
                      style={{
                        color: "#6f8aa5",
                        fontSize: 12,
                        fontStyle: "italic",
                        padding: "10px 2px",
                      }}
                    >
                      Keine Szenen im Entwurf. Lege mit + Szene eine neue Szene an und ziehe Bilder aus der eigenen Auswahl hinein.
                    </div>
                  )}
                </div>
              </div>
            )}

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
                    <div
                      key={f.filename}
                      draggable
                      onDragStart={(e) => {
                        setPaletteDragFilename(f.filename);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onDragEnd={() => setPaletteDragFilename(null)}
                      title="In eine Szene ziehen"
                      style={{
                        cursor: "grab",
                        flexShrink: 0,
                      }}
                    >
                      <img
                        src={f.dataUrl ?? api.frameImageUrl(videoId, f.filename)}
                        alt={`Auswahl ${i + 1}`}
                        draggable={false}
                        style={{
                          width: 48,
                          height: 27,
                          objectFit: "cover",
                          borderRadius: 3,
                          border: paletteDragFilename === f.filename ? "2px solid #4fc3f7" : "1px solid #4fc3f7",
                          display: "block",
                        }}
                      />
                    </div>
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
          {sortedScenes.map(([sceneIdx, frames], draftIdx) => {
            const isExpanded = expandedScenes.has(sceneIdx);
            const showAll = selectionMode || isExpanded;
            const visibleFrames = showAll ? frames : frames.slice(0, 8);
            const hasMore = !showAll && frames.length > 8;
            const selectedInScene = frames.filter((f) => customFilenames.has(f.filename)).length;
            const range = sceneTimeRange(frames);

            return (
              <div
                key={sceneIdx}
                className="card"
                style={{ marginBottom: 12, border: sceneCrossDragOver === sceneIdx ? "2px dashed #4fc3f7" : "1px solid #2a2a4a", transition: "border 0.15s" }}
                onDragOver={(e) => {
                  if (sceneDragInfo && sceneDragInfo.sceneIdx !== sceneIdx) {
                    e.preventDefault();
                    setSceneCrossDragOver(sceneIdx);
                  }
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setSceneCrossDragOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setSceneCrossDragOver(null);
                  if (sceneDragInfo && sceneDragInfo.sceneIdx !== sceneIdx) {
                    const srcFrames = localSceneFrames.get(sceneDragInfo.sceneIdx) ?? [];
                    const fn = srcFrames[sceneDragInfo.frameIdx]?.filename;
                    if (fn) moveFrameBetweenScenes(sceneDragInfo.sceneIdx, sceneIdx, fn);
                    setSceneDragInfo(null);
                    setSceneDragOver(null);
                  }
                }}
              >
                <div style={{ display: "flex", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <h3 style={{ margin: 0, color: "#90caf9", fontSize: 15 }}>Szene {sceneIdx + 1}</h3>
                  <span style={{ color: "#666", fontSize: 12 }}>{frames.length} Frames</span>
                  <span style={{ color: "#6f8aa5", fontSize: 12 }}>
                    Entwurf {draftIdx + 1}: {formatTime(range.start)} bis {formatTime(range.end)}
                  </span>
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
                    disabled={frames.length === 0}
                  >
                    {selectedScene === sceneIdx ? "Schliessen" : "Carousel"}
                  </button>
                  {/* Szene mit nächster zusammenfügen */}
                  {Array.from(scenes.keys()).sort((a, b) => a - b).indexOf(sceneIdx) < scenes.size - 1 && (
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "4px 8px", fontSize: 11, color: "#90caf9" }}
                      title="Mit nächster Szene zusammenfügen"
                      onClick={() => mergeWithNext(sceneIdx)}
                    >
                      ⊔ Zusammenfügen
                    </button>
                  )}
                </div>

                {/* Thumbnail-Raster */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, overflow: "visible" }}>
                  {visibleFrames.map((f, visIdx) => {
                    const actualIdx = frames.indexOf(f);
                    const isDragging = sceneDragInfo?.sceneIdx === sceneIdx && sceneDragInfo?.frameIdx === actualIdx;
                    const isDragOver = sceneDragOver?.sceneIdx === sceneIdx && sceneDragOver?.frameIdx === actualIdx && sceneDragInfo?.frameIdx !== actualIdx;
                    const isSelected = customFilenames.has(f.filename);
                    const isHovered = hoveredThumb === f.filename && !sceneDragInfo;
                    const isCarouselActive = carouselActiveFrame[sceneIdx] === f.filename;
                    const frameSrc = f.dataUrl ?? api.frameImageUrl(videoId, f.filename);
                    return (
                      <div
                        key={f.filename}
                        draggable
                        style={{
                          position: "relative",
                          cursor: selectionMode ? "pointer" : sceneDragInfo?.sceneIdx === sceneIdx ? "grabbing" : "pointer",
                          borderRadius: 4,
                          outline: isDragOver
                            ? "2px solid #4fc3f7"
                            : isCarouselActive
                              ? "3px solid #ff8a80"
                              : isSelected
                                ? "2px solid #4fc3f7"
                                : "none",
                          outlineOffset: isDragOver || isCarouselActive ? 3 : 1,
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
                            setCarouselActiveFrame((prev) => ({ ...prev, [sceneIdx]: f.filename }));
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
                            border: isCarouselActive ? "1px solid #ffcdd2" : "1px solid #333",
                            display: "block",
                            opacity: selectionMode && !isSelected ? 0.5 : 1,
                            transition: "opacity 0.15s",
                          }}
                          loading="lazy"
                        />

                        {/* Bearbeiten-Button (immer sichtbar, unten links) */}
                        <div
                          onClick={(e) => { e.stopPropagation(); setEditingFrame(f); }}
                          title="Frame bearbeiten (rotieren, Zielformat, Blur / Verpixeln / Schwärzen)"
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
                        </div>                        {/* Szene hier teilen (nicht beim ersten Frame) */}
                        {actualIdx > 0 && (
                          <div
                            onClick={(e) => { e.stopPropagation(); splitSceneAt(sceneIdx, actualIdx); }}
                            title="Szene hier teilen – ab diesem Bild neue Szene"
                            style={{
                              position: "absolute",
                              top: 2,
                              left: 2,
                              background: "rgba(21,101,192,0.88)",
                              color: "#c8e6ff",
                              borderRadius: 3,
                              fontSize: 9,
                              padding: "1px 4px",
                              cursor: "pointer",
                              userSelect: "none",
                              lineHeight: 1.3,
                            }}
                          >
                            \u2702
                          </div>
                        )}
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
                      onIndexChange={(_, frame) => {
                        setCarouselActiveFrame((prev) => ({ ...prev, [sceneIdx]: frame.filename }));
                      }}
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
