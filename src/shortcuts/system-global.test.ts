import { describe, expect, it } from "vitest";
import type { ShortcutGesture, ShortcutStroke } from "./registry";
import {
  buildSystemShortcutRegistrations,
  isSystemGlobalShortcutAction,
  SYSTEM_GLOBAL_SHORTCUT_ACTIONS,
  systemGestureToElectronAccelerator,
  validateSystemShortcutGesture,
} from "./system-global";

const key = (
  code: string,
  keyLabel: string,
  mods: Omit<Partial<ShortcutStroke>, "code" | "keyLabel"> = {},
): ShortcutGesture => ({
  kind: "key",
  stroke: { code, keyLabel, ...mods },
});

describe("system global shortcut contract", () => {
  it("allowlists only background-safe playback actions", () => {
    expect(SYSTEM_GLOBAL_SHORTCUT_ACTIONS).toEqual([
      "playback.toggle",
      "playback.prev",
      "playback.next",
      "playback.volumeUp",
      "playback.volumeDown",
      "playback.toggleShuffle",
      "playback.like",
      "playback.cycleRepeat",
    ]);

    expect(isSystemGlobalShortcutAction("playback.next")).toBe(true);
    expect(isSystemGlobalShortcutAction("nav.tabNow")).toBe(false);
    expect(isSystemGlobalShortcutAction("search.openGlobal")).toBe(false);
    expect(isSystemGlobalShortcutAction("library.open")).toBe(false);
  });

  it("rejects bare app keys that would be unsafe at OS scope", () => {
    const rejected = [
      key("KeyL", "L"),
      key("Digit1", "1"),
      key("ArrowLeft", "ArrowLeft"),
      key("ArrowRight", "ArrowRight"),
      key("Space", "Space"),
      key("Enter", "Enter"),
      key("KeyP", "P", { shiftKey: true }),
    ];

    for (const gesture of rejected) {
      expect(validateSystemShortcutGesture(gesture).ok).toBe(false);
    }
  });

  it("accepts modifier chords and dedicated media keys", () => {
    expect(validateSystemShortcutGesture(key("KeyP", "P", { primaryKey: true }))).toEqual({
      ok: true,
      accelerator: "CommandOrControl+P",
    });
    expect(
      validateSystemShortcutGesture(key("KeyL", "L", { ctrlKey: true, altKey: true })),
    ).toEqual({
      ok: true,
      accelerator: "Ctrl+Alt+L",
    });
    expect(validateSystemShortcutGesture(key("MediaPlayPause", "MediaPlayPause"))).toEqual({
      ok: true,
      accelerator: "MediaPlayPause",
    });
  });

  it("converts safe gestures to Electron accelerators", () => {
    expect(
      systemGestureToElectronAccelerator(key("ArrowUp", "ArrowUp", { primaryKey: true })),
    ).toBe("CommandOrControl+Up");
    expect(systemGestureToElectronAccelerator(key("KeyR", "R", { altKey: true }))).toBe("Alt+R");
    expect(
      systemGestureToElectronAccelerator({ kind: "pointer", labelKey: "shortcuts.gesture.drag" }),
    ).toBeNull();
  });

  it("does not build registrations for unsupported actions or invalid gestures", () => {
    expect(
      buildSystemShortcutRegistrations({
        "playback.toggle": { enabled: true, gesture: key("KeyP", "P", { primaryKey: true }) },
        "playback.like": { enabled: true, gesture: key("KeyL", "L") },
        "nav.tabNow": { enabled: true, gesture: key("Digit1", "1", { primaryKey: true }) },
      }),
    ).toEqual([
      {
        actionId: "playback.toggle",
        accelerator: "CommandOrControl+P",
      },
    ]);
  });
});
