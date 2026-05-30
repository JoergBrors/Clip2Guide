import React, { useEffect, useState } from "react";
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
                className="card"
                style={{
                  cursor: "pointer",
                  padding: "10px 12px",
                  marginBottom: 8,
                  border: activeScene === i ? "1px solid #4fc3f7" : "1px solid #2a2a4a",
                  fontSize: 13,
                }}
              >
                <div style={{ color: "#90caf9", fontWeight: 600 }}>Szene {i + 1}</div>
                <div style={{ color: "#666", fontSize: 11, marginTop: 2 }}>{s.duration_seconds.toFixed(1)}s</div>
              </div>
            ))}
          </div>

          {/* Editor */}
          <div style={{ flex: 1 }}>
            {scene && (
              <div className="card">
                <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
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

      {storyboard && showJson && (
        <JsonPreview storyboard={storyboard} onChange={setStoryboard} />
      )}
    </div>
  );
}
