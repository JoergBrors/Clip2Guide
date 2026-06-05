import React, { useState, useEffect, useRef } from "react";

export default function UpdateWindow(): React.ReactElement {
  const [logs, setLogs] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateAPI = (window as any).updateAPI;
    if (!updateAPI) return;

    const removeLog = updateAPI.onLog((msg: string) => {
      setLogs((prev) => [...prev, msg]);
    });

    const removeDone = updateAPI.onDone((ok: boolean, err?: string) => {
      setDone(true);
      setSuccess(ok);
      setError(err ?? null);
    });

    return () => { removeLog(); removeDone(); };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  function close() {
    (window as any).updateAPI?.close();
  }

  return (
    <div style={s.container}>
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
      <div style={s.card}>
        <div style={s.header}>
          <span style={s.icon}>{done ? (success ? "✅" : "⚠️") : "⚙️"}</span>
          <div>
            <div style={s.title}>
              {done
                ? success ? "Module aktualisiert" : "Update fehlgeschlagen"
                : "Python-Module werden aktualisiert…"}
            </div>
            <div style={s.subtitle}>
              {done
                ? success
                  ? "Alle Abhängigkeiten sind aktuell. Die App startet gleich."
                  : "Einige Module konnten nicht installiert werden. Die App versucht trotzdem zu starten."
                : "Neue oder geänderte Pakete werden installiert. Bitte warten…"}
            </div>
          </div>
        </div>

        {!done && (
          <div style={s.progress}>
            <div style={s.progressBar} />
          </div>
        )}

        <div style={s.logBox}>
          {logs.map((line, i) => (
            <div
              key={i}
              style={{
                ...s.logLine,
                color: line.includes("FEHLER") || line.includes("error") || line.includes("ERROR")
                  ? "#ef9a9a"
                  : line.startsWith("[requirements]")
                  ? "#90caf9"
                  : "#ccc",
              }}
            >
              {line}
            </div>
          ))}
          {!done && <div style={s.cursor}>▌</div>}
          <div ref={logEndRef} />
        </div>

        {error && (
          <div style={s.errorBox}>
            {error}
          </div>
        )}

        {done && (
          <button type="button" style={s.btn} onClick={close}>
            {success ? "Weiter →" : "Trotzdem starten"}
          </button>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "100vh",
    background: "#0f172a",
    fontFamily: "system-ui, sans-serif",
    padding: "1.5rem",
  },
  card: {
    background: "#1e293b",
    borderRadius: 12,
    padding: "2rem",
    width: "100%",
    maxWidth: 580,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    border: "1px solid #334155",
  },
  header: {
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
    marginBottom: 20,
  },
  icon: {
    fontSize: 36,
    lineHeight: 1,
    flexShrink: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    color: "#e2e8f0",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#94a3b8",
    lineHeight: 1.5,
  },
  progress: {
    height: 4,
    background: "#334155",
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 16,
  },
  progressBar: {
    height: "100%",
    width: "100%",
    background: "linear-gradient(90deg, #3b82f6 0%, #60a5fa 50%, #3b82f6 100%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite linear",
  },
  logBox: {
    background: "#0f172a",
    borderRadius: 8,
    padding: "12px 14px",
    maxHeight: 220,
    overflowY: "auto",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 1.6,
    border: "1px solid #1e293b",
    marginBottom: 16,
  },
  logLine: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
  cursor: {
    color: "#3b82f6",
    animation: "blink 1s step-end infinite",
  },
  errorBox: {
    background: "#450a0a",
    border: "1px solid #7f1d1d",
    borderRadius: 6,
    padding: "8px 12px",
    color: "#fca5a5",
    fontSize: 12,
    marginBottom: 16,
  },
  btn: {
    width: "100%",
    padding: "10px 0",
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
  },
};
