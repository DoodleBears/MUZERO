import { describe, expect, it } from "vitest";
import { isModifierOnlyKey, reservedWarning } from "./recorder";
import type { ShortcutGesture } from "./registry";

const key = (code: string, mods = {}): ShortcutGesture => ({
  kind: "key",
  stroke: { code, keyLabel: code, ...mods },
});

describe("reservedWarning", () => {
  it("flags bare primary-modifier combos the OS/browser reserves", () => {
    expect(reservedWarning(key("KeyW", { primaryKey: true }), "mac")).toBe("browser-reserved");
    expect(reservedWarning(key("KeyR", { metaKey: true }), "mac")).toBe("browser-reserved");
    expect(reservedWarning(key("KeyT", { ctrlKey: true }), "other")).toBe("browser-reserved");
  });

  it("does not flag non-reserved or modifier-augmented chords", () => {
    expect(reservedWarning(key("KeyW", { primaryKey: true, shiftKey: true }), "mac")).toBeNull();
    expect(reservedWarning(key("KeyJ", { primaryKey: true }), "mac")).toBeNull();
    expect(reservedWarning(key("KeyW"), "mac")).toBeNull(); // no primary modifier
    expect(reservedWarning({ kind: "pointer", labelKey: "x" }, "mac")).toBeNull();
  });

  it("only treats Ctrl as primary off mac", () => {
    expect(reservedWarning(key("KeyW", { ctrlKey: true }), "mac")).toBeNull();
    expect(reservedWarning(key("KeyW", { ctrlKey: true }), "other")).toBe("browser-reserved");
  });
});

describe("isModifierOnlyKey", () => {
  it("recognizes the four modifier keys", () => {
    for (const k of ["Alt", "Control", "Meta", "Shift"]) expect(isModifierOnlyKey(k)).toBe(true);
    expect(isModifierOnlyKey("a")).toBe(false);
    expect(isModifierOnlyKey("Enter")).toBe(false);
  });
});
