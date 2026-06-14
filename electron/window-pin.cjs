const WINDOW_PIN_MODES = ["off", "pin", "pin-click-through"];
const CLICK_THROUGH_HOVER_CHANNEL = "muzero:window:clickThroughHover";
const INTERACTIVE_REGION_MARGIN = 8;
const INTERACTIVE_REGION_POLL_MS = 48;

function normalizeWindowPinMode(mode) {
  return WINDOW_PIN_MODES.includes(mode) ? mode : "off";
}

function defaultCursorScreenPoint() {
  try {
    return require("electron").screen.getCursorScreenPoint();
  } catch {
    return null;
  }
}

function createWindowPinController({
  clearIntervalFn = clearInterval,
  getCursorScreenPoint = defaultCursorScreenPoint,
  setIntervalFn = setInterval,
} = {}) {
  const modes = new WeakMap();
  const autoPaused = new WeakMap();
  const interactiveRegions = new WeakMap();
  const manualPaused = new WeakMap();
  const pollTimers = new WeakMap();

  function getMode(win) {
    return modes.get(win) ?? "off";
  }

  function setMousePassthrough(win, enabled) {
    if (typeof win.setIgnoreMouseEvents !== "function") return !enabled;
    try {
      if (enabled) {
        win.setIgnoreMouseEvents(true, { forward: true });
      } else {
        win.setIgnoreMouseEvents(false);
      }
      return true;
    } catch {
      if (enabled) {
        try {
          win.setIgnoreMouseEvents(false);
        } catch {
          // Best effort: failure should degrade to normal pinned behavior.
        }
      }
      return false;
    }
  }

  function syncMousePassthrough(win) {
    const passthrough =
      getMode(win) === "pin-click-through" &&
      manualPaused.get(win) !== true &&
      autoPaused.get(win) !== true;
    return setMousePassthrough(win, passthrough);
  }

  function localPoint(win, screenPoint) {
    if (!screenPoint || typeof win.getBounds !== "function") return null;
    const bounds = win.getBounds();
    return {
      x: screenPoint.x - bounds.x,
      y: screenPoint.y - bounds.y,
    };
  }

  function pointInRegion(point, region) {
    return (
      point.x >= region.x - INTERACTIVE_REGION_MARGIN &&
      point.x <= region.x + region.width + INTERACTIVE_REGION_MARGIN &&
      point.y >= region.y - INTERACTIVE_REGION_MARGIN &&
      point.y <= region.y + region.height + INTERACTIVE_REGION_MARGIN
    );
  }

  function emitInteractiveRegionHover(win, hovered) {
    if (typeof win.webContents?.send !== "function") return;
    win.webContents.send(CLICK_THROUGH_HOVER_CHANNEL, hovered);
  }

  function updateInteractiveRegionPause(win) {
    if (getMode(win) !== "pin-click-through") return;
    const regions = interactiveRegions.get(win) ?? [];
    const point = localPoint(win, getCursorScreenPoint());
    const overRegion = Boolean(point && regions.some((region) => pointInRegion(point, region)));
    if (autoPaused.get(win) === overRegion) return;
    autoPaused.set(win, overRegion);
    syncMousePassthrough(win);
    emitInteractiveRegionHover(win, overRegion);
  }

  function stopInteractiveRegionPolling(win) {
    const timer = pollTimers.get(win);
    if (timer) clearIntervalFn(timer);
    pollTimers.delete(win);
    if (autoPaused.get(win) === true) emitInteractiveRegionHover(win, false);
    autoPaused.delete(win);
  }

  function startInteractiveRegionPolling(win) {
    if (pollTimers.has(win)) return;
    const regions = interactiveRegions.get(win) ?? [];
    if (regions.length === 0) return;
    const timer = setIntervalFn(() => updateInteractiveRegionPause(win), INTERACTIVE_REGION_POLL_MS);
    pollTimers.set(win, timer);
    updateInteractiveRegionPause(win);
  }

  function applyMode(win, rawMode) {
    let mode = normalizeWindowPinMode(rawMode);
    modes.set(win, mode);
    if (mode === "pin-click-through") {
      manualPaused.delete(win);
      autoPaused.delete(win);
      if (!syncMousePassthrough(win)) {
        mode = "pin";
        modes.set(win, mode);
        stopInteractiveRegionPolling(win);
        setMousePassthrough(win, false);
      } else {
        startInteractiveRegionPolling(win);
      }
    } else {
      manualPaused.delete(win);
      stopInteractiveRegionPolling(win);
      setMousePassthrough(win, false);
    }

    win.setAlwaysOnTop(mode !== "off");
    return mode;
  }

  function cycleMode(win) {
    const current = getMode(win);
    const next = current === "off" ? "pin" : "off";
    return applyMode(win, next);
  }

  function attachFocusRecovery() {
    // Click-through is now controlled by the explicit lyrics Lock button. Focusing
    // the window must not silently unlock it, or the Lock button can flip back to
    // click-through while the user is trying to unlock.
  }

  function normalizeRegion(region) {
    const x = Number(region?.x);
    const y = Number(region?.y);
    const width = Number(region?.width);
    const height = Number(region?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
    return { height, width, x, y };
  }

  function setInteractiveRegions(win, regions) {
    const normalized = Array.isArray(regions)
      ? regions.map(normalizeRegion).filter((region) => region != null)
      : [];
    interactiveRegions.set(win, normalized);
    if (normalized.length === 0) {
      stopInteractiveRegionPolling(win);
      syncMousePassthrough(win);
      return;
    }
    if (getMode(win) === "pin-click-through") startInteractiveRegionPolling(win);
  }

  // Temporarily make a click-through window interactive (paused) or restore
  // passthrough — WITHOUT changing the stored mode. Lets a hovered control (the
  // unpin button) be clicked while the rest of the window stays click-through.
  // No-op unless the window is currently in pin-click-through.
  function setPassthroughPaused(win, paused) {
    if (getMode(win) !== "pin-click-through") return false;
    manualPaused.set(win, paused === true);
    return syncMousePassthrough(win);
  }

  return {
    applyMode,
    attachFocusRecovery,
    cycleMode,
    getMode,
    setInteractiveRegions,
    setPassthroughPaused,
  };
}

const windowPin = createWindowPinController();

module.exports = {
  WINDOW_PIN_MODES,
  createWindowPinController,
  normalizeWindowPinMode,
  windowPin,
};
