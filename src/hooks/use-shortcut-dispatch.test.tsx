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
  lyricsSetOpen: vi.fn(),
  vizSetOpen: vi.fn(),
  saveSettings: vi.fn(async (_patch?: unknown) => {}),
  getSettings: vi.fn(async () => ({}) as Record<string, unknown>),
  state: { overrides: undefined as Record<string, unknown> | undefined },
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({ shortcutOverrides: mocks.state.overrides }),
}));
vi.mock("@/stores/nav-store", () => ({
  useNavStore: (sel: (s: { setTab: unknown }) => unknown) => sel({ setTab: mocks.setTab }),
}));
vi.mock("@/stores/player-store", () => ({ usePlayerStore: { getState: () => mocks.player } }));
vi.mock("@/stores/lyrics-panel-store", () => ({
  useLyricsPanelStore: { getState: () => ({ setOpen: mocks.lyricsSetOpen }) },
}));
vi.mock("@/stores/visualizer-panel-store", () => ({
  useVisualizerPanelStore: { getState: () => ({ setOpen: mocks.vizSetOpen }) },
}));
vi.mock("@/db/repositories", () => ({
  saveSettings: (...args: unknown[]) => mocks.saveSettings(...args),
  getSettings: () => mocks.getSettings(),
}));
vi.mock("@/lib/view-transition-react", () => ({ transitionState: (fn: () => void) => fn() }));

import { useShortcutDispatch } from "./use-shortcut-dispatch";

function press(code: string, key: string, mods: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { code, key, bubbles: true, cancelable: true, ...mods }),
  );
}
function release(code: string, key: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { code, key, bubbles: true }));
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

  describe("press-and-hold C / V open the tuning panels", () => {
    it("a quick tap of C toggles the lyrics rail on release, not the panel", async () => {
      mocks.getSettings.mockResolvedValueOnce({ nowPlayingRightRailCollapsed: true });
      renderHook(() => useShortcutDispatch());
      press("KeyC", "c");
      // Deferred: nothing happens until the key is released or held past threshold.
      expect(mocks.lyricsSetOpen).not.toHaveBeenCalled();
      expect(mocks.saveSettings).not.toHaveBeenCalled();
      release("KeyC", "c");
      await vi.waitFor(() =>
        expect(mocks.saveSettings).toHaveBeenCalledWith({
          lyricsStageOpen: true,
          nowPlayingRightRailCollapsed: false,
        }),
      );
      expect(mocks.lyricsSetOpen).not.toHaveBeenCalled();
    });

    it("holding C opens the lyrics settings panel and suppresses the toggle", () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useShortcutDispatch());
        press("KeyC", "c");
        vi.advanceTimersByTime(500);
        expect(mocks.lyricsSetOpen).toHaveBeenCalledWith(true);
        release("KeyC", "c");
        // The hold already opened the panel — releasing must NOT also toggle lyrics.
        expect(mocks.saveSettings).not.toHaveBeenCalledWith(
          expect.objectContaining({ nowPlayingRightRailCollapsed: expect.any(Boolean) }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("holding V opens the visualizer tuning panel", () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useShortcutDispatch());
        press("KeyV", "v");
        vi.advanceTimersByTime(500);
        expect(mocks.vizSetOpen).toHaveBeenCalledWith(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("OS auto-repeat while holding does not re-arm the timer", () => {
      vi.useFakeTimers();
      try {
        renderHook(() => useShortcutDispatch());
        press("KeyC", "c");
        vi.advanceTimersByTime(300);
        press("KeyC", "c", { repeat: true }); // auto-repeat — must be ignored
        vi.advanceTimersByTime(200); // 500ms total since the first press
        expect(mocks.lyricsSetOpen).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
