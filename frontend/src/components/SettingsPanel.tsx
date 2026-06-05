import React, { useState, useEffect } from "react";

const ALL_PROVIDERS = [
  { key: "gemini",            label: "Google Gemini" },
  { key: "openai",            label: "OpenAI" },
  { key: "azure_openai",      label: "Azure OpenAI" },
  { key: "azure_cognitive",   label: "Azure Cognitive Services" },
];

interface Field {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
}

const SECTIONS: Array<{ title: string; fields: Field[] }> = [
  {
    title: "Google Gemini",
    fields: [
      { key: "GEMINI_API_KEY", label: "API Key", placeholder: "AIza...", type: "password" },
      { key: "GEMINI_MODEL", label: "Modell", placeholder: "gemini-2.5-flash" },
    ],
  },
  {
    title: "OpenAI",
    fields: [
      { key: "OPENAI_API_KEY", label: "API Key", placeholder: "sk-...", type: "password" },
      { key: "OPENAI_MODEL", label: "Modell", placeholder: "gpt-4.1" },
    ],
  },
  {
    title: "Azure OpenAI (openai.azure.com)",
    fields: [
      { key: "AZURE_OPENAI_API_KEY", label: "API Key", type: "password" },
      {
        key: "AZURE_OPENAI_ENDPOINT",
        label: "Endpoint",
        placeholder: "https://<resource>.openai.azure.com/",
      },
      { key: "AZURE_OPENAI_DEPLOYMENT", label: "Deployment Name", placeholder: "gpt-4.1-mini" },
      { key: "AZURE_OPENAI_API_VERSION", label: "API Version", placeholder: "2025-01-01-preview" },
    ],
  },
  {
    title: "Azure Cognitive Services (cognitiveservices.azure.com)",
    fields: [
      { key: "AZURE_COGNITIVE_API_KEY", label: "API Key", type: "password" },
      {
        key: "AZURE_COGNITIVE_ENDPOINT",
        label: "Endpoint",
        placeholder: "https://<resource>.cognitiveservices.azure.com/",
      },
      { key: "AZURE_COGNITIVE_DEPLOYMENT", label: "Deployment Name", placeholder: "gpt-5-mini" },
      { key: "AZURE_COGNITIVE_API_VERSION", label: "API Version", placeholder: "2025-04-01-preview" },
    ],
  },
  {
    title: "Sprache & Video",
    fields: [
      { key: "DEFAULT_LANGUAGE", label: "Standard-Sprache", placeholder: "de" },
      { key: "OUTPUT_VIDEO_WIDTH", label: "Video-Breite (px)", placeholder: "1920" },
      { key: "OUTPUT_VIDEO_HEIGHT", label: "Video-Höhe (px)", placeholder: "1080" },
      { key: "FRAME_EXTRACTION_FPS", label: "Frame-Extraktion FPS", placeholder: "0.333" },
    ],
  },
  {
    title: "Auto-Editor",
    fields: [
      {
        key: "AUTO_EDITOR_AUDIO_EDIT",
        label: "Audio-Schwellwert",
        placeholder: "audio:threshold=0.03",
      },
      {
        key: "AUTO_EDITOR_MOTION_EDIT",
        label: "Bewegungs-Schwellwert",
        placeholder: "motion:threshold=0.08",
      },
      { key: "AUTO_EDITOR_MARGIN", label: "Margin", placeholder: "0.5s" },
    ],
  },
  {
    title: "Parallelverarbeitung",
    fields: [
      { key: "MAX_PARALLEL_LANGUAGES", label: "Max. parallele Sprachen", placeholder: "4" },
      { key: "FFMPEG_THREADS_PER_JOB", label: "FFmpeg Threads pro Job", placeholder: "2" },
    ],
  },
];

export default function SettingsPanel({ onClose, onOpenDebug }: { onClose: () => void; onOpenDebug?: () => void }): React.ReactElement {
  const [values, setValues] = useState<Record<string, string>>({});
  const [activeProviders, setActiveProviders] = useState<Set<string>>(new Set(["gemini"]));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoading(true);
    window.setupAPI
      ?.readEnv()
      .then((env) => {
        setValues(env ?? {});
        const raw = (env ?? {})["AI_PROVIDER"] ?? "gemini";
        setActiveProviders(new Set(raw.split(",").map((p) => p.trim()).filter(Boolean)));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleChange(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  function toggleProvider(key: string) {
    setActiveProviders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const providerValue = ALL_PROVIDERS
        .filter((p) => activeProviders.has(p.key))
        .map((p) => p.key)
        .join(",");
      await window.setupAPI?.writeEnv({ ...values, AI_PROVIDER: providerValue });
      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function toggleShow(key: string) {
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.panel}>
        <div style={s.panelHeader}>
          <span style={s.panelTitle}>Einstellungen</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <p style={s.hint}>Lade Einstellungen…</p>
        ) : (
          <div style={s.scrollArea}>

            {/* ── AI Provider Auswahl (Checkboxen) ── */}
            <div style={s.section}>
              <div style={s.sectionTitle}>AI Provider</div>
              <div style={s.providerRow}>
                {ALL_PROVIDERS.map((p) => (
                  <label key={p.key} style={s.providerLabel}>
                    <input
                      type="checkbox"
                      checked={activeProviders.has(p.key)}
                      onChange={() => toggleProvider(p.key)}
                      style={{ accentColor: "#4fc3f7", width: 16, height: 16 }}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>

            {SECTIONS.map((section) => (
              <div key={section.title} style={s.section}>
                <div style={s.sectionTitle}>{section.title}</div>
                {section.fields.map((field) => {
                  const isPassword = field.type === "password";
                  const shown = showPasswords[field.key];
                  return (
                    <div key={field.key} style={s.row}>
                      <label style={s.label}>{field.label}</label>
                      <div style={s.inputWrap}>
                        <input
                          style={s.input}
                          type={isPassword && !shown ? "password" : "text"}
                          value={values[field.key] ?? ""}
                          placeholder={field.placeholder ?? ""}
                          onChange={(e) => handleChange(field.key, e.target.value)}
                        />
                        {isPassword && (
                          <button
                            style={s.eyeBtn}
                            onClick={() => toggleShow(field.key)}
                            title={shown ? "Verbergen" : "Anzeigen"}
                          >
                            {shown ? "🙈" : "👁"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            <p style={s.hint}>
              Änderungen werden in der .env-Datei gespeichert. Ein Neustart der App ist erforderlich, damit alle Änderungen wirksam werden.
            </p>
          </div>
        )}

        {error && <p style={s.errorMsg}>{error}</p>}

        <div style={s.footer}>
          {saved && <span style={s.savedMsg}>✓ Gespeichert</span>}
          <button style={s.debugBtn} onClick={onOpenDebug} title="Debug & Diagnose öffnen">
            🔧 Debug
          </button>
          <button style={s.cancelBtn} onClick={onClose}>Schließen</button>
          <button
            style={{ ...s.saveBtn, ...(saving ? s.saveBtnDisabled : {}) }}
            onClick={handleSave}
            disabled={saving || loading}
          >
            {saving ? "Speichern…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.65)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    zIndex: 1000,
    overflowY: "auto",
    paddingTop: 40,
    paddingBottom: 40,
  },
  panel: {
    background: "#1e2a45",
    borderRadius: 10,
    width: 620,
    maxWidth: "95vw",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
    maxHeight: "85vh",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid #2a3a5c",
  },
  panelTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: "#4fc3f7",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#aaa",
    fontSize: 18,
    cursor: "pointer",
    lineHeight: 1,
    padding: "2px 6px",
  },
  scrollArea: {
    overflowY: "auto",
    padding: "16px 20px",
    flex: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: "#90caf9",
    marginBottom: 10,
    borderBottom: "1px solid #2a3a5c",
    paddingBottom: 4,
  },
  providerRow: {
    display: "flex",
    gap: 24,
    flexWrap: "wrap",
    paddingLeft: 4,
  },
  providerLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    color: "#e0e0e0",
    cursor: "pointer",
    userSelect: "none",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  label: {
    width: 210,
    flexShrink: 0,
    fontSize: 13,
    color: "#ccc",
    textAlign: "right",
  },
  inputWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  input: {
    flex: 1,
    background: "#0f1a30",
    border: "1px solid #334",
    borderRadius: 5,
    color: "#e0e0e0",
    padding: "5px 8px",
    fontSize: 13,
    fontFamily: "monospace",
    outline: "none",
  },
  eyeBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 16,
    padding: "2px 4px",
    lineHeight: 1,
  },
  hint: {
    fontSize: 12,
    color: "#888",
    padding: "0 20px",
    margin: "4px 0 12px",
  },
  errorMsg: {
    color: "#ef9a9a",
    fontSize: 13,
    padding: "0 20px",
    margin: "4px 0",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 20px",
    borderTop: "1px solid #2a3a5c",
    justifyContent: "flex-end",
  },
  savedMsg: {
    color: "#81c784",
    fontSize: 13,
    marginRight: "auto",
  },
  debugBtn: {
    background: "transparent",
    border: "1px solid #5d4000",
    color: "#ffb74d",
    padding: "7px 14px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    marginRight: "auto",
  },
  cancelBtn: {
    background: "transparent",
    border: "1px solid #444",
    color: "#aaa",
    padding: "7px 18px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
  },
  saveBtn: {
    background: "#1565c0",
    border: "none",
    color: "#fff",
    padding: "7px 20px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  saveBtnDisabled: {
    opacity: 0.6,
    cursor: "not-allowed",
  },
};
