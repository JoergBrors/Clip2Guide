import React, { useRef, useState } from "react";
import { api, UploadResponse } from "../api/backendClient";

interface Props {
  onUploaded: (videoId: string, filename: string, hasAudio: boolean) => void;
}

export default function VideoUpload({ onUploaded }: Props): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    setProgress(10);
    try {
      const result: UploadResponse = await api.uploadVideo(file);
      setProgress(100);
      onUploaded(result.video_id, result.filename, result.has_audio);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function openDialog() {
    if (!uploading) inputRef.current?.click();
  }

  return (
    <div className="card" style={{ maxWidth: 680, margin: "40px auto" }}>
      <h2 style={{ marginTop: 0, color: "#4fc3f7" }}>Video hochladen</h2>
      <p style={{ color: "#aaa", marginBottom: 24 }}>
        Lade eine Bildschirmaufnahme hoch (MP4, MOV, AVI, MKV, WebM).
        Das Backend analysiert das Video und erkennt Audio-Spuren.
      </p>

      <div
        role="button"
        tabIndex={0}
        aria-label="Datei hier ablegen oder klicken zum Auswaehlen"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={openDialog}
        onKeyDown={(e) => e.key === "Enter" && openDialog()}
        style={{
          border: `2px dashed ${dragOver ? "#4fc3f7" : "#444"}`,
          borderRadius: 10,
          padding: "48px 32px",
          textAlign: "center",
          cursor: uploading ? "not-allowed" : "pointer",
          background: dragOver ? "rgba(79,195,247,0.07)" : "transparent",
          transition: "all 0.2s",
          marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>🎬</div>
        <div style={{ fontSize: 16, color: "#ccc" }}>
          {uploading ? "Lade hoch..." : "Datei hier ablegen oder klicken"}
        </div>
        <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
          MP4, MOV, AVI, MKV, WebM – max. 4 GB
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
        onChange={onInputChange}
        style={{ display: "none" }}
        aria-hidden="true"
      />

      {uploading && (
        <div aria-live="polite">
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <div style={{ fontSize: 13, color: "#aaa", textAlign: "center" }}>{progress}%</div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "#ef5350", marginTop: 12, fontSize: 14 }}>
          Fehler: {error}
        </p>
      )}
    </div>
  );
}
