import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "@/stores/player-store";
import { ProgressScrubber } from "./progress-scrubber";

vi.mock("react-i18next", () => ({
  initReactI18next: { init: () => undefined, type: "3rdParty" },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const originalSeek = usePlayerStore.getState().seek;

describe("ProgressScrubber keyboard handling", () => {
  afterEach(() => {
    usePlayerStore.setState({
      durationSec: 0,
      isPlaying: false,
      positionSec: 0,
      seek: originalSeek,
    });
    vi.restoreAllMocks();
  });

  it("leaves vertical arrows for the global volume shortcuts", () => {
    const seek = vi.fn();
    usePlayerStore.setState({
      durationSec: 60,
      isPlaying: false,
      positionSec: 10,
      seek,
    });
    const { container } = render(<ProgressScrubber />);
    const slider = container.querySelector<HTMLElement>('[role="slider"]');
    if (!slider) throw new Error("no progress slider");

    const up = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "ArrowUp",
      key: "ArrowUp",
    });
    slider.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(false);
    expect(seek).not.toHaveBeenCalled();

    const right = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "ArrowRight",
      key: "ArrowRight",
    });
    slider.dispatchEvent(right);
    expect(right.defaultPrevented).toBe(true);
    expect(seek).toHaveBeenCalledWith(15);
  });
});
