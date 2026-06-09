import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  player: {
    togglePlay: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setRepeat: vi.fn(),
    setShuffle: vi.fn(),
    positionSec: 10,
    volume: 0.5,
    repeat: "off" as const,
    shuffle: false,
  },
  setTab: vi.fn(),
  state: { overrides: undefined as Record<string, unknown> | undefined },
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({ shortcutOverrides: mocks.state.overrides }),
}));
vi.mock("@/stores/nav-store", () => ({
  useNavStore: (sel: (s: { setTab: unknown }) => unknown) => sel({ setTab: mocks.setTab }),
}));
vi.mock("@/stores/player-store", () => ({ usePlayerStore: { getState: () => mocks.player } }));
vi.mock("@/lib/view-transition-react", () => ({ transitionState: (fn: () => void) => fn() }));

import { useShortcutDispatch } from "./use-shortcut-dispatch";

function press(code: string, key: string, mods: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...mods }),
  );
}

describe("useShortcutDispatch", () => {
  beforeEach(() => {
    mocks.state.overrides = undefined;
    vi.clearAllMocks();
  });

  it("routes default transport chords to player-store actions", () => {
    renderHook(() => useShortcutDispatch());
    press("KeyQ", "q");
    expect(mocks.player.prev).toHaveBeenCalledOnce();
    press("KeyE", "e");
    expect(mocks.player.next).toHaveBeenCalledOnce();
    press("Space", " ");
    expect(mocks.player.togglePlay).toHaveBeenCalledOnce();
    press("ArrowUp", "ArrowUp");
    expect(mocks.player.setVolume).toHaveBeenCalledWith(0.55);
  });

  it("honors a user override (rebinding prev to Z frees Q)", () => {
    mocks.state.overrides = {
      "playback.prev": [{ kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } }],
    };
    renderHook(() => useShortcutDispatch());
    press("KeyZ", "z");
    expect(mocks.player.prev).toHaveBeenCalledOnce();
    press("KeyQ", "q");
    expect(mocks.player.prev).toHaveBeenCalledOnce(); // Q is no longer prev
  });

  it("switches tabs on the primary-modifier digit chords", () => {
    renderHook(() => useShortcutDispatch());
    press("Digit2", "2", { ctrlKey: true });
    expect(mocks.setTab).toHaveBeenCalledWith("search");
  });

  it("stands down while typing in a text field", () => {
    renderHook(() => useShortcutDispatch());
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyQ", key: "q", bubbles: true }));
    expect(mocks.player.prev).not.toHaveBeenCalled();
    input.remove();
  });

  it("ignores unbound keys", () => {
    renderHook(() => useShortcutDispatch());
    press("KeyZ", "z");
    expect(mocks.player.prev).not.toHaveBeenCalled();
  });
});
