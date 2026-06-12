import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  overrides: undefined as Record<string, unknown> | undefined,
  systemShortcutsEnabled: false,
  systemShortcutBindings: {} as Record<string, unknown>,
}));
const repo = vi.hoisted(() => ({
  setAll: vi.fn((_overrides: Record<string, unknown>) => Promise.resolve()),
  resetAll: vi.fn(() => Promise.resolve()),
  setSystemEnabled: vi.fn((_enabled: boolean) => Promise.resolve()),
  setSystemBinding: vi.fn((_actionId: string, _binding: unknown) => Promise.resolve()),
  resetSystemShortcut: vi.fn((_actionId: string) => Promise.resolve()),
  resetAllSystem: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({
    shortcutOverrides: state.overrides,
    systemShortcutsEnabled: state.systemShortcutsEnabled,
    systemShortcutBindings: state.systemShortcutBindings,
  }),
}));
vi.mock("@/db/repositories", () => ({
  setAllShortcutOverrides: repo.setAll,
  resetAllShortcuts: repo.resetAll,
  setSystemShortcutsEnabled: repo.setSystemEnabled,
  setSystemShortcutBinding: repo.setSystemBinding,
  resetSystemShortcut: repo.resetSystemShortcut,
  resetAllSystemShortcuts: repo.resetAllSystem,
}));

import { ShortcutsSettings } from "./shortcuts-settings";

describe("ShortcutsSettings (read-only cheat-sheet)", () => {
  beforeEach(() => {
    state.overrides = undefined;
    state.systemShortcutsEnabled = false;
    state.systemShortcutBindings = {};
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

  it("renders the system global shortcut opt-in separately from in-app shortcuts", () => {
    const { container } = render(<ShortcutsSettings />);
    const section = container.querySelector<HTMLElement>("[data-system-shortcuts-section]");
    expect(section).toBeTruthy();
    if (!section) return;

    fireEvent.click(within(section).getByRole("checkbox", { name: "shortcuts.system.enable" }));
    expect(repo.setSystemEnabled).toHaveBeenCalledWith(true);
    expect(section.querySelector('[data-system-shortcut-row="playback.like"]')).toBeTruthy();
  });

  it("rejects unsafe bare keys before saving a system global shortcut", async () => {
    state.systemShortcutsEnabled = true;
    const { container } = render(<ShortcutsSettings />);
    const row = container.querySelector<HTMLElement>('[data-system-shortcut-row="playback.like"]');
    expect(row).toBeTruthy();
    if (!row) return;

    fireEvent.click(within(row).getByLabelText("shortcuts.system.set"));
    const capture = container.querySelector<HTMLElement>("[data-system-shortcut-capture]");
    expect(capture).toBeTruthy();
    if (!capture) return;

    fireEvent.keyDown(capture, { code: "KeyL", key: "l" });
    expect(repo.setSystemBinding).not.toHaveBeenCalled();
    expect(container.textContent).toContain("shortcuts.system.error.unsafeBareKey");

    fireEvent.keyDown(capture, { code: "KeyL", key: "l", ctrlKey: true });
    await waitFor(() =>
      expect(repo.setSystemBinding).toHaveBeenCalledWith("playback.like", {
        enabled: true,
        gesture: { kind: "key", stroke: { code: "KeyL", keyLabel: "L", ctrlKey: true } },
      }),
    );
  });

  it("blocks duplicate system global accelerators before saving", () => {
    state.systemShortcutsEnabled = true;
    state.systemShortcutBindings = {
      "playback.next": {
        enabled: true,
        gesture: { kind: "key", stroke: { code: "KeyL", keyLabel: "L", ctrlKey: true } },
      },
    };
    const { container } = render(<ShortcutsSettings />);
    const row = container.querySelector<HTMLElement>('[data-system-shortcut-row="playback.like"]');
    if (!row) throw new Error("no system shortcut row");

    fireEvent.click(within(row).getByLabelText("shortcuts.system.set"));
    const capture = container.querySelector<HTMLElement>("[data-system-shortcut-capture]");
    if (!capture) throw new Error("no system shortcut capture");

    fireEvent.keyDown(capture, { code: "KeyL", key: "l", ctrlKey: true });

    expect(repo.setSystemBinding).not.toHaveBeenCalled();
    expect(container.textContent).toContain("shortcuts.system.error.duplicate");
  });
});
