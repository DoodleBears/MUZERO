import { describe, expect, it } from "vitest";
import { playerShortcutHint, volumeFromPointerY } from "./player-hints";

describe("playerShortcutHint", () => {
  it("returns single keycaps for transport actions", () => {
    expect(playerShortcutHint("play", true)).toEqual(["Space"]);
    expect(playerShortcutHint("prev", true)).toEqual(["←"]);
    expect(playerShortcutHint("next", true)).toEqual(["→"]);
  });

  it("returns the platform modifier chord for repeat", () => {
    expect(playerShortcutHint("repeat", true)).toEqual(["⌘", "R"]);
    expect(playerShortcutHint("repeat", false)).toEqual(["Ctrl", "R"]);
  });

  it("returns both arrow keys for volume (up/down)", () => {
    expect(playerShortcutHint("volume", true)).toEqual(["↑", "↓"]);
    expect(playerShortcutHint("volume", false)).toEqual(["↑", "↓"]);
  });
});

describe("volumeFromPointerY", () => {
  const top = 100;
  const height = 200; // track spans y∈[100,300]

  it("maps the top of the track to full volume", () => {
    expect(volumeFromPointerY(100, top, height)).toBe(1);
  });

  it("maps the bottom of the track to zero", () => {
    expect(volumeFromPointerY(300, top, height)).toBe(0);
  });

  it("maps the middle to 0.5", () => {
    expect(volumeFromPointerY(200, top, height)).toBe(0.5);
  });

  it("clamps above the track to 1 and below to 0", () => {
    expect(volumeFromPointerY(40, top, height)).toBe(1);
    expect(volumeFromPointerY(999, top, height)).toBe(0);
  });

  it("is divide-safe for a zero-height track", () => {
    expect(volumeFromPointerY(100, top, 0)).toBe(0);
  });

  it("inverts correctly (higher on screen = louder)", () => {
    // a quarter down from the top → 0.75
    expect(volumeFromPointerY(150, top, height)).toBe(0.75);
  });
});
