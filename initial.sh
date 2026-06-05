#!/usr/bin/env bash
# Clip2Guide – macOS/Linux Setup Script
# Richtet Python-Umgebung, FFmpeg, Auto-Editor und Verzeichnisstruktur ein.
# Nutzung:  bash initial.sh [--root /path/to/project]
set -euo pipefail

# ── Standardwerte ─────────────────────────────────────────────────────────────
PYTHON_VERSION="${PYTHON_VERSION:-3.13}"
# ROOT kann per Env-Variable (Electron-Produktionsmodus) oder --root-Argument
# überschrieben werden. Standard: Verzeichnis des Skripts selbst.
ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
APP_SOURCE_DIR="${APP_SOURCE_DIR:-}"
SKIP_PYTHON=false
SKIP_FFMPEG=false
SKIP_AUTO_EDITOR=false
SKIP_NODE=false
FORCE_FFMPEG=false
FORCE_AUTO_EDITOR=false

# ── Argumente parsen ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)             ROOT="$(realpath "$2")"; shift 2 ;;
    --app-source-dir)   APP_SOURCE_DIR="$(realpath "$2")"; shift 2 ;;
    --python-version)   PYTHON_VERSION="$2"; shift 2 ;;
    --skip-python)      SKIP_PYTHON=true; shift ;;
    --skip-ffmpeg)      SKIP_FFMPEG=true; shift ;;
    --skip-auto-editor) SKIP_AUTO_EDITOR=true; shift ;;
    --skip-node)        SKIP_NODE=true; shift ;;
    --force-ffmpeg)     FORCE_FFMPEG=true; shift ;;
    --force-auto-editor) FORCE_AUTO_EDITOR=true; shift ;;
    *) echo "Unbekannte Option: $1"; exit 1 ;;
  esac
done

# ── Farben ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

section()  { echo; echo "========================================="; echo " $1"; echo "========================================="; }
ok()       { echo -e "${GREEN}[OK]${RESET} $1"; }
warn()     { echo -e "${YELLOW}[WARN]${RESET} $1"; }
fail()     { echo -e "${RED}[FAIL]${RESET} $1"; FAILED=1; }

FAILED=0

# ── Pfade ─────────────────────────────────────────────────────────────────────
TOOLS_DIR="$ROOT/tools"
FFMPEG_DIR="$TOOLS_DIR/ffmpeg"
FFMPEG_BIN="$FFMPEG_DIR/bin"
FFMPEG_EXE="$FFMPEG_BIN/ffmpeg"
FFPROBE_EXE="$FFMPEG_BIN/ffprobe"

AUTO_EDITOR_DIR="$TOOLS_DIR/auto-editor"
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  AUTO_EDITOR_ASSET="auto-editor-macos-arm64"
else
  AUTO_EDITOR_ASSET="auto-editor-macos-x86_64"
fi
AUTO_EDITOR_EXE="$AUTO_EDITOR_DIR/$AUTO_EDITOR_ASSET"

BACKEND_DIR="$ROOT/backend"
VENV_PATH="$BACKEND_DIR/.venv"

WORKSPACE_DIR="$ROOT/workspace"

section "Clip2Guide – Initialisierung"
echo "Root       : $ROOT"
echo "Python     : $PYTHON_VERSION"
echo "Architektur: $ARCH"
# Sicherheitscheck: venv muss arm64-nativ sein (kein Rosetta-x86_64)
if [[ "$ARCH" == "arm64" ]]; then
  ok "Nativ arm64 – kein Rosetta"
else
  warn "Architektur ist $ARCH – auf Apple-Silicon-Macs sollte uname -m 'arm64' liefern."
  warn "Falls Rosetta aktiv ist: Terminal beenden, nativ (nicht via Rosetta) neu starten."
fi

# ── Verzeichnisstruktur ────────────────────────────────────────────────────────
mkdir -p \
  "$TOOLS_DIR" "$FFMPEG_DIR" "$FFMPEG_BIN" "$AUTO_EDITOR_DIR" \
  "$BACKEND_DIR/app/routers" "$BACKEND_DIR/app/services" "$BACKEND_DIR/app/scripts" \
  "$ROOT/frontend" \
  "$WORKSPACE_DIR/uploads" "$WORKSPACE_DIR/normalized" "$WORKSPACE_DIR/cut" \
  "$WORKSPACE_DIR/frames" "$WORKSPACE_DIR/ai-output" "$WORKSPACE_DIR/output" \
  "$WORKSPACE_DIR/jobs" "$WORKSPACE_DIR/logs"
ok "Verzeichnisstruktur angelegt"

# ── Python Umgebung ────────────────────────────────────────────────────────────
section "Python Umgebung"

# ── Python-Binary auflösen ────────────────────────────────────────────────────
# Electron startet das Skript ohne den Homebrew-PATH (/opt/homebrew/bin fehlt).
# Daher werden bekannte Homebrew-Pfade hart kodiert geprüft – BEVOR PATH-Einträge.
# Priorität: Homebrew arm64 → Homebrew Intel → PATH-Eintrag python3.X → python3
# System-Python (/usr/bin/python3 = 3.9) wird nur als letzter Fallback akzeptiert,
# dann aber sofort mit einem Versions-Fehler abgebrochen.

_find_python() {
  local ver="$1"
  local candidates=(
    "/opt/homebrew/opt/python@${ver}/bin/python${ver}"   # Homebrew arm64
    "/opt/homebrew/opt/python@${ver}/bin/python3"
    "/opt/homebrew/bin/python${ver}"
    "/usr/local/opt/python@${ver}/bin/python${ver}"      # Homebrew Intel
    "/usr/local/opt/python@${ver}/bin/python3"
    "/usr/local/bin/python${ver}"
    "python${ver}"                                        # PATH-Eintrag
    "python3"                                             # PATH-Eintrag (Fallback)
  )
  for c in "${candidates[@]}"; do
    if [[ -f "$c" ]] && [[ -x "$c" ]]; then
      echo "$c"; return 0
    elif [[ "${c}" != /* ]] && command -v "$c" &>/dev/null; then
      command -v "$c"; return 0
    fi
  done
  return 1
}

PYTHON3_CMD="$(_find_python "$PYTHON_VERSION")" || {
  echo "[ERROR] Kein Python ${PYTHON_VERSION} gefunden."
  echo "  Bitte installieren:"
  echo "    /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  echo "    brew install python@${PYTHON_VERSION}"
  exit 1
}

# Version des gefundenen Python prüfen
PYTHON_FOUND=$("$PYTHON3_CMD" --version 2>&1)
PYTHON_MINOR=$("$PYTHON3_CMD" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo "0")
ok "Python gefunden: $PYTHON_FOUND  →  $PYTHON3_CMD"

if [[ "$PYTHON_MINOR" -lt 10 ]]; then
  echo "[ERROR] ${PYTHON_FOUND} ist zu alt – mindestens 3.10 erforderlich."
  echo "  Homebrew-Python installieren:"
  echo "    brew install python@${PYTHON_VERSION}"
  echo "  Danach Skript erneut ausführen."
  exit 1
fi

if [[ "$SKIP_PYTHON" == "false" ]]; then
  # Architektur-Check: auf Apple Silicon muss python arm64 sein
  PYTHON_ARCH=$("$PYTHON3_CMD" -c "import platform; print(platform.machine())" 2>/dev/null || echo "unknown")
  if [[ "$ARCH" == "arm64" && "$PYTHON_ARCH" != "arm64" ]]; then
    warn "Python läuft als '$PYTHON_ARCH' statt 'arm64'."
    # Homebrew arm64 explizit nochmals suchen
    BREW_NATIVE="/opt/homebrew/opt/python@${PYTHON_VERSION}/bin/python${PYTHON_VERSION}"
    if [[ -f "$BREW_NATIVE" ]] && [[ -x "$BREW_NATIVE" ]]; then
      warn "Verwende Homebrew arm64: $BREW_NATIVE"
      PYTHON3_CMD="$BREW_NATIVE"
    else
      echo "[ERROR] Kein arm64-Python gefunden."
      echo "  brew install python@${PYTHON_VERSION}"
      exit 1
    fi
  else
    ok "Python-Architektur: $PYTHON_ARCH"
  fi

  if [[ ! -d "$VENV_PATH" ]]; then
    echo "Erstelle Virtual Environment: $VENV_PATH"
    "$PYTHON3_CMD" -m venv "$VENV_PATH"
  else
    # Bestehende venv auf korrekte Architektur prüfen
    VENV_ARCH=$("$VENV_PATH/bin/python" -c "import platform; print(platform.machine())" 2>/dev/null || echo "unknown")
    if [[ "$ARCH" == "arm64" && "$VENV_ARCH" != "arm64" ]]; then
      warn "Bestehende venv ist '$VENV_ARCH' – lösche und erstelle neu als arm64."
      rm -rf "$VENV_PATH"
      "$PYTHON3_CMD" -m venv "$VENV_PATH"
    else
      ok "Virtual Environment bereits vorhanden ($VENV_ARCH)"
    fi
  fi

  # shellcheck disable=SC1090
  source "$VENV_PATH/bin/activate"

  # Nochmals Architektur des venv-Python bestätigen
  ACTIVE_ARCH=$(python -c "import platform; print(platform.machine())" 2>/dev/null || echo "unknown")
  if [[ "$ARCH" == "arm64" && "$ACTIVE_ARCH" != "arm64" ]]; then
    fail "venv-Python läuft immer noch als '$ACTIVE_ARCH' – Backend wird nicht starten!"
  else
    ok "venv-Python Architektur: $ACTIVE_ARCH"
  fi

  python -m pip install --upgrade pip setuptools wheel

  # requirements.txt: erst in APP_SOURCE_DIR (paketierd), dann in BACKEND_DIR
  REQUIREMENTS_PATH=""
  if [[ -n "$APP_SOURCE_DIR" && -f "$APP_SOURCE_DIR/backend/requirements.txt" ]]; then
    REQUIREMENTS_PATH="$APP_SOURCE_DIR/backend/requirements.txt"
  elif [[ -f "$BACKEND_DIR/requirements.txt" ]]; then
    REQUIREMENTS_PATH="$BACKEND_DIR/requirements.txt"
  else
    echo "requirements.txt nicht gefunden (weder in APP_SOURCE_DIR noch in $BACKEND_DIR)"
    exit 1
  fi

  echo "Installiere Python-Module aus $REQUIREMENTS_PATH..."
  python -m pip install --upgrade -r "$REQUIREMENTS_PATH"
fi

# ── FFmpeg (evermeet.cx statische Binaries) ────────────────────────────────────
section "FFmpeg"

if [[ "$SKIP_FFMPEG" == "false" ]]; then
  NEED_DOWNLOAD=false
  if [[ "$FORCE_FFMPEG" == "true" ]] || [[ ! -f "$FFMPEG_EXE" ]] || [[ ! -f "$FFPROBE_EXE" ]]; then
    NEED_DOWNLOAD=true
  fi

  if [[ "$NEED_DOWNLOAD" == "true" ]]; then
    echo "Lade FFmpeg von evermeet.cx..."

    # evermeet.cx bietet statische FFmpeg-Builds fuer macOS (keine ffplay benoetigt)
    FFMPEG_URL="https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
    FFPROBE_URL="https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"

    curl -L --fail -o "$TOOLS_DIR/ffmpeg.zip"   "$FFMPEG_URL"
    curl -L --fail -o "$TOOLS_DIR/ffprobe.zip"  "$FFPROBE_URL"

    unzip -o "$TOOLS_DIR/ffmpeg.zip"  -d "$FFMPEG_BIN"
    unzip -o "$TOOLS_DIR/ffprobe.zip" -d "$FFMPEG_BIN"

    rm -f "$TOOLS_DIR/ffmpeg.zip" "$TOOLS_DIR/ffprobe.zip"
    chmod +x "$FFMPEG_EXE" "$FFPROBE_EXE"

    # Architektur der heruntergeladenen Binary prüfen
    FFMPEG_FILE_ARCH=$(file "$FFMPEG_EXE" 2>/dev/null || echo "")
    if [[ "$ARCH" == "arm64" && "$FFMPEG_FILE_ARCH" != *"arm64"* ]]; then
      warn "FFmpeg-Binary ist NICHT arm64: $FFMPEG_FILE_ARCH"
      warn "evermeet.cx liefert immer die native Architektur – prüfe ob curl Rosetta nutzt."
    else
      ok "FFmpeg-Architektur: arm64"
    fi

    ok "FFmpeg installiert: $FFMPEG_BIN"
  else
    ok "FFmpeg bereits vorhanden"
  fi

  # IMAGEIO_FFMPEG_EXE fuer imageio-ffmpeg setzen (Shell-Session)
  export IMAGEIO_FFMPEG_EXE="$FFMPEG_EXE"
  ok "IMAGEIO_FFMPEG_EXE=$FFMPEG_EXE"

  # Persistent fuer zsh / bash
  PROFILE_FILE=""
  if [[ -f "$HOME/.zshrc" ]]; then   PROFILE_FILE="$HOME/.zshrc"
  elif [[ -f "$HOME/.bashrc" ]]; then PROFILE_FILE="$HOME/.bashrc"
  fi
  if [[ -n "$PROFILE_FILE" ]]; then
    if ! grep -q "IMAGEIO_FFMPEG_EXE" "$PROFILE_FILE"; then
      echo "" >> "$PROFILE_FILE"
      echo "# Clip2Guide – imageio-ffmpeg" >> "$PROFILE_FILE"
      echo "export IMAGEIO_FFMPEG_EXE=\"$FFMPEG_EXE\"" >> "$PROFILE_FILE"
      ok "IMAGEIO_FFMPEG_EXE in $PROFILE_FILE eingetragen"
    fi
  fi
fi

# ── Auto-Editor ────────────────────────────────────────────────────────────────
section "Auto-Editor"

if [[ "$SKIP_AUTO_EDITOR" == "false" ]]; then
  NEED_DOWNLOAD=false
  if [[ "$FORCE_AUTO_EDITOR" == "true" ]] || [[ ! -f "$AUTO_EDITOR_EXE" ]]; then
    NEED_DOWNLOAD=true
  fi

  if [[ "$NEED_DOWNLOAD" == "true" ]]; then
    AE_URL="https://github.com/WyattBlue/auto-editor/releases/latest/download/$AUTO_EDITOR_ASSET"
    echo "Lade Auto-Editor: $AE_URL"

    if curl -L --fail -o "$AUTO_EDITOR_EXE" "$AE_URL" 2>/dev/null; then
      chmod +x "$AUTO_EDITOR_EXE"
      ok "Auto-Editor Binary installiert: $AUTO_EDITOR_EXE"
    else
      warn "GitHub-Binary nicht verfuegbar – verwende pip-Fallback..."
      if [[ "$SKIP_PYTHON" == "false" ]]; then
        source "$VENV_PATH/bin/activate"
        python -m pip install auto-editor
        warn "auto-editor als Python-Package installiert (kein eigenstaendiges Binary)."
        warn "Pfad in .env anpassen: AUTO_EDITOR_PATH muss auf 'auto-editor' im venv zeigen."
      else
        warn "Python-Install uebersprungen – auto-editor pip-Fallback nicht moeglich."
      fi
    fi
  else
    ok "Auto-Editor bereits vorhanden"
  fi
fi

# ── .env Konfiguration ─────────────────────────────────────────────────────────
section ".env Konfiguration"

# env.example: erst in APP_SOURCE_DIR (resources/env.example), dann im ROOT
ENV_EXAMPLE=""
if [[ -n "$APP_SOURCE_DIR" && -f "$APP_SOURCE_DIR/env.example" ]]; then
  ENV_EXAMPLE="$APP_SOURCE_DIR/env.example"
elif [[ -f "$ROOT/.env.example" ]]; then
  ENV_EXAMPLE="$ROOT/.env.example"
fi
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -n "$ENV_EXAMPLE" && -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    # Pfade fuer macOS anpassen (kein .exe)
    sed -i '' \
      "s|FFMPEG_PATH=.*|FFMPEG_PATH=./tools/ffmpeg/bin/ffmpeg|" \
      "s|FFPROBE_PATH=.*|FFPROBE_PATH=./tools/ffmpeg/bin/ffprobe|" \
      "s|AUTO_EDITOR_PATH=.*|AUTO_EDITOR_PATH=./tools/auto-editor/$AUTO_EDITOR_ASSET|" \
      "$ENV_FILE" 2>/dev/null || true
    ok ".env aus .env.example erzeugt (macOS-Pfade angepasst)"
    warn "Bitte API-Schluessel eintragen: $ENV_FILE"
  else
    warn ".env.example nicht gefunden – .env wurde nicht erzeugt."
  fi
else
  ok ".env bereits vorhanden, wird nicht ueberschrieben"
fi

# ── Node / Electron ────────────────────────────────────────────────────────────
section "Node / Electron"

if [[ "$SKIP_NODE" == "false" ]]; then
  if command -v node &>/dev/null; then
    ok "Node.js : $(node --version)"
  else
    warn "Node.js nicht gefunden. Bitte installieren: brew install node"
  fi
  if command -v npm &>/dev/null; then
    ok "npm     : $(npm --version)"
  fi
fi

# ── Selbsttest ─────────────────────────────────────────────────────────────────
section "Selbsttest"

if [[ "$SKIP_PYTHON" == "false" ]]; then
  echo "Python-Module..."
  source "$VENV_PATH/bin/activate"
  if python -c "import fastapi, pydantic, cv2, moviepy, PIL, dotenv; print('[OK] Kernmodule geladen'); print(f'     MoviePy {moviepy.__version__}  |  Pillow {PIL.__version__}')"; then
    : # ok printed inline
  else
    fail "Python-Modultest fehlgeschlagen"
  fi
fi

if [[ "$SKIP_FFMPEG" == "false" ]]; then
  echo "FFmpeg..."
  if "$FFMPEG_EXE" -version 2>&1 | head -1; then
    : # ok printed inline
  else
    fail "FFmpeg nicht ausfuehrbar"
  fi
fi

if [[ "$SKIP_AUTO_EDITOR" == "false" ]] && [[ -f "$AUTO_EDITOR_EXE" ]]; then
  echo "Auto-Editor..."
  if "$AUTO_EDITOR_EXE" --version 2>&1 | head -1; then
    :
  else
    fail "Auto-Editor nicht ausfuehrbar"
  fi
fi

if [[ "$FAILED" -ne 0 ]]; then
  warn "Mindestens ein Test ist fehlgeschlagen. Bitte Ausgabe pruefen."
fi

# ── Fertig ─────────────────────────────────────────────────────────────────────
section "Fertig"

echo "Projektverzeichnis: $ROOT"
echo ""
echo "Backend starten:"
echo "  cd \"$BACKEND_DIR\""
echo "  source .venv/bin/activate"
echo "  uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload"
echo ""
echo "API-Schluessel in .env eintragen:"
echo "  $ENV_FILE"
echo ""
echo "FFmpeg:"
echo "  $FFMPEG_EXE"
echo "  $FFPROBE_EXE"
echo ""
echo "Auto-Editor:"
echo "  $AUTO_EDITOR_EXE"
