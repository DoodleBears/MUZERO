import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({ shortcutOverrides: undefined }),
}));

import { ShortcutsSettings } from "./shortcuts-settings";

describe("ShortcutsSettings (read-only cheat-sheet)", () => {
  it("lists actions with key chips and a non-editable reference row", () => {
    const { container } = render(<ShortcutsSettings />);
    const prev = container.querySelector('[data-shortcut-row="playback.prev"]');
    expect(prev).toBeTruthy();
    expect(prev?.textContent).toContain("Q");
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
});
