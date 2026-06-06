import React, { useState, useEffect, useRef } from "react";

type Provider = "gemini" | "openai" | "azure_openai" | "azure_cognitive";

interface ProviderConfig {
  label: string;
  fields: Array<{ key: string; label: string; placeholder?: string }>;
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  gemini: {
    label: "Google Gemini",
    fields: [
      { key: "GEMINI_API_KEY", label: "API Key", placeholder: "AIza..." },
    ],
  },
  openai: {
    label: "OpenAI",
    fields: [
      { key: "OPENAI_API_KEY", label: "API Key", placeholder: "sk-..." },
    ],
  },
  azure_openai: {
    label: "Azure OpenAI",
    fields: [
      { key: "AZURE_OPENAI_API_KEY", label: "API Key", placeholder: "" },
      { key: "AZURE_OPENAI_ENDPOINT", label: "Endpoint", placeholder: "https://<resource>.openai.azure.com/" },
      { key: "AZURE_OPENAI_DEPLOYMENT", label: "Deployment Name", placeholder: "gpt-4.1-mini" },
    ],
  },
  azure_cognitive: {
    label: "Azure Cognitive Services",
    fields: [
      { key: "AZURE_COGNITIVE_API_KEY", label: "API Key", placeholder: "" },
      { key: "AZURE_COGNITIVE_ENDPOINT", label: "Endpoint", placeholder: "https://<resource>.cognitiveservices.azure.com/" },
      { key: "AZURE_COGNITIVE_DEPLOYMENT", label: "Deployment Name", placeholder: "gpt-5-mini" },
    ],
  },
};

const _isMac = navigator.platform.toLowerCase().includes("mac") ||
  (navigator as any).userAgentData?.platform?.toLowerCase() === "macos";

const DEFAULT_ENV_KEYS: Record<string, string> = {
  AI_PROVIDER: "gemini",
  GEMINI_MODEL: "gemini-2.5-flash",
  OPENAI_MODEL: "gpt-4.1",
  AZURE_OPENAI_DEPLOYMENT: "gpt-4.1-mini",
  AZURE_OPENAI_API_VERSION: "2025-01-01-preview",
  AZURE_COGNITIVE_DEPLOYMENT: "gpt-5-mini",
  AZURE_COGNITIVE_API_VERSION: "2025-04-01-preview",
  FFMPEG_PATH: _isMac ? "./tools/ffmpeg/bin/ffmpeg" : "./tools/ffmpeg/bin/ffmpeg.exe",
  FFPROBE_PATH: _isMac ? "./tools/ffmpeg/bin/ffprobe" : "./tools/ffmpeg/bin/ffprobe.exe",
  AUTO_EDITOR_PATH: _isMac
    ? "./tools/auto-editor/auto-editor-macos-arm64"
    : "./tools/auto-editor/auto-editor-windows-x86_64.exe",
  WORKSPACE_ROOT: "./workspace",
  AI_RETRY_MAX_ATTEMPTS: "3",
  AI_RETRY_INITIAL_DELAY: "10",
  AI_RETRY_BACKOFF_FACTOR: "2.0",
  AI_RETRY_MAX_DELAY: "60",
};

type Step = "welcome" | "provider" | "done";

export default function SetupWizard({ onComplete }: { onComplete: () => void }): React.ReactElement {
  const [step, setStep] = useState<Step>("welcome");
  const [logs, setLogs] = useState<string[]>([]);
  const [initialRunning, setInitialRunning] = useState(false);
  const [initialDone, setInitialDone] = useState(false);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider>("gemini");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function startInitial() {
    setInitialRunning(true);
    setInitialError(null);
    setLogs([]);

    const removeListener = window.setupAPI.onLog((msg) => {
      setLogs((prev) => [...prev, msg]);
    });

    try {
      await window.setupAPI.runInitial();
      setInitialDone(true);
    } catch (err: unknown) {
      setInitialError(err instanceof Error ? err.message : String(err));
    } finally {
      removeListener();
      setInitialRunning(false);
    }
  }

  function setField(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  async function writeAndFinish() {
    setWriting(true);
    setWriteError(null);
    try {
      const existing = await window.setupAPI.readEnv().catch(() => ({}));
      const values: Record<string, string> = { ...DEFAULT_ENV_KEYS, ...existing };

      // Provider setzen
      values["AI_PROVIDER"] = selectedProvider;

      // Felder des gewählten Providers eintragen
      for (const field of PROVIDERS[selectedProvider].fields) {
        const v = fieldValues[field.key]?.trim() ?? "";
        if (v) values[field.key] = v;
      }

      await window.setupAPI.writeEnv(values);
      setStep("done");
    } catch (err: unknown) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriting(false);
    }
  }

  function finish() {
    window.setupAPI.complete();
    onComplete();
  }

  // ── Styles ─────────────────────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    background: "#1a1a2e",
    color: "#e0e0e0",
    fontFamily: "system-ui, sans-serif",
    padding: "2rem",
  };

  const cardStyle: React.CSSProperties = {
    background: "#16213e",
    borderRadius: "12px",
    padding: "2.5rem",
    width: "100%",
    maxWidth: "640px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
  };

  const titleStyle: React.CSSProperties = {
    fontSize: "1.6rem",
    fontWeight: 700,
    marginBottom: "0.5rem",
    color: "#e2e8f0",
  };

  const subtitleStyle: React.CSSProperties = {
    color: "#94a3b8",
    marginBottom: "1.5rem",
    fontSize: "0.95rem",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "0.7rem 1.6rem",
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "1rem",
    fontWeight: 600,
  };

  const btnSecondary: React.CSSProperties = {
    ...btnPrimary,
    background: "#334155",
  };

  const logBoxStyle: React.CSSProperties = {
    background: "#0f172a",
    borderRadius: "8px",
    padding: "1rem",
    maxHeight: "200px",
    overflowY: "auto",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    color: "#86efac",
    marginBottom: "1.5rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.6rem 0.8rem",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "6px",
    color: "#e2e8f0",
    fontSize: "0.9rem",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    marginBottom: "0.25rem",
    fontSize: "0.85rem",
    color: "#94a3b8",
  };

  // ── Render Steps ────────────────────────────────────────────────────────────

  if (step === "welcome") {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>Willkommen bei Clip2Guide</h1>
          <p style={subtitleStyle}>
            Erster Start erkannt. Die Einrichtung lädt notwendige Abhängigkeiten
            (Python, FFmpeg, Auto-Editor) und konfiguriert deine AI-Provider-Zugangsdaten.
          </p>
          <p style={{ color: "#fbbf24", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
            ⚠ Der erste Schritt lädt ca. 200–400 MB herunter. Bitte stelle sicher,
            dass du eine stabile Internetverbindung hast.
          </p>

          {logs.length > 0 && (
            <div style={logBoxStyle}>
              {logs.map((l, i) => <div key={i}>{l}</div>)}
              <div ref={logEndRef} />
            </div>
          )}

          {initialError && (
            <div style={{ background: "#450a0a", borderRadius: "8px", padding: "0.8rem", color: "#fca5a5", marginBottom: "1rem", fontSize: "0.85rem" }}>
              ❌ {initialError}
            </div>
          )}

          <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
            {!initialDone ? (
              <button
                style={{ ...btnPrimary, opacity: initialRunning ? 0.6 : 1 }}
                disabled={initialRunning}
                onClick={startInitial}
              >
                {initialRunning ? "Einrichtung läuft …" : "Einrichtung starten"}
              </button>
            ) : (
              <button style={btnPrimary} onClick={() => setStep("provider")}>
                Weiter →
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step === "provider") {
    const cfg = PROVIDERS[selectedProvider];
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h1 style={titleStyle}>AI-Provider konfigurieren</h1>
          <p style={subtitleStyle}>
            Wähle deinen AI-Provider und trage die API-Zugangsdaten ein.
            Diese werden sicher in deinem persönlichen Benutzerverzeichnis gespeichert
            und <strong>nie</strong> in das Git-Repository übernommen.
          </p>

          <div style={{ marginBottom: "1.5rem" }}>
            <label style={labelStyle}>AI-Provider</label>
            <select
              aria-label="AI-Provider auswählen"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value as Provider)}
              style={{ ...inputStyle }}
            >
              {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
                <option key={p} value={p}>{PROVIDERS[p].label}</option>
              ))}
            </select>
          </div>

          {cfg.fields.map((f) => (
            <div key={f.key} style={{ marginBottom: "1rem" }}>
              <label style={labelStyle}>{f.label}</label>
              <input
                type="password"
                value={fieldValues[f.key] ?? ""}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                style={inputStyle}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ))}

          {writeError && (
            <div style={{ background: "#450a0a", borderRadius: "8px", padding: "0.8rem", color: "#fca5a5", marginBottom: "1rem", fontSize: "0.85rem" }}>
              ❌ {writeError}
            </div>
          )}

          <div style={{ display: "flex", gap: "1rem", justifyContent: "space-between", marginTop: "1.5rem" }}>
            <button style={btnSecondary} onClick={() => setStep("welcome")}>← Zurück</button>
            <button
              style={{ ...btnPrimary, opacity: writing ? 0.6 : 1 }}
              disabled={writing}
              onClick={writeAndFinish}
            >
              {writing ? "Speichern …" : "Speichern & Fertigstellen"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // done
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>✅ Einrichtung abgeschlossen</h1>
        <p style={subtitleStyle}>
          Clip2Guide ist jetzt eingerichtet. Beim nächsten Start öffnet sich
          direkt die Hauptanwendung.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button style={btnPrimary} onClick={finish}>Clip2Guide starten →</button>
        </div>
      </div>
    </div>
  );
}
