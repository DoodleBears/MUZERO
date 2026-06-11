// Main-process IPC handlers for the renderer's `window.muzero` bridge.
//
// fs security mirrors the Tauri "runtime per-folder scope" posture: the app ships
// with NO filesystem access; folders become readable only after `grantFolder`
// (called when the user picks one, and re-issued each launch from the remembered
// `importFolders` list). Every read validates the path against the allowlist using
// the resolved real path, so symlinks can't escape the granted roots.
const { ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { applyAppIcon } = require("./app-icon.cjs");

/** Granted folder roots (real paths). In-memory, not persisted — re-granted on boot. */
const allowedRoots = new Set();

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
}

module.exports = { registerIpc };
