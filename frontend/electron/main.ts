import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import { spawn, spawnSync, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const BACKEND_PORT = 8787;
const VITE_PORT = 5173;

/** Pfad zur .env im userData-Verzeichnis des Betriebssystems.
 *  z.B. %APPDATA%\Clip2Guide\.env (Windows), ~/Library/Application Support/Clip2Guide/.env (macOS)
 *  Im Dev-Modus liegt .env weiterhin im Projektroot (keine userData-Datei erwartet). */
export const USER_ENV_FILE = isDev
  ? path.join(path.resolve(__dirname, "../../.."), ".env")
  : path.join(app.getPath("userData"), ".env");

/**
 * Beschreibbares lokales Benutzerverzeichnis für venv, Tools und Workspace.
 * Windows : %LOCALAPPDATA%\Clip2Guide  (nicht-roamend, ideal für große Videodaten)
 * macOS   : ~/Library/Application Support/Clip2Guide
 * Dev     : Projektverzeichnis
 */
export const USER_LOCAL_DIR: string = (() => {
  if (isDev) return path.resolve(__dirname, "../../..");
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA;
    if (local) return path.join(local, "Clip2Guide");
  }
  return app.getPath("userData");
})();

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

// ── Requirements-Check beim Start ────────────────────────────────────────────

/**
 * Prüft ob requirements.txt seit dem letzten pip install verändert wurde.
 * Wenn ja (oder Hash-Datei fehlt), führt pip install --upgrade -r ... aus.
 * Läuft synchron damit das Backend erst nach erfolgter Prüfung startet.
 */
function ensureRequirements(): void {
  const isWindows = process.platform === "win32";
  const venvPython = path.join(
    USER_LOCAL_DIR, "backend", ".venv",
    isWindows ? "Scripts\\python.exe" : "bin/python"
  );

  if (!fs.existsSync(venvPython)) {
    console.log("[requirements] venv nicht gefunden – Prüfung übersprungen");
    return;
  }

  // requirements.txt: im paketierten Modus in resources/, im Dev in backend/
  const resourcesRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../../..");
  const reqCandidates = [
    path.join(resourcesRoot, "backend", "requirements.txt"),
    path.join(USER_LOCAL_DIR, "backend", "requirements.txt"),
  ];
  const reqPath = reqCandidates.find((p) => fs.existsSync(p));
  if (!reqPath) {
    console.warn("[requirements] requirements.txt nicht gefunden – Prüfung übersprungen");
    return;
  }

  // SHA256 der requirements.txt berechnen
  const reqContent = fs.readFileSync(reqPath);
  const currentHash = crypto.createHash("sha256").update(reqContent).digest("hex");

  const hashFile = path.join(USER_LOCAL_DIR, "backend", ".venv", ".requirements_hash");
  let storedHash = "";
  try { storedHash = fs.readFileSync(hashFile, "utf8").trim(); } catch { /* kein Hash */ }

  if (currentHash === storedHash) {
    console.log("[requirements] requirements.txt unverändert – pip install übersprungen");
    return;
  }

  console.log("[requirements] requirements.txt geändert oder Erststart – installiere Module...");
  console.log(`[requirements] requirements.txt: ${reqPath}`);

  const pipArgs = ["-m", "pip", "install", "--upgrade", "-r", reqPath];
  const result = spawnSync(venvPython, pipArgs, {
    stdio: "inherit",
    encoding: "utf8",
    timeout: 5 * 60 * 1000,  // 5 Minuten max.
  });

  if (result.status === 0) {
    fs.writeFileSync(hashFile, currentHash, "utf8");
    console.log("[requirements] Module erfolgreich installiert, Hash gespeichert");
  } else {
    console.error(`[requirements] pip install fehlgeschlagen (Exit-Code ${result.status})`);
    // Kein harter Abbruch – Backend-Start versuchen, Fehler wird dort sichtbar
  }
}

// ── Backend starten ──────────────────────────────────────────────────────────

function startBackend(): void {
  // Im VS Code Dev-Modus startet tasks.json das Backend bereits – überspringen.
  if (process.env.SKIP_BACKEND_SPAWN === "1") {
    console.log("[backend] Spawn übersprungen (SKIP_BACKEND_SPAWN=1)");
    return;
  }

  // Python-Quellcode (app/) liegt immer in app.asar.unpacked (read-only, in Program Files)
  const resourcesRoot = isDev
    ? path.resolve(__dirname, "../../..")
    : process.resourcesPath;
  const backendCwd = isDev
    ? path.join(resourcesRoot, "backend")
    : path.join(resourcesRoot, "app.asar.unpacked", "backend");

  // venv liegt in USER_LOCAL_DIR (beschreibbar), NICHT in Program Files
  const isWindows = process.platform === "win32";
  const venvPython = path.join(
    USER_LOCAL_DIR,
    "backend",
    ".venv",
    isWindows ? "Scripts\\python.exe" : "bin/python"
  );

  if (!fs.existsSync(venvPython)) {
    console.error(
      `[backend] Python-venv nicht gefunden: ${venvPython}\n` +
      `Bitte initial.ps1 (Windows) oder initial.sh (Mac) ausführen.`
    );
    return;
  }

  backendProcess = spawn(
    venvPython,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(BACKEND_PORT)],
    {
      cwd: backendCwd,
      // PROJECT_ROOT → config.py löst ./workspace, ./tools relativ dazu auf
      env: { ...process.env, APP_ENV_FILE: USER_ENV_FILE, PROJECT_ROOT: USER_LOCAL_DIR },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  backendProcess.stdout?.on("data", (d) => console.log("[backend]", d.toString().trim()));
  backendProcess.stderr?.on("data", (d) => console.error("[backend]", d.toString().trim()));
  backendProcess.on("exit", (code) => console.log("[backend] Prozess beendet, Code:", code));
  backendProcess.on("error", (err) => console.error("[backend] Spawn-Fehler:", err.message));
}

// ── Fenster erstellen ─────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Clip2Guide",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${VITE_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/renderer/index.html"));
  }

  // Externe Links im Browser oeffnen
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost")) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
}

/** Öffnet das Setup-Wizard-Fenster (kein Haupt-Fenster). */
function createSetupWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 780,
    height: 600,
    resizable: false,
    title: "Clip2Guide – Einrichtung",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (isDev) {
    win.loadURL(`http://localhost:${VITE_PORT}?setup=1`);
  } else {
    win.loadFile(
      path.join(__dirname, "../../dist/renderer/index.html"),
      { query: { setup: "1" } }
    );
  }
  return win;
}

// ── IPC Handlers laden ────────────────────────────────────────────────────────

function registerIpcHandlers(): void {
  require("./ipc").registerAll(ipcMain);
}

async function clearStartupCache(): Promise<void> {
  try {
    await session.defaultSession.clearCache();
    console.log("[startup] Electron-Session-Cache bereinigt");
  } catch (err) {
    console.warn("[startup] Electron-Session-Cache konnte nicht bereinigt werden:", err);
  }
}

// ── App-Lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await clearStartupCache();
  registerIpcHandlers();

  const setupComplete = fs.existsSync(USER_ENV_FILE);
  if (!setupComplete && !isDev) {
    // Erster Start ohne .env → Setup-Wizard zeigen
    const setupWin = createSetupWindow();
    // Nach Setup-Abschluss: Wizard schließen, Backend starten, Hauptfenster öffnen
    ipcMain.once("setup:completed", () => {
      setupWin.close();
      ensureRequirements();
      startBackend();
      setTimeout(() => createWindow(), 1500);
    });
  } else {
    ensureRequirements();
    startBackend();
    // Kurz warten bis Backend bereit ist
    setTimeout(() => createWindow(), 1500);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  backendProcess?.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  backendProcess?.kill();
});
