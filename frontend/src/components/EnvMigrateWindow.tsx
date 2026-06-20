import React, { useState, useEffect } from "react";

interface MigrationEntry {
  key: string;
  defaultValue: string;
  comments: string[];
  sensitive: boolean;
}

interface EditableEntry extends MigrationEntry {
  value: string;
  skip: boolean;
  showValue: boolean;
}

export default function EnvMigrateWindow(): React.ReactElement {
  const [entries, setEntries] = useState<EditableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const api = (window as any).envMigrateAPI;
    if (!api) { setLoading(false); return; }
    const examplePath = decodeURIComponent(api.getExamplePath());
    api.checkMigration(examplePath).then((raw: MigrationEntry[]) => {
      setEntries(raw.map((e) => ({ ...e, value: e.defaultValue, skip: false, showValue: false })));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function update(key: string, patch: Partial<EditableEntry>) {
    setEntries((prev) => prev.map((e) => e.key === key ? { ...e, ...patch } : e));
  }

  async function handleSave() {
    const api = (window as any).envMigrateAPI;
    if (!api) return;
    setSaving(true);
    const toWrite = entries
      .filter((e) => !e.skip)
      .map(({ key, value, comments }) => ({ key, value, comments }));
    await api.applyMigration(toWrite);
    setSaved(true);
    setSaving(false);
    setTimeout(() => api.done(), 800);
  }

  function handleSkip() {
    (window as any).envMigrateAPI?.skip();
  }

  const toWrite = entries.filter((e) => !e.skip);

  if (loading) {
    return (
      <div style={s.container}>
        <div style={s.card}>
          <p style={{ color: "#94a3b8", textAlign: "center" }}>Prüfe Konfiguration…</p>
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div style={s.container}>
        <div style={s.card}>
          <p style={{ color: "#4ade80", textAlign: "center" }}>Keine neuen Einstellungen gefunden.</p>
          <button style={s.btnPrimary} onClick={handleSkip}>Schließen</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.card}>
        <div style={s.header}>
          <span style={{ fontSize: 32 }}>⚙️</span>
          <div>
            <div style={s.title}>Neue Einstellungen verfügbar</div>
            <div style={s.subtitle}>
              Nach dem Update wurden {entries.length} neue Parameter in der Konfiguration gefunden.
              Bitte prüfe die Werte und bestätige die Übernahme.
            </div>
          </div>
        </div>

        <div style={s.list}>
          {entries.map((entry) => (
            <div key={entry.key} style={{ ...s.item, opacity: entry.skip ? 0.45 : 1 }}>
              <div style={s.itemHeader}>
                <label style={s.keyLabel}>{entry.key}</label>
                <label style={s.skipLabel}>
                  <input
                    type="checkbox"
                    checked={entry.skip}
                    onChange={(e) => update(entry.key, { skip: e.target.checked })}
                    style={{ marginRight: 5 }}
                  />
                  Überspringen
                </label>
              </div>

              {entry.comments.length > 0 && (
                <div style={s.comments}>
                  {entry.comments.filter(Boolean).map((c, i) => (
                    <div key={i} style={s.comment}>{c}</div>
                  ))}
                </div>
              )}

              <div style={s.inputRow}>
                <input
                  type={entry.sensitive && !entry.showValue ? "password" : "text"}
                  value={entry.value}
                  disabled={entry.skip}
                  onChange={(e) => update(entry.key, { value: e.target.value })}
                  placeholder={entry.defaultValue || "(leer lassen)"}
                  style={s.input}
                />
                {entry.sensitive && (
                  <button
                    type="button"
                    style={s.eyeBtn}
                    onClick={() => update(entry.key, { showValue: !entry.showValue })}
                    title={entry.showValue ? "Verbergen" : "Anzeigen"}
                  >
                    {entry.showValue ? "🙈" : "👁"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={s.footer}>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            {toWrite.length} von {entries.length} Parameter werden übernommen
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" style={s.btnGhost} onClick={handleSkip} disabled={saving}>
              Jetzt überspringen
            </button>
            <button
              type="button"
              style={{ ...s.btnPrimary, ...(saved ? { background: "#16a34a" } : {}) }}
              onClick={handleSave}
              disabled={saving || saved}
            >
              {saved ? "✓ Gespeichert" : saving ? "Speichere…" : `${toWrite.length} Parameter übernehmen`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    minHeight: "100vh",
    background: "#0f172a",
    fontFamily: "system-ui, sans-serif",
    padding: "1.5rem",
    overflowY: "auto",
  },
  card: {
    background: "#1e293b",
    borderRadius: 12,
    padding: "1.75rem",
    width: "100%",
    maxWidth: 640,
    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    border: "1px solid #334155",
  },
  header: {
    display: "flex",
    gap: 14,
    alignItems: "flex-start",
    marginBottom: 20,
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
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxHeight: 360,
    overflowY: "auto",
    marginBottom: 16,
    paddingRight: 4,
  },
  item: {
    background: "#0f172a",
    border: "1px solid #1e3a5f",
    borderRadius: 8,
    padding: "12px 14px",
    transition: "opacity 0.2s",
  },
  itemHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  keyLabel: {
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: 700,
    color: "#60a5fa",
  },
  skipLabel: {
    fontSize: 11,
    color: "#64748b",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
  },
  comments: {
    marginBottom: 8,
  },
  comment: {
    fontSize: 11,
    color: "#64748b",
    lineHeight: 1.5,
  },
  inputRow: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  input: {
    flex: 1,
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: 6,
    padding: "6px 10px",
    color: "#e2e8f0",
    fontSize: 13,
    fontFamily: "monospace",
    outline: "none",
  },
  eyeBtn: {
    background: "none",
    border: "1px solid #334155",
    borderRadius: 6,
    padding: "4px 8px",
    cursor: "pointer",
    fontSize: 14,
    color: "#94a3b8",
    flexShrink: 0,
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderTop: "1px solid #1e293b",
    paddingTop: 14,
    gap: 12,
    flexWrap: "wrap",
  },
  btnPrimary: {
    padding: "9px 20px",
    background: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnGhost: {
    padding: "9px 16px",
    background: "transparent",
    color: "#64748b",
    border: "1px solid #334155",
    borderRadius: 8,
    fontSize: 13,
    cursor: "pointer",
  },
};
