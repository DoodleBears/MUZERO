import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateToTab } from "./navigate-tab";

describe("navigateToTab", () => {
  afterEach(() => {
    // The view-transition probe below installs a stub; drop it so other suites
    // see the real (absent in jsdom) API.
    // biome-ignore lint/suspicious/noExplicitAny: test-only teardown of a DOM stub
    (document as any).startViewTransition = undefined;
  });

  it("switches the active tab through the provided setter", () => {
    const setTab = vi.fn();
    navigateToTab(setTab, "search");
    expect(setTab).toHaveBeenCalledOnce();
    expect(setTab).toHaveBeenCalledWith("search");
  });

  it("never wraps the switch in a view transition (kept-mounted tabs must stay faithful)", () => {
    // The bug this helper fixes: routing a tab switch through `transitionState`
    // (startViewTransition + flushSync) disturbed the kept-mounted library tab's
    // scroll/detail/sort on the way back, while the plain-setTab dock-song open
    // stayed faithful. navigateToTab is the faithful path — it must touch neither
    // the View Transition API nor flushSync.
    const startViewTransition = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: install a spy where jsdom has none
    (document as any).startViewTransition = startViewTransition;
    const setTab = vi.fn();

    navigateToTab(setTab, "now");

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(setTab).toHaveBeenCalledWith("now");
  });
});
