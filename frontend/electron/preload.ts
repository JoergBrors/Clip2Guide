import { contextBridge, ipcRenderer } from "electron";

/**
 * Clip2Guide Preload-Script
 * Stellt dem Renderer-Prozess ein typsicheres API-Objekt bereit.
 * Kein direkter Node-Zugriff aus dem Renderer.
 */
contextBridge.exposeInMainWorld("clip2guide", {
  /** Backend-Basis-URL */
  backendUrl: "http://localhost:8787",

  /** IPC: Datei im System-Explorer oeffnen */
  openPath: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("open-path", filePath),

  /** IPC: Nativen Datei-Oeffnen-Dialog */
  openFileDialog: (filters?: Electron.FileFilter[]): Promise<string | null> =>
    ipcRenderer.invoke("open-file-dialog", filters),

  /** IPC: Nativen Ordner-Speichern-Dialog */
  saveFileDialog: (defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke("save-file-dialog", defaultName),

  /** IPC: App-Version */
  getVersion: (): Promise<string> =>
    ipcRenderer.invoke("get-version"),
});

/** Setup-Wizard API – nur im Einrichtungsschritt verwendet. */
contextBridge.exposeInMainWorld("setupAPI", {
  isComplete: (): Promise<boolean> =>
    ipcRenderer.invoke("setup:is-complete"),

  runInitial: (): Promise<void> =>
    ipcRenderer.invoke("setup:run-initial"),

  onLog: (callback: (msg: string) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on("setup:log", listener);
    return () => ipcRenderer.removeListener("setup:log", listener);
  },

  writeEnv: (values: Record<string, string>): Promise<string> =>
    ipcRenderer.invoke("setup:write-env", values),

  readEnv: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke("setup:read-env"),

  complete: (): void => {
    ipcRenderer.send("setup:completed");
  },
});

/** Update-API – Requirements-Update-Fenster */
contextBridge.exposeInMainWorld("updateAPI", {
  onLog: (callback: (msg: string) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on("update:log", listener);
    return () => ipcRenderer.removeListener("update:log", listener);
  },
  onDone: (callback: (success: boolean, error?: string) => void): (() => void) => {
    const listener = (_: Electron.IpcRendererEvent, success: boolean, error?: string) =>
      callback(success, error);
    ipcRenderer.on("update:done", listener);
    return () => ipcRenderer.removeListener("update:done", listener);
  },
  close: (): void => {
    ipcRenderer.send("update:close");
  },
});

/** Uninstall-API */
contextBridge.exposeInMainWorld("appAPI", {
  uninstall: (deleteUserData: boolean): Promise<{ confirmed: boolean }> =>
    ipcRenderer.invoke("app:uninstall", deleteUserData),
});

/** Debug-API */
contextBridge.exposeInMainWorld("debugAPI", {
  getInfo: (): Promise<unknown> =>
    ipcRenderer.invoke("debug:info"),
  clearCache: (): Promise<string[]> =>
    ipcRenderer.invoke("debug:clear-cache"),
  openLogDir: (): Promise<void> =>
    ipcRenderer.invoke("debug:open-log-dir"),
  openEnvFile: (): Promise<boolean> =>
    ipcRenderer.invoke("debug:open-env-file"),
});

export type Clip2GuideApi = {
  backendUrl: string;
  openPath: (filePath: string) => Promise<void>;
  openFileDialog: (filters?: Electron.FileFilter[]) => Promise<string | null>;
  saveFileDialog: (defaultName?: string) => Promise<string | null>;
  getVersion: () => Promise<string>;
};

export type SetupApi = {
  isComplete: () => Promise<boolean>;
  runInitial: () => Promise<void>;
  onLog: (callback: (msg: string) => void) => () => void;
  writeEnv: (values: Record<string, string>) => Promise<string>;
  readEnv: () => Promise<Record<string, string>>;
  complete: () => void;
};

export type DebugApi = {
  getInfo: () => Promise<unknown>;
  clearCache: () => Promise<string[]>;
  openLogDir: () => Promise<void>;
  openEnvFile: () => Promise<boolean>;
};

declare global {
  interface Window {
    clip2guide: Clip2GuideApi;
    setupAPI: SetupApi;
    debugAPI?: DebugApi;
  }
}
