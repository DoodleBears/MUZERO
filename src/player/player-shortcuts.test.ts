import { describe, expect, it } from "vitest";
import { resolvePlayerShortcut } from "./player-shortcuts";

const k = (key: string, mods: Partial<KeyboardEvent> = {}) => ({ key, ...mods });

describe("resolvePlayerShortcut — play/pause", () => {
  it("Space toggles", () => {
    expect(resolvePlayerShortcut(k(" "))).toBe("toggle-play");
  });
  it("Cmd+P and Ctrl+P toggle (either modifier)", () => {
    expect(resolvePlayerShortcut(k("p", { metaKey: true }))).toBe("toggle-play");
    expect(resolvePlayerShortcut(k("P", { ctrlKey: true }))).toBe("toggle-play");
  });
});

describe("resolvePlayerShortcut — track switching", () => {
  it("ArrowLeft / A → prev, ArrowRight / D → next", () => {
    expect(resolvePlayerShortcut(k("ArrowLeft"))).toBe("prev");
    expect(resolvePlayerShortcut(k("a"))).toBe("prev");
    expect(resolvePlayerShortcut(k("ArrowRight"))).toBe("next");
    expect(resolvePlayerShortcut(k("d"))).toBe("next");
  });
});

describe("resolvePlayerShortcut — seek ±5s", () => {
  it("Shift+Left / Shift+A → back, Shift+Right / Shift+D → forward", () => {
    expect(resolvePlayerShortcut(k("ArrowLeft", { shiftKey: true }))).toBe("seek-back");
    expect(resolvePlayerShortcut(k("A", { shiftKey: true }))).toBe("seek-back");
    expect(resolvePlayerShortcut(k("ArrowRight", { shiftKey: true }))).toBe("seek-forward");
    expect(resolvePlayerShortcut(k("D", { shiftKey: true }))).toBe("seek-forward");
  });
});

describe("resolvePlayerShortcut — volume / repeat / restart", () => {
  it("ArrowUp / ArrowDown → volume", () => {
    expect(resolvePlayerShortcut(k("ArrowUp"))).toBe("volume-up");
    expect(resolvePlayerShortcut(k("ArrowDown"))).toBe("volume-down");
  });
  it("Cmd/Ctrl+R → cycle repeat", () => {
    expect(resolvePlayerShortcut(k("r", { metaKey: true }))).toBe("cycle-repeat");
    expect(resolvePlayerShortcut(k("R", { ctrlKey: true }))).toBe("cycle-repeat");
  });
  it("plain R → restart from the beginning", () => {
    expect(resolvePlayerShortcut(k("r"))).toBe("restart");
  });
});

describe("resolvePlayerShortcut — no-ops", () => {
  it("returns null for nav (Cmd+1) and unrelated keys", () => {
    expect(resolvePlayerShortcut(k("1", { metaKey: true }))).toBeNull();
    expect(resolvePlayerShortcut(k("x"))).toBeNull();
    expect(resolvePlayerShortcut(k("Enter"))).toBeNull();
  });
  it("Alt disables shortcuts", () => {
    expect(resolvePlayerShortcut(k("ArrowLeft", { altKey: true }))).toBeNull();
    expect(resolvePlayerShortcut(k(" ", { altKey: true }))).toBeNull();
  });
});
