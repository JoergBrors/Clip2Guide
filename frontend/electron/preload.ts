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

export type Clip2GuideApi = {
  backendUrl: string;
  openPath: (filePath: string) => Promise<void>;
  openFileDialog: (filters?: Electron.FileFilter[]) => Promise<string | null>;
  saveFileDialog: (defaultName?: string) => Promise<string | null>;
  getVersion: () => Promise<string>;
};

declare global {
  interface Window {
    clip2guide: Clip2GuideApi;
  }
}
