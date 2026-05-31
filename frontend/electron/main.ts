import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";

const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
const BACKEND_PORT = 8787;
const VITE_PORT = 5173;

/** Pfad zur .env im userData-Verzeichnis des Betriebssystems.
 *  z.B. %APPDATA%\Clip2Guide\.env (Windows), ~/Library/Application Support/Clip2Guide/.env (macOS)
 *  Im Dev-Modus liegt .env weiterhin im Projektroot (keine userData-Datei erwartet). */
export const USER_ENV_FILE = isDev
  ? path.join(path.resolve(__dirname, "../../.."), ".env")
  : path.join(app.getPath("userData"), ".env");

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

// ── Backend starten ──────────────────────────────────────────────────────────

function startBackend(): void {
  // Im VS Code Dev-Modus startet tasks.json das Backend bereits – überspringen.
  if (process.env.SKIP_BACKEND_SPAWN === "1") {
    console.log("[backend] Spawn übersprungen (SKIP_BACKEND_SPAWN=1)");
    return;
  }

  // In production: resourcesRoot = process.resourcesPath
  //   (z.B. %LOCALAPPDATA%\Programs\Clip2Guide\resources)
  // In dev:        resourcesRoot = Projektverzeichnis (3 Ebenen über dist/electron/)
  const resourcesRoot = isDev
    ? path.resolve(__dirname, "../../..")
    : process.resourcesPath;

  // initial.ps1 / initial.sh legt das venv unter <resourcesRoot>/backend/.venv an
  const backendDir = path.join(resourcesRoot, "backend");
  // uvicorn braucht das echte Dateisystem-Verzeichnis (nicht ASAR-virtuell)
  const backendCwd = isDev
    ? backendDir
    : path.join(resourcesRoot, "app.asar.unpacked", "backend");

  const isWindows = process.platform === "win32";
  const venvPython = path.join(
    backendDir,
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
      env: { ...process.env, APP_ENV_FILE: USER_ENV_FILE, PROJECT_ROOT: resourcesRoot },
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

// ── App-Lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  registerIpcHandlers();

  const setupComplete = fs.existsSync(USER_ENV_FILE);
  if (!setupComplete && !isDev) {
    // Erster Start ohne .env → Setup-Wizard zeigen
    const setupWin = createSetupWindow();
    // Nach Setup-Abschluss: Wizard schließen, Backend starten, Hauptfenster öffnen
    ipcMain.once("setup:completed", () => {
      setupWin.close();
      startBackend();
      setTimeout(() => createWindow(), 1500);
    });
  } else {
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
