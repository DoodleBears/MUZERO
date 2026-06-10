import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SettingsSidebar } from "./settings-sidebar";

function itemIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-settings-item]")].map((b) =>
    b.getAttribute("data-settings-item"),
  );
}

describe("SettingsSidebar search", () => {
  it("filters items by query (id / label) and keeps the match", () => {
    const { container } = render(<SettingsSidebar active="appearance" onSelect={() => {}} />);
    expect(itemIds(container).length).toBeGreaterThan(1);

    const input = container.querySelector<HTMLInputElement>("[data-settings-search]");
    if (!input) throw new Error("no search input");
    fireEvent.change(input, { target: { value: "shortcuts" } });

    const ids = itemIds(container);
    expect(ids).toContain("shortcuts");
    expect(ids).not.toContain("appearance");
  });

  it("shows a no-results message when nothing matches", () => {
    const { container } = render(<SettingsSidebar active="appearance" onSelect={() => {}} />);
    const input = container.querySelector<HTMLInputElement>("[data-settings-search]");
    if (!input) throw new Error("no search input");
    fireEvent.change(input, { target: { value: "qwertyzzz" } });
    expect(itemIds(container)).toHaveLength(0);
  });
});
