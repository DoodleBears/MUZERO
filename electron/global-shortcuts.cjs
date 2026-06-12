const CONFIGURE_CHANNEL = "muzero:systemShortcuts:configure";
const ACTION_CHANNEL = "muzero:systemShortcuts:action";

const ALLOWED_ACTION_IDS = new Set([
  "playback.toggle",
  "playback.prev",
  "playback.next",
  "playback.volumeUp",
  "playback.volumeDown",
  "playback.toggleShuffle",
  "playback.like",
  "playback.cycleRepeat",
]);

function createGlobalShortcutRegistry({ globalShortcut: shortcutApi, getWindows }) {
  const ownedAccelerators = new Map();

  function emitAction(actionId) {
    for (const win of getWindows()) {
      if (!win || win.isDestroyed?.()) continue;
      win.webContents?.send(ACTION_CHANNEL, actionId);
    }
  }

  function unregisterAccelerator(accelerator) {
    if (!ownedAccelerators.has(accelerator)) return;
    shortcutApi.unregister(accelerator);
    ownedAccelerators.delete(accelerator);
  }

  function unregisterAll() {
    for (const accelerator of [...ownedAccelerators.keys()]) {
      unregisterAccelerator(accelerator);
    }
  }

  function configure(request) {
    const registrations = normalizeRegistrations(request?.registrations);
    const desiredByAccelerator = new Map();
    const duplicateAccelerators = new Set();

    for (const registration of registrations) {
      if (desiredByAccelerator.has(registration.accelerator)) {
        duplicateAccelerators.add(registration.accelerator);
        continue;
      }
      desiredByAccelerator.set(registration.accelerator, registration.actionId);
    }

    for (const [accelerator, actionId] of [...ownedAccelerators]) {
      if (desiredByAccelerator.get(accelerator) !== actionId) {
        unregisterAccelerator(accelerator);
      }
    }

    const seen = new Set();
    const statuses = registrations.map((registration) => {
      const { accelerator, actionId } = registration;
      if (seen.has(accelerator) || duplicateAccelerators.has(accelerator)) {
        seen.add(accelerator);
        return { actionId, accelerator, status: "failed", reason: "duplicate-accelerator" };
      }
      seen.add(accelerator);
      if (ownedAccelerators.get(accelerator) === actionId) {
        return { actionId, accelerator, status: "active" };
      }
      const registered = shortcutApi.register(accelerator, () => emitAction(actionId));
      if (!registered) {
        return { actionId, accelerator, status: "failed", reason: "registration-failed" };
      }
      ownedAccelerators.set(accelerator, actionId);
      return { actionId, accelerator, status: "active" };
    });

    return { supported: true, statuses };
  }

  return { configure, unregisterAll };
}

function registerElectronGlobalShortcuts() {
  const { app, BrowserWindow, globalShortcut, ipcMain } = require("electron");
  const registry = createGlobalShortcutRegistry({
    globalShortcut,
    getWindows: () => BrowserWindow.getAllWindows(),
  });
  ipcMain.handle(CONFIGURE_CHANNEL, (_event, request) => registry.configure(request));
  app.on("will-quit", () => registry.unregisterAll());
  return registry;
}

function normalizeRegistrations(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const actionId = item.actionId;
    const accelerator = item.accelerator;
    if (
      typeof actionId !== "string" ||
      typeof accelerator !== "string" ||
      !ALLOWED_ACTION_IDS.has(actionId) ||
      accelerator.trim() === ""
    ) {
      continue;
    }
    out.push({ actionId, accelerator });
  }
  return out;
}

module.exports = {
  ACTION_CHANNEL,
  CONFIGURE_CHANNEL,
  createGlobalShortcutRegistry,
  registerElectronGlobalShortcuts,
};
