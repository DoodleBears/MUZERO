import { describe, expect, it, vi } from "vitest";
import { runShortcutAction, type ShortcutActionRunnerContext } from "./actions";

function createContext(
  overrides: Partial<ShortcutActionRunnerContext> = {},
): ShortcutActionRunnerContext {
  const player = {
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
    currentIndex: -1,
    queue: [] as Array<{ id: string; liked?: boolean }>,
  };

  return {
    getPlayerState: () => player,
    getTab: () => "now",
    setTab: vi.fn(),
    toggleQueue: vi.fn(),
    getSettings: vi.fn(async () => ({})),
    saveSettings: vi.fn(async () => ({})),
    getTrack: vi.fn(async () => undefined),
    setTrackLiked: vi.fn(async () => {}),
    setLyricsPanelOpen: vi.fn(),
    setVisualizerPanelOpen: vi.fn(),
    toggleDocumentFullscreen: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runShortcutAction", () => {
  it("runs shared playback actions", () => {
    const ctx = createContext();

    expect(runShortcutAction("playback.next", ctx)).toBe(true);
    expect(ctx.getPlayerState().next).toHaveBeenCalledOnce();

    expect(runShortcutAction("playback.volumeUp", ctx)).toBe(true);
    expect(ctx.getPlayerState().setVolume).toHaveBeenCalledWith(0.55);

    expect(runShortcutAction("playback.cycleRepeat", ctx)).toBe(true);
    expect(ctx.getPlayerState().setRepeat).toHaveBeenCalledWith("all");
  });

  it("toggles like using the current track snapshot", async () => {
    const player = {
      ...createContext().getPlayerState(),
      currentIndex: 0,
      queue: [{ id: "trk_1", liked: false }],
    };
    const setTrackLiked = vi.fn(async () => {});
    const ctx = createContext({
      getPlayerState: () => player,
      getTrack: vi.fn(async () => ({ liked: true })),
      setTrackLiked,
    });

    expect(runShortcutAction("playback.like", ctx)).toBe(true);
    await vi.waitFor(() => expect(setTrackLiked).toHaveBeenCalledWith("trk_1", false));
  });

  it("runs shared navigation and queue actions without exposing them to system globals", () => {
    const ctx = createContext();

    // Tab nav is a plain setTab (faithful on kept-mounted tabs) — the context no
    // longer carries a `transitionState`, so a nav action that tried to wrap the
    // switch in a View Transition would throw here instead of silently passing.
    expect(runShortcutAction("nav.tabLibrary", ctx)).toBe(true);
    expect(ctx.setTab).toHaveBeenCalledWith("search");

    expect(runShortcutAction("nav.tabNow", ctx)).toBe(true);
    expect(ctx.setTab).toHaveBeenCalledWith("now");

    expect(runShortcutAction("queue.toggle", ctx)).toBe(true);
    expect(ctx.toggleQueue).toHaveBeenCalledOnce();
  });

  it("cycles primary navigation tabs in both directions", () => {
    const ctx = createContext({ getTab: () => "settings" });

    expect(runShortcutAction("nav.tabNext", ctx)).toBe(true);
    expect(ctx.setTab).toHaveBeenCalledWith("now");

    expect(runShortcutAction("nav.tabPrev", ctx)).toBe(true);
    expect(ctx.setTab).toHaveBeenCalledWith("search");
  });

  it("returns false for actions owned by other surfaces", () => {
    const ctx = createContext();

    expect(runShortcutAction("library.open", ctx)).toBe(false);
    expect(runShortcutAction("search.openGlobal", ctx)).toBe(false);
  });
});
