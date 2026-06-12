// Sandboxed preload (contextIsolation + sandbox). Exposes a minimal, typed bridge
// on `window.muzero`; the renderer detects Electron by its presence and routes all
// native access (folder picking, fs reads, save dialog, opening links) through it.
// Network goes through the `muzfetch://` scheme, not here (see electron/main.cjs).
const { contextBridge, ipcRenderer } = require("electron");
// Sandboxed preloads can only require Electron's limited preload modules; keep
// this in sync with electron/diagnostics.cjs without requiring that local file.
const DIAGNOSTICS_CHANNEL = "muzero:diagnostics:event";

contextBridge.exposeInMainWorld("muzero", {
  kind: "electron",
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke("muzero:pickFolder"),
  readDir: (path) => ipcRenderer.invoke("muzero:readDir", path),
  readFile: (path) => ipcRenderer.invoke("muzero:readFile", path),
  grantFolderAccess: (path) => ipcRenderer.invoke("muzero:grantFolder", path),
  saveFile: (input) => ipcRenderer.invoke("muzero:saveFile", input),
  writeMediaStorageFile: (input) => ipcRenderer.invoke("muzero:mediaStorage:write", input),
  readMediaStorageFile: (input) => ipcRenderer.invoke("muzero:mediaStorage:read", input),
  deleteMediaStorageFile: (input) => ipcRenderer.invoke("muzero:mediaStorage:delete", input),
  statMediaStorageFile: (input) => ipcRenderer.invoke("muzero:mediaStorage:stat", input),
  openExternal: (url) => ipcRenderer.invoke("muzero:openExternal", url),
  setAppIcon: (icon) => ipcRenderer.invoke("muzero:setAppIcon", icon),
  openSourceLogin: (request) => ipcRenderer.invoke("muzero:openSourceLogin", request),
  readSourceCookies: (request) => ipcRenderer.invoke("muzero:readSourceCookies", request),
  evalYoutubeN: (functionSource, n) =>
    ipcRenderer.invoke("muzero:evalYoutubeN", functionSource, n),
  getAppVersion: () => ipcRenderer.invoke("muzero:getAppVersion"),
  windowControls: {
    minimize: () => ipcRenderer.invoke("muzero:window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("muzero:window:toggleMaximize"),
    close: () => ipcRenderer.invoke("muzero:window:close"),
    getState: () => ipcRenderer.invoke("muzero:window:getState"),
    onStateChange: (callback) => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on("muzero:window:state", listener);
      return () => ipcRenderer.removeListener("muzero:window:state", listener);
    },
  },
  update: {
    onStatus: (callback) => {
      const listener = (_event, status) => callback(status);
      ipcRenderer.on("muzero:update:status", listener);
      return () => ipcRenderer.removeListener("muzero:update:status", listener);
    },
    check: () => ipcRenderer.invoke("muzero:update:check"),
    install: () => ipcRenderer.invoke("muzero:update:install"),
    setChannel: (channel) => ipcRenderer.invoke("muzero:update:setChannel", channel),
  },
  diagnostics: {
    onEvent: (callback) => {
      const listener = (_event, entry) => callback(entry);
      ipcRenderer.on(DIAGNOSTICS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(DIAGNOSTICS_CHANNEL, listener);
    },
  },
});
