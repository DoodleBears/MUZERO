// macOS renders a Tray image at its logical point size and does NOT downscale it to
// the menu-bar height, so the full-resolution app logo (1120×1120) shows up huge.
// Downscale it to a menu-bar-sized glyph. We deliberately keep the COLORED logo and
// do NOT mark it a template image — a template would strip the brand mark to a flat
// monochrome silhouette ("wrong pattern"). Tradeoff: a colored icon won't auto-recolor
// for light/dark menu bars, but the logo's alpha + contrast carries it on both.
const TRAY_ICON_SIZE = 16;

function createTrayController({ app, iconPath, Menu, nativeImage, platform, Tray }) {
  let tray = null;
  let windowRef = null;
  let isQuitting = false;
  const actionListeners = new Set();

  function hasTray() {
    return Boolean(tray);
  }

  // Returns the resized (colored) app logo for the Tray, or the raw path as a fallback
  // when nativeImage isn't injected or the asset decodes empty (preserves prior behavior).
  function buildTrayIcon() {
    if (!nativeImage || typeof nativeImage.createFromPath !== "function") return iconPath;
    const image = nativeImage.createFromPath(iconPath);
    if (!image || (typeof image.isEmpty === "function" && image.isEmpty())) return iconPath;
    return typeof image.resize === "function"
      ? image.resize({ height: TRAY_ICON_SIZE, width: TRAY_ICON_SIZE })
      : image;
  }

  function onAction(listener) {
    actionListeners.add(listener);
    return () => actionListeners.delete(listener);
  }

  function emitAction(actionId) {
    for (const listener of actionListeners) listener(actionId);
  }

  function ensureTray() {
    if (tray) return tray;
    try {
      tray = new Tray(buildTrayIcon());
    } catch {
      tray = null;
      return null;
    }
    tray.setToolTip("MUZERO");
    tray.on("click", () => showWindow());
    tray.on("double-click", () => showWindow());
    return tray;
  }

  function attachWindow(win) {
    windowRef = win;
    win.on("close", (event) => {
      if (isQuitting || !tray || win.isDestroyed()) return;
      event.preventDefault();
      hideToTray(win);
    });
  }

  function currentWindow() {
    return windowRef && !windowRef.isDestroyed() ? windowRef : null;
  }

  function showWindow(win = currentWindow()) {
    if (!win) return false;
    if (typeof win.setSkipTaskbar === "function" && platform !== "darwin") {
      win.setSkipTaskbar(false);
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  }

  function hideToTray(win = currentWindow()) {
    if (!win) return false;
    if (typeof win.setSkipTaskbar === "function" && platform !== "darwin") {
      win.setSkipTaskbar(true);
    }
    win.hide();
    return true;
  }

  function markQuitting() {
    isQuitting = true;
  }

  function quitApp() {
    markQuitting();
    app.quit();
  }

  function updateMenu(model) {
    if (!ensureTray()) return;
    if (typeof model?.tooltip === "string" && model.tooltip.trim()) {
      tray.setToolTip(model.tooltip);
    }
    if (Array.isArray(model?.items)) {
      tray.setContextMenu(Menu.buildFromTemplate(model.items.map(toElectronMenuItem)));
    }
  }

  function toElectronMenuItem(item) {
    switch (item.type) {
      case "separator":
        return { type: "separator" };
      case "submenu":
        return {
          label: item.label,
          submenu: item.items.map(toElectronMenuItem),
        };
      case "checkbox":
        return {
          checked: item.checked === true,
          click: () => emitAction(item.action),
          enabled: item.enabled !== false,
          label: item.label,
          type: "checkbox",
        };
      default:
        return {
          click: () => emitAction(item.action),
          enabled: item.enabled !== false,
          label: item.label,
        };
    }
  }

  return {
    attachWindow,
    ensureTray,
    hasTray,
    hideToTray,
    isQuitting: () => isQuitting,
    markQuitting,
    onAction,
    quitApp,
    showWindow,
    updateMenu,
  };
}

module.exports = { createTrayController };
