import { IpcMain, dialog, shell, app } from "electron";

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
}
