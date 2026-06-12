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

/** Granted folder roots (real paths). In-memory, not persisted — re-granted on boot. */
const allowedRoots = new Set();
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

function senderWindow(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error("Window is no longer available");
  return win;
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

function registerIpc() {
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

  ipcMain.handle("muzero:openExternal", async (_event, url) => {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new Error("Unsupported external URL protocol");
    }
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
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return { fullscreen: win.isFullScreen(), maximized: win.isMaximized() };
  });

  ipcMain.handle("muzero:window:close", (event) => {
    senderWindow(event).close();
  });

  ipcMain.handle("muzero:window:getState", (event) => {
    const win = senderWindow(event);
    return { fullscreen: win.isFullScreen(), maximized: win.isMaximized() };
  });
}

module.exports = { registerIpc };
