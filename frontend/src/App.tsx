import React, { useState } from "react";
import VideoUpload from "./components/VideoUpload";
import ProcessingWizard from "./components/ProcessingWizard";
import FrameStack from "./components/FrameStack";
import SceneEditor from "./components/SceneEditor";
import RenderPanel from "./components/RenderPanel";

type Step = "upload" | "processing" | "frames" | "storyboard" | "render";

interface ProjectState {
  videoId: string;
  filename: string;
  hasAudio: boolean;
}

export default function App(): React.ReactElement {
  const [step, setStep] = useState<Step>("upload");
  const [project, setProject] = useState<ProjectState | null>(null);
  const [selectedFrames, setSelectedFrames] = useState<string[]>([]);

  function handleUploaded(videoId: string, filename: string, hasAudio: boolean) {
    setProject({ videoId, filename, hasAudio });
    setStep("processing");
  }

  function handleProcessed() {
    setStep("frames");
  }

  function handleFramesDone(frames: string[]) {
    setSelectedFrames(frames);
    setStep("storyboard");
  }

  function handleStoryboardDone() {
    setStep("render");
  }

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <h1 style={styles.title}>Clip2Guide</h1>
        {project && (
          <span style={styles.subtitle}>{project.filename}</span>
        )}
        <nav style={styles.nav} aria-label="Workflow-Schritte">
          {(["upload", "processing", "frames", "storyboard", "render"] as Step[]).map((s) => (
            <button
              key={s}
              style={{ ...styles.navBtn, ...(step === s ? styles.navBtnActive : {}) }}
              onClick={() => project && setStep(s)}
              disabled={!project && s !== "upload"}
              aria-current={step === s ? "step" : undefined}
            >
              {s === "upload" ? "1 Upload" :
               s === "processing" ? "2 Verarbeitung" :
               s === "frames" ? "3 Frames" :
               s === "storyboard" ? "4 Storyboard" : "5 Rendering"}
            </button>
          ))}
        </nav>
      </header>

      <main style={styles.main}>
        {step === "upload" && (
          <VideoUpload onUploaded={handleUploaded} />
        )}
        {/* ProcessingWizard bleibt gemountet damit laufende Jobs nicht abgebrochen werden */}
        {project && (
          <div style={{ display: step === "processing" ? "block" : "none" }}>
            <ProcessingWizard
              videoId={project.videoId}
              hasAudio={project.hasAudio}
              onDone={handleProcessed}
            />
          </div>
        )}
        {step === "frames" && project && (
          <FrameStack
            videoId={project.videoId}
            onDone={handleFramesDone}
          />
        )}
        {step === "storyboard" && project && (
          <SceneEditor
            videoId={project.videoId}
            selectedFrames={selectedFrames}
            onDone={handleStoryboardDone}
          />
        )}
        {step === "render" && project && (
          <RenderPanel videoId={project.videoId} />
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    fontFamily: "system-ui, -apple-system, sans-serif",
    display: "flex",
    flexDirection: "column",
    minHeight: "100vh",
    background: "#1a1a2e",
    color: "#e0e0e0",
  },
  header: {
    background: "#16213e",
    padding: "12px 24px",
    display: "flex",
    alignItems: "center",
    gap: 16,
    boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    color: "#4fc3f7",
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 13,
    color: "#90caf9",
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  nav: {
    display: "flex",
    gap: 8,
  },
  navBtn: {
    background: "transparent",
    border: "1px solid #444",
    color: "#aaa",
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    transition: "all 0.15s",
  },
  navBtnActive: {
    background: "#0d47a1",
    border: "1px solid #1565c0",
    color: "#fff",
  },
  main: {
    flex: 1,
    padding: 24,
    overflowY: "auto",
  },
};
