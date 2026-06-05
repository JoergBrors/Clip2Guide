import React, { useEffect, useRef, useState } from "react";
import { api, StoryboardJson, subscribeToJob, JobEvent } from "../api/backendClient";

interface Props {
  videoId: string;
  onProjectImported?: (videoId: string) => void;
}

const FPS_OPTIONS = [15, 25, 30] as const;
const QUALITY_OPTIONS = [
  { value: "schnell",    label: "Schnell (CRF 28)" },
  { value: "ausgewogen", label: "Ausgewogen (CRF 23)" },
  { value: "beste",      label: "Beste (CRF 18, langsam)" },
] as const;
type OutputMode = "video" | "manual" | "both";

export default function RenderPanel({ videoId, onProjectImported }: Props): React.ReactElement {
  const [storyboard, setStoryboard] = useState<StoryboardJson | null>(null);
  const [storyboardError, setStoryboardError] = useState<string | null>(null);

  // Sprach-Auswahl (aus Storyboard vorbelegt)
  const [selected, setSelected] = useState<string[]>([]);

  // Render-Optionen
  const [fps, setFps] = useState<number>(25);
  const [quality, setQuality] = useState<string>("ausgewogen");
  const [ttsSlow, setTtsSlow] = useState<boolean>(false);
  const [outputMode, setOutputMode] = useState<OutputMode>("video");
  const [handbookOptimize, setHandbookOptimize] = useState<boolean>(false);
  const [availableProviders, setAvailableProviders] = useState<{ id: string; label: string }[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

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
  const [exportingProject, setExportingProject] = useState(false);
  const [projectExport, setProjectExport] = useState<{ filename: string; message: string } | null>(null);
  const [importingProject, setImportingProject] = useState(false);
  const [projectArchiveError, setProjectArchiveError] = useState<string | null>(null);

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

  useEffect(() => {
    api.getAiProviders()
      .then(({ providers, default: def }) => {
        setAvailableProviders(providers);
        setProvider(def);
      })
      .catch(() => {
        setAvailableProviders([{ id: "gemini", label: "Google Gemini" }]);
        setProvider("gemini");
      });
  }, []);

  useEffect(() => {
    if (!provider) return;
    setModelsLoading(true);
    setModelsError(null);
    setAvailableModels([]);
    setSelectedModel("");
    api.getAiModels(provider)
      .then(({ models, default: def }) => {
        setAvailableModels(models);
        setSelectedModel(def && models.includes(def) ? def : (models[0] ?? ""));
      })
      .catch((e: unknown) => setModelsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setModelsLoading(false));
  }, [provider]);

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
      const outputFormats: Array<"video" | "manual"> = outputMode === "both"
        ? ["video", "manual"]
        : [outputMode];
      const { job_id } = await api.renderVideo(
        videoId,
        selected,
        fps,
        quality,
        ttsSlow,
        outputFormats,
        handbookOptimize,
        handbookOptimize ? provider : undefined,
        handbookOptimize ? selectedModel : undefined,
      );
      subscribeToJob(job_id, (ev: JobEvent) => {
        if (ev.type === "log" || ev.type === "debug") {
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

  async function exportProject() {
    setExportingProject(true);
    setProjectArchiveError(null);
    setProjectExport(null);
    try {
      const result = await api.exportProject(videoId);
      setProjectExport({ filename: result.filename, message: result.message });
    } catch (e: unknown) {
      setProjectArchiveError(e instanceof Error ? e.message : "Projekt-Export fehlgeschlagen");
    } finally {
      setExportingProject(false);
    }
  }

  async function importProject(file: File | null) {
    if (!file) return;
    setImportingProject(true);
    setProjectArchiveError(null);
    try {
      const result = await api.importProjectZip(file, "new_id");
      onProjectImported?.(result.video_id);
    } catch (e: unknown) {
      setProjectArchiveError(e instanceof Error ? e.message : "Projekt-Import fehlgeschlagen");
    } finally {
      setImportingProject(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0, color: "#4fc3f7" }}>Tutorial-Rendering</h2>
      <p style={{ color: "#aaa", fontSize: 14 }}>
        Pro Sprache wird ein Tutorial-Video, ein DOCX-Handbuch oder beides aus dem bestehenden Storyboard erstellt.
      </p>

      {storyboardError && (
        <p role="alert" style={{ color: "#ef5350", fontSize: 13 }}>⚠ {storyboardError}</p>
      )}

      <div style={{ marginBottom: 20, padding: "10px 12px", border: "1px solid #273452", borderRadius: 6, background: "#10182d" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button className="btn btn-ghost" onClick={exportProject} disabled={exportingProject || !storyboard}>
            {exportingProject ? "Projektstand wird gesichert..." : "Projektstand als ZIP sichern"}
          </button>
          <label className="btn btn-ghost" style={{ cursor: importingProject ? "default" : "pointer" }}>
            {importingProject ? "Projektstand wird wiederhergestellt..." : "Projektstand aus ZIP wiederherstellen"}
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={importingProject}
              onChange={(e) => importProject(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
          </label>
          {projectExport && (
            <a
              href={api.projectDownloadUrl(videoId, projectExport.filename)}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
              style={{ textDecoration: "none" }}
              download={projectExport.filename}
            >
              ZIP herunterladen
            </a>
          )}
        </div>
        {projectArchiveError && (
          <p role="alert" style={{ color: "#ef5350", fontSize: 12, margin: "8px 0 0" }}>{projectArchiveError}</p>
        )}
      </div>

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
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 13, minWidth: 130, color: "#bbb" }}>Ausgabeformat:</span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { value: "video", label: "Video" },
                  { value: "manual", label: "Handbuch (DOCX)" },
                  { value: "both", label: "Video + Handbuch" },
                ].map((option) => (
                  <button
                    key={option.value}
                    className={`btn ${outputMode === option.value ? "btn-primary" : "btn-ghost"}`}
                    style={{ fontSize: 13, padding: "3px 14px" }}
                    onClick={() => setOutputMode(option.value as OutputMode)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* FPS */}
            <div style={{ display: outputMode === "manual" ? "none" : "flex", alignItems: "center", gap: 12 }}>
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
            <div style={{ display: outputMode === "manual" ? "none" : "flex", alignItems: "center", gap: 12 }}>
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
            <div style={{ display: outputMode === "manual" ? "none" : "flex", alignItems: "center", gap: 12 }}>
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
            {(outputMode === "manual" || outputMode === "both") && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 13, minWidth: 130, color: "#bbb" }}>Handbuch:</span>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={handbookOptimize}
                      onChange={(e) => setHandbookOptimize(e.target.checked)}
                    />
                    <span style={{ fontSize: 13 }}>KI-Segmentierung ohne Inhaltsaenderung</span>
                  </label>
                </div>
                {handbookOptimize && (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, minWidth: 130, color: "#bbb" }}>KI-Provider:</span>
                      {availableProviders.map((p) => (
                        <button
                          key={p.id}
                          className={`btn ${provider === p.id ? "btn-primary" : "btn-ghost"}`}
                          style={{ fontSize: 13, padding: "3px 14px" }}
                          onClick={() => setProvider(p.id)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, minWidth: 130, color: "#bbb" }}>KI-Modell:</span>
                      {modelsLoading && <span style={{ fontSize: 12, color: "#666" }}>Lädt...</span>}
                      {modelsError && <span style={{ fontSize: 12, color: "#ef5350" }}>⚠ {modelsError}</span>}
                      {!modelsLoading && !modelsError && (
                        <select
                          aria-label="KI-Modell fuer Handbuch auswählen"
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          style={{ fontSize: 13, padding: "4px 8px", background: "#1a1a2e", color: "#e0e0e0", border: "1px solid #333", borderRadius: 4, minWidth: 220 }}
                        >
                          {availableModels.map((m, i) => (
                            <option key={m} value={m}>{i + 1}. {m}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </details>
      )}

      {/* Start-Button */}
      {!done && (
        <button
          className="btn btn-success"
          onClick={startRender}
          disabled={rendering || !selected.length || !storyboard || (handbookOptimize && (!provider || !selectedModel || modelsLoading))}
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
              <React.Fragment key={lang}>
                {(outputMode === "video" || outputMode === "both") && (
                  <a
                    href={`${backendBase}/api/videos/${videoId}/output/tutorial_${lang}.mp4`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary"
                    style={{ textDecoration: "none", display: "inline-flex", width: "fit-content" }}
                    download={`tutorial_${lang}.mp4`}
                  >
                    ⬇ tutorial_{lang}.mp4 herunterladen
                  </a>
                )}
                {(outputMode === "manual" || outputMode === "both") && (
                  <a
                    href={`${backendBase}/api/videos/${videoId}/manual/manual_${lang}.docx`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary"
                    style={{ textDecoration: "none", display: "inline-flex", width: "fit-content" }}
                    download={`manual_${lang}.docx`}
                  >
                    ⬇ manual_{lang}.docx herunterladen
                  </a>
                )}
              </React.Fragment>
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
