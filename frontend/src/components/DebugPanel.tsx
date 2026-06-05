import React, { useState, useCallback } from "react";

interface DebugInfo {
  app: {
    version: string;
    isPackaged: boolean;
    platform: string;
    arch: string;
    osArch: string;
    osPlatform: string;
    osRelease: string;
    nodeVersion: string;
    electronVersion: string;
  };
  paths: {
    userLocalDir: string;
    userEnvFile: string;
    envExists: boolean;
    venvPython: string;
    venvExists: boolean;
    ffmpegExe: string;
    ffmpegExists: boolean;
    backendCwd: string;
    workspaceTmp: string;
    logDir: string;
  };
  python: { version: string; arch: string };
  ffmpeg: { arch: string };
  backend: { reachable: boolean; error: string; url: string };
  workspace: Record<string, string>;
  logs: string[];
}

interface Props {
  onClose: () => void;
}

export default function DebugPanel({ onClose }: Props): React.ReactElement {
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [cacheResults, setCacheResults] = useState<string[] | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCacheResults(null);
    try {
      const result = await (window as any).debugAPI?.getInfo();
      if (!result) {
        setError("debugAPI nicht verfügbar – nur im Electron-Modus nutzbar.");
        return;
      }
      setInfo(result as DebugInfo);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const clearCache = useCallback(async () => {
    setClearingCache(true);
    setCacheResults(null);
    try {
      const results = await (window as any).debugAPI?.clearCache() ?? [];
      setCacheResults(results);
      // Info neu laden um aktuellen Workspace-Stand zu zeigen
      const result = await (window as any).debugAPI?.getInfo();
      if (result) setInfo(result as DebugInfo);
    } catch (e: unknown) {
      setCacheResults([`Fehler: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setClearingCache(false);
    }
  }, []);

  const statusDot = (ok: boolean) => (
    <span style={{ ...s.dot, background: ok ? "#66bb6a" : "#ef5350" }} />
  );

  const row = (label: string, value: React.ReactNode, warn = false) => (
    <div style={s.infoRow} key={label}>
      <span style={s.infoLabel}>{label}</span>
      <span style={{ ...s.infoValue, color: warn ? "#ffb74d" : "#e0e0e0" }}>{value}</span>
    </div>
  );

  return (
    <div style={s.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={s.panel}>

        {/* Header */}
        <div style={s.header}>
          <span style={s.title}>Debug & Diagnose</span>
          <button style={s.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Toolbar */}
        <div style={s.toolbar}>
          <button style={s.btnPrimary} onClick={load} disabled={loading}>
            {loading ? "Lade…" : info ? "Neu laden" : "Diagnose starten"}
          </button>
          <button
            style={{ ...s.btnWarn, ...(clearingCache ? s.btnDisabled : {}) }}
            onClick={clearCache}
            disabled={clearingCache || !info}
            title="Löscht Electron-Cache, Electron-Storage und workspace/tmp"
          >
            {clearingCache ? "Lösche…" : "Cache & tmp leeren"}
          </button>
          {info?.paths.logDir && (
            <button style={s.btnSecondary}
              onClick={() => (window as any).debugAPI?.openLogDir()}
            >
              Logs öffnen
            </button>
          )}
          {info?.paths.envExists && (
            <button style={s.btnSecondary}
              onClick={() => (window as any).debugAPI?.openEnvFile()}
            >
              .env öffnen
            </button>
          )}
        </div>

        {/* Cache-Ergebnis */}
        {cacheResults && (
          <div style={s.cacheResult}>
            {cacheResults.map((r, i) => (
              <div key={i} style={{ color: r.startsWith("Fehler") ? "#ef9a9a" : "#a5d6a7" }}>
                {r.startsWith("Fehler") ? "✗" : "✓"} {r}
              </div>
            ))}
          </div>
        )}

        {error && <div style={s.errorBox}>{error}</div>}

        <div style={s.scroll}>
          {!info && !loading && !error && (
            <p style={s.hint}>Klicke „Diagnose starten" um Systeminformationen zu laden.</p>
          )}

          {info && (
            <>
              {/* Backend-Status – prominentester Block */}
              <div style={s.section}>
                <div style={{ ...s.sectionTitle, color: info.backend.reachable ? "#66bb6a" : "#ef5350" }}>
                  {statusDot(info.backend.reachable)}
                  Backend {info.backend.reachable ? "erreichbar" : "NICHT erreichbar"}
                </div>
                {row("URL", info.backend.url)}
                {!info.backend.reachable && info.backend.error && (
                  row("Fehler", info.backend.error, true)
                )}
                {!info.backend.reachable && (
                  <div style={s.diagHint}>
                    Mögliche Ursachen:<br />
                    • Python-venv nicht gefunden oder falsche Architektur (arm64 vs x86_64)<br />
                    • initial.sh wurde noch nicht ausgeführt<br />
                    • Backend-Prozess ist abgestürzt (Logs prüfen)<br />
                    • Port 8787 belegt
                  </div>
                )}
              </div>

              {/* App & System */}
              <div style={s.section}>
                <div style={s.sectionTitle}>App & System</div>
                {row("App-Version", `v${info.app.version}`)}
                {row("Paketiert", info.app.isPackaged ? "Ja (Produktion)" : "Nein (Entwicklung)")}
                {row("Plattform", `${info.app.osPlatform} ${info.app.osRelease}`)}
                {row("Architektur (OS)", info.app.osArch,
                  info.app.osPlatform === "darwin" && info.app.osArch !== "arm64")}
                {row("Architektur (Prozess)", info.app.arch,
                  info.app.osPlatform === "darwin" && info.app.arch !== "arm64")}
                {row("Electron", info.app.electronVersion)}
                {row("Node.js", info.app.nodeVersion)}
              </div>

              {/* Python / venv */}
              <div style={s.section}>
                <div style={s.sectionTitle}>
                  {statusDot(info.paths.venvExists)}
                  Python / venv
                </div>
                {row("venv vorhanden", info.paths.venvExists ? "Ja" : "NEIN – initial.sh ausführen!", !info.paths.venvExists)}
                {row("venv Pfad", info.paths.venvPython)}
                {info.paths.venvExists && row("Python Version", info.python.version)}
                {info.paths.venvExists && row(
                  "Python Architektur", info.python.arch,
                  info.app.osPlatform === "darwin" && info.python.arch !== "arm64"
                )}
                {info.paths.venvExists && info.app.osPlatform === "darwin"
                  && info.python.arch !== "arm64" && (
                  <div style={s.diagHint}>
                    ⚠ Python läuft als {info.python.arch} statt arm64 (Rosetta).<br />
                    Lösung: venv löschen und initial.sh mit nativem arm64-Python neu ausführen.<br />
                    <code>rm -rf "{info.paths.venvPython.replace(/\/bin\/python$/, "")}"</code>
                  </div>
                )}
              </div>

              {/* FFmpeg */}
              <div style={s.section}>
                <div style={s.sectionTitle}>
                  {statusDot(info.paths.ffmpegExists)}
                  FFmpeg
                </div>
                {row("Vorhanden", info.paths.ffmpegExists ? "Ja" : "NEIN – initial.sh ausführen!", !info.paths.ffmpegExists)}
                {row("Pfad", info.paths.ffmpegExe)}
                {info.paths.ffmpegExists && row("Architektur", info.ffmpeg.arch,
                  info.app.osPlatform === "darwin" && !info.ffmpeg.arch.includes("arm64"))}
              </div>

              {/* Pfade */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Pfade</div>
                {row("Benutzerverzeichnis", info.paths.userLocalDir)}
                {row(".env Datei", info.paths.userEnvFile)}
                {row(".env vorhanden", info.paths.envExists ? "Ja" : "NEIN", !info.paths.envExists)}
                {row("Backend CWD", info.paths.backendCwd)}
                {row("Log-Verzeichnis", info.paths.logDir)}
              </div>

              {/* Workspace */}
              <div style={s.section}>
                <div style={s.sectionTitle}>Workspace</div>
                {Object.entries(info.workspace).map(([dir, status]) =>
                  row(dir, status, status === "fehlt")
                )}
              </div>

              {/* Log-Dateien */}
              {info.logs.length > 0 && (
                <div style={s.section}>
                  <div style={s.sectionTitle}>Letzte Log-Dateien</div>
                  {info.logs.map((f) => (
                    <div key={f} style={s.logEntry}>{f}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    zIndex: 1100,
    overflowY: "auto",
    paddingTop: 40,
    paddingBottom: 40,
  },
  panel: {
    background: "#131c2e",
    borderRadius: 10,
    width: 700,
    maxWidth: "96vw",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 8px 40px rgba(0,0,0,0.7)",
    maxHeight: "88vh",
    border: "1px solid #2a3a5c",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 20px",
    borderBottom: "1px solid #2a3a5c",
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: "#ffb74d",
    letterSpacing: 0.5,
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#aaa",
    fontSize: 18,
    cursor: "pointer",
    padding: "2px 6px",
    lineHeight: 1,
  },
  toolbar: {
    display: "flex",
    gap: 8,
    padding: "12px 20px",
    borderBottom: "1px solid #1e2a45",
    flexWrap: "wrap",
  },
  btnPrimary: {
    background: "#1565c0",
    border: "none",
    color: "#fff",
    padding: "6px 16px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  btnWarn: {
    background: "transparent",
    border: "1px solid #e65100",
    color: "#ffb74d",
    padding: "6px 16px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
  },
  btnSecondary: {
    background: "transparent",
    border: "1px solid #444",
    color: "#90caf9",
    padding: "6px 14px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  cacheResult: {
    background: "#0d1a2e",
    padding: "10px 20px",
    fontSize: 12,
    fontFamily: "monospace",
    borderBottom: "1px solid #1e2a45",
    lineHeight: 1.7,
  },
  errorBox: {
    background: "#2d0f0f",
    color: "#ef9a9a",
    padding: "10px 20px",
    fontSize: 13,
    borderBottom: "1px solid #4a1c1c",
  },
  scroll: {
    overflowY: "auto",
    flex: 1,
    padding: "12px 20px 20px",
  },
  hint: {
    color: "#666",
    fontSize: 13,
    textAlign: "center",
    marginTop: 32,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    color: "#90caf9",
    marginBottom: 8,
    borderBottom: "1px solid #1e2a45",
    paddingBottom: 4,
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    display: "inline-block",
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  infoRow: {
    display: "flex",
    gap: 10,
    marginBottom: 4,
    alignItems: "flex-start",
  },
  infoLabel: {
    width: 200,
    flexShrink: 0,
    fontSize: 12,
    color: "#888",
    textAlign: "right" as const,
    paddingTop: 1,
  },
  infoValue: {
    flex: 1,
    fontSize: 12,
    fontFamily: "monospace",
    wordBreak: "break-all" as const,
    color: "#e0e0e0",
  },
  diagHint: {
    marginTop: 8,
    marginLeft: 210,
    background: "#1e1400",
    border: "1px solid #5d4000",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 12,
    color: "#ffcc80",
    lineHeight: 1.7,
  },
  logEntry: {
    fontSize: 12,
    fontFamily: "monospace",
    color: "#aaa",
    paddingLeft: 210,
    marginBottom: 2,
  },
};
