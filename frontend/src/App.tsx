import React, { useState, useEffect } from "react";
import VideoUpload from "./components/VideoUpload";
import ImageAdjust from "./components/ImageAdjust";
import ProcessingWizard from "./components/ProcessingWizard";
import FrameStack from "./components/FrameStack";
import SceneEditor from "./components/SceneEditor";
import RenderPanel from "./components/RenderPanel";
import SetupWizard from "./components/SetupWizard";
import UpdateWindow from "./components/UpdateWindow";
import SettingsPanel from "./components/SettingsPanel";
import DebugPanel from "./components/DebugPanel";
import type { ImageInfo, StoryboardDraftHints, FolderGroup } from "./api/backendClient";
import { api } from "./api/backendClient";

type Step = "upload" | "image-adjust" | "processing" | "frames" | "storyboard" | "render";
type ProjectMode = "video" | "images";

interface ProjectState {
  mode: ProjectMode;
  videoId: string;
  filename: string;
  hasAudio: boolean;
  imageSessionId?: string;
  imageInfos?: ImageInfo[];
}

const VIDEO_STEPS: Array<{ id: Step; label: string }> = [
  { id: "upload",     label: "1 Upload" },
  { id: "processing", label: "2 Verarbeitung" },
  { id: "frames",     label: "3 Frames" },
  { id: "storyboard", label: "4 Storyboard" },
  { id: "render",     label: "5 Rendering" },
];

const IMAGE_STEPS: Array<{ id: Step; label: string }> = [
  { id: "upload",       label: "1 Upload" },
  { id: "image-adjust", label: "2 Anpassung" },
  { id: "frames",       label: "3 Frames" },
  { id: "storyboard",   label: "4 Storyboard" },
  { id: "render",       label: "5 Rendering" },
];

export default function App(): React.ReactElement {
  const [step, setStep] = useState<Step>("upload");
  const [project, setProject] = useState<ProjectState | null>(null);
  const [selectedFrames, setSelectedFrames] = useState<string[]>([]);
  const [sceneGroups, setSceneGroups] = useState<string[][] | null>(null);
  const [draftHints, setDraftHints] = useState<StoryboardDraftHints | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [folderGroups, setFolderGroups] = useState<FolderGroup[] | undefined>(undefined);

  // Update-Fenster: URL-Parameter ?update=1 → Requirements-Install-Fortschritt zeigen.
  const isUpdateMode = new URLSearchParams(window.location.search).get("update") === "1";
  if (isUpdateMode) {
    return <UpdateWindow />;
  }

  // Setup-Wizard: URL-Parameter ?setup=1 signalisiert, dass das Einrichtungsfenster aktiv ist.
  const isSetupMode = new URLSearchParams(window.location.search).get("setup") === "1";
  const [setupDone, setSetupDone] = useState(false);

  useEffect(() => {
    if (!isSetupMode) return;
    // Prüfen ob .env bereits existiert (z.B. Neustart nach Setup)
    window.setupAPI?.isComplete().then((complete) => {
      if (complete) setSetupDone(true);
    }).catch(() => {/* kein setupAPI im Browser-Dev-Modus */});
  }, [isSetupMode]);

  if (isSetupMode && !setupDone) {
    return <SetupWizard onComplete={() => setSetupDone(true)} />;
  }

  function handleUploaded(videoId: string, filename: string, hasAudio: boolean) {
    setProject({ mode: "video", videoId, filename, hasAudio });
    setStep("processing");
  }

  function handleImagesUploaded(sessionId: string, images: ImageInfo[], groups?: FolderGroup[]) {
    setFolderGroups(groups);
    setProject({
      mode: "images",
      videoId: "",
      filename: groups
        ? `${groups.length} Ordner · ${images.length} Bilder`
        : `${images.length} Bilder`,
      hasAudio: false,
      imageSessionId: sessionId,
      imageInfos: images,
    });
    setStep("image-adjust");
  }

  async function handleImageAdjustDone(_sessionId: string, _images: ImageInfo[]) {
    const stack = await api.imagesToFrames(_sessionId);
    setProject((prev) => prev ? { ...prev, videoId: stack.video_id } : prev);
    setStep("frames");
    // folderGroups bleiben im State und werden an FrameStack weitergegeben
  }

  function handleProcessed() {
    setStep("frames");
  }

  function handleFramesDone(frames: string[], groups: string[][], hints: StoryboardDraftHints) {
    setSelectedFrames(frames);
    setSceneGroups(groups.length > 0 ? groups : null);
    setDraftHints(hints);
    setStep("storyboard");
  }

  function handleImageFramesDone(frames: string[], groups: string[][], hints: StoryboardDraftHints) {
    setSelectedFrames(frames);
    setSceneGroups(groups.length > 0 ? groups : null);
    setDraftHints(hints);
    setStep("storyboard");
  }

  function handleStoryboardDone() {
    setStep("render");
  }

  function handleProjectImported(videoId: string) {
    setProject({
      mode: "images",
      videoId,
      filename: `Import ${videoId}`,
      hasAudio: false,
    });
    setSelectedFrames([]);
    setSceneGroups(null);
    setDraftHints(null);
    setStep("storyboard");
  }

  const currentSteps = project?.mode === "images" ? IMAGE_STEPS : VIDEO_STEPS;

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <h1 style={styles.title}>Clip2Guide</h1>
        {project && (
          <span style={styles.subtitle}>{project.filename}</span>
        )}
        <nav style={styles.nav} aria-label="Workflow-Schritte">
          {currentSteps.map(({ id, label }) => (
            <button
              key={id}
              style={{ ...styles.navBtn, ...(step === id ? styles.navBtnActive : {}) }}
              onClick={() => project && setStep(id)}
              disabled={!project && id !== "upload"}
              aria-current={step === id ? "step" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          style={styles.settingsBtn}
          title="Einstellungen"
          onClick={() => setSettingsOpen(true)}
        >
          ⚙
        </button>
        <button
          style={styles.uninstallBtn}
          title="Clip2Guide deinstallieren"
          onClick={() => {
            const deleteData = window.confirm(
              "Auch Benutzerdaten löschen?\n(venv, Workspace, Tools in %LOCALAPPDATA%\\Clip2Guide)\n\nOK = löschen   Abbrechen = behalten"
            );
            (window as any).appAPI?.uninstall(deleteData);
          }}
        >
          Deinstallieren
        </button>
      </header>

      {settingsOpen && (
        <SettingsPanel
          onClose={() => setSettingsOpen(false)}
          onOpenDebug={() => { setSettingsOpen(false); setDebugOpen(true); }}
        />
      )}
      {debugOpen && <DebugPanel onClose={() => setDebugOpen(false)} />}

      <main style={styles.main}>
        {step === "upload" && (
          <VideoUpload
            onUploaded={handleUploaded}
            onImagesUploaded={handleImagesUploaded}
            onProjectImported={handleProjectImported}
          />
        )}
        {step === "image-adjust" && project?.imageSessionId && project.imageInfos && (
          <ImageAdjust
            sessionId={project.imageSessionId}
            images={project.imageInfos}
            folderGroups={folderGroups}
            onDone={handleImageAdjustDone}
          />
        )}
        {/* ProcessingWizard bleibt gemountet damit laufende Jobs nicht abgebrochen werden */}
        {project && project.mode === "video" && (
          <div style={{ display: step === "processing" ? "block" : "none" }}>
            <ProcessingWizard
              videoId={project.videoId}
              hasAudio={project.hasAudio}
              onDone={handleProcessed}
            />
          </div>
        )}
        {step === "frames" && project && project.mode === "video" && (
          <FrameStack
            videoId={project.videoId}
            onDone={handleFramesDone}
          />
        )}
        {step === "frames" && project && project.mode === "images" && project.videoId && (
          <FrameStack
            videoId={project.videoId}
            onDone={handleImageFramesDone}
            disableExtract
            initialFolderGroups={folderGroups}
          />
        )}
        {step === "storyboard" && project && project.mode === "video" && (
          <SceneEditor
            videoId={project.videoId}
            selectedFrames={selectedFrames}
            sceneGroups={sceneGroups}
            draftHints={draftHints}
            onDone={handleStoryboardDone}
          />
        )}
        {step === "storyboard" && project && project.mode === "images" && project.videoId && (
          <SceneEditor
            videoId={project.videoId}
            selectedFrames={selectedFrames}
            sceneGroups={sceneGroups}
            draftHints={draftHints}
            onDone={handleStoryboardDone}
          />
        )}
        {step === "render" && project && (
          <RenderPanel videoId={project.videoId} onProjectImported={handleProjectImported} />
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
  settingsBtn: {
    marginLeft: "auto",
    background: "transparent",
    border: "1px solid #444",
    color: "#aaa",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 16,
    padding: "2px 10px",
    lineHeight: 1.4,
  },
  uninstallBtn: {
    padding: "4px 12px",
    background: "transparent",
    border: "1px solid #c62828",
    color: "#ef9a9a",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
  },
  main: {
    flex: 1,
    padding: 24,
    overflowY: "auto",
  },
};
