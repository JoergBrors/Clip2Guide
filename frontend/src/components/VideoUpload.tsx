import React, { useRef, useState } from "react";
import { api, ImageInfo, FolderGroup } from "../api/backendClient";
import ImageHoverZoom from "./ImageHoverZoom";

type UploadMode = "video" | "images";

interface LocalImage {
  file: File;
  dataUrl: string | null;  // null für HEIC/HEIF (Browser kann kein HEIC rendern)
  folderName?: string;     // gesetzt wenn via Ordner-Import
}

interface Props {
  onUploaded: (videoId: string, filename: string, hasAudio: boolean) => void;
  onImagesUploaded: (sessionId: string, images: ImageInfo[], folderGroups?: FolderGroup[]) => void;
  onProjectImported: (videoId: string) => void;
}

export default function VideoUpload({ onUploaded, onImagesUploaded, onProjectImported }: Props): React.ReactElement {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<UploadMode>("video");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // ── Video-State ────────────────────────────────────────────────────────────
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoProgressLabel, setVideoProgressLabel] = useState("");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoDragOver, setVideoDragOver] = useState(false);

  // ── Bild-State ─────────────────────────────────────────────────────────────
  const [localImages, setLocalImages] = useState<LocalImage[]>([]);
  const [imgUploading, setImgUploading] = useState(false);
  const [imgProgress, setImgProgress] = useState(0);
  const [imgError, setImgError] = useState<string | null>(null);
  const [imgDragOver, setImgDragOver] = useState(false);

  // ── Video-Handler ──────────────────────────────────────────────────────────

  async function handleVideoFile(file: File) {
    setVideoError(null);
    setVideoUploading(true);
    setVideoProgress(0);
    setVideoProgressLabel("Verbinde…");

    const uploadId = crypto.randomUUID();

    // SSE nur für Fortschritts-Updates öffnen, NICHT als Abschluss-Signal nutzen
    const src = api.openUploadEvents(uploadId, (event) => {
      setVideoProgress(event.percent);
      setVideoProgressLabel(event.message);
    });

    try {
      // Kurz warten bis SSE-Verbindung steht
      await new Promise<void>((r) => setTimeout(r, 150));
      // HTTP-Response ist das echte Abschluss-Signal
      const result = await api.uploadVideoWithProgress(file, uploadId);
      src.close();
      setVideoProgress(100);
      setVideoProgressLabel("Fertig");
      onUploaded(result.video_id, result.filename, result.has_audio);
    } catch (e: unknown) {
      src.close();
      setVideoError(e instanceof Error ? e.message : "Upload fehlgeschlagen");
      setVideoUploading(false);
    }
  }

  // ── Bild-Handler ───────────────────────────────────────────────────────────

  const _HEIC_EXTS = new Set([".heic", ".heif"]);
  function _isImageFile(f: File): boolean {
    if (f.type.startsWith("image/")) return true;
    // Browser kennt HEIC oft nicht → MIME-Type ist leer; Endung prüfen
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    return _HEIC_EXTS.has(ext);
  }
  function _isHeic(f: File): boolean {
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    return _HEIC_EXTS.has(ext) || f.type === "image/heic" || f.type === "image/heif";
  }

  function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(_isImageFile);
    if (!arr.length) return;
    Promise.all(
      arr.map(
        (file) =>
          new Promise<LocalImage>((resolve) => {
            // HEIC kann Browser nicht rendern → Placeholder statt DataURL
            if (_isHeic(file)) {
              resolve({ file, dataUrl: null });
              return;
            }
            const reader = new FileReader();
            reader.onload = (ev) =>
              resolve({ file, dataUrl: ev.target?.result as string });
            reader.readAsDataURL(file);
          }),
      ),
    ).then((imgs) => setLocalImages((prev) => [...prev, ...imgs]));
  }

  function onImageInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function onFolderInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(_isImageFile);
    e.target.value = "";
    if (!files.length) return;

    // webkitRelativePath hat die Form "RootOrdner/Unterordner/datei.jpg"
    // → parts[parts.length - 2] ist der direkte Elternordner der Datei.
    // Liegt eine Datei direkt im gewählten Root-Ordner (parts.length === 2),
    // verwenden wir den Root-Ordner selbst als Scene-Namen.
    // Tiefere Verschachtelung (parts.length > 3) wird auf den ersten Unterordner (parts[1]) normalisiert,
    // damit jeder direkte Unterordner des Root eine Scene wird.
    function sceneNameForFile(file: File): string {
      const parts = (file.webkitRelativePath || file.name).split("/");
      if (parts.length <= 1) return "(kein Ordner)";
      if (parts.length === 2) return parts[0];        // Datei direkt im Root → Root-Name
      return parts[1];                                // Unterordner-Name (tiefere Ebenen ignorieren)
    }

    // Führende Zahl aus einem String extrahieren; fehlt sie → Infinity (alphabetisch ans Ende)
    function leadingNumber(s: string): number {
      const m = s.match(/^(\d+)/);
      return m ? parseInt(m[1], 10) : Infinity;
    }

    // Sortierung: erst Ordner-Nummer aufsteigend, dann Bild-Nummer aufsteigend,
    // Fallback auf alphabetischen Vergleich wenn kein führendes Zahl-Präfix vorhanden.
    const sorted = [...files].sort((a, b) => {
      const sa = sceneNameForFile(a);
      const sb = sceneNameForFile(b);
      const na = leadingNumber(sa);
      const nb = leadingNumber(sb);
      if (na !== nb) return na - nb;
      if (sa !== sb) return sa.localeCompare(sb, undefined, { sensitivity: "base" });
      const fa = leadingNumber(a.name);
      const fb = leadingNumber(b.name);
      if (fa !== fb) return fa - fb;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    Promise.all(
      sorted.map(
        (file) =>
          new Promise<LocalImage>((resolve) => {
            const folderName = sceneNameForFile(file);
            if (_isHeic(file)) {
              resolve({ file, dataUrl: null, folderName });
              return;
            }
            const reader = new FileReader();
            reader.onload = (ev) =>
              resolve({ file, dataUrl: ev.target?.result as string, folderName });
            reader.readAsDataURL(file);
          }),
      ),
    ).then((imgs) => {
      setLocalImages(imgs);
    });
  }

  async function uploadImages() {
    if (!localImages.length) return;
    setImgError(null);
    setImgUploading(true);
    setImgProgress(10);
    try {
      const result = await api.uploadImages(localImages.map((li) => li.file));
      setImgProgress(100);

      // Ordner-Gruppen rekonstruieren: Backend gibt images in derselben Reihenfolge zurück.
      const hasFolders = localImages.some((li) => li.folderName !== undefined);
      let folderGroups: FolderGroup[] | undefined;
      if (hasFolders) {
        const groupMap = new Map<string, string[]>();
        for (let i = 0; i < localImages.length; i++) {
          const folder = localImages[i].folderName ?? "(kein Ordner)";
          const imageId = result.images[i]?.image_id;
          if (!imageId) continue;
          if (!groupMap.has(folder)) groupMap.set(folder, []);
          groupMap.get(folder)!.push(imageId);
        }
        // Reihenfolge der Ordner aus dem ersten Auftreten in localImages ableiten
        const orderedFolders = [...new Set(localImages.map((li) => li.folderName ?? "(kein Ordner)"))];
        folderGroups = orderedFolders.map((name) => ({
          folderName: name,
          imageIds: groupMap.get(name) ?? [],
        }));
      }

      onImagesUploaded(result.session_id, result.images, folderGroups);
    } catch (e: unknown) {
      setImgError(e instanceof Error ? e.message : "Upload fehlgeschlagen");
      setImgUploading(false);
    }
  }

  async function restoreProject(file: File | null) {
    if (!file) return;
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      const result = await api.importProjectZip(file, "new_id");
      onProjectImported(result.video_id);
    } catch (e: unknown) {
      setRestoreError(e instanceof Error ? e.message : "Projekt-Wiederherstellung fehlgeschlagen");
    } finally {
      setRestoreBusy(false);
      if (restoreInputRef.current) restoreInputRef.current.value = "";
    }
  }

  return (
    <div className="card" style={{ maxWidth: 720, margin: "32px auto" }}>
      <h2 style={{ marginTop: 0, color: "#4fc3f7" }}>Hochladen</h2>

      <div style={{ marginBottom: 20, padding: "10px 12px", border: "1px solid #273452", borderRadius: 6, background: "#10182d" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#90caf9", marginRight: 4 }}>Projekt wiederherstellen:</span>
          <label className="btn btn-ghost" style={{ cursor: restoreBusy ? "default" : "pointer" }}>
            {restoreBusy ? "Projektstand wird wiederhergestellt..." : "ZIP auswählen"}
            <input
              ref={restoreInputRef}
              type="file"
              accept=".zip,application/zip"
              disabled={restoreBusy}
              onChange={(e) => restoreProject(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
          </label>
        </div>
        {restoreError && (
          <p role="alert" style={{ color: "#ef5350", fontSize: 12, margin: "8px 0 0" }}>{restoreError}</p>
        )}
      </div>

      {/* Modus-Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <button
          className={`btn ${mode === "video" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setMode("video")}
          aria-pressed={mode === "video"}
        >
          🎬 Video
        </button>
        <button
          className={`btn ${mode === "images" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setMode("images")}
          aria-pressed={mode === "images"}
        >
          🖼️ Bilder
        </button>
      </div>

      {/* ── VIDEO-TAB ── */}
      {mode === "video" && (
        <>
          <p style={{ color: "#aaa", marginBottom: 20 }}>
            Lade eine Bildschirmaufnahme hoch (MP4, MOV, AVI, MKV, WebM – max.&nbsp;4&nbsp;GB).
          </p>

          <div
            role="button"
            tabIndex={0}
            aria-label="Video hier ablegen oder klicken zum Auswählen"
            onDragOver={(e) => { e.preventDefault(); setVideoDragOver(true); }}
            onDragLeave={() => setVideoDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setVideoDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleVideoFile(f);
            }}
            onClick={() => { if (!videoUploading) videoInputRef.current?.click(); }}
            onKeyDown={(e) => e.key === "Enter" && !videoUploading && videoInputRef.current?.click()}
            style={{
              border: `2px dashed ${videoDragOver ? "#4fc3f7" : "#444"}`,
              borderRadius: 10,
              padding: "48px 32px",
              textAlign: "center",
              cursor: videoUploading ? "not-allowed" : "pointer",
              background: videoDragOver ? "rgba(79,195,247,0.07)" : "transparent",
              transition: "all 0.2s",
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 12 }}>🎬</div>
            <div style={{ fontSize: 16, color: "#ccc" }}>
              {videoUploading ? videoProgressLabel : "Datei hier ablegen oder klicken"}
            </div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
              MP4, MOV, AVI, MKV, WebM – max. 4 GB
            </div>
          </div>

          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVideoFile(f); }}
            style={{ display: "none" }}
            aria-hidden="true"
          />

          {videoUploading && (
            <div aria-live="polite">
              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${videoProgress}%`, transition: "width 0.4s ease" }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                <span style={{ fontSize: 13, color: "#aaa" }}>{videoProgressLabel}</span>
                <span style={{ fontSize: 13, color: "#aaa" }}>{videoProgress}%</span>
              </div>
            </div>
          )}

          {videoError && (
            <p role="alert" style={{ color: "#ef5350", marginTop: 12, fontSize: 14 }}>
              Fehler: {videoError}
            </p>
          )}
        </>
      )}

      {/* ── BILDER-TAB ── */}
      {mode === "images" && (
        <>
          <p style={{ color: "#aaa", marginBottom: 20 }}>
            Lade mehrere Bilder hoch (JPEG, PNG, WebP, HEIC). In Schritt&nbsp;2 werden sie auf
            eine einheitliche Größe gebracht.
          </p>

          {/* Auswahl-Buttons */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { if (!imgUploading) imageInputRef.current?.click(); }}
              disabled={imgUploading}
              title="Einzelne Bilddateien auswählen"
            >
              🖼️ Bilder wählen
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { if (!imgUploading) folderInputRef.current?.click(); }}
              disabled={imgUploading}
              title="Ordner wählen – jeder Ordner wird eine Scene"
            >
              📁 Ordner wählen
            </button>
          </div>

          {/* Info: Ordner-Modus aktiv */}
          {localImages.some((li) => li.folderName !== undefined) && (
            <div style={{
              background: "#0d2137",
              border: "1px solid #1e4976",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 12,
              color: "#90caf9",
              marginBottom: 12,
            }}>
              📁 Ordner-Modus: {[...new Set(localImages.map((li) => li.folderName))].length} Ordner
              → {[...new Set(localImages.map((li) => li.folderName))].length} Scenes vorbelegt
              &nbsp;|&nbsp;
              {[...new Set(localImages.map((li) => li.folderName))].join(", ")}
            </div>
          )}

          {/* Drop-Zone */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Bilder hier ablegen oder klicken zum Auswählen"
            onDragOver={(e) => { e.preventDefault(); setImgDragOver(true); }}
            onDragLeave={() => setImgDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setImgDragOver(false);
              if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
            }}
            onClick={() => { if (!imgUploading) imageInputRef.current?.click(); }}
            onKeyDown={(e) => e.key === "Enter" && !imgUploading && imageInputRef.current?.click()}
            style={{
              border: `2px dashed ${imgDragOver ? "#4fc3f7" : "#444"}`,
              borderRadius: 10,
              padding: localImages.length ? "20px 32px" : "48px 32px",
              textAlign: "center",
              cursor: imgUploading ? "not-allowed" : "pointer",
              background: imgDragOver ? "rgba(79,195,247,0.07)" : "transparent",
              transition: "all 0.2s",
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: localImages.length ? 32 : 48, marginBottom: 8 }}>🖼️</div>
            <div style={{ fontSize: 15, color: "#ccc" }}>
              {localImages.length
                ? `${localImages.length} Bild${localImages.length !== 1 ? "er" : ""} ausgewählt – klicken zum Hinzufügen`
                : "Bilder hier ablegen oder klicken"}
            </div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
              JPEG, PNG, WebP, HEIC – mehrere gleichzeitig möglich
            </div>
          </div>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            multiple
            onChange={onImageInputChange}
            style={{ display: "none" }}
            aria-hidden="true"
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error – webkitdirectory ist kein Standard-HTML-Attribut, funktioniert aber in Electron/Chrome
            webkitdirectory=""
            multiple
            onChange={onFolderInputChange}
            style={{ display: "none" }}
            aria-hidden="true"
          />

          {/* Vorschau-Raster */}
          {localImages.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
                gap: 8,
                marginBottom: 16,
                maxHeight: 320,
                overflowY: "auto",
                padding: "4px 0",
              }}
            >
              {localImages.map((img, idx) => (
                <div key={idx} style={{ position: "relative" }}>
                  {img.dataUrl ? (
                    <ImageHoverZoom src={img.dataUrl} alt={img.file.name} aspectRatio="4/3" />
                  ) : (
                    <div style={{
                      aspectRatio: "4/3",
                      background: "#1a2540",
                      border: "1px solid #2a3a5c",
                      borderRadius: 6,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: 6,
                    }}>
                      <span style={{ fontSize: 28 }}>🖼️</span>
                      <span style={{ fontSize: 9, color: "#90caf9", textAlign: "center", wordBreak: "break-all" }}>
                        HEIC
                      </span>
                      <span style={{ fontSize: 9, color: "#666", textAlign: "center" }}>
                        {(img.file.size / 1024).toFixed(0)} KB
                      </span>
                    </div>
                  )}
                  <button
                    aria-label={`${img.file.name} entfernen`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocalImages((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    style={{
                      position: "absolute",
                      top: 3,
                      right: 3,
                      background: "rgba(0,0,0,0.72)",
                      border: "none",
                      borderRadius: "50%",
                      color: "#fff",
                      width: 20,
                      height: 20,
                      cursor: "pointer",
                      fontSize: 11,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,
                    }}
                  >
                    ✕
                  </button>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#666",
                      marginTop: 3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={img.file.name}
                  >
                    {img.file.name}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Upload-Button */}
          {localImages.length > 0 && !imgUploading && (
            <button className="btn btn-primary" onClick={uploadImages} style={{ marginBottom: 12 }}>
              {localImages.length} Bild{localImages.length !== 1 ? "er" : ""} hochladen →
            </button>
          )}

          {imgUploading && (
            <div aria-live="polite">
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${imgProgress}%` }} />
              </div>
              <div style={{ fontSize: 13, color: "#aaa", marginTop: 6 }}>
                Bilder werden hochgeladen… {imgProgress}%
              </div>
            </div>
          )}

          {imgError && (
            <p role="alert" style={{ color: "#ef5350", marginTop: 12, fontSize: 14 }}>
              Fehler: {imgError}
            </p>
          )}
        </>
      )}
    </div>
  );
}
