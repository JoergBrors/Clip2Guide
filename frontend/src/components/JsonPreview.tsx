import React, { useState } from "react";
import { StoryboardJson } from "../api/backendClient";

interface Props {
  storyboard: StoryboardJson;
  onChange: (updated: StoryboardJson) => void;
}

export default function JsonPreview({ storyboard, onChange }: Props): React.ReactElement {
  const [text, setText] = useState(() => JSON.stringify(storyboard, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  function handleChange(value: string) {
    setText(value);
    try {
      const parsed = JSON.parse(value) as StoryboardJson;
      setParseError(null);
      onChange(parsed);
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : "JSON-Fehler");
    }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ margin: 0, color: "#90caf9" }}>Storyboard JSON</h3>
        {parseError && (
          <span role="alert" style={{ marginLeft: 16, color: "#ef5350", fontSize: 13 }}>
            Parse-Fehler: {parseError}
          </span>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={30}
        style={{
          fontFamily: "monospace",
          fontSize: 13,
          background: "#0d1117",
          color: "#e0e0e0",
          border: `1px solid ${parseError ? "#ef5350" : "#333"}`,
          borderRadius: 6,
          padding: 12,
          width: "100%",
          resize: "vertical",
        }}
        spellCheck={false}
        aria-label="Storyboard JSON"
      />
    </div>
  );
}
