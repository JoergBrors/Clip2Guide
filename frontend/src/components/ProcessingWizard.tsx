import React, { useState, useRef, useEffect, useMemo } from "react";
import { api, subscribeToJob, JobEvent } from "../api/backendClient";

interface Props {
  videoId: string;
  hasAudio: boolean;
  onDone: () => void;
}

type Phase = "cut" | "normalize" | "done";
type EditMode = "audio" | "motion" | "combined";

interface StepStatus {
  state: "idle" | "running" | "done" | "error";
  message: string;
  percent: number;
}

// Defaults pro Erkennungsmodus
const AUDIO_THRESHOLD_DEFAULT = 0.03;
const MOTION_THRESHOLD_DEFAULT = 0.08;
const MARGIN_DEFAULT = 0.5;

export default function ProcessingWizard({ videoId, hasAudio, onDone }: Props): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("cut");
  const [editMode, setEditMode] = useState<EditMode>(hasAudio ? "audio" : "motion");
  const [audioThreshold, setAudioThreshold] = useState(AUDIO_THRESHOLD_DEFAULT);
  const [motionThreshold, setMotionThreshold] = useState(MOTION_THRESHOLD_DEFAULT);
  const [margin, setMargin] = useState(MARGIN_DEFAULT);
  const [normalizeStatus, setNormalizeStatus] = useState<StepStatus>({ state: "idle", message: "", percent: 0 });
  const [cutStatus, setCutStatus] = useState<StepStatus>({ state: "idle", message: "", percent: 0 });
  const [normalizeLog, setNormalizeLog] = useState<string[]>([]);
  const [cutLog, setCutLog] = useState<string[]>([]);

  const normalizeCleanup = useRef<(() => void) | null>(null);
  const cutCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      normalizeCleanup.current?.();
      cutCleanup.current?.();
    };
  }, []);

  // Vorschau des Auto-Editor-Ausdrucks
  const editExpr = useMemo(() => {
    if (editMode === "audio") return `audio:threshold=${audioThreshold.toFixed(3)}`;
    if (editMode === "motion") return `motion:threshold=${motionThreshold.toFixed(3)}`;
    return `(or audio:threshold=${audioThreshold.toFixed(3)} motion:threshold=${motionThreshold.toFixed(3)})`;
  }, [editMode, audioThreshold, motionThreshold]);

  const isRunning = cutStatus.state === "running" || normalizeStatus.state === "running";

  async function runNormalize() {
    setNormalizeStatus({ state: "running", message: "Normalisierung laeuft...", percent: 5 });
    setNormalizeLog([]);
    try {
      const { job_id } = await api.normalizeVideo(videoId, hasAudio);
      normalizeCleanup.current = subscribeToJob(job_id, (ev: JobEvent) => {
        if (ev.type === "log") {
          setNormalizeLog((prev) => [...prev, ev.message]);
          return;
        }
        setNormalizeStatus({ state: ev.type === "error" ? "error" : ev.type === "completed" ? "done" : "running", message: ev.message, percent: ev.percent });
        if (ev.type === "completed") { setPhase("done"); onDone(); }
      });
    } catch (e: unknown) {
      setNormalizeStatus({ state: "error", message: e instanceof Error ? e.message : "Fehler", percent: 0 });
    }
  }

  async function runCut() {
    setCutStatus({ state: "running", message: "Schnitt laeuft...", percent: 5 });
    setCutLog([]);
    try {
      const { job_id } = await api.cutVideo(
        videoId, editMode, hasAudio,
        `${margin.toFixed(1)}s`,
        audioThreshold,
        motionThreshold,
      );
      cutCleanup.current = subscribeToJob(job_id, (ev: JobEvent) => {
        if (ev.type === "log") {
          setCutLog((prev) => [...prev, ev.message]);
          return;
        }
        setCutStatus({ state: ev.type === "error" ? "error" : ev.type === "completed" ? "done" : "running", message: ev.message, percent: ev.percent });
        if (ev.type === "completed") { setPhase("normalize"); }
      });
    } catch (e: unknown) {
      setCutStatus({ state: "error", message: e instanceof Error ? e.message : "Fehler", percent: 0 });
    }
  }

  function skipCut() {
    setPhase("normalize");
  }

  return (
    <div className="card" style={{ maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ marginTop: 0, color: "#4fc3f7" }}>Video-Verarbeitung</h2>

      {/* Schritt 1: Auto-Editor Schnitt */}
      <section aria-labelledby="step-cut">
        <h3 id="step-cut" style={{ color: "#90caf9" }}>1. Pausen entfernen (optional)</h3>
        <p style={{ color: "#aaa", fontSize: 14 }}>
          Auto-Editor entfernt automatisch Stille und Pausen aus der Originalaufnahme.
        </p>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="edit-mode" style={{ fontSize: 14, marginRight: 10 }}>Erkennungsmodus:</label>
          <select
            id="edit-mode"
            value={editMode}
            onChange={(e) => setEditMode(e.target.value as EditMode)}
            disabled={phase !== "cut" || isRunning}
            style={{ width: "auto" }}
          >
            <option value="audio">Audio (empfohlen bei Ton)</option>
            <option value="motion">Bewegung (empfohlen ohne Ton)</option>
            <option value="combined">Kombiniert</option>
          </select>
        </div>

        {/* Tuning */}
        <div style={{
          marginBottom: 16,
          padding: "14px 16px",
          background: "#0d0d1a",
          borderRadius: 8,
          border: "1px solid #1e1e3a",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#6080a0", letterSpacing: "0.08em", marginBottom: 14, textTransform: "uppercase" }}>
            Tuning
          </div>

          {(editMode === "audio" || editMode === "combined") && (
            <SliderRow
              label="Audio-Schwelle"
              hint="Lautstärke-Grenzwert · niedriger = sensibler, mehr Schnitte"
              value={audioThreshold}
              min={0.01} max={0.30} step={0.01}
              onChange={setAudioThreshold}
              format={(v) => v.toFixed(2)}
              disabled={isRunning}
            />
          )}

          {(editMode === "motion" || editMode === "combined") && (
            <SliderRow
              label="Bewegungs-Schwelle"
              hint="Bewegungs-Grenzwert · niedriger = sensibler, mehr Schnitte"
              value={motionThreshold}
              min={0.01} max={0.30} step={0.01}
              onChange={setMotionThreshold}
              format={(v) => v.toFixed(2)}
              disabled={isRunning}
            />
          )}

          <SliderRow
            label="Puffer (Margin)"
            hint="Sekunden die vor/nach jedem aktiven Segment erhalten bleiben"
            value={margin}
            min={0.0} max={3.0} step={0.1}
            onChange={setMargin}
            format={(v) => `${v.toFixed(1)} s`}
            disabled={isRunning}
          />

          <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#445566", flexShrink: 0 }}>Ausdruck:</span>
            <code style={{
              fontSize: 11,
              fontFamily: "'Consolas', 'Courier New', monospace",
              color: "#7090b0",
              background: "#080810",
              padding: "2px 8px",
              borderRadius: 4,
              wordBreak: "break-all",
            }}>
              {editExpr} --margin {margin.toFixed(1)}s
            </code>
          </div>
        </div>

        <StatusBar status={cutStatus} />
        <LogPanel lines={cutLog} label="Auto-Editor Output" />

        {phase === "cut" && cutStatus.state === "idle" && (
          <div style={{ display: "flex", gap: 12 }}>
            <button className="btn btn-primary" onClick={runCut}>Schnitt starten</button>
            <button className="btn btn-ghost" onClick={skipCut}>Ueberspringen</button>
          </div>
        )}
      </section>

      <hr style={{ border: "none", borderTop: "1px solid #2a2a4a", margin: "20px 0" }} />

      {/* Schritt 2: Normalisierung */}
      <section aria-labelledby="step-normalize">
        <h3 id="step-normalize" style={{ color: "#90caf9" }}>2. Normalisierung</h3>
        <p style={{ color: "#aaa", fontSize: 14 }}>
          Konvertiert das Video in ein einheitliches H.264-Format (1080p, konstante FPS).
        </p>
        <StatusBar status={normalizeStatus} />
        <LogPanel lines={normalizeLog} label="FFmpeg Output" />
        {phase === "normalize" && normalizeStatus.state === "idle" && (
          <button className="btn btn-primary" onClick={runNormalize}>Normalisierung starten</button>
        )}
        {(phase === "cut" || cutStatus.state === "running") && normalizeStatus.state === "idle" && (
          <p style={{ color: "#555", fontSize: 13 }}>Wird nach Schritt 1 freigeschaltet.</p>
        )}
      </section>
    </div>
  );
}

function StatusBar({ status }: { status: StepStatus }): React.ReactElement | null {
  if (status.state === "idle") return null;
  const color = status.state === "error" ? "#ef5350" : status.state === "done" ? "#66bb6a" : "#4fc3f7";
  return (
    <div aria-live="polite" style={{ marginBottom: 12 }}>
      {(status.state === "running" || status.state === "done") && (
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${status.percent}%`, background: color }} />
        </div>
      )}
      <p style={{ color, fontSize: 13, margin: "4px 0" }}>{status.message}</p>
    </div>
  );
}

function LogPanel({ lines, label }: { lines: string[]; label: string }): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, open]);

  if (lines.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        className="btn btn-ghost"
        onClick={() => setOpen((v) => !v)}
        style={{ fontSize: 12, padding: "3px 10px", marginBottom: 6 }}
        aria-expanded={open}
      >
        {open ? "▲" : "▼"} {label} ({lines.length} Zeilen)
      </button>
      {open && (
        <pre
          style={{
            background: "#0d0d1a",
            border: "1px solid #2a2a4a",
            borderRadius: 6,
            padding: "10px 12px",
            fontSize: 11,
            fontFamily: "'Consolas', 'Courier New', monospace",
            color: "#a0b0c0",
            maxHeight: 260,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            margin: 0,
          }}
        >
          {lines.join("\n")}
          <div ref={bottomRef} />
        </pre>
      )}
    </div>
  );
}

interface SliderRowProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  disabled?: boolean;
}

function SliderRow({ label, hint, value, min, max, step, onChange, format, disabled }: SliderRowProps): React.ReactElement {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
        <span style={{ fontSize: 13, color: "#b0c4d8" }}>{label}</span>
        <span style={{
          fontSize: 13,
          fontFamily: "'Consolas', 'Courier New', monospace",
          color: "#4fc3f7",
          minWidth: 52,
          textAlign: "right",
        }}>
          {format(value)}
        </span>
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: "#445566", marginBottom: 4 }}>{hint}</div>
      )}
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={format(value)}
        style={{ width: "100%", accentColor: "#4fc3f7", cursor: disabled ? "not-allowed" : "pointer" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#334455", marginTop: 1 }}>
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
