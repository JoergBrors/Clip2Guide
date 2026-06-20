import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  StoryboardJson,
  Scene,
  TextPanel,
  subscribeToJob,
  JobEvent,
  ThrottleAlternative,
  StoryboardDraftHints,
} from "../api/backendClient";
import JsonPreview from "./JsonPreview";

interface Props {
  videoId: string;
  selectedFrames?: string[];
  sceneGroups?: string[][] | null;
  draftHints?: StoryboardDraftHints | null;
  onDone: () => void;
}

const DEFAULT_LANGUAGES = ["de", "en"];
const DEFAULT_MASTER_PROMPT =
  "Erstelle ein zusammenhaengendes Tutorial-Storyboard. Bewahre den roten Faden ueber alle Szenen, erklaere die Schritte fuer Einsteiger klar und nutze die Szenen- und Bildhinweise als verbindliche Zusatzanweisungen.";

export default function SceneEditor({ videoId, selectedFrames, sceneGroups, draftHints, onDone }: Props): React.ReactElement {
  const [storyboard, setStoryboard] = useState<StoryboardJson | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMsg, setAnalyzeMsg] = useState("");
  const [analyzeProgress, setAnalyzeProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string[]>(DEFAULT_LANGUAGES);
  const [langInput, setLangInput] = useState<string>(DEFAULT_LANGUAGES.join(","));
  const [masterPrompt, setMasterPrompt] = useState<string>(draftHints?.masterPrompt ?? DEFAULT_MASTER_PROMPT);
  const [activeScene, setActiveScene] = useState<number>(0);
  const [activeLang, setActiveLang] = useState<string>(DEFAULT_LANGUAGES[0]);
  const [showJson, setShowJson] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hover-Zoom-Vorschau
  const [hoveredImg, setHoveredImg] = useState<{ src: string; x: number; y: number } | null>(null);

  // Debug-Protokoll (KI-Prompts)
  const [debugLogs, setDebugLogs] = useState<Array<{ ts: string; step: string; content: string }>>([]);
  const [showDebug, setShowDebug] = useState(false);

  function addDebugLog(step: string, content: string) {
    setDebugLogs((prev) => [...prev.slice(-199), { ts: new Date().toLocaleTimeString(), step, content }]);
  }

  // Drag-and-Drop: Bild zwischen Szenen verschieben (fromScene = null → aus Referenz-Streifen)
  const [dragInfo, setDragInfo] = useState<{ filename: string; fromScene: number | null } | null>(null);
  const [dragOverScene, setDragOverScene] = useState<number | null>(null);
  // In-Szene-Reihenfolge: Dateiname vor dem der gezogene Frame eingesetzt wird
  const [dragOverInsideFilename, setDragOverInsideFilename] = useState<string | null>(null);

  // Alle Frames des Videos als Fallback-Referenz, wenn selectedFrames leer ist
  const [allFrames, setAllFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!selectedFrames || selectedFrames.length === 0) {
      api.getFrameStack(videoId)
        .then((stack) => {
          if (stack) setAllFrames(stack.frames.map((f) => f.filename));
        })
        .catch(() => { /* keine Frames verfügbar */ });
    }
  }, [videoId, selectedFrames]);

  // Referenz-Frames: explizit ausgewählte oder alle verfügbaren
  const refFrames = (selectedFrames && selectedFrames.length > 0) ? selectedFrames : allFrames;
  const [dragOverImageGroup, setDragOverImageGroup] = useState(false);

  // KI Szene neu schreiben
  const [rewritingScene, setRewritingScene] = useState(false);
  const [rewriteMsg, setRewriteMsg] = useState("");
  const [rewriteProgress, setRewriteProgress] = useState(0);
  const [showRewritePanel, setShowRewritePanel] = useState(false);
  const [rewriteAddressStyle, setRewriteAddressStyle] = useState("sie");
  const [rewriteWritingStyle, setRewriteWritingStyle] = useState("sachlich");
  const [rewriteDetailLevel, setRewriteDetailLevel] = useState("standard");
  // Szenen-IDs die nach einem Rewrite nicht automatisch angereichert werden sollen
  const [rewrittenSceneIds, setRewrittenSceneIds] = useState<Set<string>>(new Set());
  // Timer-Refs fuer debounced Auto-Rewrite (sceneId -> timer)
  const autoRewriteTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Anreicherung (slide_panels + render_hints)
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState("");
  // Separates Flag fuer den Post-Rewrite-Enrich (laeuft unabhaengig vom allgemeinen Enrich)
  const [enrichingAfterRewrite, setEnrichingAfterRewrite] = useState(false);

  // Referenz: Bildgruppen wie sie zuletzt vom Server geladen/gespeichert wurden (fuer Aenderungs-Erkennung)
  const serverImageGroupsRef = useRef<Record<string, string[]>>({});

  function syncServerImageGroups(sb: StoryboardJson) {
    serverImageGroupsRef.current = Object.fromEntries(
      sb.scenes.map((s) => [s.scene_id, [...s.image_group]])
    );
  }

  function imagesChangedVsServer(sceneId: string, currentGroup: string[]): boolean {
    const server = serverImageGroupsRef.current[sceneId];
    if (!server) return true; // noch nicht vom Server bekannt → als geändert behandeln
    if (server.length !== currentGroup.length) return true;
    return server.some((f, i) => f !== currentGroup[i]);
  }

  function estimateSceneDurationSeconds(scene: Scene): number {
    const textDuration = Object.values(scene.texts ?? {}).reduce((maxDuration, panel) => {
      const chars = Math.max(panel.speaker_notes.length, panel.body.length);
      return Math.max(maxDuration, chars / 13);
    }, 0);
    const imageDuration = Math.max(2, scene.image_group.length * 2);
    return Math.max(2, textDuration, imageDuration);
  }

  function withRecalculatedDuration(scene: Scene): Scene {
    return { ...scene, duration_seconds: Number(estimateSceneDurationSeconds(scene).toFixed(1)) };
  }

  function getImagePrompt(sb: StoryboardJson, filename: string): string {
    const direct = sb.scenes.find((scene) => scene.image_prompts?.[filename])?.image_prompts?.[filename];
    if (direct) return direct;
    const memory = sb.metadata?.image_prompt_memory as Record<string, string> | undefined;
    return memory?.[filename] ?? "";
  }

  function rememberImagePrompt(sb: StoryboardJson, filename: string, prompt: string): StoryboardJson {
    const memory = { ...((sb.metadata?.image_prompt_memory as Record<string, string> | undefined) ?? {}) };
    if (prompt.trim()) memory[filename] = prompt;
    return { ...sb, metadata: { ...sb.metadata, image_prompt_memory: memory } };
  }

  function describeSceneForContext(scene: Scene): string {
    const textDescriptions = Object.entries(scene.texts ?? {})
      .map(([lang, panel]) => {
        const parts = [
          panel.heading ? `Ueberschrift: ${panel.heading}` : "",
          panel.body ? `Beschreibung: ${panel.body}` : "",
          panel.speaker_notes ? `Sprecher-Notizen: ${panel.speaker_notes}` : "",
        ].filter(Boolean);
        return parts.length ? `${lang}: ${parts.join(" | ")}` : "";
      })
      .filter(Boolean);
    return textDescriptions.join("\n");
  }

  function buildUpdatedMasterContext(sb: StoryboardJson): Record<string, unknown> | null {
    const master = sb.metadata?.ai_master_context;
    if (!master || typeof master !== "object" || Array.isArray(master)) return null;
    const masterContext = { ...(master as Record<string, unknown>) };
    const originalSceneGroups = Array.isArray(masterContext.scene_groups)
      ? masterContext.scene_groups
      : [];
    masterContext.scene_groups = sb.scenes.map((scene, idx) => {
      const original = originalSceneGroups[idx];
      const originalGroup = original && typeof original === "object" && !Array.isArray(original)
        ? original as Record<string, unknown>
        : {};
      const currentDescription = describeSceneForContext(scene);
      return {
        ...originalGroup,
        scene_index: idx,
        scene_id: scene.scene_id,
        description: currentDescription || String(originalGroup.description ?? ""),
        frames: scene.image_group,
        image_prompts: scene.image_prompts,
        duration_seconds: scene.duration_seconds,
      };
    });
    masterContext.current_scene_count = sb.scenes.length;
    masterContext.last_client_update = "Master-Kontext wurde vor dem Szenen-Rewrite aus dem aktuellen Storyboard aktualisiert.";
    return masterContext;
  }

  function buildRewriteContext(sb: StoryboardJson): Record<string, unknown> {
    const masterContext = buildUpdatedMasterContext(sb);
    return {
      master_context: masterContext ?? sb.metadata?.ai_master_context ?? null,
      change_history: sb.metadata?.ai_change_history ?? [],
      scenes: sb.scenes.map((scene, idx) => ({
        index: idx + 1,
        scene_id: scene.scene_id,
        scene_description: describeSceneForContext(scene),
        image_group: scene.image_group,
        image_prompts: scene.image_prompts,
        duration_seconds: scene.duration_seconds,
        texts: scene.texts,
      })),
    };
  }

  function appendLocalChangeHistory(sb: StoryboardJson, summary: string): StoryboardJson {
    const history = Array.isArray(sb.metadata?.ai_change_history)
      ? [...(sb.metadata.ai_change_history as Array<Record<string, unknown>>)]
      : [];
    history.push({ index: history.length + 1, summary });
    return {
      ...sb,
      metadata: {
        ...sb.metadata,
        ai_change_history: history.slice(-50),
      },
    };
  }

  /**
   * Plant einen Auto-Rewrite fuer eine oder mehrere Szenen (debounced 500 ms).
   * Wird nach jeder Bild-Mutation aufgerufen.
   * sbSnapshot: das bereits aktualisierte Storyboard (nicht den veralteten React-State verwenden)
   * sceneIndices: Indizes der betroffenen Szenen
   */
  function scheduleAutoRewrite(sbSnapshot: StoryboardJson, sceneIndices: number[], changeSummary: string) {
    sceneIndices.forEach((idx) => {
      const sceneId = sbSnapshot.scenes[idx]?.scene_id;
      if (!sceneId) return;
      // Laufenden Timer für diese Szene löschen
      if (autoRewriteTimersRef.current[sceneId]) {
        clearTimeout(autoRewriteTimersRef.current[sceneId]);
      }
      autoRewriteTimersRef.current[sceneId] = setTimeout(() => {
        delete autoRewriteTimersRef.current[sceneId];
        runRewriteScene(undefined, undefined, sbSnapshot, idx, changeSummary);
      }, 500);
    });
  }

  // Throttle-Dialog: wird gesetzt wenn ein KI-Anbieter 503/429 zurueckgibt
  const [throttleDialog, setThrottleDialog] = useState<{
    context: "analyze" | "rewrite";
    alternatives: ThrottleAlternative[];
  } | null>(null);

  // Provider / Modell-Auswahl
  const [availableProviders, setAvailableProviders] = useState<{ id: string; label: string }[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    setMasterPrompt(draftHints?.masterPrompt ?? DEFAULT_MASTER_PROMPT);
  }, [videoId, draftHints?.masterPrompt]);

  // Provider-Liste einmalig beim Laden holen
  useEffect(() => {
    api.getAiProviders()
      .then(({ providers, default: def }) => {
        setAvailableProviders(providers);
        setProvider(def);
      })
      .catch(() => {
        // Fallback wenn Endpoint nicht erreichbar
        setAvailableProviders([{ id: "gemini", label: "Google Gemini" }]);
        setProvider("gemini");
      });
  }, []);

  // Modelle laden wenn Provider gewechselt wird
  useEffect(() => {
    if (!provider) return;
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

  const storyboardDraftScenes = useMemo<string[][]>(() => {
    if (sceneGroups && sceneGroups.length > 0) return sceneGroups;
    return refFrames.length > 0 ? [refFrames] : [];
  }, [sceneGroups, refFrames]);

  const analyzePromptPreview = useMemo(() => {
    const lines: string[] = [
      "Analyse-Auftrag vor KI-Start",
      `Provider: ${provider || "(nicht geladen)"}`,
      `Modell: ${selectedModel || "(Provider-Default)"}`,
      `Video-ID: ${videoId}`,
      `Sprachen: ${languages.join(", ")}`,
      `Ausgewaehlte Frames: ${(selectedFrames && selectedFrames.length > 0) ? selectedFrames.join(", ") : "(alle verfuegbaren Frames)"}`,
      "",
      "Allgemein vorangestellter Master-Prompt:",
      masterPrompt.trim() || "(leer)",
      "",
      "Hinweis: Das Backend ergaenzt diesen Kontext pro KI-Aufruf mit build_analysis_prompt().",
      "Nach dem Start erscheinen darunter die echten Backend-Prompt-Dumps.",
      "",
      `Storyboard-Szenen: ${storyboardDraftScenes.length}`,
    ];

    storyboardDraftScenes.forEach((group, sceneIdx) => {
      const description = draftHints?.sceneDescriptions?.[sceneIdx]?.trim();
      lines.push("");
      lines.push(`Szene ${sceneIdx + 1}`);
      lines.push(`Frames (${group.length}): ${group.join(", ")}`);
      if (description) {
        lines.push("Kurze Szenenbeschreibung:");
        lines.push(description);
      }
      const imagePromptLines = group
        .map((filename) => {
          const prompt = draftHints?.imagePrompts?.[filename]?.trim();
          return prompt ? `- ${filename}: ${prompt}` : "";
        })
        .filter(Boolean);
      if (imagePromptLines.length > 0) {
        lines.push("Bildspezifische KI-Anweisungen:");
        lines.push(...imagePromptLines);
      }
    });

    return lines.join("\n");
  }, [draftHints, languages, masterPrompt, provider, refFrames, sceneGroups, selectedFrames, selectedModel, storyboardDraftScenes, videoId]);

  useEffect(() => {
    api.getStoryboard(videoId)
      .then((sb) => { setStoryboard(sb); syncServerImageGroups(sb); })
      .catch(() => { /* noch nicht erstellt */ });
  }, [videoId]);

  async function runAnalyze(providerOverride?: string, modelOverride?: string) {
    setAnalyzing(true);
    setError(null);
    setThrottleDialog(null);
    addDebugLog("analyze-preview", analyzePromptPreview);
    const activeProvider = providerOverride ?? provider;
    const activeModel = (modelOverride ?? selectedModel) || undefined;
    const analyzeDraftHints: StoryboardDraftHints = {
      masterPrompt: masterPrompt.trim(),
      sceneDescriptions: draftHints?.sceneDescriptions ?? [],
      imagePrompts: draftHints?.imagePrompts ?? {},
    };
    try {
      const { job_id } = await api.analyzeVideo(
        videoId, languages, activeProvider, activeModel,
        selectedFrames?.length ? selectedFrames : undefined,
        sceneGroups?.length ? sceneGroups : undefined,
        analyzeDraftHints,
      );
      subscribeToJob(job_id, (ev: JobEvent) => {
        if (ev.type === "debug") { addDebugLog(ev.step, ev.message); return; }
        setAnalyzeMsg(ev.message);
        setAnalyzeProgress(ev.percent);
        if (ev.type === "completed") {
          setAnalyzing(false);
          api.getStoryboard(videoId).then((sb) => {
            setStoryboard(sb);
            syncServerImageGroups(sb);
            // Nach der Analyse automatisch Szenen mit mehreren Bildern anreichern
            const langs = sb.languages.length ? sb.languages : languages;
            const multiImgScenes = sb.scenes.filter((s) => s.image_group.length > 1);
            if (multiImgScenes.length > 0) {
              triggerEnrich(langs, multiImgScenes.map((s) => s.scene_id));
            }
          }).catch(console.error);
        } else if (ev.type === "throttled") {
          setAnalyzing(false);
          const alts = (ev.data?.alternatives ?? []) as ThrottleAlternative[];
          setThrottleDialog({ context: "analyze", alternatives: alts });
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

  function setImagePrompt(sceneIdx: number, filename: string, prompt: string) {
    if (!storyboard) return;
    let updated = rememberImagePrompt(storyboard, filename, prompt);
    updated = { ...updated, scenes: [...updated.scenes] };
    const s = { ...updated.scenes[sceneIdx] };
    s.image_prompts = { ...s.image_prompts, [filename]: prompt };
    updated.scenes[sceneIdx] = s;
    setStoryboard(updated);
  }

  function updateTextPanel(sceneIdx: number, lang: string, field: keyof TextPanel, value: string) {
    if (!storyboard) return;
    const updated = { ...storyboard };
    const scene = { ...updated.scenes[sceneIdx] };
    scene.texts = { ...scene.texts, [lang]: { ...scene.texts[lang], [field]: value } };
    updated.scenes = [...updated.scenes];
    updated.scenes[sceneIdx] = withRecalculatedDuration(scene);
    setStoryboard(updated);
  }

  function removeFrameFromScene(sceneIdx: number, filename: string) {
    if (!storyboard) return;
    const updated = { ...storyboard, scenes: [...storyboard.scenes] };
    const s = { ...updated.scenes[sceneIdx] };
    s.image_group = s.image_group.filter((f) => f !== filename);
    if (s.start_frame === filename) s.start_frame = s.image_group[0] ?? "";
    if (s.end_frame === filename) s.end_frame = s.image_group[s.image_group.length - 1] ?? null;
    updated.scenes[sceneIdx] = withRecalculatedDuration(s);
    setStoryboard(updated);
    if (s.image_group.length > 0) {
      scheduleAutoRewrite(updated, [sceneIdx], `Bild '${filename}' wurde aus Szene ${sceneIdx + 1} entfernt.`);
    }
  }

  function moveFrameToScene(fromIdx: number, toIdx: number, filename: string) {
    if (!storyboard) return;
    const updated = { ...storyboard, scenes: [...storyboard.scenes] };
    const imagePrompt = getImagePrompt(storyboard, filename);
    const from = { ...updated.scenes[fromIdx] };
    from.image_group = from.image_group.filter((f) => f !== filename);
    updated.scenes[fromIdx] = withRecalculatedDuration(from);
    const to = { ...updated.scenes[toIdx] };
    to.image_group = [...to.image_group, filename];
    if (imagePrompt) to.image_prompts = { ...to.image_prompts, [filename]: imagePrompt };
    updated.scenes[toIdx] = withRecalculatedDuration(to);
    setStoryboard(updated);
    // Beide betroffenen Szenen neu schreiben (Quell-Szene verliert ein Bild, Ziel-Szene bekommt eines)
    const affected = [toIdx];
    if (from.image_group.length > 0) affected.push(fromIdx);
    scheduleAutoRewrite(updated, affected, `Bild '${filename}' wurde von Szene ${fromIdx + 1} nach Szene ${toIdx + 1} verschoben.`);
  }

  function addFrameFromRef(filename: string, toIdx: number) {
    if (!storyboard) return;
    const imagePrompt = getImagePrompt(storyboard, filename);
    const updated = { ...storyboard, scenes: storyboard.scenes.map((s, i) => {
      if (i === toIdx) return s;
      if (s.image_group.includes(filename)) {
        const ng = s.image_group.filter((f) => f !== filename);
        return withRecalculatedDuration({ ...s, image_group: ng,
          start_frame: ng[0] ?? s.start_frame,
          end_frame: ng[ng.length - 1] ?? null,
        });
      }
      return s;
    }) };
    const to = { ...updated.scenes[toIdx] };
    if (!to.image_group.includes(filename)) {
      to.image_group = [...to.image_group, filename];
      if (!to.start_frame) to.start_frame = to.image_group[0];
      if (imagePrompt) to.image_prompts = { ...to.image_prompts, [filename]: imagePrompt };
    }
    updated.scenes[toIdx] = withRecalculatedDuration(to);
    setStoryboard(updated);
    // Ziel-Szene neu schreiben; ggf. auch alle Quell-Szenen die ein Bild verloren haben
    const affectedSrcIndices = storyboard.scenes
      .map((s, i) => (i !== toIdx && s.image_group.includes(filename) ? i : -1))
      .filter((i) => i >= 0);
    const affected = [toIdx, ...affectedSrcIndices];
    scheduleAutoRewrite(updated, affected, `Bild '${filename}' wurde zu Szene ${toIdx + 1} hinzugefuegt.`);
  }

  function reorderWithinScene(sceneIdx: number, fromFilename: string, beforeFilename: string | null) {
    if (!storyboard) return;
    const updated = { ...storyboard, scenes: [...storyboard.scenes] };
    const s = { ...updated.scenes[sceneIdx] };
    const group = s.image_group.filter((f) => f !== fromFilename);
    const insertAt = beforeFilename ? group.indexOf(beforeFilename) : group.length;
    group.splice(insertAt === -1 ? group.length : insertAt, 0, fromFilename);
    s.image_group = group;
    s.start_frame = group[0] ?? "";
    s.end_frame = group[group.length - 1] ?? null;
    updated.scenes[sceneIdx] = withRecalculatedDuration(s);
    setStoryboard(updated);
    scheduleAutoRewrite(updated, [sceneIdx], `Bildreihenfolge in Szene ${sceneIdx + 1} wurde geaendert.`);
  }

  function addScene() {
    if (!storyboard) return;
    const langs = storyboard.languages.length ? storyboard.languages : languages;
    const emptyTexts = Object.fromEntries(langs.map((l) => [l, { heading: "", body: "", speaker_notes: "" }]));
    const newScene: Scene = {
      scene_id: crypto.randomUUID(),
      start_frame: "",
      end_frame: null,
      image_group: [],
      image_prompts: {},
      texts: emptyTexts,
      duration_seconds: 0,
    };
    const updated = appendLocalChangeHistory(
      { ...storyboard, scenes: [...storyboard.scenes, newScene] },
      `Neue leere Szene ${storyboard.scenes.length + 1} wurde erstellt.`,
    );
    setStoryboard(updated);
    setActiveScene(updated.scenes.length - 1);
  }

  function deleteScene(idx: number) {
    if (!storyboard || storyboard.scenes.length <= 1) return;
    const deleted = storyboard.scenes[idx];
    const updated = appendLocalChangeHistory(
      { ...storyboard, scenes: storyboard.scenes.filter((_, i) => i !== idx) },
      `Szene ${idx + 1} (${deleted?.scene_id ?? "unbekannt"}) wurde geloescht.`,
    );
    setStoryboard(updated);
    setActiveScene(Math.min(idx, updated.scenes.length - 1));
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
    if (!dragInfo) return;
    if (dragInfo.fromScene === null) {
      addFrameFromRef(dragInfo.filename, toIdx);
    } else if (dragInfo.fromScene !== toIdx) {
      moveFrameToScene(dragInfo.fromScene, toIdx, dragInfo.filename);
    }
    setDragInfo(null);
  }

  function handleImageGroupDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOverImageGroup(false);
    setDragOverInsideFilename(null);
    if (!dragInfo) return;
    if (dragInfo.fromScene === activeScene) {
      // In-Szene: ans Ende verschieben
      reorderWithinScene(activeScene, dragInfo.filename, null);
    } else if (dragInfo.fromScene === null) {
      addFrameFromRef(dragInfo.filename, activeScene);
    } else {
      moveFrameToScene(dragInfo.fromScene, activeScene, dragInfo.filename);
    }
    setDragInfo(null);
  }

  function handleInsideItemDragOver(e: React.DragEvent, filename: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!dragInfo) return;
    if (dragInfo.fromScene === activeScene) {
      // Reihenfolge innerhalb der Szene
      setDragOverInsideFilename(filename);
    } else {
      // Externe Quelle: ganzen Container highlighten
      setDragOverImageGroup(true);
    }
  }

  function handleInsideItemDrop(e: React.DragEvent, beforeFilename: string) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverInsideFilename(null);
    setDragOverImageGroup(false);
    if (!dragInfo) return;
    if (dragInfo.fromScene === activeScene) {
      reorderWithinScene(activeScene, dragInfo.filename, beforeFilename);
    } else if (dragInfo.fromScene === null) {
      addFrameFromRef(dragInfo.filename, activeScene);
    } else {
      moveFrameToScene(dragInfo.fromScene, activeScene, dragInfo.filename);
    }
    setDragInfo(null);
  }

  async function runRewriteScene(
    providerOverride?: string,
    modelOverride?: string,
    sbOverride?: StoryboardJson,   // direkt nach Bild-Mutation übergeben (kein Stale-State)
    sceneIdxOverride?: number,     // Szenen-Index des sbOverride
    changeSummary = "Manueller Rewrite der Szene.",
  ) {
    const sb = sbOverride ?? storyboard;
    const sceneIdx = sceneIdxOverride ?? activeScene;
    const scn = sb?.scenes[sceneIdx];
    if (!sb || !scn) return;
    setRewritingScene(true);
    setRewriteMsg("");
    setRewriteProgress(0);
    setError(null);
    setThrottleDialog(null);
    const activeProvider = providerOverride ?? provider;
    const activeModel = (modelOverride ?? selectedModel) || undefined;
    try {
      const langs = sb.languages.length ? sb.languages : languages;
      // Immer frischer Inhalt – KI soll Bilder und image_prompts frei interpretieren
      const imagePrompts = scn.image_prompts
        ? Object.fromEntries(Object.entries(scn.image_prompts).filter(([, v]) => v && v.trim()))
        : undefined;
      const { job_id } = await api.rewriteScene(
        videoId, scn.scene_id, scn.image_group, langs,
        scn.texts,
        Object.keys(imagePrompts ?? {}).length ? imagePrompts : undefined,
        activeProvider, activeModel,
        scn.duration_seconds ?? undefined,
        buildRewriteContext(sb),
        changeSummary,
        rewriteAddressStyle,
        rewriteWritingStyle,
        rewriteDetailLevel,
      );
      const sceneIdForEnrich = scn.scene_id;
      const capturedSceneIdx = sceneIdx;
      subscribeToJob(job_id, (ev: JobEvent) => {
        if (ev.type === "debug") { addDebugLog(ev.step, ev.message); return; }
        setRewriteMsg(ev.message);
        setRewriteProgress(ev.percent);
        if (ev.type === "completed" && ev.data) {
          setRewritingScene(false);
          const texts = ev.data.texts as Record<string, TextPanel>;
          // Funktionaler State-Update: immer aktuellsten State nehmen (kein Stale-Closure-Problem)
          setStoryboard((prev) => {
            if (!prev) return prev;
            const scenes = [...prev.scenes];
            const durationSeconds = typeof ev.data?.duration_seconds === "number"
              ? ev.data.duration_seconds
              : scenes[capturedSceneIdx].duration_seconds;
            const s = withRecalculatedDuration({
              ...scenes[capturedSceneIdx],
              texts: { ...scenes[capturedSceneIdx].texts, ...texts },
              duration_seconds: durationSeconds,
            });
            scenes[capturedSceneIdx] = s;
            const updated = {
              ...prev,
              scenes,
              metadata: {
                ...prev.metadata,
                ...((ev.data?.metadata as Record<string, unknown> | undefined) ?? {}),
              },
            };
            // Szene als neu geschrieben markieren → kein doppelter Auto-Enrich beim manuellen Speichern
            setRewrittenSceneIds((rw) => new Set([...rw, sceneIdForEnrich]));
            // Storyboard sofort speichern, dann Enrich für slide_panels/render_hints
            const enrichLangs = updated.languages.length ? updated.languages : langs;
            api.updateStoryboard(videoId, updated)
              .then(() => {
                syncServerImageGroups(updated);
                triggerEnrichForScene(sceneIdForEnrich, enrichLangs);
              })
              .catch(console.error);
            return updated;
          });
        } else if (ev.type === "throttled") {
          setRewritingScene(false);
          const alts = (ev.data?.alternatives ?? []) as ThrottleAlternative[];
          setThrottleDialog({ context: "rewrite", alternatives: alts });
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
      syncServerImageGroups(storyboard);
      // Im Hintergrund Szenen anreichern die mehrere Bilder haben und noch keine slide_panels
      // Szenen die gerade per KI-Rewrite neu geschrieben wurden ausnehmen (Post-Rewrite-Enrich läuft bereits)
      const langs = storyboard.languages.length ? storyboard.languages : languages;
      const needEnrich = storyboard.scenes.filter(
        (s) => s.image_group.length > 1 && !s.slide_panels?.[langs[0]]?.length && !rewrittenSceneIds.has(s.scene_id)
      );
      if (needEnrich.length > 0) {
        triggerEnrich(langs, needEnrich.map((s) => s.scene_id));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  function triggerEnrichForScene(sceneId: string, langs: string[]) {
    // Eigener Flag statt dem globalen enriching → laeuft immer, auch wenn allgemeiner Enrich aktiv ist
    setEnrichingAfterRewrite(true);
    api.enrichStoryboard(videoId, langs, [sceneId], provider, selectedModel || undefined)
      .then(({ job_id }) => {
        subscribeToJob(job_id, (ev: JobEvent) => {
          if (ev.type === "completed") {
            setEnrichingAfterRewrite(false);
            const enrichedSb = ev.data?.storyboard as StoryboardJson | undefined;
            if (enrichedSb) {
              setStoryboard((prev) => {
                if (!prev) return enrichedSb;
                const mergedScenes = prev.scenes.map((prevScene) => {
                  const enrichedScene = enrichedSb.scenes.find((s) => s.scene_id === prevScene.scene_id);
                  if (!enrichedScene) return prevScene;
                  return { ...prevScene, slide_panels: enrichedScene.slide_panels, render_hints: enrichedScene.render_hints };
                });
                return { ...prev, scenes: mergedScenes };
              });
            }
          } else if (ev.type === "error" || ev.type === "throttled") {
            setEnrichingAfterRewrite(false);
          }
        });
      })
      .catch(() => { setEnrichingAfterRewrite(false); });
  }

  function triggerEnrich(langs: string[], sceneIds?: string[]) {
    if (enriching) return;
    setEnriching(true);
    setEnrichMsg("Anreicherung läuft...");
    api.enrichStoryboard(videoId, langs, sceneIds, provider, selectedModel || undefined)
      .then(({ job_id }) => {
        subscribeToJob(job_id, (ev: JobEvent) => {
          setEnrichMsg(ev.message);
          if (ev.type === "completed") {
            setEnriching(false);
            setEnrichMsg("");
            // Nur slide_panels und render_hints aus dem Enrich-Ergebnis in den aktuellen State mergen
            // NICHT das gesamte Storyboard ersetzen – das würde laufende/abgeschlossene Rewrites überschreiben
            const enrichedSb = ev.data?.storyboard as StoryboardJson | undefined;
            if (enrichedSb) {
              setStoryboard((prev) => {
                if (!prev) return enrichedSb;
                const mergedScenes = prev.scenes.map((prevScene) => {
                  const enrichedScene = enrichedSb.scenes.find((s) => s.scene_id === prevScene.scene_id);
                  if (!enrichedScene) return prevScene;
                  return {
                    ...prevScene,
                    slide_panels: enrichedScene.slide_panels,
                    render_hints: enrichedScene.render_hints,
                  };
                });
                return { ...prev, scenes: mergedScenes };
              });
            } else {
              // Fallback: Storyboard vom Server laden und slide_panels/render_hints mergen
              api.getStoryboard(videoId).then((serverSb) => {
                setStoryboard((prev) => {
                  if (!prev) return serverSb;
                  const mergedScenes = prev.scenes.map((prevScene) => {
                    const serverScene = serverSb.scenes.find((s) => s.scene_id === prevScene.scene_id);
                    if (!serverScene) return prevScene;
                    return {
                      ...prevScene,
                      slide_panels: serverScene.slide_panels,
                      render_hints: serverScene.render_hints,
                    };
                  });
                  return { ...prev, scenes: mergedScenes };
                });
              }).catch(console.error);
            }
          } else if (ev.type === "error" || ev.type === "throttled") {
            setEnriching(false);
            setEnrichMsg("");
          }
        });
      })
      .catch(() => { setEnriching(false); setEnrichMsg(""); });
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
            <button
              className={`btn ${showDebug ? "btn-primary" : "btn-ghost"}`}
              style={{ fontSize: 12 }}
              onClick={() => setShowDebug((v) => !v)}
              title="KI-Prompt-Debug anzeigen"
            >
              {showDebug ? "🔍 Debug aktiv" : "🔍 Debug"}
              {debugLogs.length > 0 && <span style={{ marginLeft: 4, fontSize: 10, background: "#1565c0", borderRadius: 8, padding: "0 5px" }}>{debugLogs.length}</span>}
            </button>
            <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowJson(!showJson)}>
              {showJson ? "Editor" : "JSON"}
            </button>
            {storyboard && <button className="btn btn-primary" onClick={saveStoryboard} disabled={saving}>
              {saving ? "Speichern..." : "Speichern"}
            </button>}
            {storyboard && (
              <button
                className="btn btn-success"
                onClick={() => {
                  // Vor dem Weiter ggf. Anreicherung starten wenn nicht schon erledigt
                  if (!enriching) {
                    const langs = storyboard.languages.length ? storyboard.languages : languages;
                    const needEnrich = storyboard.scenes.filter(
                      (s) => s.image_group.length > 1 && !s.slide_panels?.[langs[0]]?.length
                    );
                    if (needEnrich.length > 0) {
                      triggerEnrich(langs, needEnrich.map((s) => s.scene_id));
                    }
                  }
                  onDone();
                }}
              >
                Weiter → Rendering
              </button>
            )}
          </div>
        </div>

        {!storyboard && !analyzing && (
          <>
            <p style={{ color: "#aaa" }}>Noch kein Storyboard. KI-Analyse starten:</p>

            <div style={{ marginBottom: 14 }}>
              <label htmlFor="master-prompt-input" style={{ fontSize: 13, color: "#90caf9", display: "block", marginBottom: 6 }}>
                Allgemeiner Master-Prompt
              </label>
              <textarea
                id="master-prompt-input"
                rows={4}
                value={masterPrompt}
                onChange={(e) => setMasterPrompt(e.target.value)}
                placeholder="Gesamtanweisung fuer das Storyboard..."
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  resize: "vertical",
                  minHeight: 84,
                  background: "#0d1520",
                  color: "#d7ecff",
                  border: "1px solid #203b56",
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontFamily: "inherit",
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              />
            </div>

            {/* Provider-Auswahl */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 13, color: "#90caf9", minWidth: 80 }}>Provider:</span>
              {availableProviders.map((p) => (
                <button
                  key={p.id}
                  className={`btn ${provider === p.id ? "btn-primary" : "btn-ghost"}`}
                  style={{ fontSize: 13, padding: "4px 16px", textTransform: "capitalize" }}
                  onClick={() => setProvider(p.id)}
                >
                  {p.label}
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
                value={langInput}
                onChange={(e) => setLangInput(e.target.value)}
                onBlur={() => {
                  const parsed = langInput.split(",").map((l) => l.trim()).filter(Boolean);
                  setLanguages(parsed);
                  setLangInput(parsed.join(","));
                }}
                placeholder="de,en"
                style={{ width: 160 }}
              />
              <span style={{ fontSize: 12, color: "#888" }}>ISO-Codes, kommagetrennt</span>
            </div>

            <button
              className="btn btn-primary"
              onClick={() => runAnalyze()}
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

        {enriching && enrichMsg && (
          <p style={{ color: "#81c784", fontSize: 12, margin: "4px 0 0" }}>
            ⏳ {enrichMsg}
          </p>
        )}

        {throttleDialog && (
          <div role="alert" style={{
            background: "#1a2a1a", border: "1px solid #f57f17", borderRadius: 8,
            padding: "14px 16px", marginTop: 8,
          }}>
            <p style={{ color: "#ffb74d", fontWeight: 600, margin: "0 0 10px" }}>
              ⚠️ Modell überlastet – bitte wähle ein alternatives Modell:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {throttleDialog.alternatives.map((alt) => (
                <button
                  key={`${alt.provider}-${alt.model}`}
                  className="btn btn-ghost"
                  style={{ fontSize: 12, borderColor: "#f57f17", color: "#ffb74d" }}
                  onClick={() => {
                    setThrottleDialog(null);
                    if (throttleDialog.context === "analyze") {
                      runAnalyze(alt.provider, alt.model);
                    } else {
                      runRewriteScene(alt.provider, alt.model);
                    }
                  }}
                >
                  {alt.label}
                </button>
              ))}
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, color: "#888" }}
                onClick={() => setThrottleDialog(null)}
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>

      {storyboard && !showJson && (
        <div style={{ display: "flex", gap: 16 }}>
          {/* Szenen-Liste */}
          <div style={{ width: 200, flexShrink: 0 }}>
            {storyboard.scenes.map((s, i) => (
              <div
                key={s.scene_id}
                onDragOver={(e) => { e.preventDefault(); setDragOverScene(i); }}
                onDragLeave={() => setDragOverScene(null)}
                onDrop={(e) => handleSceneDrop(e, i)}
                className="card"
                style={{
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
                  position: "relative",
                }}
              >
                {/* Klick-Bereich */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveScene(i)}
                  onKeyDown={(e) => e.key === "Enter" && setActiveScene(i)}
                  style={{ cursor: "pointer" }}
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
                {/* Löschen-Button */}
                {storyboard.scenes.length > 1 && (
                  <button
                    title="Szene löschen"
                    onClick={(e) => { e.stopPropagation(); deleteScene(i); }}
                    style={{
                      position: "absolute", top: 6, right: 6,
                      background: "rgba(180,40,40,0.85)", border: "none", borderRadius: "50%",
                      width: 18, height: 18, cursor: "pointer", color: "#fff",
                      fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
                      lineHeight: 1, padding: 0,
                    }}
                  >✕</button>
                )}
              </div>
            ))}
            {/* Szene hinzufügen */}
            <button
              className="btn btn-ghost"
              style={{ width: "100%", fontSize: 12, padding: "6px 0", borderStyle: "dashed", color: "#4fc3f7", borderColor: "#4fc3f7" }}
              onClick={addScene}
            >
              + Szene hinzufügen
            </button>
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
                      onClick={() => setShowRewritePanel((v) => !v)}
                      disabled={rewritingScene || scene.image_group.length === 0}
                    >
                      {rewritingScene ? `⏳ ${rewriteProgress}%` : `🤖 KI: Szene neu schreiben ${showRewritePanel ? "▲" : "▼"}`}
                    </button>
                  </div>
                </div>

                {/* KI Rewrite Panel */}
                {showRewritePanel && !rewritingScene && (
                  <div style={{ marginBottom: 14, padding: "12px 14px", background: "#0a0f1a", borderRadius: 6, border: "1px solid #1e3a5f" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                      {/* Anredeform */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, minWidth: 110, color: "#8ab" }}>Anredeform:</span>
                        {[{ v: "sie", l: "Sie" }, { v: "du", l: "Du" }, { v: "neutral", l: "Neutral" }].map(({ v, l }) => (
                          <button type="button" key={v} className={`btn ${rewriteAddressStyle === v ? "btn-primary" : "btn-ghost"}`}
                            style={{ fontSize: 12, padding: "2px 12px" }} onClick={() => setRewriteAddressStyle(v)}>{l}</button>
                        ))}
                      </div>

                      {/* Schreibstil */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, minWidth: 110, color: "#8ab" }}>Schreibstil:</span>
                        {[{ v: "sachlich", l: "Sachlich" }, { v: "leicht_verstaendlich", l: "Leicht verständlich" }, { v: "technisch_detailliert", l: "Technisch detailliert" }].map(({ v, l }) => (
                          <button type="button" key={v} className={`btn ${rewriteWritingStyle === v ? "btn-primary" : "btn-ghost"}`}
                            style={{ fontSize: 12, padding: "2px 12px" }} onClick={() => setRewriteWritingStyle(v)}>{l}</button>
                        ))}
                      </div>

                      {/* Detailtiefe */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, minWidth: 110, color: "#8ab" }}>Detailtiefe:</span>
                        {[{ v: "kurz", l: "Kurz" }, { v: "standard", l: "Standard" }, { v: "ausfuehrlich", l: "Ausführlich" }].map(({ v, l }) => (
                          <button type="button" key={v} className={`btn ${rewriteDetailLevel === v ? "btn-primary" : "btn-ghost"}`}
                            style={{ fontSize: 12, padding: "2px 12px" }} onClick={() => setRewriteDetailLevel(v)}>{l}</button>
                        ))}
                      </div>

                      {/* KI-Provider */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, minWidth: 110, color: "#8ab" }}>KI-Provider:</span>
                        {availableProviders.map((p) => (
                          <button type="button" key={p.id} className={`btn ${provider === p.id ? "btn-primary" : "btn-ghost"}`}
                            style={{ fontSize: 12, padding: "2px 12px" }} onClick={() => setProvider(p.id)}>{p.label}</button>
                        ))}
                      </div>

                      {/* KI-Modell */}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, minWidth: 110, color: "#8ab" }}>KI-Modell:</span>
                        {modelsLoading && <span style={{ fontSize: 12, color: "#666" }}>Lädt...</span>}
                        {modelsError && <span style={{ fontSize: 12, color: "#ef5350" }}>⚠ {modelsError}</span>}
                        {!modelsLoading && !modelsError && (
                          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
                            aria-label="KI-Modell auswählen"
                            style={{ fontSize: 12, padding: "3px 8px", background: "#1a1a2e", color: "#e0e0e0", border: "1px solid #333", borderRadius: 4, minWidth: 200 }}>
                            {availableModels.map((m, i) => (
                              <option key={m} value={m}>{i + 1}. {m}</option>
                            ))}
                          </select>
                        )}
                      </div>

                      {/* Start-Button */}
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                        <button type="button" className="btn btn-primary" style={{ fontSize: 13, padding: "5px 20px" }}
                          onClick={() => {
                            setShowRewritePanel(false);
                            const styleInfo = `Anredeform: ${rewriteAddressStyle}, Stil: ${rewriteWritingStyle}, Detail: ${rewriteDetailLevel}`;
                            runRewriteScene(undefined, undefined, undefined, undefined, `Manueller Rewrite – ${styleInfo}`);
                          }}
                          disabled={scene.image_group.length === 0}>
                          Szene neu schreiben
                        </button>
                      </div>

                    </div>
                  </div>
                )}

                {/* Bilder-Gruppe */}
                <div
                  style={{ marginBottom: 14, padding: "10px 12px", background: "#0a0f1a", borderRadius: 6,
                    border: dragOverImageGroup ? "2px solid #4fc3f7" : "1px solid #1a2a3a",
                    transition: "border 0.15s",
                  }}
                  onDragOver={(e) => { if (dragInfo && dragInfo.fromScene !== activeScene) { e.preventDefault(); setDragOverImageGroup(true); } }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverImageGroup(false); }}
                  onDrop={handleImageGroupDrop}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#6080a0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                    Bilder dieser Szene ({scene.image_group.length}) · ziehen = reihenfolge ändern / in andere szene · ✕ = entfernen
                  </div>
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: 5, minHeight: 34 }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setDragOverInsideFilename(null);
                      }
                    }}
                  >
                    {scene.image_group.length === 0 && (
                      <span style={{ fontSize: 12, color: "#555", fontStyle: "italic" }}>Keine Bilder zugeordnet</span>
                    )}
                    {scene.image_group.map((filename) => {
                      const src = api.frameImageUrl(videoId, filename);
                      const isDropTarget = dragOverInsideFilename === filename && dragInfo?.fromScene === activeScene;
                      return (
                        <div
                          key={filename}
                          draggable
                          style={{
                            flexShrink: 0, cursor: "grab", width: 88,
                            borderLeft: isDropTarget ? "3px solid #4fc3f7" : "3px solid transparent",
                            borderRadius: 4,
                            transition: "border-color 0.1s",
                            opacity: dragInfo?.filename === filename && dragInfo.fromScene === activeScene ? 0.4 : 1,
                          }}
                          title={`${filename} – ziehen = Reihenfolge ändern / in andere Szene verschieben`}
                          onDragStart={(e) => handleDragStart(e, filename, activeScene)}
                          onDragEnd={() => { setDragInfo(null); setDragOverInsideFilename(null); }}
                          onDragOver={(e) => handleInsideItemDragOver(e, filename)}
                          onDrop={(e) => handleInsideItemDrop(e, filename)}
                        >
                          {/* Bild + Badges */}
                          <div
                            style={{ position: "relative" }}
                            onMouseEnter={(e) => handleImgHover(src, e)}
                            onMouseMove={(e) => handleImgHover(src, e)}
                            onMouseLeave={() => setHoveredImg(null)}
                          >
                            <img
                              src={src}
                              alt={filename}
                              style={{ width: 88, height: 50, objectFit: "cover", borderRadius: 4, border: "1px solid #2a4a6a", display: "block", pointerEvents: "none" }}
                            />
                            {/* Reihenfolge-Nummer */}
                            <div style={{
                              position: "absolute", bottom: 2, left: 2,
                              background: "rgba(10,20,50,0.85)", borderRadius: 3,
                              padding: "1px 4px", fontSize: 9, color: "#90caf9",
                              fontWeight: 700, pointerEvents: "none",
                            }}>{scene.image_group.indexOf(filename) + 1}</div>
                            {/* Entfernen-Button */}
                            <button
                              title="Bild entfernen"
                              onClick={(e) => { e.stopPropagation(); removeFrameFromScene(activeScene, filename); }}
                              style={{
                                position: "absolute", top: 2, right: 2,
                                background: "rgba(180,40,40,0.9)", border: "none", borderRadius: "50%",
                                width: 14, height: 14, cursor: "pointer", color: "#fff",
                                fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center",
                                lineHeight: 1, padding: 0,
                              }}
                            >✕</button>
                          </div>
                          {/* Per-Bild KI-Anweisung */}
                          <textarea
                            draggable={false}
                            placeholder="KI-Anweisung…"
                            value={scene.image_prompts?.[filename] ?? ""}
                            rows={2}
                            onClick={(e) => e.stopPropagation()}
                            onDragStart={(e) => e.preventDefault()}
                            onMouseEnter={() => setHoveredImg(null)}
                            onChange={(e) => { e.stopPropagation(); setImagePrompt(activeScene, filename, e.target.value); }}
                            style={{
                              width: "100%", boxSizing: "border-box",
                              marginTop: 3, padding: "2px 4px",
                              fontSize: 9, lineHeight: 1.35,
                              background: "#0d1a2a", color: "#90caf9",
                              border: scene.image_prompts?.[filename]?.trim()
                                ? "1px solid #4fc3f7"
                                : "1px solid #1a3050",
                              borderRadius: 3, resize: "none",
                              fontFamily: "inherit", cursor: "text",
                            }}
                          />
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

      {/* Debug-Panel: KI-Prompts */}
      {showDebug && (
        <div className="card" style={{ marginTop: 12, background: "#080d14", border: "1px solid #1565c0" }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 12 }}>
            <span style={{ color: "#4fc3f7", fontWeight: 700, fontSize: 13 }}>
              \ud83d\udd0d KI-Prompt-Debug ({debugLogs.length} Backend-Eintr\u00e4ge)
            </span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: "2px 8px", marginLeft: "auto" }}
              onClick={() => setDebugLogs([])}
            >
              Leeren
            </button>
          </div>
          <div style={{ background: "#0d1520", borderRadius: 6, padding: "8px 12px", border: "1px solid #1a3050", marginBottom: 8 }}>
            <div style={{ fontSize: 11, background: "#0d2a4a", color: "#4fc3f7", borderRadius: 3, padding: "0 6px", display: "inline-block", marginBottom: 5 }}>
              analyse-preview
            </div>
            <pre style={{
              margin: 0, fontSize: 11, color: "#90b4c8",
              fontFamily: "'Consolas', 'Courier New', monospace",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
              maxHeight: 320, overflowY: "auto",
              background: "#050a10", borderRadius: 4, padding: "6px 8px",
            }}>{analyzePromptPreview}</pre>
          </div>
          {debugLogs.length === 0 && (
            <p style={{ color: "#556", fontSize: 12, margin: 0 }}>
              Noch keine KI-Anfragen aufgezeichnet. Starte eine Analyse oder einen Rewrite.
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 480, overflowY: "auto" }}>
            {[...debugLogs].reverse().map((log, i) => (
              <div key={i} style={{ background: "#0d1520", borderRadius: 6, padding: "8px 12px", border: "1px solid #1a3050" }}>
                <div style={{ display: "flex", gap: 10, marginBottom: 4, alignItems: "baseline" }}>
                  <span style={{ fontSize: 10, color: "#556", fontFamily: "monospace", flexShrink: 0 }}>{log.ts}</span>
                  <span style={{ fontSize: 11, background: "#0d2a4a", color: "#4fc3f7", borderRadius: 3, padding: "0 6px", flexShrink: 0 }}>{log.step}</span>
                </div>
                <pre style={{
                  margin: 0, fontSize: 11, color: "#90b4c8",
                  fontFamily: "'Consolas', 'Courier New', monospace",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                  maxHeight: 260, overflowY: "auto",
                  background: "#050a10", borderRadius: 4, padding: "6px 8px",
                }}>{log.content}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Storyboard-Zusammenfassung vor/nach Analyse */}
      {storyboardDraftScenes.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6080a0", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
            Storyboard-Zusammenfassung ({storyboardDraftScenes.length} Szene(n), {refFrames.length} Frame(s))
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {storyboardDraftScenes.map((group, sceneIdx) => {
              const description = draftHints?.sceneDescriptions?.[sceneIdx]?.trim();
              const promptedFrames = group.filter((filename) => draftHints?.imagePrompts?.[filename]?.trim());
              return (
                <div
                  key={`draft-scene-${sceneIdx}`}
                  style={{
                    background: "#0d1520",
                    border: "1px solid #203b56",
                    borderRadius: 6,
                    padding: 10,
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
                    <strong style={{ color: "#90caf9", fontSize: 13 }}>Szene {sceneIdx + 1}</strong>
                    <span style={{ color: "#6f8aa5", fontSize: 11 }}>{group.length} Frame(s)</span>
                    {promptedFrames.length > 0 && (
                      <span style={{ marginLeft: "auto", color: "#4fc3f7", fontSize: 11 }}>
                        {promptedFrames.length} Bild-Hinweis(e)
                      </span>
                    )}
                  </div>
                  {description && (
                    <p style={{ margin: "0 0 8px", color: "#c8e6ff", fontSize: 12, lineHeight: 1.4 }}>
                      {description}
                    </p>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {group.map((filename, frameIdx) => {
                      const src = api.frameImageUrl(videoId, filename);
                      const assignedScene = storyboard?.scenes.findIndex((s) => s.image_group.includes(filename)) ?? -1;
                      const imagePrompt = draftHints?.imagePrompts?.[filename]?.trim();
                      const isDragging = dragInfo?.filename === filename && dragInfo.fromScene === null;
                      return (
                        <div
                          key={filename}
                          draggable
                          title={`${filename}${imagePrompt ? ` - KI: ${imagePrompt}` : ""}`}
                          style={{ position: "relative", flexShrink: 0, cursor: "grab", opacity: isDragging ? 0.4 : 1 }}
                          onDragStart={(e) => { setDragInfo({ filename, fromScene: null }); e.dataTransfer.effectAllowed = "copy"; }}
                          onDragEnd={() => setDragInfo(null)}
                          onMouseEnter={(e) => handleImgHover(src, e)}
                          onMouseMove={(e) => handleImgHover(src, e)}
                          onMouseLeave={() => setHoveredImg(null)}
                        >
                          <img
                            src={src}
                            alt={`Szene ${sceneIdx + 1}, Frame ${frameIdx + 1}`}
                            style={{
                              width: 72,
                              height: 41,
                              objectFit: "cover",
                              borderRadius: 4,
                              border: `1px solid ${imagePrompt ? "#4fc3f7" : assignedScene >= 0 ? "#2a4a6a" : "#6a2a2a"}`,
                              display: "block",
                              opacity: assignedScene >= 0 || !storyboard ? 1 : 0.5,
                              pointerEvents: "none",
                            }}
                          />
                          <div style={{
                            position: "absolute",
                            bottom: 2,
                            right: 2,
                            background: imagePrompt ? "rgba(21,101,192,0.9)" : "rgba(10,30,60,0.85)",
                            color: imagePrompt ? "#e3f2fd" : "#90caf9",
                            fontSize: 9,
                            padding: "1px 4px",
                            borderRadius: 3,
                            fontWeight: 700,
                            pointerEvents: "none",
                          }}>
                            {imagePrompt ? "KI" : frameIdx + 1}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {storyboard && (() => {
            const unassigned = refFrames.filter(
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
