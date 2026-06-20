import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, StoryboardJson, subscribeToJob } from "../api/backendClient";

const WAVE_STYLE = `
@keyframes chatWave {
  0%,100% { transform: translateY(0) scaleX(1); color: #4caf50; text-shadow: none; }
  50%      { transform: translateY(-5px) scaleX(1.15); color: #a5d6a7;
             text-shadow: 0 0 8px #81c784, 0 2px 12px #2e7d32; }
}
.chat-wave-letter {
  display: inline-block;
  animation: chatWave 1.4s ease-in-out infinite;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.03em;
}
`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  updateCount?: number;
}

interface SceneUpdate {
  scene_id: string;
  lang: string;
  field: "heading" | "body" | "speaker_notes";
  value: string;
}

interface ChatFloatPanelProps {
  videoId: string;
  storyboard: StoryboardJson;
  onUpdateStoryboard: (updater: (prev: StoryboardJson | null) => StoryboardJson | null) => void;
  provider: string;
  selectedModel: string;
  languages: string[];
  addressStyle: string;
  writingStyle: string;
  detailLevel: string;
  onClose: () => void;
}

function WaveText({ text }: { text: string }): React.ReactElement {
  return (
    <>
      <style>{WAVE_STYLE}</style>
      {text.split("").map((ch, i) =>
        ch === " " ? (
          <span key={i}>&nbsp;</span>
        ) : (
          <span
            key={i}
            className="chat-wave-letter"
            style={{ animationDelay: `${i * 0.08}s` }}
          >
            {ch}
          </span>
        )
      )}
    </>
  );
}

export default function ChatFloatPanel({
  videoId,
  storyboard,
  onUpdateStoryboard,
  provider,
  selectedModel,
  languages,
  addressStyle,
  writingStyle,
  detailLevel,
  onClose,
}: ChatFloatPanelProps): React.ReactElement {
  const dragStart = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const [pos, setPos] = useState({ x: 20, y: 60 });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Eigene Provider/Modell-Auswahl im Chat-Panel
  const [chatProvider, setChatProvider] = useState(provider);
  const [chatModel, setChatModel] = useState(selectedModel);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Modelle laden wenn chatProvider sich ändert
  useEffect(() => {
    if (!chatProvider) return;
    setModelsLoading(true);
    setAvailableModels([]);
    api.getAiModels(chatProvider)
      .then(({ models, default: def }) => {
        setAvailableModels(models);
        setChatModel((m) => (models.includes(m) ? m : (def && models.includes(def) ? def : (models[0] ?? ""))));
      })
      .catch(() => { /* Provider ohne Modelle – bleibt leer */ })
      .finally(() => setModelsLoading(false));
  }, [chatProvider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup SSE on unmount
  useEffect(() => () => { cleanupRef.current?.(); }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragStart.current) return;
      setPos({
        x: dragStart.current.px + e.clientX - dragStart.current.mx,
        y: dragStart.current.py + e.clientY - dragStart.current.my,
      });
    }
    function onUp() { dragStart.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function applyUpdates(updates: SceneUpdate[]): void {
    if (!updates.length) return;
    onUpdateStoryboard((prev) => {
      if (!prev) return prev;
      const sb: StoryboardJson = { ...prev, scenes: [...prev.scenes] };
      for (const upd of updates) {
        const idx = sb.scenes.findIndex((s) => s.scene_id === upd.scene_id);
        if (idx < 0) continue;
        const scene = { ...sb.scenes[idx] };
        const lang = upd.lang ?? (sb.languages[0] ?? "de");
        const currentPanel = scene.texts[lang] ?? { heading: "", body: "", speaker_notes: "" };
        scene.texts = {
          ...scene.texts,
          [lang]: { ...currentPanel, [upd.field]: upd.value },
        };
        sb.scenes[idx] = scene;
      }
      return sb;
    });
  }

  async function handleSend(): Promise<void> {
    const msg = input.trim();
    if (!msg || loading) return;

    setInput("");
    setLoading(true);

    const userMsg: ChatMessage = { role: "user", content: msg, ts: new Date().toLocaleTimeString() };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const { job_id } = await api.chatWithStoryboard(
        videoId, msg,
        chatProvider || undefined,
        chatModel || undefined,
        languages,
        addressStyle,
        writingStyle,
        detailLevel,
      );

      cleanupRef.current?.();
      cleanupRef.current = subscribeToJob(
        job_id,
        (ev) => {
          if (ev.type === "completed") {
            const reply = String((ev.data as Record<string, unknown>)?.reply ?? "");
            const updates = ((ev.data as Record<string, unknown>)?.updates ?? []) as SceneUpdate[];
            applyUpdates(updates);
            const assistantMsg: ChatMessage = {
              role: "assistant",
              content: reply,
              ts: new Date().toLocaleTimeString(),
              updateCount: updates.length,
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setLoading(false);
          } else if (ev.type === "error") {
            const errMsg: ChatMessage = {
              role: "assistant",
              content: `Fehler: ${ev.message}`,
              ts: new Date().toLocaleTimeString(),
            };
            setMessages((prev) => [...prev, errMsg]);
            setLoading(false);
          }
        },
        () => { setLoading(false); },
      );
    } catch (err) {
      const errMsg: ChatMessage = {
        role: "assistant",
        content: `Fehler: ${err instanceof Error ? err.message : String(err)}`,
        ts: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, errMsg]);
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        left: Math.max(0, pos.x),
        top: Math.max(0, pos.y),
        width: 400,
        maxHeight: "80vh",
        background: "#080d14",
        border: "1px solid #2e7d32",
        borderRadius: 10,
        boxShadow: "0 8px 40px rgba(0,0,0,0.8)",
        zIndex: 1200,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Titelleiste */}
      <div
        onMouseDown={onMouseDown}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px", background: "#0d1a0d",
          borderBottom: "1px solid #2e7d32", cursor: "grab", userSelect: "none", flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#81c784", flex: 1 }}>
          💬 KI-Assistent
          {messages.length > 0 && (
            <span style={{ marginLeft: 6, fontSize: 10, background: "#2e7d32", borderRadius: 8, padding: "1px 6px", color: "#fff" }}>
              {messages.length}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{ fontSize: 14, padding: "0 6px", background: "transparent", border: "none", color: "#aaa", cursor: "pointer", lineHeight: 1 }}
        >
          ✕
        </button>
      </div>

      {/* Provider + Modell-Auswahl */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          display: "flex", gap: 6, padding: "6px 10px",
          borderBottom: "1px solid #1a2a1a", background: "#050a05",
          alignItems: "center", flexShrink: 0, flexWrap: "wrap",
        }}
      >
        <select
          value={chatProvider}
          onChange={(e) => setChatProvider(e.target.value)}
          title="KI-Provider"
          style={{
            background: "#0d1a0d", border: "1px solid #2e7d32", borderRadius: 4,
            color: "#81c784", fontSize: 11, padding: "2px 6px", cursor: "pointer", outline: "none",
          }}
        >
          <option value="gemini">Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="azure_openai">Azure OpenAI</option>
          <option value="azure_cognitive">Azure Cognitive</option>
        </select>
        <select
          value={chatModel}
          onChange={(e) => setChatModel(e.target.value)}
          disabled={modelsLoading || availableModels.length === 0}
          title="KI-Modell"
          style={{
            flex: 1, minWidth: 0, background: "#0d1a0d", border: "1px solid #2e7d32", borderRadius: 4,
            color: "#81c784", fontSize: 11, padding: "2px 6px", cursor: "pointer", outline: "none",
          }}
        >
          {modelsLoading && <option value="">Lädt…</option>}
          {!modelsLoading && availableModels.length === 0 && <option value="">{chatModel || "Standard"}</option>}
          {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {/* Chat-Verlauf */}
      <div
        style={{
          flex: 1, overflowY: "auto", padding: "10px 12px",
          display: "flex", flexDirection: "column", gap: 8, minHeight: 120,
        }}
      >
        {messages.length === 0 && !loading && (
          <p style={{ color: "#445", fontSize: 11, textAlign: "center", margin: "20px 0" }}>
            Stell eine Frage oder gib eine Anweisung, z. B.:<br />
            <em style={{ color: "#3a5a3a" }}>"Detailiere die speaker_notes in Szene 2"</em>
          </p>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div
              style={{
                maxWidth: "85%",
                background: msg.role === "user" ? "#0d2a4a" : "#0d1a0d",
                border: `1px solid ${msg.role === "user" ? "#1565c0" : "#2e7d32"}`,
                borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                padding: "8px 12px",
                fontSize: 12,
                color: msg.role === "user" ? "#90caf9" : "#a5d6a7",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {msg.content}
            </div>
            <div style={{ fontSize: 9, color: "#445", marginTop: 2, display: "flex", gap: 8 }}>
              <span>{msg.ts}</span>
              {msg.updateCount !== undefined && msg.updateCount > 0 && (
                <span style={{ color: "#4caf50" }}>
                  ✓ {msg.updateCount} Feld{msg.updateCount !== 1 ? "er" : ""} aktualisiert
                </span>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
            <div style={{
              background: "#0d1a0d", border: "1px solid #2e7d32",
              borderRadius: "12px 12px 12px 2px", padding: "8px 14px",
              fontSize: 13,
            }}>
              <WaveText text="KI denkt…" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Eingabebereich */}
      <div
        style={{
          padding: "8px 12px", borderTop: "1px solid #1a2a1a",
          background: "#050a05", display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0,
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="Nachricht… (Enter = Senden, Shift+Enter = Zeilenumbruch)"
          rows={2}
          style={{
            flex: 1, background: "#0d1a0d", border: "1px solid #2e7d32",
            borderRadius: 6, padding: "6px 10px", color: "#c8e6c9",
            fontSize: 12, fontFamily: "inherit", outline: "none",
            resize: "none", lineHeight: 1.4,
          }}
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={!input.trim() || loading}
          style={{
            background: input.trim() && !loading ? "#2e7d32" : "#1a2a1a",
            border: "none", borderRadius: 6, color: "#fff",
            padding: "6px 14px", fontSize: 12, cursor: input.trim() && !loading ? "pointer" : "default",
            flexShrink: 0, alignSelf: "stretch",
          }}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
