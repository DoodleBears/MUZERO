// Sandboxed preload (contextIsolation + sandbox). Exposes a minimal, typed bridge
// on `window.muzero`; the renderer detects Electron by its presence and routes all
// native access (folder picking, fs reads, save dialog, opening links) through it.
// Network goes through the `muzfetch://` scheme, not here (see electron/main.cjs).
const { contextBridge, ipcRenderer, webUtils } = require("electron");
// Sandboxed preloads can only require Electron's limited preload modules; keep
// this in sync with electron/diagnostics.cjs without requiring that local file.
const DIAGNOSTICS_CHANNEL = "muzero:diagnostics:event";
const CLICK_THROUGH_HOVER_CHANNEL = "muzero:window:clickThroughHover";
const SYSTEM_SHORTCUT_CONFIGURE_CHANNEL = "muzero:systemShortcuts:configure";
const SYSTEM_SHORTCUT_ACTION_CHANNEL = "muzero:systemShortcuts:action";
const LIVE_REQUEST_MESSAGE_CHANNEL = "muzero:liveRequest:message";
// Dev-only control endpoint relay (PRD 20260615-dev-control-endpoint). Inert in prod:
// the main process only sends/handles these channels when the build is unpackaged and
// opted in (see electron/perf-control.cjs shouldEnablePerfControl), so with no server
// attached onCommand never fires and sendResult reaches no handler.
const PERF_CONTROL_COMMAND_CHANNEL = "muzero:perfControl:command";
const PERF_CONTROL_RESULT_CHANNEL = "muzero:perfControl:result";

contextBridge.exposeInMainWorld("muzero", {
  kind: "electron",
  platform: process.platform,
  pickFolder: () => ipcRenderer.invoke("muzero:pickFolder"),
  readDir: (path) => ipcRenderer.invoke("muzero:readDir", path),
  scanFolderForMedia: (path, options) => ipcRenderer.invoke("muzero:scanFolderForMedia", path, options),
  readFile: (path) => ipcRenderer.invoke("muzero:readFile", path),
  grantFolderAccess: (path) => ipcRenderer.invoke("muzero:grantFolder", path),
  grantFileAccess: (path) => ipcRenderer.invoke("muzero:grantFile", path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  localMediaToken: (input) => ipcRenderer.invoke("muzero:localMedia:token", input),
  saveFile: (input) => ipcRenderer.invoke("muzero:saveFile", input),
  writeMediaStorageFile: (input) => ipcRenderer.invoke("muzero:mediaStorage:write", input),
  beginMediaStorageWrite: (input) =>
    ipcRenderer.invoke("muzero:mediaStorage:writeBegin", input),
  writeMediaStorageChunk: (input) =>
    ipcRenderer.invoke("muzero:mediaStorage:writeChunk", input),
  commitMediaStorageWrite: (input) =>
    ipcRenderer.invoke("muzero:mediaStorage:writeCommit", input),
  abortMediaStorageWrite: (input) =>
    ipcRenderer.invoke("muzero:mediaStorage:writeAbort", input),
  readMediaStorageFile: (input) => ipcRenderer.invoke("muzero:mediaStorage:read", input),
  deleteMediaStorageFile: (input) => ipcRenderer.invoke("muzero:mediaStorage:delete", input),
  statMediaStorageFile: (input) => ipcRenderer.invoke("muzero:mediaStorage:stat", input),
  openMediaStorageFolder: () => ipcRenderer.invoke("muzero:mediaStorage:openRoot"),
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
    setPinMode: (mode) => ipcRenderer.invoke("muzero:window:setPinMode", mode),
    cyclePinMode: () => ipcRenderer.invoke("muzero:window:cyclePinMode"),
    setClickThroughPaused: (paused) =>
      ipcRenderer.invoke("muzero:window:setClickThroughPaused", paused),
    setClickThroughRegions: (regions) =>
      ipcRenderer.invoke("muzero:window:setClickThroughRegions", regions),
    close: () => ipcRenderer.invoke("muzero:window:close"),
    hideToTray: () => ipcRenderer.invoke("muzero:window:hideToTray"),
    showFromTray: () => ipcRenderer.invoke("muzero:window:showFromTray"),
    quitApp: () => ipcRenderer.invoke("muzero:window:quitApp"),
    getState: () => ipcRenderer.invoke("muzero:window:getState"),
    onClickThroughHover: (callback) => {
      const listener = (_event, hovered) => callback(hovered === true);
      ipcRenderer.on(CLICK_THROUGH_HOVER_CHANNEL, listener);
      return () => ipcRenderer.removeListener(CLICK_THROUGH_HOVER_CHANNEL, listener);
    },
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
  tray: {
    update: (model) => ipcRenderer.invoke("muzero:tray:update", model),
    onAction: (callback) => {
      const listener = (_event, actionId) => callback(actionId);
      ipcRenderer.on("muzero:tray:action", listener);
      return () => ipcRenderer.removeListener("muzero:tray:action", listener);
    },
  },
  diagnostics: {
    onEvent: (callback) => {
      const listener = (_event, entry) => callback(entry);
      ipcRenderer.on(DIAGNOSTICS_CHANNEL, listener);
      return () => ipcRenderer.removeListener(DIAGNOSTICS_CHANNEL, listener);
    },
  },
  systemShortcuts: {
    configure: (registrations) =>
      ipcRenderer.invoke(SYSTEM_SHORTCUT_CONFIGURE_CHANNEL, { registrations }),
    onAction: (callback) => {
      const listener = (_event, actionId) => {
        if (typeof actionId === "string") callback(actionId);
      };
      ipcRenderer.on(SYSTEM_SHORTCUT_ACTION_CHANNEL, listener);
      return () => ipcRenderer.removeListener(SYSTEM_SHORTCUT_ACTION_CHANNEL, listener);
    },
  },
  liveRequestIntake: {
    start: (input) => ipcRenderer.invoke("muzero:liveRequest:start", input),
    stop: () => ipcRenderer.invoke("muzero:liveRequest:stop"),
    status: () => ipcRenderer.invoke("muzero:liveRequest:status"),
    onMessage: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(LIVE_REQUEST_MESSAGE_CHANNEL, listener);
      return () => ipcRenderer.removeListener(LIVE_REQUEST_MESSAGE_CHANNEL, listener);
    },
  },
  perfControl: {
    onCommand: (callback) => {
      const listener = (_event, message) => callback(message);
      ipcRenderer.on(PERF_CONTROL_COMMAND_CHANNEL, listener);
      return () => ipcRenderer.removeListener(PERF_CONTROL_COMMAND_CHANNEL, listener);
    },
    sendResult: (payload) => ipcRenderer.send(PERF_CONTROL_RESULT_CHANNEL, payload),
  },
});
