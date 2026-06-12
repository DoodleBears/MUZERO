import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("supports horizontal drag scrolling in narrow mode", () => {
    const { container } = render(<SettingsSidebar active="appearance" onSelect={() => {}} />);
    const nav = container.querySelector<HTMLElement>("nav");
    if (!nav) throw new Error("no settings nav");

    Object.defineProperties(nav, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 640 },
    });
    nav.scrollLeft = 120;

    fireEvent.pointerDown(nav, { button: 0, clientX: 200, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(nav, { clientX: 150, clientY: 0, pointerId: 1 });

    expect(nav.scrollLeft).toBe(170);
  });

  it("supports vertical drag scrolling in wide mode", () => {
    const { container } = render(
      <div className="settings-scroll-surface">
        <SettingsSidebar active="appearance" onSelect={() => {}} />
      </div>,
    );
    const scrollSurface = container.querySelector<HTMLElement>(".settings-scroll-surface");
    const nav = container.querySelector<HTMLElement>("nav");
    if (!scrollSurface || !nav) throw new Error("no settings nav");

    Object.defineProperties(nav, {
      clientWidth: { configurable: true, value: 240 },
      scrollWidth: { configurable: true, value: 240 },
    });
    scrollSurface.scrollTop = 80;

    fireEvent.pointerDown(nav, { button: 0, clientX: 0, clientY: 200, pointerId: 1 });
    fireEvent.pointerMove(nav, { clientX: 0, clientY: 150, pointerId: 1 });

    expect(scrollSurface.scrollTop).toBe(130);
  });

  it("selects an item on a normal click without capturing the pointer", () => {
    const onSelect = vi.fn();
    const { container } = render(<SettingsSidebar active="appearance" onSelect={onSelect} />);
    const nav = container.querySelector<HTMLElement>("nav");
    const shortcuts = container.querySelector<HTMLElement>('[data-settings-item="shortcuts"]');
    if (!nav || !shortcuts) throw new Error("no settings nav");

    const setPointerCapture = vi.fn();
    nav.setPointerCapture = setPointerCapture;

    fireEvent.pointerDown(shortcuts, { button: 0, clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(shortcuts, { clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.click(shortcuts);

    expect(setPointerCapture).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("shortcuts");
  });

  it("captures the pointer only after drag starts", () => {
    const { container } = render(<SettingsSidebar active="appearance" onSelect={() => {}} />);
    const nav = container.querySelector<HTMLElement>("nav");
    if (!nav) throw new Error("no settings nav");

    Object.defineProperties(nav, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 640 },
    });
    const setPointerCapture = vi.fn();
    nav.setPointerCapture = setPointerCapture;

    fireEvent.pointerDown(nav, { button: 0, clientX: 200, clientY: 0, pointerId: 1 });
    expect(setPointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerMove(nav, { clientX: 150, clientY: 0, pointerId: 1 });
    expect(setPointerCapture).toHaveBeenCalledWith(1);
  });

  it("still allows selecting an item after a drag scroll", () => {
    const onSelect = vi.fn();
    const { container } = render(<SettingsSidebar active="appearance" onSelect={onSelect} />);
    const nav = container.querySelector<HTMLElement>("nav");
    const shortcuts = container.querySelector<HTMLElement>('[data-settings-item="shortcuts"]');
    if (!nav || !shortcuts) throw new Error("no settings nav");

    Object.defineProperties(nav, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 640 },
    });

    fireEvent.pointerDown(nav, { button: 0, clientX: 200, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(nav, { clientX: 150, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(nav, { clientX: 150, clientY: 0, pointerId: 1 });

    fireEvent.pointerDown(shortcuts, { button: 0, clientX: 20, clientY: 10, pointerId: 2 });
    fireEvent.pointerUp(shortcuts, { clientX: 20, clientY: 10, pointerId: 2 });
    fireEvent.click(shortcuts);

    expect(onSelect).toHaveBeenCalledWith("shortcuts");
  });
});
