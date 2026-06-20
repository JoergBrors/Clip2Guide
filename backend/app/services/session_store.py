"""
KI-Session-Store: Eine Session pro video_id für die gesamte Laufzeit des Backends.

Die Session hält:
- master_prompt + Sprachen aus der initialen Analyse
- Eine chronologische Ereignis-History (Analyse, Rewrites, Enrich)
- Aktuelle kompakte Szenenübersicht (nur heading pro Szene, kein body/speaker_notes)
- Provider/Modell-Präferenz des letzten Calls

Die Session wird beim Storyboard-Start automatisch angelegt und bei jedem
Rewrite-Aufruf erweitert. Der Backend-Prompt kann so viel schlanker sein:
statt alle Szenen-Texte mitzuschicken reicht ein Verweis auf die Session.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class SessionEvent:
    timestamp: str
    event_type: str          # "analyze" | "rewrite" | "enrich"
    scene_id: str | None
    provider: str
    model: str
    change_summary: str | None
    scene_heading: str | None


@dataclass
class KiSession:
    video_id: str
    created_at: str
    master_prompt: str
    languages: list[str]
    provider: str
    model: str
    # Kompakte Szenenübersicht: scene_id → heading (nur DE oder erste Sprache)
    scene_headings: dict[str, str] = field(default_factory=dict)
    # Chronologische Ereignis-History (max 200 Einträge)
    events: list[SessionEvent] = field(default_factory=list)
    # Letzter vollständiger Prompt-Extra (für Debug-Zwecke)
    last_prompt_extra: str = ""
    # Chronologische Chat-History (max 100 Einträge)
    chat_history: list[dict[str, str]] = field(default_factory=list)

    def add_chat_message(self, role: str, content: str) -> None:
        self.chat_history.append({
            "role": role,
            "content": content,
            "ts": datetime.now().strftime("%H:%M:%S"),
        })
        if len(self.chat_history) > 100:
            self.chat_history = self.chat_history[-100:]

    def add_event(
        self,
        event_type: str,
        scene_id: str | None,
        provider: str,
        model: str,
        change_summary: str | None = None,
        scene_heading: str | None = None,
    ) -> None:
        evt = SessionEvent(
            timestamp=datetime.now().strftime("%H:%M:%S"),
            event_type=event_type,
            scene_id=scene_id,
            provider=provider,
            model=model,
            change_summary=change_summary,
            scene_heading=scene_heading,
        )
        self.events.append(evt)
        if len(self.events) > 200:
            self.events = self.events[-200:]

    def update_scene_heading(self, scene_id: str, heading: str) -> None:
        if heading:
            self.scene_headings[scene_id] = heading

    def context_summary(self) -> str:
        """Kompakter Kontext-String für KI-Prompts (< 500 Zeichen pro Szene)."""
        lines = [
            f"KI-Session für dieses Storyboard:",
            f"  Sprachen: {', '.join(self.languages)}",
            f"  Master-Prompt: {self.master_prompt[:200]}{'...' if len(self.master_prompt) > 200 else ''}",
            f"  Gesamt-Szenen: {len(self.scene_headings)}",
        ]
        if self.scene_headings:
            lines.append("  Aktuelle Szenen-Überschriften:")
            for sid, heading in list(self.scene_headings.items())[:20]:
                lines.append(f"    {sid}: {heading[:80]}")
        recent = self.events[-10:]
        if recent:
            lines.append("  Letzte Aktionen:")
            for ev in recent:
                parts = [f"    [{ev.timestamp}] {ev.event_type}"]
                if ev.scene_id:
                    parts.append(f"Szene={ev.scene_id}")
                if ev.change_summary:
                    parts.append(f"Änderung: {ev.change_summary[:100]}")
                lines.append(" ".join(parts))
        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        return {
            "video_id": self.video_id,
            "created_at": self.created_at,
            "master_prompt": self.master_prompt,
            "languages": self.languages,
            "provider": self.provider,
            "model": self.model,
            "scene_count": len(self.scene_headings),
            "scene_headings": self.scene_headings,
            "event_count": len(self.events),
            "events": [
                {
                    "ts": e.timestamp,
                    "type": e.event_type,
                    "scene": e.scene_id,
                    "provider": e.provider,
                    "model": e.model,
                    "summary": e.change_summary,
                    "heading": e.scene_heading,
                }
                for e in self.events
            ],
            "chat_history": self.chat_history,
        }

    def to_archive_dict(self) -> dict[str, Any]:
        """Vollständige Serialisierung für ZIP-Export (inkl. aller Felder zum Wiederherstellen)."""
        return {
            "schema": "ki_session_v1",
            "video_id": self.video_id,
            "created_at": self.created_at,
            "master_prompt": self.master_prompt,
            "languages": self.languages,
            "provider": self.provider,
            "model": self.model,
            "scene_headings": self.scene_headings,
            "last_prompt_extra": self.last_prompt_extra,
            "events": [
                {
                    "timestamp": e.timestamp,
                    "event_type": e.event_type,
                    "scene_id": e.scene_id,
                    "provider": e.provider,
                    "model": e.model,
                    "change_summary": e.change_summary,
                    "scene_heading": e.scene_heading,
                }
                for e in self.events
            ],
            "chat_history": self.chat_history,
        }


    @classmethod
    def from_archive_dict(cls, data: dict[str, Any]) -> "KiSession":
        """Stellt eine KiSession aus einem ZIP-Archiv-Dict wieder her."""
        events = [
            SessionEvent(
                timestamp=e.get("timestamp", ""),
                event_type=e.get("event_type", ""),
                scene_id=e.get("scene_id"),
                provider=e.get("provider", ""),
                model=e.get("model", ""),
                change_summary=e.get("change_summary"),
                scene_heading=e.get("scene_heading"),
            )
            for e in data.get("events", [])
        ]
        session = cls(
            video_id=data["video_id"],
            created_at=data.get("created_at", datetime.now().isoformat(timespec="seconds")),
            master_prompt=data.get("master_prompt", ""),
            languages=data.get("languages", ["de"]),
            provider=data.get("provider", "gemini"),
            model=data.get("model", ""),
            scene_headings=data.get("scene_headings", {}),
            events=events,
            last_prompt_extra=data.get("last_prompt_extra", ""),
            chat_history=data.get("chat_history", []),
        )
        return session


class SessionStore:
    """Thread-sicherer In-Memory Store für KI-Sessions (eine pro video_id)."""

    def __init__(self) -> None:
        self._sessions: dict[str, KiSession] = {}
        self._lock = threading.Lock()

    def start(
        self,
        video_id: str,
        master_prompt: str,
        languages: list[str],
        provider: str,
        model: str,
    ) -> KiSession:
        session = KiSession(
            video_id=video_id,
            created_at=datetime.now().isoformat(timespec="seconds"),
            master_prompt=master_prompt,
            languages=languages,
            provider=provider,
            model=model,
        )
        with self._lock:
            self._sessions[video_id] = session
        return session

    def get(self, video_id: str) -> KiSession | None:
        with self._lock:
            return self._sessions.get(video_id)

    def get_or_create(
        self,
        video_id: str,
        master_prompt: str = "",
        languages: list[str] | None = None,
        provider: str = "gemini",
        model: str = "",
    ) -> KiSession:
        with self._lock:
            if video_id not in self._sessions:
                self._sessions[video_id] = KiSession(
                    video_id=video_id,
                    created_at=datetime.now().isoformat(timespec="seconds"),
                    master_prompt=master_prompt,
                    languages=languages or ["de"],
                    provider=provider,
                    model=model,
                )
            return self._sessions[video_id]

    def restore(self, session: KiSession) -> None:
        """Stellt eine importierte Session wieder in den Store ein (überschreibt bestehende)."""
        with self._lock:
            self._sessions[session.video_id] = session

    def delete(self, video_id: str) -> None:
        with self._lock:
            self._sessions.pop(video_id, None)

    def list_sessions(self) -> list[dict[str, Any]]:
        with self._lock:
            return [s.to_dict() for s in self._sessions.values()]


# Globale Singleton-Instanz
session_store = SessionStore()
