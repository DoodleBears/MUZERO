function createTrayController({ app, iconPath, Menu, platform, Tray }) {
  let tray = null;
  let windowRef = null;
  let isQuitting = false;
  const actionListeners = new Set();

  function hasTray() {
    return Boolean(tray);
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
      tray = new Tray(iconPath);
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
