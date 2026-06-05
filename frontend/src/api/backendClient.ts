/**
 * Backend-Client: typsichere Wrapper fuer alle REST-Endpunkte.
 * Nutzt window.clip2guide.backendUrl oder faellt auf localhost:8787 zurueck.
 */

const BASE = typeof window !== "undefined" && window.clip2guide?.backendUrl
  ? window.clip2guide.backendUrl
  : "http://localhost:8787";

// ── Typen ──────────────────────────────────────────────────────────────────────

export interface UploadResponse {
  video_id: string;
  filename: string;
  path: string;
  has_audio: boolean;
  metadata: Record<string, unknown>;
}

export interface JobStartResponse {
  job_id: string;
  video_id: string;
  message: string;
}

export interface FrameInfo {
  filename: string;
  timestamp_seconds: number;
  scene_index: number | null;
  /** Lokale Bild-URL fuer importierte Frames (Datei/Zwischenablage) */
  dataUrl?: string;
}

export interface FrameStack {
  video_id: string;
  frames: FrameInfo[];
  total_frames: number;
}

export interface StoryboardDraftHints {
  masterPrompt?: string;
  sceneDescriptions: string[];
  imagePrompts: Record<string, string>;
}

export interface TextPanel {
  heading: string;
  body: string;
  speaker_notes: string;
}

export interface RenderHints {
  transition?: "fade" | "cut";
  image_durations?: number[];
  text_scroll_speed?: number;
}

export interface Scene {
  scene_id: string;
  start_frame: string;
  end_frame: string | null;
  image_group: string[];
  image_prompts: Record<string, string>;  // optional – wird vom Backend mit {} befüllt
  texts: Record<string, TextPanel>;
  slide_panels?: Record<string, TextPanel[]>;
  render_hints?: RenderHints;
  duration_seconds: number;
}

export interface StoryboardJson {
  video_id: string;
  source_video: string;
  cut_video: string | null;
  languages: string[];
  scenes: Scene[];
  metadata: Record<string, unknown>;
}

export interface ThrottleAlternative {
  provider: string;
  model: string;
  label: string;
}

export interface JobEvent {
  type: "progress" | "completed" | "error" | "log" | "throttled" | "debug";
  step: string;
  message: string;
  percent: number;
  data?: Record<string, unknown>;
}

export interface ImageInfo {
  image_id: string;
  filename: string;
  width: number;
  height: number;
}

export interface ImageSetResponse {
  session_id: string;
  images: ImageInfo[];
}

export interface NormalizeRequest {
  session_id: string;
  target_width: number;
  target_height: number;
  mode: "crop" | "fit" | "stretch";
}

export interface NormalizeResponse {
  session_id: string;
  images: ImageInfo[];
}

export interface ProjectExportResponse {
  video_id: string;
  filename: string;
  path: string;
  message: string;
}

export interface ProjectImportResponse {
  video_id: string;
  original_video_id: string;
  restored_files: number;
  message: string;
}

// ── API-Funktionen ─────────────────────────────────────────────────────────────

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${url}`, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health(): Promise<{ status: string; version: string }> {
    return request("/health");
  },

  uploadVideo(file: File): Promise<UploadResponse> {
    const form = new FormData();
    form.append("file", file);
    return request<UploadResponse>("/api/upload/video", { method: "POST", body: form });
  },

  uploadVideoWithProgress(file: File, uploadId: string): Promise<UploadResponse> {
    const form = new FormData();
    form.append("file", file);
    const params = new URLSearchParams({ upload_id: uploadId, file_size: String(file.size) });
    return request<UploadResponse>(`/api/upload/video?${params}`, { method: "POST", body: form });
  },

  openUploadEvents(
    uploadId: string,
    onEvent: (event: JobEvent) => void,
  ): EventSource {
    const src = new EventSource(`${BASE}/api/upload/${uploadId}/events`);
    src.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data as string) as JobEvent;
        onEvent(parsed);
      } catch {
        // malformed event ignorieren
      }
    };
    return src;
  },

  normalizeVideo(videoId: string, hasAudio: boolean): Promise<JobStartResponse> {
    return request<JobStartResponse>(
      `/api/videos/${videoId}/normalize?has_audio=${hasAudio}`,
      { method: "POST" }
    );
  },

  cutVideo(
    videoId: string,
    editMode: string,
    hasAudio: boolean,
    margin?: string,
    audioThreshold?: number,
    motionThreshold?: number,
  ): Promise<JobStartResponse> {
    return request<JobStartResponse>(`/api/videos/${videoId}/cut`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: videoId,
        edit_mode: editMode,
        has_audio: hasAudio,
        margin,
        audio_threshold: audioThreshold,
        motion_threshold: motionThreshold,
      }),
    });
  },

  extractFrames(videoId: string): Promise<JobStartResponse> {
    return request<JobStartResponse>(`/api/videos/${videoId}/extract-frames`, { method: "POST" });
  },

  async getFrameStack(videoId: string): Promise<FrameStack | null> {
    const res = await fetch(`${BASE}/api/videos/${videoId}/frame-stack`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
    return res.json() as Promise<FrameStack>;
  },

  frameImageUrl(videoId: string, filename: string): string {
    return `${BASE}/api/videos/${videoId}/frames/${filename}`;
  },

  getAiProviders(): Promise<{ providers: { id: string; label: string }[]; default: string }> {
    return request("/api/ai/providers");
  },

  getAiModels(provider: string): Promise<{ provider: string; models: string[]; default: string }> {
    return request(`/api/ai/models?provider=${encodeURIComponent(provider)}`);
  },

  analyzeVideo(
    videoId: string,
    languages: string[],
    provider?: string,
    model?: string,
    selectedFrames?: string[],
    sceneGroups?: string[][],
    draftHints?: StoryboardDraftHints | null,
  ): Promise<JobStartResponse> {
    return request<JobStartResponse>(`/api/videos/${videoId}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: videoId,
        languages,
        ai_provider: provider,
        ai_model: model,
        selected_frames: selectedFrames ?? [],
        scene_groups: sceneGroups ?? null,
        master_prompt: draftHints?.masterPrompt ?? "",
        scene_descriptions: draftHints?.sceneDescriptions ?? [],
        image_prompts: draftHints?.imagePrompts ?? {},
      }),
    });
  },

  getStoryboard(videoId: string): Promise<StoryboardJson> {
    return request<StoryboardJson>(`/api/videos/${videoId}/storyboard`);
  },

  updateStoryboard(videoId: string, storyboard: StoryboardJson): Promise<StoryboardJson> {
    return request<StoryboardJson>(`/api/videos/${videoId}/storyboard`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storyboard }),
    });
  },

  rewriteScene(
    videoId: string,
    sceneId: string,
    imageGroup: string[],
    languages: string[],
    currentTexts?: Record<string, { heading: string; body: string; speaker_notes: string }>,
    imagePrompts?: Record<string, string>,
    provider?: string,
    model?: string,
    durationSeconds?: number,
    storyboardContext?: Record<string, unknown>,
    changeSummary?: string,
  ): Promise<JobStartResponse> {
    return request<JobStartResponse>(`/api/videos/${videoId}/rewrite-scene`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scene_id: sceneId,
        image_group: imageGroup,
        languages,
        current_texts: currentTexts,
        image_prompts: imagePrompts,
        ai_provider: provider,
        ai_model: model,
        duration_seconds: durationSeconds,
        storyboard_context: storyboardContext,
        change_summary: changeSummary,
      }),
    });
  },

  uploadCustomFrames(videoId: string, files: File[]): Promise<FrameStack> {
    const form = new FormData();
    for (const file of files) {
      form.append("files", file);
    }
    return request<FrameStack>(`/api/videos/${videoId}/frames/upload`, { method: "POST", body: form });
  },

  async updateFrame(videoId: string, filename: string, dataUrl: string): Promise<void> {
    // fetch(dataUrl) schlaegt in Electron fehl – direkt mit atob() konvertieren
    const [header, base64] = dataUrl.split(",");
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: mime });
    const form = new FormData();
    form.append("file", blob, filename);
    await request<{ ok: boolean }>(`/api/videos/${videoId}/frames/${encodeURIComponent(filename)}`, {
      method: "PUT",
      body: form,
    });
  },

  renderVideo(
    videoId: string,
    languages: string[],
    fps?: number,
    quality?: string,
    ttsSlow?: boolean,
    outputFormats?: Array<"video" | "manual">,
    handbookOptimize?: boolean,
    provider?: string,
    model?: string,
  ): Promise<JobStartResponse> {
    return request<JobStartResponse>(`/api/videos/${videoId}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        video_id: videoId,
        languages,
        output_formats: outputFormats ?? ["video"],
        handbook_optimize: handbookOptimize ?? false,
        ai_provider: provider,
        ai_model: model,
        fps: fps ?? 25,
        quality: quality ?? "ausgewogen",
        tts_slow: ttsSlow ?? false,
      }),
    });
  },

  uploadImages(files: File[]): Promise<ImageSetResponse> {
    const form = new FormData();
    for (const file of files) {
      form.append("files", file);
    }
    return request<ImageSetResponse>("/api/upload/images", { method: "POST", body: form });
  },

  normalizeImages(req: NormalizeRequest): Promise<NormalizeResponse> {
    return request<NormalizeResponse>("/api/images/normalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
  },

  imagesToFrames(sessionId: string): Promise<FrameStack> {
    return request<FrameStack>(`/api/images/${sessionId}/to-frames`, { method: "POST" });
  },

  imageUrl(sessionId: string, imageId: string, normalized = false): string {
    const q = normalized ? "?normalized=true" : "";
    return `${BASE}/api/images/${sessionId}/${imageId}${q}`;
  },

  enrichStoryboard(
    videoId: string,
    languages: string[],
    sceneIds?: string[],
    provider?: string,
    model?: string,
  ): Promise<JobStartResponse> {
    return request<JobStartResponse>(`/api/videos/${videoId}/storyboard/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        languages,
        scene_ids: sceneIds ?? null,
        ai_provider: provider,
        ai_model: model,
      }),
    });
  },

  exportProject(videoId: string): Promise<ProjectExportResponse> {
    return request<ProjectExportResponse>(`/api/videos/${videoId}/export-project`, { method: "POST" });
  },

  projectDownloadUrl(videoId: string, filename: string): string {
    return `${BASE}/api/videos/${videoId}/project/${encodeURIComponent(filename)}`;
  },

  importProjectZip(file: File, restoreMode = "new_id"): Promise<ProjectImportResponse> {
    const form = new FormData();
    form.append("file", file);
    form.append("restore_mode", restoreMode);
    return request<ProjectImportResponse>("/api/projects/import", { method: "POST", body: form });
  },
};

// ── SSE Job-Helper ────────────────────────────────────────────────────────────

export function subscribeToJob(
  jobId: string,
  onEvent: (event: JobEvent) => void,
  onDone?: () => void
): () => void {
  const url = `${BASE}/api/jobs/${jobId}/events`;
  const es = new EventSource(url);

  // Verhindert, dass onerror nach einem intentionalen close() faelschlich
  // einen Fehler meldet (passiert in einigen Browsern/Electron nach es.close()).
  let intentionallyClosed = false;

  es.onmessage = (msg) => {
    try {
      const event: JobEvent = JSON.parse(msg.data);
      onEvent(event);
      if (event.type === "completed" || event.type === "error") {
        intentionallyClosed = true;
        es.close();
        onDone?.();
      }
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    if (intentionallyClosed) return; // Normales Ende nach completed/error – kein Fehler
    // EventSource versucht nach Fehlern automatisch neu zu verbinden.
    // Wir schliessen explizit und melden einen Fehler.
    intentionallyClosed = true;
    es.close();
    onEvent({
      type: "error",
      step: "sse",
      message: "Verbindung zum Server unterbrochen. Ist das Backend gestartet?",
      percent: 0,
    });
    onDone?.();
  };

  // Cleanup-Funktion
  return () => {
    intentionallyClosed = true;
    es.close();
  };
}
