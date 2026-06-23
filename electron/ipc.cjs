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
const { emitMainDiagnostic } = require("./diagnostics.cjs");
const { registerLocalMedia } = require("./local-media.cjs");
const { windowPin } = require("./window-pin.cjs");

/** Granted folder roots (real paths). In-memory, not persisted — re-granted on boot. */
const allowedRoots = new Set();
/** Exact file grants for drag/drop and file-picker imports. */
const allowedFiles = new Set();
const windowMaximizedState = new WeakMap();
const windowNormalBounds = new WeakMap();
const windowStateTimers = new WeakMap();
let mediaStorageRoot = null;
const pendingMediaStorageWrites = new Map();

const isWin = process.platform === "win32";
const norm = (p) => (isWin ? p.toLowerCase() : p);

function realOrNull(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return null;
  }
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

function pathExtension(filePath) {
  return path.extname(String(filePath || "")).toLowerCase() || undefined;
}

const MAX_FOLDER_SCAN_DEPTH = 24;
const NCM_EXT = /\.ncm$/i;
const ENCRYPTED_STORE_EXT =
  /\.(qmc0|qmc3|qmcflac|qmcogg|mflac|mflac0|mgg|mgg1|mggl|kgm|kgma|kwm|tkm|bkcmp3|bkcflac)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|flac|ogg|opus)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i;

async function traceFsIpc(event, work, context = {}) {
  const startedAt = nowMs();
  try {
    const result = await work();
    return result;
  } catch (error) {
    emitMainDiagnostic("warn", "electron.fs", event, event, {
      source: "electron-main",
      category: "sync",
      phase: "fail",
      durationMs: roundMs(nowMs() - startedAt),
      errorKind: error?.code === "EACCES" ? "permission_denied" : "unknown",
      errorCode: error?.code,
      errorName: error?.name,
      ...context,
      result: undefined,
    });
    throw error;
  }
}

/** Resolve `target` to a real path and assert it sits within a granted root. */
function assertAllowed(target) {
  const real = realOrNull(target);
  if (!real) throw new Error(`ENOENT: ${target}`);
  const r = norm(real);
  if (allowedFiles.has(r)) return real;
  for (const root of allowedRoots) {
    const nr = norm(root);
    if (r === nr || r.startsWith(nr + path.sep)) return real;
  }
  throw new Error("EACCES: path outside granted scope");
}

function joinRendererPath(base, name) {
  return `${String(base).replace(/[/\\]+$/, "")}/${name}`;
}

function classifyFolderScanFile(name) {
  if (NCM_EXT.test(name)) return { kind: "audio", decode: "ncm" };
  if (ENCRYPTED_STORE_EXT.test(name)) return { encrypted: true };
  if (AUDIO_EXT.test(name)) return { kind: "audio" };
  if (VIDEO_EXT.test(name)) return { kind: "video" };
  if (IMAGE_EXT.test(name)) return { image: true };
  return null;
}

async function scanFolderForMediaNative(rootPath, options = {}) {
  const rootReal = assertAllowed(rootPath);
  const recursive = options?.recursive !== false;
  const media = [];
  let encryptedCount = 0;
  let unsupportedCount = 0;

  async function walk(realDir, displayDir, depth) {
    if (depth > MAX_FOLDER_SCAN_DEPTH) return;
    let entries;
    try {
      entries = await fsp.readdir(realDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const displayPath = joinRendererPath(displayDir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await walk(path.join(realDir, entry.name), displayPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const classified = classifyFolderScanFile(entry.name);
      if (!classified) {
        unsupportedCount += 1;
        continue;
      }
      if (classified.image) continue;
      if (classified.encrypted) {
        encryptedCount += 1;
        continue;
      }
      media.push({
        path: displayPath,
        name: entry.name,
        kind: classified.kind,
        ...(classified.decode ? { decode: classified.decode } : {}),
      });
    }
  }

  await walk(rootReal, rootPath, 0);
  return { media, encryptedCount, unsupportedCount };
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
    let granted = false;
    return traceFsIpc("grantFolder", () => {
      const real = realOrNull(folderPath);
      granted = Boolean(real);
      if (real) allowedRoots.add(real);
    }, { result: () => ({ granted, roots: allowedRoots.size }) });
  });

  ipcMain.handle("muzero:grantFile", (_event, filePath) => {
    let granted = false;
    return traceFsIpc("grantFile", () => {
      const real = realOrNull(filePath);
      granted = Boolean(real);
      if (real) allowedFiles.add(norm(real));
    }, {
      extension: pathExtension(filePath),
      result: () => ({ files: allowedFiles.size, granted }),
    });
  });

  ipcMain.handle("muzero:pickFolder", async () => {
    const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  ipcMain.handle("muzero:readDir", async (_event, dirPath) => {
    return traceFsIpc(
      "readDir",
      async () => {
        const real = assertAllowed(dirPath);
        const entries = await fsp.readdir(real, { withFileTypes: true });
        return entries.map((d) => ({
          name: d.name,
          isDirectory: d.isDirectory(),
          isFile: d.isFile(),
          isSymlink: d.isSymbolicLink(),
        }));
      },
      { result: (entries) => ({ entries: entries.length }) },
    );
  });

  ipcMain.handle("muzero:scanFolderForMedia", async (_event, dirPath, options) => {
    return traceFsIpc(
      "scanFolderForMedia",
      () => scanFolderForMediaNative(dirPath, options),
      {
        recursive: options?.recursive !== false,
        result: (scan) => ({
          encrypted: scan.encryptedCount,
          media: scan.media.length,
          unsupported: scan.unsupportedCount,
        }),
      },
    );
  });

  ipcMain.handle("muzero:readFile", async (_event, filePath) => {
    return traceFsIpc(
      "readFile",
      async () => {
        const real = assertAllowed(filePath);
        const buf = await fsp.readFile(real);
        // Return a standalone ArrayBuffer (structured-cloned across IPC).
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      },
      {
        extension: pathExtension(filePath),
        result: (bytes) => ({ bytes: bytes.byteLength }),
      },
    );
  });

  ipcMain.handle("muzero:localMedia:token", async (_event, input) => {
    // storageKey: an app-managed persistent-media file (covers/media). Resolve it
    // through the same traversal/symlink-safe mapping as fs IPC — no allowlist
    // needed since the key is confined to our media root. Otherwise it's an
    // absolute path from an imported folder, gated by the granted-folder allowlist.
    return traceFsIpc(
      "localMedia.token",
      async () => {
        const real = input?.storageKey
          ? await mediaStorageExistingTarget(input.storageKey)
          : assertAllowed(input?.path);
        return registerLocalMedia(real, input?.mime);
      },
      {
        extension: pathExtension(input?.path ?? input?.storageKey),
        sourceKind: input?.storageKey ? "storage" : "sourcePath",
      },
    );
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

  ipcMain.handle("muzero:mediaStorage:writeBegin", async (_event, input) => {
    const storageKey = input?.storageKey;
    const expectedBytes = Number.isFinite(input?.expectedBytes) ? input.expectedBytes : undefined;
    const { filePath, parent } = await mediaStorageWriteTarget(storageKey);
    const uploadId = crypto.randomUUID();
    const tempPath = path.join(parent, `.${path.basename(filePath)}.${uploadId}.tmp`);
    const handle = await fsp.open(tempPath, "w");
    pendingMediaStorageWrites.set(uploadId, {
      expectedBytes,
      filePath,
      handle,
      storageKey,
      tempPath,
      writtenBytes: 0,
    });
    return { uploadId };
  });

  ipcMain.handle("muzero:mediaStorage:writeChunk", async (_event, input) => {
    const upload = pendingMediaStorageWrites.get(input?.uploadId);
    if (!upload) throw new Error("Unknown media storage write");
    const bytes = Buffer.from(input?.bytes ?? new ArrayBuffer(0));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await upload.handle.write(
        bytes,
        offset,
        bytes.length - offset,
        upload.writtenBytes + offset,
      );
      if (bytesWritten <= 0) throw new Error("Media storage streamed chunk write stalled");
      offset += bytesWritten;
    }
    upload.writtenBytes += bytes.length;
    return { writtenBytes: upload.writtenBytes };
  });

  ipcMain.handle("muzero:mediaStorage:writeCommit", async (_event, input) => {
    const upload = pendingMediaStorageWrites.get(input?.uploadId);
    if (!upload) throw new Error("Unknown media storage write");
    pendingMediaStorageWrites.delete(input.uploadId);
    try {
      await upload.handle.close();
      const tempStat = await fsp.stat(upload.tempPath);
      const expectedBytes = upload.expectedBytes ?? upload.writtenBytes;
      if (tempStat.size !== expectedBytes || upload.writtenBytes !== expectedBytes) {
        throw new Error("Media storage streamed write mismatch");
      }
      await fsp.rename(upload.tempPath, upload.filePath);
      const finalStat = await fsp.stat(upload.filePath);
      if (finalStat.size !== expectedBytes) {
        await fsp.rm(upload.filePath, { force: true });
        throw new Error("Media storage streamed final write mismatch");
      }
    } catch (error) {
      await upload.handle.close().catch(() => {});
      await fsp.rm(upload.tempPath, { force: true }).catch(() => {});
      throw error;
    }
  });

  ipcMain.handle("muzero:mediaStorage:writeAbort", async (_event, input) => {
    const upload = pendingMediaStorageWrites.get(input?.uploadId);
    if (!upload) return;
    pendingMediaStorageWrites.delete(input.uploadId);
    await upload.handle.close().catch(() => {});
    await fsp.rm(upload.tempPath, { force: true }).catch(() => {});
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

  // Pause/restore click-through so a hovered control can be clicked without
  // leaving the always-on-top click-through mode. No state broadcast: the stored
  // pin mode is unchanged (no-op unless currently pin-click-through).
  ipcMain.handle("muzero:window:setClickThroughPaused", (event, paused) => {
    windowPin.setPassthroughPaused(senderWindow(event), paused === true);
  });

  ipcMain.handle("muzero:window:setClickThroughRegions", (event, regions) => {
    windowPin.setInteractiveRegions(senderWindow(event), regions);
  });

  ipcMain.handle("muzero:window:getState", (event) => {
    const win = senderWindow(event);
    return windowState(win);
  });

  // Force a full repaint to flush the macOS transparent-window stale frame left
  // when a heavy layer (the ambient background canvas) is torn down — Chromium
  // doesn't reliably clear the freed region on a transparent surface.
  ipcMain.handle("muzero:window:repaint", (event) => {
    senderWindow(event).webContents.invalidate();
  });
}

module.exports = { registerIpc };
