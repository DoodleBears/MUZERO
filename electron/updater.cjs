// Desktop auto-update (electron-updater). Inlined into dist-electron/main.cjs by
// the esbuild bundle, so it works with node_modules excluded. Win/Linux apply
// updates in place; unsigned macOS can't (Squirrel.Mac needs a signature), so it
// reports `manual-required` with a download URL. Status is broadcast to the
// renderer over `muzero:update:status`; the channel toggle is a visible Settings
// control (no hidden flags). See the release PRD §2.6/§4.1.
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const DOWNLOAD_PAGE = "https://mu0.app/download";
const isMac = process.platform === "darwin";

let latest = { kind: "idle" };
let started = false;

function broadcast(status) {
  latest = status;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("muzero:update:status", status);
  }
}

// Unsigned macOS and dev builds can't silently apply updates.
function canAutoApply() {
  return app.isPackaged && !isMac;
}

async function runCheck() {
  if (isMac) {
    broadcast({ kind: "manual-required", downloadUrl: DOWNLOAD_PAGE });
    return latest;
  }
  if (!canAutoApply()) {
    broadcast({ kind: "idle" });
    return latest;
  }
  broadcast({ kind: "checking" });
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    broadcast({ kind: "error", error: String((error && error.message) || error) });
  }
  return latest;
}

function initDesktopUpdater() {
  if (started) return;
  started = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (info) => broadcast({ kind: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => broadcast({ kind: "idle" }));
  autoUpdater.on("download-progress", (p) => broadcast({ kind: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => broadcast({ kind: "downloaded", version: info.version }));
  autoUpdater.on("error", (error) => broadcast({ kind: "error", error: String((error && error.message) || error) }));

  ipcMain.handle("muzero:getAppVersion", () => app.getVersion());
  ipcMain.handle("muzero:update:check", () => runCheck());
  ipcMain.handle("muzero:update:install", () => {
    if (isMac) {
      void shell.openExternal(DOWNLOAD_PAGE);
      return false;
    }
    if (latest.kind !== "downloaded") return false;
    autoUpdater.quitAndInstall(true, true); // silent + run-after-install
    return true;
  });
  ipcMain.handle("muzero:update:setChannel", (_event, channel) => {
    autoUpdater.channel = channel === "beta" ? "beta" : "latest";
    autoUpdater.allowDowngrade = channel !== "beta"; // beta→stable is a "downgrade"
    return runCheck();
  });

  // Startup check (after first paint settles), then every 6h. macOS still runs so
  // it can surface `manual-required`.
  if (canAutoApply() || (isMac && app.isPackaged)) {
    setTimeout(() => void runCheck(), 5000);
    if (canAutoApply()) setInterval(() => void runCheck(), CHECK_INTERVAL_MS);
  }
}

module.exports = { initDesktopUpdater };
