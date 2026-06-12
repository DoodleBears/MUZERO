// Runtime app-icon swap, shared by the boot default (main.cjs) and the
// renderer-driven IPC handler (ipc.cjs). Variant ids map to a fixed allowlist of
// app logo PNGs — never an arbitrary renderer-supplied path.
// macOS swaps the dock icon (app.dock); Windows/Linux swap each window's icon.
// The installed bundle icon (build/icon.icns|png) is separate and static.
const fs = require("node:fs");
const path = require("node:path");
const { app, nativeImage, BrowserWindow } = require("electron");

/** Variant id → bundled/public asset filename. The keys are the renderer's allowlist. */
const ICON_FILES = {
  light: "muzero-logo-light.png",
  dark: "muzero-logo-dark.png",
  sketch: "muzero-logo.png",
  monogram: "muzero-logo-1.png",
  split: "muzero-logo-2.png",
};
const LEGACY_ICON_FILES = { dark: "app-icon-dark.png", light: "app-icon-light.png" };

const DEFAULT_APP_ICON = "dark";

function iconCandidates(variant) {
  const file = ICON_FILES[variant] ?? ICON_FILES[DEFAULT_APP_ICON];
  return [
    path.join(__dirname, "..", "dist", file),
    path.join(__dirname, "..", "public", file),
    path.join(__dirname, "assets", LEGACY_ICON_FILES[variant] ?? file),
    path.join(__dirname, "assets", file),
  ];
}

function resolveIconPath(variant) {
  const candidates = iconCandidates(variant);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

/**
 * Apply a built-in icon variant to the running process. Returns false for an
 * unknown id (renderer can't reach arbitrary files) or an unreadable asset.
 */
function applyAppIcon(variant) {
  if (!ICON_FILES[variant]) return false;
  const iconPath = resolveIconPath(variant);
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    // Surfaces a wrong path / missing asset instead of a silent no-op (the dock
    // would just keep the Electron default). Visible in the `make electron-dev` log.
    console.warn(`[muzero] app icon asset missing or unreadable: ${iconPath}`);
    return false;
  }
  if (process.platform === "darwin") {
    app.dock?.setIcon(image);
  } else {
    for (const win of BrowserWindow.getAllWindows()) win.setIcon(image);
  }
  return true;
}

/** Absolute path to a variant's PNG (used as the BrowserWindow `icon` at creation). */
function appIconPath(variant) {
  return resolveIconPath(ICON_FILES[variant] ? variant : DEFAULT_APP_ICON);
}

module.exports = { applyAppIcon, appIconPath, DEFAULT_APP_ICON };
