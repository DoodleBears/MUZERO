// Main-process IPC handlers for the renderer's `window.muzero` bridge.
//
// fs security mirrors the Tauri "runtime per-folder scope" posture: the app ships
// with NO filesystem access; folders become readable only after `grantFolder`
// (called when the user picks one, and re-issued each launch from the remembered
// `importFolders` list). Every read validates the path against the allowlist using
// the resolved real path, so symlinks can't escape the granted roots.
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { applyAppIcon } = require("./app-icon.cjs");
const { registerLocalMedia } = require("./local-media.cjs");
const { windowPin } = require("./window-pin.cjs");

/** Granted folder roots (real paths). In-memory, not persisted — re-granted on boot. */
const allowedRoots = new Set();
const windowMaximizedState = new WeakMap();
const windowNormalBounds = new WeakMap();
const windowStateTimers = new WeakMap();
let mediaStorageRoot = null;

const isWin = process.platform === "win32";
const norm = (p) => (isWin ? p.toLowerCase() : p);

function realOrNull(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return null;
  }
}

/** Resolve `target` to a real path and assert it sits within a granted root. */
function assertAllowed(target) {
  const real = realOrNull(target);
  if (!real) throw new Error(`ENOENT: ${target}`);
  const r = norm(real);
  for (const root of allowedRoots) {
    const nr = norm(root);
    if (r === nr || r.startsWith(nr + path.sep)) return real;
  }
  throw new Error("EACCES: path outside granted scope");
}

async function ensureMediaStorageRoot() {
  if (mediaStorageRoot) return mediaStorageRoot;
  const root = path.join(app.getPath("userData"), "persistent-media");
  await fsp.mkdir(root, { recursive: true });
  mediaStorageRoot = await fsp.realpath(root);
  return mediaStorageRoot;
}

function storageKeyParts(storageKey) {
  if (typeof storageKey !== "string" || storageKey.trim() === "") {
    throw new Error("Invalid media storage key");
  }
  if (storageKey.includes("\0") || path.isAbsolute(storageKey)) {
    throw new Error("Invalid media storage key");
  }
  const normalized = path.normalize(storageKey).replace(/^[/\\]+/, "");
  if (normalized === "." || normalized.startsWith("..")) {
    throw new Error("Invalid media storage key");
  }
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Invalid media storage key");
  }
  return parts;
}

function assertPathInsideRoot(candidate, root) {
  const c = norm(candidate);
  const r = norm(root);
  if (c !== r && !c.startsWith(r + path.sep)) {
    throw new Error("EACCES: media path outside storage root");
  }
}

function isCurrentAppOrigin(url) {
  const devUrl = process.env.MUZERO_ELECTRON_URL;
  if (!devUrl) return false;
  const dev = new URL(devUrl);
  return url.protocol === dev.protocol && url.host === dev.host;
}

function isDevLoopbackUrl(url) {
  return (
    Boolean(process.env.MUZERO_ELECTRON_URL) &&
    ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
  );
}

function senderWindow(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error("Window is no longer available");
  return win;
}

function windowState(win) {
  const cachedMaximized = windowMaximizedState.get(win) === true;
  return {
    fullscreen: win.isFullScreen(),
    maximized: cachedMaximized || win.isMaximized(),
    pinMode: windowPin.getMode(win),
  };
}

function sendWindowState(win, state = windowState(win)) {
  if (win.isDestroyed()) return;
  win.webContents.send("muzero:window:state", state);
}

function clearWindowStateTimer(win) {
  const timer = windowStateTimers.get(win);
  if (timer) clearTimeout(timer);
  windowStateTimers.delete(win);
}

function validBounds(bounds) {
  return (
    bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}

async function ensureMediaStorageParent(parts) {
  const root = await ensureMediaStorageRoot();
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const next = path.join(current, part);
    assertPathInsideRoot(next, root);
    try {
      const stat = await fsp.lstat(next);
      if (stat.isSymbolicLink()) throw new Error("EACCES: symlink in media storage path");
      if (!stat.isDirectory()) throw new Error("ENOTDIR: media storage path component");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await fsp.mkdir(next);
    }
    current = next;
  }
  return current;
}

async function mediaStorageWriteTarget(storageKey) {
  const parts = storageKeyParts(storageKey);
  const parent = await ensureMediaStorageParent(parts);
  const filePath = path.join(parent, parts.at(-1));
  const root = await ensureMediaStorageRoot();
  assertPathInsideRoot(filePath, root);
  try {
    const stat = await fsp.lstat(filePath);
    if (stat.isSymbolicLink()) throw new Error("EACCES: symlink in media storage path");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return { filePath, parent };
}

async function mediaStorageExistingTarget(storageKey) {
  const parts = storageKeyParts(storageKey);
  const root = await ensureMediaStorageRoot();
  const candidate = path.join(root, ...parts);
  const real = await fsp.realpath(candidate);
  assertPathInsideRoot(real, root);
  return real;
}

function registerIpc({ trayController } = {}) {
  ipcMain.handle("muzero:grantFolder", (_event, folderPath) => {
    const real = realOrNull(folderPath);
    if (real) allowedRoots.add(real);
  });

  ipcMain.handle("muzero:pickFolder", async () => {
    const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  ipcMain.handle("muzero:readDir", async (_event, dirPath) => {
    const real = assertAllowed(dirPath);
    const entries = await fsp.readdir(real, { withFileTypes: true });
    return entries.map((d) => ({
      name: d.name,
      isDirectory: d.isDirectory(),
      isFile: d.isFile(),
      isSymlink: d.isSymbolicLink(),
    }));
  });

  ipcMain.handle("muzero:readFile", async (_event, filePath) => {
    const real = assertAllowed(filePath);
    const buf = await fsp.readFile(real);
    // Return a standalone ArrayBuffer (structured-cloned across IPC).
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle("muzero:localMedia:token", async (_event, input) => {
    // storageKey: an app-managed persistent-media file (covers/media). Resolve it
    // through the same traversal/symlink-safe mapping as fs IPC — no allowlist
    // needed since the key is confined to our media root. Otherwise it's an
    // absolute path from an imported folder, gated by the granted-folder allowlist.
    const real = input?.storageKey
      ? await mediaStorageExistingTarget(input.storageKey)
      : assertAllowed(input?.path);
    return registerLocalMedia(real, input?.mime);
  });

  ipcMain.handle("muzero:saveFile", async (_event, input) => {
    const res = await dialog.showSaveDialog({ defaultPath: input.fileName });
    if (res.canceled || !res.filePath) return false;
    await fsp.writeFile(res.filePath, Buffer.from(input.bytes));
    return true;
  });

  ipcMain.handle("muzero:mediaStorage:write", async (_event, input) => {
    const storageKey = input?.storageKey;
    const bytes = Buffer.from(input?.bytes ?? new ArrayBuffer(0));
    const expectedBytes = Number.isFinite(input?.expectedBytes) ? input.expectedBytes : bytes.length;
    const { filePath, parent } = await mediaStorageWriteTarget(storageKey);
    const tempPath = path.join(parent, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
    try {
      await fsp.writeFile(tempPath, bytes);
      const tempStat = await fsp.stat(tempPath);
      if (tempStat.size !== expectedBytes) throw new Error("Media storage staged write mismatch");
      await fsp.rename(tempPath, filePath);
      const finalStat = await fsp.stat(filePath);
      if (finalStat.size !== expectedBytes) {
        await fsp.rm(filePath, { force: true });
        throw new Error("Media storage final write mismatch");
      }
    } catch (error) {
      await fsp.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  });

  ipcMain.handle("muzero:mediaStorage:read", async (_event, input) => {
    const filePath = await mediaStorageExistingTarget(input?.storageKey);
    const buf = await fsp.readFile(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  });

  ipcMain.handle("muzero:mediaStorage:delete", async (_event, input) => {
    try {
      const filePath = await mediaStorageExistingTarget(input?.storageKey);
      await fsp.rm(filePath, { force: true });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  });

  ipcMain.handle("muzero:mediaStorage:stat", async (_event, input) => {
    try {
      const filePath = await mediaStorageExistingTarget(input?.storageKey);
      const stat = await fsp.stat(filePath);
      return { bytes: stat.size };
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  });

  ipcMain.handle("muzero:mediaStorage:openRoot", async () => {
    const root = await ensureMediaStorageRoot();
    const error = await shell.openPath(root);
    if (error) throw new Error(error);
  });

  ipcMain.handle("muzero:openExternal", async (_event, url) => {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("Unsupported external URL protocol");
    }
    if (isCurrentAppOrigin(u)) {
      console.warn(`[muzero:electron] blocked internal ipc openExternal: ${u.toString()}`);
      return;
    }
    if (isDevLoopbackUrl(u)) {
      console.warn(`[muzero:electron] blocked loopback ipc openExternal: ${u.toString()}`);
      return;
    }
    console.warn(`[muzero:electron] open external from ipc: ${u.toString()}`);
    await shell.openExternal(u.toString());
  });

  // Swap the running dock/taskbar icon. `applyAppIcon` allowlists the variant id
  // → a bundled asset, so an unknown/forged value is a silent no-op (never a path).
  ipcMain.handle("muzero:setAppIcon", (_event, icon) => {
    applyAppIcon(icon);
  });

  ipcMain.handle("muzero:window:minimize", (event) => {
    senderWindow(event).minimize();
  });

  ipcMain.handle("muzero:window:toggleMaximize", (event) => {
    const win = senderWindow(event);
    clearWindowStateTimer(win);
    const shouldRestore = windowMaximizedState.get(win) === true || win.isMaximized();
    const expectedMaximized = !shouldRestore;
    if (shouldRestore) {
      const restoreBounds = windowNormalBounds.get(win) ?? win.getNormalBounds();
      windowMaximizedState.set(win, false);
      win.unmaximize();
      win.restore();
      if (validBounds(restoreBounds)) {
        win.setBounds(restoreBounds, true);
      }
    } else {
      windowNormalBounds.set(win, win.getBounds());
      windowMaximizedState.set(win, true);
      win.maximize();
    }
    const state = {
      fullscreen: win.isFullScreen(),
      maximized: expectedMaximized,
      pinMode: windowPin.getMode(win),
    };
    sendWindowState(win, state);
    const timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      windowMaximizedState.set(win, expectedMaximized);
      sendWindowState(win, {
        fullscreen: win.isFullScreen(),
        maximized: expectedMaximized,
        pinMode: windowPin.getMode(win),
      });
      windowStateTimers.delete(win);
    }, 120);
    windowStateTimers.set(win, timer);
    return state;
  });

  ipcMain.handle("muzero:window:close", (event) => {
    senderWindow(event).close();
  });

  ipcMain.handle("muzero:window:hideToTray", (event) => {
    const win = senderWindow(event);
    if (!trayController?.hasTray()) return win.close();
    trayController.hideToTray(win);
  });

  ipcMain.handle("muzero:window:showFromTray", (event) => {
    trayController?.showWindow(senderWindow(event));
  });

  ipcMain.handle("muzero:window:quitApp", () => {
    trayController?.quitApp();
  });

  ipcMain.handle("muzero:tray:update", (_event, model) => {
    trayController?.updateMenu(model);
  });

  ipcMain.handle("muzero:window:setPinMode", (event, mode) => {
    const win = senderWindow(event);
    windowPin.applyMode(win, mode);
    const state = windowState(win);
    sendWindowState(win, state);
    return state;
  });

  ipcMain.handle("muzero:window:cyclePinMode", (event) => {
    const win = senderWindow(event);
    windowPin.cycleMode(win);
    const state = windowState(win);
    sendWindowState(win, state);
    return state;
  });

  ipcMain.handle("muzero:window:getState", (event) => {
    const win = senderWindow(event);
    return windowState(win);
  });
}

module.exports = { registerIpc };
