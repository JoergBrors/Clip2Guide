import React, { useEffect, useMemo, useState } from "react";
import { api, StoryboardJson, Scene, TextPanel, subscribeToJob, JobEvent } from "../api/backendClient";
import JsonPreview from "./JsonPreview";

interface Props {
  videoId: string;
  selectedFrames?: string[];
  onDone: () => void;
}

const DEFAULT_LANGUAGES = ["de", "en"];

export default function SceneEditor({ videoId, selectedFrames, onDone }: Props): React.ReactElement {
  const [storyboard, setStoryboard] = useState<StoryboardJson | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState("");
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string[]>(DEFAULT_LANGUAGES);
  const [activeScene, setActiveScene] = useState<number>(0);
  const [activeLang, setActiveLang] = useState<string>(DEFAULT_LANGUAGES[0]);
  const [showJson, setShowJson] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hover-Zoom-Vorschau
  const [hoveredImg, setHoveredImg] = useState<{ src: string; x: number; y: number } | null>(null);

  // Drag-and-Drop: Bild zwischen Szenen verschieben
  const [dragInfo, setDragInfo] = useState<{ filename: string; fromScene: number } | null>(null);
  const [dragOverScene, setDragOverScene] = useState<number | null>(null);

  // KI Szene neu schreiben
  const [rewritingScene, setRewritingScene] = useState(false);
  const [rewriteMsg, setRewriteMsg] = useState("");
  const [rewriteProgress, setRewriteProgress] = useState(0);

  // Provider / Modell-Auswahl
  const [provider, setProvider] = useState<"gemini" | "openai">("gemini");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // Modelle laden wenn Provider gewechselt wird
  useEffect(() => {
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

  useEffect(() => {
    api.getStoryboard(videoId)
      .then(setStoryboard)
      .catch(() => { /* noch nicht erstellt */ });
  }, [videoId]);

  async function runAnalyze() {
    setAnalyzing(true);
    setError(null);
    try {
      const { job_id } = await api.analyzeVideo(videoId, languages, provider, selectedModel || undefined, selectedFrames?.length ? selectedFrames : undefined);
      subscribeToJob(job_id, (ev: JobEvent) => {
        setAnalyzeMsg(ev.message);
        setAnalyzeProgress(ev.percent);
        if (ev.type === "completed") {
          setAnalyzing(false);
          api.getStoryboard(videoId).then(setStoryboard).catch(console.error);
        } else if (ev.type === "error") {
          setAnalyzing(false);
          setError(ev.message);
        }
      });
    } catch (e: unknown) {
      setAnalyzing(false);
      setError(e instanceof Error ? e.message : "Analyse fehlgeschlagen");
    }
  }

  function updateTextPanel(sceneIdx: number, lang: string, field: keyof TextPanel, value: string) {
    if (!storyboard) return;
    const updated = { ...storyboard };
    const scene = { ...updated.scenes[sceneIdx] };
    scene.texts = { ...scene.texts, [lang]: { ...scene.texts[lang], [field]: value } };
    updated.scenes = [...updated.scenes];
    updated.scenes[sceneIdx] = scene;
    setStoryboard(updated);
  }

  function removeFrameFromScene(sceneIdx: number, filename: string) {
    if (!storyboard) return;
    const updated = { ...storyboard, scenes: [...storyboard.scenes] };
    const s = { ...updated.scenes[sceneIdx] };
    s.image_group = s.image_group.filter((f) => f !== filename);
    if (s.start_frame === filename) s.start_frame = s.image_group[0] ?? "";
    if (s.end_frame === filename) s.end_frame = s.image_group[s.image_group.length - 1] ?? null;
    updated.scenes[sceneIdx] = s;
    setStoryboard(updated);
  }

  function moveFrameToScene(fromIdx: number, toIdx: number, filename: string) {
    if (!storyboard) return;
    const updated = { ...storyboard, scenes: [...storyboard.scenes] };
    const from = { ...updated.scenes[fromIdx] };
    from.image_group = from.image_group.filter((f) => f !== filename);
    updated.scenes[fromIdx] = from;
    const to = { ...updated.scenes[toIdx] };
    to.image_group = [...to.image_group, filename].sort();
    updated.scenes[toIdx] = to;
    setStoryboard(updated);
  }

  function handleImgHover(src: string, e: React.MouseEvent) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const PW = 320, PH = 200, OFF = 14;
    let x = e.clientX + OFF;
    let y = e.clientY + OFF;
    if (x + PW > vw - 8) x = e.clientX - PW - OFF;
    if (y + PH > vh - 8) y = e.clientY - PH - OFF;
    setHoveredImg({ src, x, y });
  }

  function handleDragStart(e: React.DragEvent, filename: string, fromScene: number) {
    setDragInfo({ filename, fromScene });
    e.dataTransfer.effectAllowed = "move";
  }

  function handleSceneDrop(e: React.DragEvent, toIdx: number) {
    e.preventDefault();
    setDragOverScene(null);
    if (!dragInfo || dragInfo.fromScene === toIdx) { setDragInfo(null); return; }
    moveFrameToScene(dragInfo.fromScene, toIdx, dragInfo.filename);
    setDragInfo(null);
  }

  async function runRewriteScene() {
    if (!storyboard || !scene) return;
    setRewritingScene(true);
    setRewriteMsg("");
    setRewriteProgress(0);
    setError(null);
    try {
      const langs = storyboard.languages.length ? storyboard.languages : languages;
      const { job_id } = await api.rewriteScene(
        videoId, scene.scene_id, scene.image_group, langs,
        provider, selectedModel || undefined
      );
      subscribeToJob(job_id, (ev: JobEvent) => {
        setRewriteMsg(ev.message);
        setRewriteProgress(ev.percent);
        if (ev.type === "completed" && ev.data) {
          setRewritingScene(false);
          const texts = ev.data.texts as Record<string, TextPanel>;
          const updated = { ...storyboard, scenes: [...storyboard.scenes] };
          const s = { ...updated.scenes[activeScene], texts: { ...updated.scenes[activeScene].texts, ...texts } };
          updated.scenes[activeScene] = s;
          setStoryboard(updated);
        } else if (ev.type === "error") {
          setRewritingScene(false);
          setError(ev.message);
        }
      });
    } catch (e: unknown) {
      setRewritingScene(false);
      setError(e instanceof Error ? e.message : "Neu-Schreiben fehlgeschlagen");
    }
  }

  async function saveStoryboard() {
    if (!storyboard) return;
    setSaving(true);
    try {
      await api.updateStoryboard(videoId, storyboard);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  const scene: Scene | undefined = storyboard?.scenes[activeScene];
  const panel: TextPanel | undefined = scene?.texts[activeLang];

  const otherFrames = useMemo(() => {
    if (!storyboard) return [];
    const result: { filename: string; fromScene: number }[] = [];
    storyboard.scenes.forEach((s, i) => {
      if (i !== activeScene) {
        s.image_group.forEach((f) => result.push({ filename: f, fromScene: i }));
      }
    });
    return result;
  }, [storyboard, activeScene]);

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16, gap: 12 }}>
          <h2 style={{ margin: 0, color: "#4fc3f7" }}>Storyboard-Editor</h2>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowJson(!showJson)}>
              {showJson ? "Editor" : "JSON"}
            </button>
            {storyboard && <button className="btn btn-primary" onClick={saveStoryboard} disabled={saving}>
              {saving ? "Speichern..." : "Speichern"}
            </button>}
            {storyboard && <button className="btn btn-success" onClick={onDone}>Weiter → Rendering</button>}
          </div>
        </div>

        {!storyboard && !analyzing && (
          <>
            <p style={{ color: "#aaa" }}>Noch kein Storyboard. KI-Analyse starten:</p>

            {/* Provider-Auswahl */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "#90caf9", minWidth: 80 }}>Provider:</span>
              {(["gemini", "openai"] as const).map((p) => (
                <button
                  key={p}
                  className={`btn ${provider === p ? "btn-primary" : "btn-ghost"}`}
                  style={{ fontSize: 13, padding: "4px 16px", textTransform: "capitalize" }}
                  onClick={() => setProvider(p)}
                >
                  {p === "gemini" ? "🤖 Google Gemini" : "🧠 OpenAI"}
                </button>
              ))}
            </div>

            {/* Modell-Auswahl */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "#90caf9", minWidth: 80 }}>Modell:</span>
              {modelsLoading && <span style={{ fontSize: 12, color: "#666" }}>Lädt...</span>}
              {modelsError && <span style={{ fontSize: 12, color: "#ef5350" }}>⚠ {modelsError}</span>}
              {!modelsLoading && !modelsError && (
                <select
                  aria-label="KI-Modell auswählen"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{ fontSize: 13, padding: "4px 8px", background: "#1a1a2e", color: "#e0e0e0", border: "1px solid #333", borderRadius: 4, minWidth: 220 }}
                >
                  {availableModels.map((m, i) => (
                    <option key={m} value={m}>
                      {i + 1}. {m}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Sprachen */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <label htmlFor="lang-input" style={{ fontSize: 13, color: "#90caf9", minWidth: 80 }}>Sprachen:</label>
              <input
                id="lang-input"
                type="text"
                value={languages.join(",")}
                onChange={(e) => setLanguages(e.target.value.split(",").map(l => l.trim()).filter(Boolean))}
                placeholder="de,en"
                style={{ width: 160 }}
              />
              <span style={{ fontSize: 12, color: "#888" }}>ISO-Codes, kommagetrennt</span>
            </div>

            <button
              className="btn btn-primary"
              onClick={runAnalyze}
              disabled={modelsLoading || !selectedModel}
            >
              KI-Analyse starten
            </button>
          </>
        )}

        {analyzing && (
          <div aria-live="polite">
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${analyzeProgress}%` }} />
            </div>
            <p style={{ color: "#4fc3f7", fontSize: 13 }}>{analyzeMsg}</p>
          </div>
        )}

        {error && <p role="alert" style={{ color: "#ef5350" }}>Fehler: {error}</p>}
      </div>

      {storyboard && !showJson && (
        <div style={{ display: "flex", gap: 16 }}>
          {/* Szenen-Liste */}
          <div style={{ width: 200, flexShrink: 0 }}>
            {storyboard.scenes.map((s, i) => (
              <div
                key={s.scene_id}
                role="button"
                tabIndex={0}
                onClick={() => setActiveScene(i)}
                onKeyDown={(e) => e.key === "Enter" && setActiveScene(i)}
                onDragOver={(e) => { e.preventDefault(); setDragOverScene(i); }}
                onDragLeave={() => setDragOverScene(null)}
                onDrop={(e) => handleSceneDrop(e, i)}
                className="card"
                style={{
                  cursor: "pointer",
                  padding: "10px 12px",
                  marginBottom: 8,
                  border: dragOverScene === i
                    ? "2px solid #4fc3f7"
                    : activeScene === i
                    ? "1px solid #4fc3f7"
                    : "1px solid #2a2a4a",
                  background: dragOverScene === i ? "rgba(79,195,247,0.08)" : undefined,
                  transition: "border 0.15s, background 0.15s",
                  fontSize: 13,
                }}
              >
                {s.image_group[0] && (
                  <img
                    src={api.frameImageUrl(videoId, s.image_group[0])}
                    alt={`Szene ${i + 1}`}
                    style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 3, marginBottom: 5, display: "block" }}
                  />
                )}
                <div style={{ color: "#90caf9", fontWeight: 600 }}>Szene {i + 1}</div>
                <div style={{ color: "#666", fontSize: 11, marginTop: 2 }}>{s.duration_seconds.toFixed(1)}s · {s.image_group.length} Bilder</div>
              </div>
            ))}
          </div>

          {/* Editor */}
          <div style={{ flex: 1 }}>
            {scene && (
              <div className="card">
                {/* Sprach-Tabs + KI-Rewrite-Button */}
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
                  {(storyboard.languages.length ? storyboard.languages : languages).map((lang) => (
                    <button
                      key={lang}
                      className={`btn ${activeLang === lang ? "btn-primary" : "btn-ghost"}`}
                      style={{ padding: "4px 12px", fontSize: 13 }}
                      onClick={() => setActiveLang(lang)}
                    >
                      {lang.toUpperCase()}
                    </button>
                  ))}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                    {rewritingScene && (
                      <span style={{ fontSize: 12, color: "#4fc3f7" }}>{rewriteMsg || "Analysiere…"}</span>
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: "4px 12px", borderColor: "#4fc3f7", color: "#4fc3f7" }}
                      onClick={runRewriteScene}
                      disabled={rewritingScene || scene.image_group.length === 0}
                      title={`KI schreibt Szene neu (${provider} / ${selectedModel || "Standard"})`}
                    >
                      {rewritingScene ? `⏳ ${rewriteProgress}%` : "🤖 KI: Szene neu schreiben"}
                    </button>
                  </div>
                </div>

                {/* Bilder-Gruppe */}
                <div style={{ marginBottom: 14, padding: "10px 12px", background: "#0a0f1a", borderRadius: 6, border: "1px solid #1a2a3a" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6080a0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                    Bilder dieser Szene ({scene.image_group.length}) · ✕ = entfernen · ziehen = verschieben
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, minHeight: 34 }}>
                    {scene.image_group.length === 0 && (
                      <span style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Keine Bilder zugeordnet</span>
                    )}
                    {scene.image_group.map((filename) => {
                      const src = api.frameImageUrl(videoId, filename);
                      return (
                        <div
                          key={filename}
                          draggable
                          style={{ position: "relative", cursor: "grab", flexShrink: 0 }}
                          title={`${filename} – ziehen zum Verschieben, klicken zum Entfernen`}
                          onDragStart={(e) => handleDragStart(e, filename, activeScene)}
                          onDragEnd={() => setDragInfo(null)}
                          onClick={() => removeFrameFromScene(activeScene, filename)}
                          onMouseEnter={(e) => handleImgHover(src, e)}
                          onMouseMove={(e) => handleImgHover(src, e)}
                          onMouseLeave={() => setHoveredImg(null)}
                        >
                          <img
                            src={src}
                            alt={filename}
                            style={{ width: 88, height: 50, objectFit: "cover", borderRadius: 4, border: "1px solid #2a4a6a", display: "block", pointerEvents: "none" }}
                          />
                          <div style={{
                            position: "absolute", top: 2, right: 2,
                            background: "rgba(180,40,40,0.9)", borderRadius: "50%",
                            width: 14, height: 14, display: "flex", alignItems: "center",
                            justifyContent: "center", fontSize: 9, color: "#fff", pointerEvents: "none",
                          }}>✕</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Bilder aus anderen Szenen */}
                  {otherFrames.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, color: "#6080a0", margin: "10px 0 8px", borderTop: "1px solid #1a2a3a", paddingTop: 8, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        Aus anderen Szenen hinzufügen (klicken):
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {otherFrames.map(({ filename, fromScene }) => {
                          const src = api.frameImageUrl(videoId, filename);
                          return (
                            <div
                              key={filename}
                              style={{ position: "relative", cursor: "pointer", flexShrink: 0 }}
                              title={`Von Szene ${fromScene + 1} in diese Szene verschieben`}
                              onClick={() => moveFrameToScene(fromScene, activeScene, filename)}
                              onMouseEnter={(e) => handleImgHover(src, e)}
                              onMouseMove={(e) => handleImgHover(src, e)}
                              onMouseLeave={() => setHoveredImg(null)}
                            >
                              <img
                                src={src}
                                alt={filename}
                                style={{ width: 66, height: 37, objectFit: "cover", borderRadius: 3, border: "1px solid #334", display: "block", pointerEvents: "none", opacity: 0.75 }}
                              />
                              {/* Szenen-Label */}
                              <div style={{
                                position: "absolute", bottom: 0, left: 0, right: 0,
                                background: "rgba(10,20,40,0.85)", fontSize: 9, color: "#90caf9",
                                textAlign: "center", borderRadius: "0 0 3px 3px", padding: "2px 0",
                                fontWeight: 700, letterSpacing: "0.04em", pointerEvents: "none",
                              }}>Szene {fromScene + 1}</div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 13, color: "#90caf9", display: "block", marginBottom: 4 }}>
                      Ueberschrift
                    </label>
                    <input
                      type="text"
                      value={panel?.heading ?? ""}
                      onChange={(e) => updateTextPanel(activeScene, activeLang, "heading", e.target.value)}
                      placeholder="Ueberschrift..."
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 13, color: "#90caf9", display: "block", marginBottom: 4 }}>
                      Beschreibung
                    </label>
                    <textarea
                      rows={3}
                      value={panel?.body ?? ""}
                      onChange={(e) => updateTextPanel(activeScene, activeLang, "body", e.target.value)}
                      placeholder="Beschreibung..."
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 13, color: "#90caf9", display: "block", marginBottom: 4 }}>
                      Sprecher-Notizen (TTS)
                    </label>
                    <textarea
                      rows={2}
                      value={panel?.speaker_notes ?? ""}
                      onChange={(e) => updateTextPanel(activeScene, activeLang, "speaker_notes", e.target.value)}
                      placeholder="Text fuer Text-to-Speech..."
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Hover-Zoom-Vorschau */}
      {hoveredImg && (
        <div
          style={{
            position: "fixed",
            left: hoveredImg.x,
            top: hoveredImg.y,
            width: 320,
            zIndex: 9999,
            pointerEvents: "none",
            borderRadius: 10,
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.85), 0 0 0 1px rgba(79,195,247,0.35)",
            background: "#111",
          }}
        >
          <img src={hoveredImg.src} alt="Vorschau" style={{ width: "100%", display: "block" }} />
        </div>
      )}

      {storyboard && showJson && (
        <JsonPreview storyboard={storyboard} onChange={setStoryboard} />
      )}

      {/* Übergebene Frames – Referenzstreifen */}
      {selectedFrames && selectedFrames.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6080a0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Übergebene Frames ({selectedFrames.length}) – Referenz
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, overflowX: "auto" }}>
            {selectedFrames.map((filename, idx) => {
              const src = api.frameImageUrl(videoId, filename);
              // Welcher Szene ist dieser Frame zugeordnet?
              const assignedScene = storyboard?.scenes.findIndex((s) => s.image_group.includes(filename)) ?? -1;
              return (
                <div
                  key={filename}
                  title={`${filename}${assignedScene >= 0 ? ` → Szene ${assignedScene + 1}` : " (nicht zugeordnet)"}`}
                  style={{ position: "relative", flexShrink: 0 }}
                >
                  <img
                    src={src}
                    alt={`Frame ${idx + 1}`}
                    style={{
                      width: 88,
                      height: 50,
                      objectFit: "cover",
                      borderRadius: 4,
                      border: `1px solid ${assignedScene >= 0 ? "#2a4a6a" : "#6a2a2a"}`,
                      display: "block",
                      opacity: assignedScene >= 0 ? 1 : 0.5,
                    }}
                    onMouseEnter={(e) => handleImgHover(src, e)}
                    onMouseMove={(e) => handleImgHover(src, e)}
                    onMouseLeave={() => setHoveredImg(null)}
                  />
                  {/* Szenen-Badge */}
                  <div style={{
                    position: "absolute",
                    bottom: 2,
                    right: 2,
                    background: assignedScene >= 0 ? "rgba(10,30,60,0.85)" : "rgba(100,20,20,0.9)",
                    color: assignedScene >= 0 ? "#90caf9" : "#ef9090",
                    fontSize: 9,
                    padding: "1px 4px",
                    borderRadius: 3,
                    fontWeight: 700,
                  }}>
                    {assignedScene >= 0 ? `S${assignedScene + 1}` : "?"}
                  </div>
                </div>
              );
            })}
          </div>
          {storyboard && (() => {
            const unassigned = selectedFrames.filter(
              (fn) => !storyboard.scenes.some((s) => s.image_group.includes(fn))
            );
            return unassigned.length > 0 ? (
              <p style={{ marginTop: 8, fontSize: 12, color: "#ef9090" }}>
                ⚠ {unassigned.length} Frame(s) keiner Szene zugeordnet: {unassigned.join(", ")}
              </p>
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}
