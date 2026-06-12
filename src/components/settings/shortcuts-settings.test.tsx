import { fireEvent, render, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  overrides: undefined as Record<string, unknown> | undefined,
}));
const repo = vi.hoisted(() => ({
  setAll: vi.fn((_overrides: Record<string, unknown>) => Promise.resolve()),
  resetAll: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({ shortcutOverrides: state.overrides }),
}));
vi.mock("@/db/repositories", () => ({
  setAllShortcutOverrides: repo.setAll,
  resetAllShortcuts: repo.resetAll,
}));

import { ShortcutsSettings } from "./shortcuts-settings";

describe("ShortcutsSettings (read-only cheat-sheet)", () => {
  beforeEach(() => {
    state.overrides = undefined;
    vi.clearAllMocks();
  });

  it("lists actions with key chips and a non-editable reference row", () => {
    const { container } = render(<ShortcutsSettings />);
    const prev = container.querySelector(
      '[data-shortcut-row="playback.prev"][data-shortcut-scope="global"]',
    );
    expect(prev).toBeTruthy();
    expect(prev?.textContent).toContain("Q");
    const nowPrev = container.querySelector(
      '[data-shortcut-row="playback.prev"][data-shortcut-scope="now"]',
    );
    expect(nowPrev?.textContent).toContain("←");
    expect(container.querySelector('[data-shortcut-row="ref.swipeBack"]')).toBeTruthy();
  });

  it("filters rows by the search query (keyword / chord)", () => {
    const { container } = render(<ShortcutsSettings />);
    const input = container.querySelector<HTMLInputElement>("[data-shortcut-search]");
    expect(input).toBeTruthy();
    if (!input) return;

    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(container.querySelector('[data-shortcut-row="playback.prev"]')).toBeNull();

    fireEvent.change(input, { target: { value: "q" } });
    expect(container.querySelector('[data-shortcut-row="playback.prev"]')).toBeTruthy();
  });

  it("resets one surface row without changing another surface on the same action", () => {
    state.overrides = {
      "playback.next": [
        { scope: "global", gesture: { kind: "key", stroke: { code: "KeyE", keyLabel: "E" } } },
        { scope: "now", gesture: { kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } } },
      ],
    };
    const { container } = render(<ShortcutsSettings />);
    const nowNext = container.querySelector<HTMLElement>(
      '[data-shortcut-row="playback.next"][data-shortcut-scope="now"]',
    );
    expect(nowNext).toBeTruthy();
    if (!nowNext) return;
    fireEvent.click(within(nowNext).getByLabelText("shortcuts.resetAction"));
    expect(repo.setAll).toHaveBeenCalledWith({});
  });
});
