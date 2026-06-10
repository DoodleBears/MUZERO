// Sandboxed preload (contextIsolation + sandbox). Exposes a minimal, typed bridge
// on `window.muzero`; the renderer detects Electron by its presence and routes all
// native access (folder picking, fs reads, save dialog, opening links) through it.
// Network goes through the `muzfetch://` scheme, not here (see electron/main.cjs).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("muzero", {
  kind: "electron",
  pickFolder: () => ipcRenderer.invoke("muzero:pickFolder"),
  readDir: (path) => ipcRenderer.invoke("muzero:readDir", path),
  readFile: (path) => ipcRenderer.invoke("muzero:readFile", path),
  grantFolderAccess: (path) => ipcRenderer.invoke("muzero:grantFolder", path),
  saveFile: (input) => ipcRenderer.invoke("muzero:saveFile", input),
  openExternal: (url) => ipcRenderer.invoke("muzero:openExternal", url),
});
