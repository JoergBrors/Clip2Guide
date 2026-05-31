import React, { useEffect, useRef, useState } from "react";
import { api, StoryboardJson, subscribeToJob, JobEvent } from "../api/backendClient";

interface Props {
  videoId: string;
}

const FPS_OPTIONS = [15, 25, 30] as const;
const QUALITY_OPTIONS = [
  { value: "schnell",    label: "Schnell (CRF 28)" },
  { value: "ausgewogen", label: "Ausgewogen (CRF 23)" },
  { value: "beste",      label: "Beste (CRF 18, langsam)" },
] as const;

export default function RenderPanel({ videoId }: Props): React.ReactElement {
  const [storyboard, setStoryboard] = useState<StoryboardJson | null>(null);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);

  // Sprach-Auswahl (aus Storyboard vorbelegt)
  const [selected, setSelected] = useState<string[]>([]);

  // Render-Optionen
  const [fps, setFps] = useState<number>(25);
  const [quality, setQuality] = useState<string>("ausgewogen");
  const [ttsSlow, setTtsSlow] = useState<boolean>(false);

  // Status
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debug-Konsole
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Storyboard beim Mounten laden → Sprachen aus Storyboard übernehmen
  useEffect(() => {
    api.getStoryboard(videoId)
      .then((sb) => {
        setStoryboard(sb);
        if (sb.languages?.length) {
          setSelected(sb.languages);
        }
      })
      .catch((e: unknown) =>
        setStoryboardError(e instanceof Error ? e.message : "Storyboard nicht gefunden")
      );
  }, [videoId]);

  // Log-Ende immer sichtbar halten
  useEffect(() => {
    if (showLog) logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log, showLog]);

  function toggleLang(code: string) {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((l) => l !== code) : [...prev, code]
    );
  }

  async function startRender() {
    if (!selected.length) return;
    setRendering(true);
    setDone(false);
    setError(null);
    setLog([]);
    setProgress(5);
    setMessage("Rendering wird gestartet...");

    try {
      const { job_id } = await api.renderVideo(videoId, selected, fps, quality, ttsSlow);
      subscribeToJob(job_id, (ev: JobEvent) => {
        if (ev.type === "log") {
          setLog((prev) => [...prev, ev.message]);
          return;
        }
        setMessage(ev.message);
        setProgress(ev.percent);
        if (ev.type === "completed") {
          setRendering(false);
          setDone(true);
        } else if (ev.type === "error") {
          setRendering(false);
          setError(ev.message);
        }
      });
    } catch (e: unknown) {
      setRendering(false);
      setError(e instanceof Error ? e.message : "Rendering fehlgeschlagen");
    }
  }

  const backendBase = typeof window !== "undefined" && window.clip2guide?.backendUrl
    ? window.clip2guide.backendUrl
    : "http://localhost:8787";

  const availableLangs = storyboard?.languages ?? [];

  return (
    <div className="card" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0, color: "#4fc3f7" }}>Tutorial-Rendering</h2>
      <p style={{ color: "#aaa", fontSize: 14 }}>
        Pro Sprache wird ein Tutorial-Video mit Text-Panels und Sprachausgabe (TTS) erstellt.
      </p>

      {storyboardError && (
        <p role="alert" style={{ color: "#ef5350", fontSize: 13 }}>⚠ {storyboardError}</p>
      )}

      {/* Sprach-Auswahl – nur aus Storyboard */}
      {availableLangs.length > 0 ? (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: "#90caf9", marginBottom: 8 }}>
            Ausgabesprachen (aus KI-Analyse):
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {availableLangs.map((code) => {
              const active = selected.includes(code);
              return (
                <button
                  key={code}
                  className={`btn ${active ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => toggleLang(code)}
                  disabled={rendering}
                  aria-pressed={active ? "true" : "false"}
                >
                  {code.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        !storyboardError && (
          <p style={{ color: "#666", fontSize: 13, marginBottom: 16 }}>Storyboard wird geladen…</p>
        )
      )}

      {/* Render-Optionen */}
      {!rendering && !done && (
        <details style={{ marginBottom: 20 }}>
          <summary style={{ cursor: "pointer", color: "#90caf9", fontSize: 14, userSelect: "none" }}>
            ⚙ Render-Optionen
          </summary>
          <div style={{ paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>

            {/* FPS */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, minWidth: 130, color: "#bbb" }}>Frames pro Sekunde:</span>
              <div style={{ display: "flex", gap: 6 }}>
                {FPS_OPTIONS.map((f) => (
                  <button
                    key={f}
                    className={`btn ${fps === f ? "btn-primary" : "btn-ghost"}`}
                    style={{ fontSize: 13, padding: "3px 14px" }}
                    onClick={() => setFps(f)}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>

            {/* Qualität */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, minWidth: 130, color: "#bbb" }}>Qualität:</span>
              <select
                aria-label="Render-Qualität"
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                style={{ fontSize: 13, padding: "4px 8px", background: "#1a1a2e", color: "#e0e0e0", border: "1px solid #333", borderRadius: 4 }}
              >
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q.value} value={q.value}>{q.label}</option>
                ))}
              </select>
            </div>

            {/* TTS-Geschwindigkeit */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, minWidth: 130, color: "#bbb" }}>TTS-Tempo:</span>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={ttsSlow}
                  onChange={(e) => setTtsSlow(e.target.checked)}
                />
                <span style={{ fontSize: 13 }}>Langsam sprechen</span>
              </label>
            </div>
          </div>
        </details>
      )}

      {/* Start-Button */}
      {!done && (
        <button
          className="btn btn-success"
          onClick={startRender}
          disabled={rendering || !selected.length || !storyboard}
          style={{ marginBottom: 16 }}
        >
          {rendering ? "Rendering läuft…" : "Rendering starten"}
        </button>
      )}

      {/* Fortschrittsbalken */}
      {rendering && (
        <div aria-live="polite" style={{ marginBottom: 12 }}>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <p style={{ color: "#4fc3f7", fontSize: 13, margin: "6px 0 0" }}>{message}</p>
        </div>
      )}

      {/* Debug-Konsole */}
      {(rendering || log.length > 0) && (
        <div style={{ marginTop: 12 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: "2px 12px", marginBottom: 8 }}
            onClick={() => setShowLog((v) => !v)}
          >
            {showLog ? "▲ Konsole ausblenden" : "▼ Debug-Konsole anzeigen"}
            {log.length > 0 && ` (${log.length} Zeilen)`}
          </button>
          {showLog && (
            <div
              style={{
                background: "#0d0d1a",
                border: "1px solid #333",
                borderRadius: 6,
                padding: "10px 14px",
                maxHeight: 280,
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: 12,
                color: "#b0bec5",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {log.map((line, i) => (
                <div key={i} style={{ lineHeight: 1.6 }}>{line}</div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "#ef5350", fontSize: 14, marginTop: 12 }}>Fehler: {error}</p>
      )}

      {/* Download-Links */}
      {done && (
        <div style={{ marginTop: 16 }}>
          <p style={{ color: "#66bb6a", fontWeight: 600 }}>✓ Rendering abgeschlossen!</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {selected.map((lang) => (
              <a
                key={lang}
                href={`${backendBase}/api/videos/${videoId}/output/tutorial_${lang}.mp4`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary"
                style={{ textDecoration: "none", display: "inline-flex", width: "fit-content" }}
                download={`tutorial_${lang}.mp4`}
              >
                ⬇ tutorial_{lang}.mp4 herunterladen
              </a>
            ))}
          </div>
          {log.length > 0 && (
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: "2px 12px", marginTop: 12 }}
              onClick={() => setShowLog((v) => !v)}
            >
              {showLog ? "▲ Konsole ausblenden" : "▼ Render-Log anzeigen"}
            </button>
          )}
          {showLog && log.length > 0 && (
            <div
              style={{
                background: "#0d0d1a",
                border: "1px solid #333",
                borderRadius: 6,
                padding: "10px 14px",
                maxHeight: 280,
                overflowY: "auto",
                fontFamily: "monospace",
                fontSize: 12,
                color: "#b0bec5",
                whiteSpace: "pre-wrap",
                marginTop: 8,
              }}
            >
              {log.map((line, i) => <div key={i} style={{ lineHeight: 1.6 }}>{line}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
