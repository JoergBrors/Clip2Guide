import { IpcMain, dialog, shell, app, session } from "electron";
import { spawn, execFile } from "child_process";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { USER_ENV_FILE, USER_LOCAL_DIR } from "./main";

/** Registriert alle IPC-Handler im Haupt-Prozess. */
export function registerAll(ipcMain: IpcMain): void {

  ipcMain.handle("get-version", () => app.getVersion());

  ipcMain.handle("open-path", async (_event, filePath: string) => {
    await shell.openPath(filePath);
  });

  ipcMain.handle(
    "open-file-dialog",
    async (_event, filters?: Electron.FileFilter[]) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: filters ?? [
          { name: "Videos", extensions: ["mp4", "mov", "avi", "mkv", "webm"] },
        ],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    }
  );

  ipcMain.handle(
    "save-file-dialog",
    async (_event, defaultName?: string) => {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: "MP4-Video", extensions: ["mp4"] }],
      });
      return result.canceled ? null : result.filePath ?? null;
    }
  );

  // ── Setup-Wizard IPC ────────────────────────────────────────────────────────

  /** Prüft ob .env im userData existiert (Setup abgeschlossen). */
  ipcMain.handle("setup:is-complete", () => fs.existsSync(USER_ENV_FILE));

  /** Führt initial.ps1 (Windows) oder initial.sh (macOS) aus und streamt stdout
   *  Zeile für Zeile als "setup:log"-Events an den Renderer. */
  ipcMain.handle("setup:run-initial", (event) => {
    return new Promise<void>((resolve, reject) => {
      const isPackaged = app.isPackaged;
      // Im paketierten Modus liegt das Skript in extraResources
      const resourcesPath = isPackaged
        ? process.resourcesPath
        : path.resolve(__dirname, "../../..");
      const isWindows = process.platform === "win32";
      const scriptName = isWindows ? "initial.ps1" : "initial.sh";
      const scriptPath = path.join(resourcesPath, scriptName);

      const send = (msg: string) =>
        event.sender.send("setup:log", msg);

      if (!fs.existsSync(scriptPath)) {
        reject(new Error(`Einrichtungsskript nicht gefunden: ${scriptPath}`));
        return;
      }

      let proc: ReturnType<typeof spawn>;
      if (isWindows) {
        proc = spawn(
          "powershell.exe",
          ["-ExecutionPolicy", "RemoteSigned", "-File", scriptPath,
           "-Root", USER_LOCAL_DIR,
           "-AppSourceDir", resourcesPath],
          { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } }
        );
      } else {
        proc = spawn(
          "bash",
          [scriptPath],
          { stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, ROOT: USER_LOCAL_DIR, APP_SOURCE_DIR: resourcesPath } }
        );
      }

      const onData = (chunk: Buffer) => {
        chunk.toString().split(/\r?\n/).filter(Boolean).forEach(send);
      };
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", onData);
      proc.on("error", (err) => reject(err));
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Einrichtung fehlgeschlagen (Exit-Code ${code})`));
      });
    });
  });

  /** Schreibt die .env-Datei in den userData-Pfad.
   *  envValues ist ein Record<string, string> mit den Key-Value-Paaren. */
  ipcMain.handle("setup:write-env", async (_event, envValues: Record<string, string>) => {
    fs.mkdirSync(path.dirname(USER_ENV_FILE), { recursive: true });

    // Datei existiert → Kommentare und Struktur erhalten, nur Werte ersetzen
    if (fs.existsSync(USER_ENV_FILE)) {
      const existing = fs.readFileSync(USER_ENV_FILE, "utf8");
      const updated = new Set<string>();
      const outLines = existing.split(/\r?\n/).map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return line;
        const idx = trimmed.indexOf("=");
        if (idx < 0) return line;
        const key = trimmed.slice(0, idx).trim();
        if (key in envValues) {
          updated.add(key);
          return `${key}=${envValues[key]}`;
        }
        return line;
      });
      // Neue Keys anfügen die noch nicht in der Datei waren
      for (const [k, v] of Object.entries(envValues)) {
        if (!updated.has(k)) outLines.push(`${k}=${v}`);
      }
      fs.writeFileSync(USER_ENV_FILE, outLines.join("\n") + "\n", "utf8");
    } else {
      // Noch keine Datei → einfach schreiben
      const lines = Object.entries(envValues).map(([k, v]) => `${k}=${v}`).join("\n");
      fs.writeFileSync(USER_ENV_FILE, lines + "\n", "utf8");
    }
    return USER_ENV_FILE;
  });

  /** Liest die vorhandene .env (falls vorhanden) und gibt die Werte zurück. */
  ipcMain.handle("setup:read-env", () => {
    if (!fs.existsSync(USER_ENV_FILE)) return {};
    const content = fs.readFileSync(USER_ENV_FILE, "utf8");
    const result: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx < 0) continue;
      result[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
    return result;
  });

  // ── .env-Migration ─────────────────────────────────────────────────────────

  /**
   * Parst .env.example und die User-.env, gibt fehlende Keys mit Metadaten zurück.
   * Rückgabe: Array von { key, defaultValue, comments, sensitive }
   */
  ipcMain.handle("env:check-migration", (_event, examplePath: string) => {
    if (!fs.existsSync(examplePath) || !fs.existsSync(USER_ENV_FILE)) return [];

    // User-.env einlesen
    const userEnv: Record<string, string> = {};
    for (const line of fs.readFileSync(USER_ENV_FILE, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx < 0) continue;
      userEnv[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
    }

    // .env.example parsen: Keys + Default + vorherige Kommentarzeilen sammeln
    const exampleLines = fs.readFileSync(examplePath, "utf8").split(/\r?\n/);
    const missing: Array<{ key: string; defaultValue: string; comments: string[]; sensitive: boolean }> = [];
    const pendingComments: string[] = [];

    for (const line of exampleLines) {
      const t = line.trim();
      if (!t) { pendingComments.length = 0; continue; }
      if (t.startsWith("#")) { pendingComments.push(t.slice(1).trim()); continue; }
      const idx = t.indexOf("=");
      if (idx < 0) { pendingComments.length = 0; continue; }
      const key = t.slice(0, idx).trim();
      const defaultValue = t.slice(idx + 1).trim();
      if (!(key in userEnv)) {
        const sensitive = /key|secret|password|token/i.test(key);
        missing.push({ key, defaultValue, comments: [...pendingComments], sensitive });
      }
      pendingComments.length = 0;
    }

    return missing;
  });

  /** Schreibt fehlende Keys in die User-.env (Kommentare werden mit übertragen). */
  ipcMain.handle("env:apply-migration", (_event, entries: Array<{ key: string; value: string; comments: string[] }>) => {
    if (!fs.existsSync(USER_ENV_FILE) || entries.length === 0) return;
    const existing = fs.readFileSync(USER_ENV_FILE, "utf8");
    const appendLines: string[] = ["", "# ── Neue Einstellungen (automatisch ergänzt) ──────────────────────────────"];
    for (const { key, value, comments } of entries) {
      for (const c of comments) appendLines.push(`# ${c}`);
      appendLines.push(`${key}=${value}`);
    }
    fs.writeFileSync(USER_ENV_FILE, existing.trimEnd() + "\n" + appendLines.join("\n") + "\n", "utf8");
  });

  // ── Deinstallation ─────────────────────────────────────────────────────────

  /**
   * Zeigt einen Bestätigungsdialog und startet dann den NSIS-Uninstaller.
   * Gibt { confirmed: false } zurück wenn der Nutzer abbricht.
   * deleteUserData: true  → löscht zusätzlich %LOCALAPPDATA%\Clip2Guide
   */
  ipcMain.handle("app:uninstall", async (_event, deleteUserData: boolean) => {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Deinstallieren", "Abbrechen"],
      defaultId: 1,
      cancelId: 1,
      title: "Clip2Guide deinstallieren",
      message: deleteUserData
        ? "Clip2Guide wird deinstalliert und alle Benutzerdaten (venv, Workspace, Tools) werden gelöscht. Fortfahren?"
        : "Clip2Guide wird deinstalliert. Benutzerdaten bleiben erhalten. Fortfahren?",
    });

    if (response !== 0) return { confirmed: false };

    if (deleteUserData && fs.existsSync(USER_LOCAL_DIR)) {
      fs.rmSync(USER_LOCAL_DIR, { recursive: true, force: true });
    }

    // NSIS-Uninstaller liegt neben der App-EXE im Installationsverzeichnis
    const uninstallerPath = path.join(
      path.dirname(app.getPath("exe")),
      "Uninstall Clip2Guide.exe"
    );
    if (fs.existsSync(uninstallerPath)) {
      spawn(uninstallerPath, [], { detached: true, stdio: "ignore" }).unref();
    }

    app.quit();
    return { confirmed: true };
  });

  // ── Debug-Panel IPC ─────────────────────────────────────────────────────────

  /** Sammelt Systeminfos: Plattform, Architektur, Pfade, Backend-Status, venv. */
  ipcMain.handle("debug:info", async () => {
    const isWindows = process.platform === "win32";
    const venvPython = path.join(
      USER_LOCAL_DIR, "backend", ".venv",
      isWindows ? "Scripts\\python.exe" : "bin/python"
    );
    const backendCwd = app.isPackaged
      ? path.join(process.resourcesPath, "app.asar.unpacked", "backend")
      : path.join(USER_LOCAL_DIR, "backend");
    const workspaceTmp = path.join(USER_LOCAL_DIR, "workspace", "tmp");

    // Backend-Erreichbarkeit prüfen
    let backendReachable = false;
    let backendError = "";
    try {
      const res = await fetch("http://127.0.0.1:8787/health", { signal: AbortSignal.timeout(3000) });
      backendReachable = res.ok;
      if (!res.ok) backendError = `HTTP ${res.status}`;
    } catch (e: unknown) {
      backendError = e instanceof Error ? e.message : String(e);
    }

    // Python-Architektur auslesen (nur wenn venv existiert)
    let pythonArch = "n/a";
    let pythonVersion = "n/a";
    if (fs.existsSync(venvPython)) {
      pythonArch = await new Promise<string>((resolve) => {
        execFile(venvPython, ["-c", "import platform; print(platform.machine())"],
          { timeout: 5000 }, (err, stdout) => resolve(err ? "error" : stdout.trim()));
      });
      pythonVersion = await new Promise<string>((resolve) => {
        execFile(venvPython, ["--version"],
          { timeout: 5000 }, (err, stdout, stderr) => resolve(err ? "error" : (stdout || stderr).trim()));
      });
    }

    // FFmpeg-Architektur
    const ffmpegExe = path.join(USER_LOCAL_DIR, "tools", "ffmpeg", "bin",
      isWindows ? "ffmpeg.exe" : "ffmpeg");
    let ffmpegArch = "n/a";
    if (fs.existsSync(ffmpegExe) && !isWindows) {
      ffmpegArch = await new Promise<string>((resolve) => {
        execFile("file", [ffmpegExe], { timeout: 5000 },
          (err, stdout) => resolve(err ? "error" : stdout.trim()));
      });
    } else if (fs.existsSync(ffmpegExe)) {
      ffmpegArch = "vorhanden (Windows)";
    }

    // Workspace-Verzeichnisse
    const wsRoot = path.join(USER_LOCAL_DIR, "workspace");
    const wsDirs = ["uploads", "normalized", "cut", "frames", "ai-output", "output", "tmp"];
    const wsStatus: Record<string, string> = {};
    for (const d of wsDirs) {
      const p = path.join(wsRoot, d);
      if (fs.existsSync(p)) {
        try {
          const count = fs.readdirSync(p).length;
          wsStatus[d] = `${count} Einträge`;
        } catch { wsStatus[d] = "Lesefehler"; }
      } else {
        wsStatus[d] = "fehlt";
      }
    }

    // Log-Verzeichnis
    const logDir = path.join(USER_LOCAL_DIR, "workspace", "logs");
    let logFiles: string[] = [];
    try { logFiles = fs.existsSync(logDir) ? fs.readdirSync(logDir).slice(-10) : []; } catch { /**/ }

    return {
      app: {
        version: app.getVersion(),
        isPackaged: app.isPackaged,
        platform: process.platform,
        arch: process.arch,
        osArch: os.arch(),
        osPlatform: os.platform(),
        osRelease: os.release(),
        nodeVersion: process.versions.node,
        electronVersion: process.versions.electron,
      },
      paths: {
        userLocalDir: USER_LOCAL_DIR,
        userEnvFile: USER_ENV_FILE,
        envExists: fs.existsSync(USER_ENV_FILE),
        venvPython,
        venvExists: fs.existsSync(venvPython),
        ffmpegExe,
        ffmpegExists: fs.existsSync(ffmpegExe),
        backendCwd,
        workspaceTmp,
        logDir,
      },
      python: {
        version: pythonVersion,
        arch: pythonArch,
      },
      ffmpeg: {
        arch: ffmpegArch,
      },
      backend: {
        reachable: backendReachable,
        error: backendError,
        url: "http://127.0.0.1:8787",
      },
      workspace: wsStatus,
      logs: logFiles,
    };
  });

  /** Leert Electron-Session-Cache und workspace/tmp. */
  ipcMain.handle("debug:clear-cache", async () => {
    const results: string[] = [];
    try {
      await session.defaultSession.clearCache();
      results.push("Electron-Cache geleert");
    } catch (e: unknown) {
      results.push(`Electron-Cache Fehler: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await session.defaultSession.clearStorageData();
      results.push("Electron-Storage geleert");
    } catch (e: unknown) {
      results.push(`Electron-Storage Fehler: ${e instanceof Error ? e.message : String(e)}`);
    }
    const tmpDir = path.join(USER_LOCAL_DIR, "workspace", "tmp");
    if (fs.existsSync(tmpDir)) {
      try {
        const entries = fs.readdirSync(tmpDir);
        for (const entry of entries) {
          fs.rmSync(path.join(tmpDir, entry), { recursive: true, force: true });
        }
        results.push(`workspace/tmp geleert (${entries.length} Einträge)`);
      } catch (e: unknown) {
        results.push(`workspace/tmp Fehler: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      results.push("workspace/tmp nicht vorhanden");
    }
    return results;
  });

  /** Öffnet das Log-Verzeichnis im Finder / Explorer. */
  ipcMain.handle("debug:open-log-dir", async () => {
    const logDir = path.join(USER_LOCAL_DIR, "workspace", "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    await shell.openPath(logDir);
  });

  /** Öffnet die .env-Datei im Standard-Texteditor. */
  ipcMain.handle("debug:open-env-file", async () => {
    if (fs.existsSync(USER_ENV_FILE)) {
      await shell.openPath(USER_ENV_FILE);
    }
    return fs.existsSync(USER_ENV_FILE);
  });
}
