import { IpcMain, dialog, shell, app } from "electron";
import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { USER_ENV_FILE } from "./main";

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
          ["-ExecutionPolicy", "RemoteSigned", "-File", scriptPath, "-Root", resourcesPath],
          { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } }
        );
      } else {
        proc = spawn(
          "bash",
          [scriptPath],
          { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ROOT: resourcesPath } }
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
    const lines = Object.entries(envValues)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    fs.mkdirSync(path.dirname(USER_ENV_FILE), { recursive: true });
    fs.writeFileSync(USER_ENV_FILE, lines + "\n", "utf8");
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
}
