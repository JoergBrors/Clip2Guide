#Requires -Version 5.1
<#
.SYNOPSIS
    Clip2Guide - Windows-Setup-Skript
.DESCRIPTION
    Richtet Python-Umgebung, FFmpeg, Auto-Editor und Verzeichnisstruktur ein.
    Muss einmalig vor dem ersten Start ausgefuehrt werden.
.PARAMETER Root
    Projektverzeichnis. Standard: aktuelles Verzeichnis (.)
.PARAMETER PythonVersion
    Python-Hauptversion fuer py.exe Launcher, z.B. "3.13". Standard: "3.13"
.PARAMETER ForceFFmpegDownload
    FFmpeg auch dann neu herunterladen, wenn es bereits vorhanden ist.
.PARAMETER ForceAutoEditorDownload
    Auto-Editor auch dann neu herunterladen, wenn er bereits vorhanden ist.
.PARAMETER SkipNodeInstall
    Node-Pruefung ueberspringen.
.PARAMETER SkipPythonInstall
    Python-venv und pip-Install ueberspringen.
.PARAMETER SkipFFmpeg
    FFmpeg-Download ueberspringen.
.PARAMETER SkipAutoEditor
    Auto-Editor-Download ueberspringen.
.EXAMPLE
    .\initial.ps1
.EXAMPLE
    .\initial.ps1 -ForceFFmpegDownload -SkipPythonInstall
#>
param(
    [string]$Root            = ".",
    [string]$PythonVersion   = "3.13",
    # Pfad zum App-Quellverzeichnis (resources/) im paketierten Betrieb.
    # Enthaelt requirements.txt und env.example die im ASAR-Paket liegen.
    # Im manuellen Aufruf leer lassen – dann wird $Root verwendet.
    [string]$AppSourceDir    = "",
    [switch]$ForceFFmpegDownload,
    [switch]$ForceAutoEditorDownload,
    [switch]$SkipNodeInstall,
    [switch]$SkipPythonInstall,
    [switch]$SkipFFmpeg,
    [switch]$SkipAutoEditor
)

$ErrorActionPreference = "Stop"

# Hilfsfunktionen

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
    Write-Host "Download : $Uri"
    Write-Host "Ziel     : $OutFile"
    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing
    if (-not (Test-Path $OutFile)) {
        throw "Download fehlgeschlagen: $Uri"
    }
}

# Pfade

Write-Section "Clip2Guide - Initialisierung"

$Root = [System.IO.Path]::GetFullPath($Root)
Write-Host "Root Directory  : $Root"
Write-Host "Python Version  : $PythonVersion"

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

# Verzeichnisstruktur

$RequiredDirs = @(
    $ToolsDir, $FfmpegDir, $AutoEditorDir,
    $BackendDir, $BackendAppDir, $ScriptsDir,
    (Join-Path $BackendAppDir "routers"),
    (Join-Path $BackendAppDir "services"),
    $FrontendDir,
    $WorkspaceDir, $UploadDir, $NormalizedDir, $CutDir,
    $FramesDir, $AiOutputDir, $OutputDir, $JobsDir, $LogsDir
)

foreach ($Dir in $RequiredDirs) {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
}

Write-Host "[OK] Verzeichnisstruktur angelegt"

# Python Umgebung

Write-Section "Python Umgebung"

# ── Auto-Install Python falls nicht vorhanden ──────────────────────────────────
if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    Write-Host "[WARN] py.exe (Python Launcher) nicht gefunden. Lade Python $PythonVersion Installer..."
    $PyInstallerUrl = "https://www.python.org/ftp/python/3.13.4/python-3.13.4-amd64.exe"
    $PyInstallerPath = Join-Path $env:TEMP "python-$PythonVersion-amd64.exe"
    Download-File -Uri $PyInstallerUrl -OutFile $PyInstallerPath
    Write-Host "Installiere Python $PythonVersion (still, nur fuer aktuellen Benutzer)..."
    $pResult = Start-Process -FilePath $PyInstallerPath -ArgumentList @(
        "/quiet",
        "InstallAllUsers=0",
        "PrependPath=1",
        "Include_launcher=1",
        "Include_pip=1"
    ) -Wait -PassThru
    Remove-Item $PyInstallerPath -Force -ErrorAction SilentlyContinue
    if ($pResult.ExitCode -ne 0) {
        throw "Python-Installer fehlgeschlagen (ExitCode=$($pResult.ExitCode)). Bitte manuell installieren: https://www.python.org/downloads/"
    }
    # PATH neu laden damit py.exe verfuegbar ist
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "User") + ";" + $env:PATH
    Write-Host "[OK] Python $PythonVersion installiert"
}

Assert-Command -Command "py" -InstallHint "Bitte Python $PythonVersion installieren: https://www.python.org/downloads/"

$PythonCheck = py -$PythonVersion --version 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Python $PythonVersion nicht gefunden. Bitte installieren: https://www.python.org/downloads/"
}
Write-Host "[OK] $PythonCheck"

if (-not $SkipPythonInstall) {
    if (-not (Test-Path $VenvPath)) {
        Write-Host "Erstelle Virtual Environment: $VenvPath"
        py -$PythonVersion -m venv $VenvPath
    } else {
        Write-Host "[OK] Virtual Environment bereits vorhanden"
    }

    $ActivateScript = Join-Path $VenvPath "Scripts\Activate.ps1"
    & $ActivateScript

    python -m pip install --upgrade pip setuptools wheel

    # requirements.txt: erst im App-Quellverzeichnis suchen (paketierd in resources/),
    # dann im Root (manueller Aufruf / Dev-Modus)
    $RequirementsPath = $null
    if ($AppSourceDir) {
        $candidate = Join-Path $AppSourceDir "backend\requirements.txt"
        if (Test-Path $candidate) { $RequirementsPath = $candidate }
    }
    if (-not $RequirementsPath) {
        $RequirementsPath = Join-Path $BackendDir "requirements.txt"
    }
    if (-not (Test-Path $RequirementsPath)) {
        throw "requirements.txt nicht gefunden (weder in AppSourceDir noch in $BackendDir)"
    }

    Write-Host "Installiere Python-Module aus $RequirementsPath..."
    python -m pip install --upgrade -r $RequirementsPath
}

# FFmpeg

Write-Section "FFmpeg"

if (-not $SkipFFmpeg) {
    $NeedDownload = $ForceFFmpegDownload -or (-not (Test-Path $FfmpegExe)) -or (-not (Test-Path $FfprobeExe))

    if ($NeedDownload) {
        if ($ForceFFmpegDownload -and (Test-Path $FfmpegDir)) {
            Remove-Item $FfmpegDir -Recurse -Force
            New-Item -ItemType Directory -Force -Path $FfmpegDir | Out-Null
        }
        if (Test-Path $FfmpegZip) { Remove-Item $FfmpegZip -Force }

        $FfmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl-shared.zip"
        Download-File -Uri $FfmpegUrl -OutFile $FfmpegZip

        $TempExtract = Join-Path $ToolsDir "ffmpeg_extract"
        if (Test-Path $TempExtract) { Remove-Item $TempExtract -Recurse -Force }
        New-Item -ItemType Directory -Force -Path $TempExtract | Out-Null
        Expand-Archive -Path $FfmpegZip -DestinationPath $TempExtract -Force

        $ExtractedFolder = Get-ChildItem $TempExtract -Directory |
            Where-Object { $_.Name -like "ffmpeg-master*" } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

        if (-not $ExtractedFolder) {
            throw "FFmpeg-Archiv konnte nicht entpackt werden (Unterordner nicht gefunden)."
        }

        if (Test-Path $FfmpegDir) { Remove-Item $FfmpegDir -Recurse -Force }
        Move-Item -Path $ExtractedFolder.FullName -Destination $FfmpegDir -Force
        Remove-Item $TempExtract -Recurse -Force
        Remove-Item $FfmpegZip -Force

        Write-Host "[OK] FFmpeg installiert: $FfmpegDir"
    } else {
        Write-Host "[OK] FFmpeg bereits vorhanden"
    }

    # IMAGEIO_FFMPEG_EXE fuer imageio-ffmpeg setzen
    $env:IMAGEIO_FFMPEG_EXE = $FfmpegExe
    [Environment]::SetEnvironmentVariable("IMAGEIO_FFMPEG_EXE", $FfmpegExe, "User")
    Write-Host "[OK] IMAGEIO_FFMPEG_EXE gesetzt: $FfmpegExe"
}

# Auto-Editor

Write-Section "Auto-Editor"

if (-not $SkipAutoEditor) {
    $NeedDownload = $ForceAutoEditorDownload -or (-not (Test-Path $AutoEditorExe))

    if ($NeedDownload) {
        if (Test-Path $AutoEditorExe) { Remove-Item $AutoEditorExe -Force }

        # Offizielles Windows-Binary von GitHub Releases (WyattBlue/auto-editor)
        $AutoEditorUrl = "https://github.com/WyattBlue/auto-editor/releases/latest/download/auto-editor-windows-x86_64.exe"
        Download-File -Uri $AutoEditorUrl -OutFile $AutoEditorExe

        Write-Host "[OK] Auto-Editor installiert: $AutoEditorExe"
    } else {
        Write-Host "[OK] Auto-Editor bereits vorhanden"
    }
}

# .env Konfiguration

Write-Section ".env Konfiguration"

# env.example: erst im App-Quellverzeichnis suchen (resources/env.example),
# dann im Root (.env.example) – fuer manuellen Aufruf / Dev-Modus
$EnvExamplePath = $null
if ($AppSourceDir) {
    $candidate = Join-Path $AppSourceDir "env.example"
    if (Test-Path $candidate) { $EnvExamplePath = $candidate }
}
if (-not $EnvExamplePath) {
    $candidate = Join-Path $Root ".env.example"
    if (Test-Path $candidate) { $EnvExamplePath = $candidate }
}
$EnvPath = Join-Path $Root ".env"

if (-not (Test-Path $EnvPath)) {
    if ($EnvExamplePath) {
        Copy-Item $EnvExamplePath $EnvPath -Force
        Write-Host "[OK] .env aus env.example erzeugt"
        Write-Host "     => Bitte API-Schluessel eintragen: $EnvPath"
    } else {
        Write-Warning "env.example nicht gefunden - .env wurde nicht erzeugt. Bitte manuell anlegen."
    }
} else {
    Write-Host "[OK] .env bereits vorhanden, wird nicht ueberschrieben"
}

# Node / Electron

Write-Section "Node / Electron"

if (-not $SkipNodeInstall) {
    if (Get-Command node -ErrorAction SilentlyContinue) {
        Write-Host "[OK] Node.js : $(node --version)"
    } else {
        Write-Warning "Node.js nicht gefunden. Bitte installieren: winget install OpenJS.NodeJS.LTS"
    }
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Write-Host "[OK] npm     : $(npm --version)"
    }
}

# Tests

Write-Section "Selbsttest"

$AnyFailed = $false

if (-not $SkipPythonInstall) {
    Write-Host "Python-Module..."
    try {
        $ModuleCheck = "import fastapi, pydantic, cv2, moviepy, PIL, dotenv; print('[OK] Kernmodule geladen'); print(f'     MoviePy {moviepy.__version__}  |  Pillow {PIL.__version__}')"
        & (Join-Path $VenvPath "Scripts\python.exe") -c $ModuleCheck
    } catch {
        Write-Warning "[FAIL] Python-Modultest fehlgeschlagen: $_"
        $AnyFailed = $true
    }
}

if (-not $SkipFFmpeg) {
    Write-Host "FFmpeg..."
    try {
        $v = & $FfmpegExe -version 2>&1 | Select-Object -First 1
        Write-Host "[OK] $v"
        $v = & $FfprobeExe -version 2>&1 | Select-Object -First 1
        Write-Host "[OK] $v"
    } catch {
        Write-Warning "[FAIL] FFmpeg nicht ausfuehrbar: $_"
        $AnyFailed = $true
    }
}

if (-not $SkipAutoEditor) {
    Write-Host "Auto-Editor..."
    try {
        $v = & $AutoEditorExe --version 2>&1 | Select-Object -First 1
        Write-Host "[OK] Auto-Editor $v"
    } catch {
        Write-Warning "[FAIL] Auto-Editor nicht ausfuehrbar: $_"
        $AnyFailed = $true
    }
}

if ($AnyFailed) {
    Write-Host ""
    Write-Warning "Mindestens ein Test ist fehlgeschlagen. Bitte Ausgabe pruefen."
}

# Fertig

Write-Section "Fertig"

Write-Host "Projektverzeichnis:"
Write-Host "  $Root"
Write-Host ""
Write-Host "Backend starten:"
Write-Host "  cd `"$BackendDir`""
Write-Host "  .\.venv\Scripts\Activate.ps1"
Write-Host "  uvicorn app.main:app --host 127.0.0.1 --port 8787 --reload"
Write-Host ""
Write-Host "API-Schluessel in .env eintragen:"
Write-Host "  $EnvPath"
Write-Host ""
Write-Host "Manueller Auto-Editor Test:"
Write-Host "  `"$AutoEditorExe`" workspace\uploads\test.mp4 --edit audio:threshold=0.03 --margin 0.5s --output workspace\cut\test_cut.mp4"
Write-Host ""
Write-Host "FFmpeg:"
Write-Host "  $FfmpegExe"
Write-Host "  $FfprobeExe"
