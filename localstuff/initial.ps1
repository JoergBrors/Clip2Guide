param(
    [string]$Root = "J:\VideoInstructionBuilder",
    [string]$PythonVersion = "3.13",
    [switch]$ForceFFmpegDownload,
    [switch]$ForceAutoEditorDownload,
    [switch]$SkipNodeInstall,
    [switch]$SkipPythonInstall,
    [switch]$SkipFFmpeg,
    [switch]$SkipAutoEditor
)

$ErrorActionPreference = "Stop"

function Write-Section {
    param([string]$Text)
    Write-Host ""
    Write-Host "========================================="
    Write-Host " $Text"
    Write-Host "========================================="
}

function Assert-Command {
    param(
        [string]$Command,
        [string]$InstallHint
    )

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "$Command wurde nicht gefunden. $InstallHint"
    }
}

function Download-File {
    param(
        [string]$Uri,
        [string]$OutFile
    )

    Write-Host "Download:"
    Write-Host "  $Uri"
    Write-Host "Nach:"
    Write-Host "  $OutFile"

    Invoke-WebRequest `
        -Uri $Uri `
        -OutFile $OutFile `
        -UseBasicParsing
}

Write-Section "Video Instruction Builder Initialisierung"

Write-Host "Root Directory : $Root"
Write-Host "Python Version : $PythonVersion"

$Root = [System.IO.Path]::GetFullPath($Root)

$ToolsDir        = Join-Path $Root "tools"
$FfmpegDir       = Join-Path $ToolsDir "ffmpeg"
$FfmpegZip       = Join-Path $ToolsDir "ffmpeg.zip"
$FfmpegExe       = Join-Path $FfmpegDir "bin\ffmpeg.exe"
$FfprobeExe      = Join-Path $FfmpegDir "bin\ffprobe.exe"

$AutoEditorDir   = Join-Path $ToolsDir "auto-editor"
$AutoEditorExe   = Join-Path $AutoEditorDir "auto-editor-windows-x86_64.exe"

$BackendDir      = Join-Path $Root "backend"
$BackendAppDir   = Join-Path $BackendDir "app"
$ScriptsDir      = Join-Path $BackendAppDir "scripts"
$VenvPath        = Join-Path $BackendDir ".venv"

$FrontendDir     = Join-Path $Root "frontend"

$WorkspaceDir    = Join-Path $Root "workspace"
$UploadDir       = Join-Path $WorkspaceDir "uploads"
$NormalizedDir   = Join-Path $WorkspaceDir "normalized"
$CutDir          = Join-Path $WorkspaceDir "cut"
$FramesDir       = Join-Path $WorkspaceDir "frames"
$AiOutputDir     = Join-Path $WorkspaceDir "ai-output"
$OutputDir       = Join-Path $WorkspaceDir "output"
$JobsDir         = Join-Path $WorkspaceDir "jobs"
$LogsDir         = Join-Path $WorkspaceDir "logs"

$RequiredDirs = @(
    $Root,
    $ToolsDir,
    $FfmpegDir,
    $AutoEditorDir,
    $BackendDir,
    $BackendAppDir,
    $ScriptsDir,
    $FrontendDir,
    $WorkspaceDir,
    $UploadDir,
    $NormalizedDir,
    $CutDir,
    $FramesDir,
    $AiOutputDir,
    $OutputDir,
    $JobsDir,
    $LogsDir
)

foreach ($Dir in $RequiredDirs) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
}

Set-Location $Root

Write-Section "Python Umgebung"

Assert-Command -Command "py" -InstallHint "Bitte Python 3.13 installieren. Beispiel: winget install Python.Python.3.13"

$PythonCheck = py -$PythonVersion --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Python $PythonVersion wurde nicht gefunden. Beispiel: winget install Python.Python.3.13"
}
Write-Host "[OK] $PythonCheck"

if (-not $SkipPythonInstall) {
    if (-not (Test-Path $VenvPath)) {
        Write-Host "Erstelle Python Virtual Environment:"
        Write-Host "  $VenvPath"
        py -$PythonVersion -m venv $VenvPath
    }
    else {
        Write-Host "[OK] Virtual Environment bereits vorhanden"
    }

    $ActivateScript = Join-Path $VenvPath "Scripts\Activate.ps1"
    & $ActivateScript

    python -m pip install --upgrade pip setuptools wheel

    Write-Host "Installiere Python-Module fuer Backend, Videoanalyse, KI und Rendering..."

    python -m pip install --upgrade `
        fastapi `
        "uvicorn[standard]" `
        pydantic `
        python-dotenv `
        python-multipart `
        aiofiles `
        requests `
        httpx `
        numpy `
        opencv-python `
        moviepy `
        pillow `
        gtts `
        imageio `
        imageio-ffmpeg `
        google-generativeai `
        openai
}

Write-Section "FFmpeg"

if (-not $SkipFFmpeg) {
    $NeedFfmpegDownload = $ForceFFmpegDownload -or (-not (Test-Path $FfmpegExe)) -or (-not (Test-Path $FfprobeExe))

    if ($NeedFfmpegDownload) {
        if (Test-Path $FfmpegZip) {
            Remove-Item $FfmpegZip -Force
        }

        if ($ForceFFmpegDownload -and (Test-Path $FfmpegDir)) {
            Remove-Item $FfmpegDir -Recurse -Force
            New-Item -ItemType Directory -Force -Path $FfmpegDir | Out-Null
        }

        $FfmpegDownloadUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl-shared.zip"

        Download-File -Uri $FfmpegDownloadUrl -OutFile $FfmpegZip

        $TempExtract = Join-Path $ToolsDir "ffmpeg_extract"
        if (Test-Path $TempExtract) {
            Remove-Item $TempExtract -Recurse -Force
        }

        New-Item -ItemType Directory -Force -Path $TempExtract | Out-Null

        Expand-Archive -Path $FfmpegZip -DestinationPath $TempExtract -Force

        $ExtractedFolder =
            Get-ChildItem $TempExtract -Directory |
            Where-Object { $_.Name -like "ffmpeg-master*" } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if (-not $ExtractedFolder) {
            throw "FFmpeg konnte nicht entpackt werden."
        }

        if (Test-Path $FfmpegDir) {
            Remove-Item $FfmpegDir -Recurse -Force
        }

        Move-Item -Path $ExtractedFolder.FullName -Destination $FfmpegDir -Force

        Remove-Item $TempExtract -Recurse -Force
        Remove-Item $FfmpegZip -Force

        Write-Host "[OK] FFmpeg installiert"
    }
    else {
        Write-Host "[OK] FFmpeg bereits vorhanden"
    }

    $env:IMAGEIO_FFMPEG_EXE = $FfmpegExe
    [Environment]::SetEnvironmentVariable("IMAGEIO_FFMPEG_EXE", $FfmpegExe, "User")
}

Write-Section "Auto-Editor"

if (-not $SkipAutoEditor) {
    $NeedAutoEditorDownload = $ForceAutoEditorDownload -or (-not (Test-Path $AutoEditorExe))

    if ($NeedAutoEditorDownload) {
        if (Test-Path $AutoEditorExe) {
            Remove-Item $AutoEditorExe -Force
        }

        # Auto-Editor stellt offizielle Binaries ueber GitHub Releases bereit.
        # Der Dateiname kann sich bei kuenftigen Releases aendern. Fuer Windows x64 wird aktuell dieses Asset erwartet.
        $AutoEditorDownloadUrl = "https://github.com/WyattBlue/auto-editor/releases/latest/download/auto-editor-windows-x86_64.exe"

        Download-File -Uri $AutoEditorDownloadUrl -OutFile $AutoEditorExe

        if (-not (Test-Path $AutoEditorExe)) {
            throw "Auto-Editor konnte nicht heruntergeladen werden."
        }

        Write-Host "[OK] Auto-Editor installiert"
    }
    else {
        Write-Host "[OK] Auto-Editor bereits vorhanden"
    }
}

Write-Section "Projektdateien kopieren"

$SourceFiles = Get-ChildItem -Path $PSScriptRoot -File -ErrorAction SilentlyContinue

foreach ($File in $SourceFiles) {
    switch -Regex ($File.Name) {
        "^instruction\.md$" {
            Copy-Item $File.FullName (Join-Path $Root "instruction.md") -Force
            Write-Host "[OK] instruction.md kopiert"
        }
        "^\.env\.example$" {
            Copy-Item $File.FullName (Join-Path $Root ".env.example") -Force
            Write-Host "[OK] .env.example kopiert"
        }
        "^create_tutorial\.py$" {
            Copy-Item $File.FullName (Join-Path $ScriptsDir "create_tutorial.py") -Force
            Write-Host "[OK] create_tutorial.py nach backend/app/scripts kopiert"
        }
        "^.*\.py$" {
            Copy-Item $File.FullName (Join-Path $ScriptsDir $File.Name) -Force
            Write-Host "[OK] Python-Skript kopiert: $($File.Name)"
        }
        "^frame_[0-9]{3}\.jpg$" {
            Copy-Item $File.FullName (Join-Path $FramesDir $File.Name) -Force
            Write-Host "[OK] Frame kopiert: $($File.Name)"
        }
    }
}

$EnvExamplePath = Join-Path $Root ".env.example"
$EnvPath = Join-Path $Root ".env"

if (-not (Test-Path $EnvExamplePath)) {
    @"
APP_ENV=development
APP_HOST=127.0.0.1
APP_PORT=8787

AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-1.5-pro

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1

FFMPEG_PATH=$($FfmpegExe.Replace("\", "\\"))
FFPROBE_PATH=$($FfprobeExe.Replace("\", "\\"))
AUTO_EDITOR_PATH=$($AutoEditorExe.Replace("\", "\\"))

WORKSPACE_ROOT=$($WorkspaceDir.Replace("\", "\\"))
UPLOAD_DIR=$($UploadDir.Replace("\", "\\"))
NORMALIZED_DIR=$($NormalizedDir.Replace("\", "\\"))
CUT_DIR=$($CutDir.Replace("\", "\\"))
FRAMES_DIR=$($FramesDir.Replace("\", "\\"))
AI_OUTPUT_DIR=$($AiOutputDir.Replace("\", "\\"))
RENDER_OUTPUT_DIR=$($OutputDir.Replace("\", "\\"))

DEFAULT_LANGUAGE=de
OUTPUT_VIDEO_WIDTH=1920
OUTPUT_VIDEO_HEIGHT=1080
FRAME_EXTRACTION_FPS=0.333
SCENE_DIFF_THRESHOLD=0.08
MIN_SCENE_SECONDS=1.0
AUTO_EDITOR_AUDIO_EDIT=audio:threshold=0.03
AUTO_EDITOR_MOTION_EDIT=motion:threshold=0.08
AUTO_EDITOR_COMBINED_EDIT=(or audio:0.03 motion:0.08)
AUTO_EDITOR_MARGIN=0.5s
MAX_PARALLEL_LANGUAGES=4
FFMPEG_THREADS_PER_JOB=2
"@ | Set-Content -Path $EnvExamplePath -Encoding UTF8

    Write-Host "[OK] .env.example erzeugt"
}

if (-not (Test-Path $EnvPath)) {
    Copy-Item $EnvExamplePath $EnvPath -Force
    Write-Host "[OK] .env aus .env.example erzeugt"
}
else {
    Write-Host "[OK] .env bereits vorhanden, wird nicht ueberschrieben"
}

Write-Section "Node / Electron Hinweise"

if (-not $SkipNodeInstall) {
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Host "[OK] Node gefunden: $(node --version)"
    }
    else {
        Write-Warning "Node.js wurde nicht gefunden. Installiere Node.js LTS, z.B.: winget install OpenJS.NodeJS.LTS"
    }

    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Write-Host "[OK] npm gefunden: $(npm --version)"
    }
    else {
        Write-Warning "npm wurde nicht gefunden."
    }
}

Write-Section "Tests"

if (-not $SkipPythonInstall) {
    & (Join-Path $VenvPath "Scripts\python.exe") -c "import fastapi, pydantic, cv2, moviepy, PIL, dotenv; print('Python module OK'); print('MoviePy', moviepy.__version__); print('Pillow', PIL.__version__)"
}

if (-not $SkipFFmpeg) {
    & $FfmpegExe -version | Select-Object -First 1
    & $FfprobeExe -version | Select-Object -First 1
}

if (-not $SkipAutoEditor) {
    & $AutoEditorExe --version
}

Write-Section "Fertig"

Write-Host "Projektverzeichnis:"
Write-Host "  $Root"
Write-Host ""
Write-Host "Python venv aktivieren:"
Write-Host "  cd `"$BackendDir`""
Write-Host "  .\.venv\Scripts\Activate.ps1"
Write-Host ""
Write-Host "Backend starten:"
Write-Host "  cd `"$BackendDir`""
Write-Host "  .\.venv\Scripts\Activate.ps1"
Write-Host "  uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload"
Write-Host ""
Write-Host "Auto-Editor Test:"
Write-Host "  `"$AutoEditorExe`" --help"
Write-Host ""
Write-Host "FFmpeg:"
Write-Host "  $FfmpegExe"
Write-Host ""
Write-Host "Auto-Editor:"
Write-Host "  $AutoEditorExe"
Write-Host ""
Write-Host "Bitte trage deine API-Schluessel in diese Datei ein:"
Write-Host "  $EnvPath"
