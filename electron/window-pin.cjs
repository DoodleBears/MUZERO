const WINDOW_PIN_MODES = ["off", "pin", "pin-click-through"];

function normalizeWindowPinMode(mode) {
  return WINDOW_PIN_MODES.includes(mode) ? mode : "off";
}

function createWindowPinController() {
  const modes = new WeakMap();

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

  function applyMode(win, rawMode) {
    let mode = normalizeWindowPinMode(rawMode);
    const wantsClickThrough = mode === "pin-click-through";
    if (wantsClickThrough && !setMousePassthrough(win, true)) {
      mode = "pin";
    } else if (!wantsClickThrough) {
      setMousePassthrough(win, false);
    }

    win.setAlwaysOnTop(mode !== "off");
    modes.set(win, mode);
    return mode;
  }

  function cycleMode(win) {
    const current = getMode(win);
    const next =
      current === "off" ? "pin" : current === "pin" ? "pin-click-through" : "off";
    return applyMode(win, next);
  }

  function attachFocusRecovery(win, onRecovered) {
    if (typeof win.on !== "function") return;
    win.on("focus", () => {
      if (getMode(win) !== "pin-click-through") return;
      const mode = applyMode(win, "pin");
      onRecovered?.(mode);
    });
  }

  return { applyMode, attachFocusRecovery, cycleMode, getMode };
}

const windowPin = createWindowPinController();

module.exports = {
  WINDOW_PIN_MODES,
  createWindowPinController,
  normalizeWindowPinMode,
  windowPin,
};
