import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "@/stores/player-store";
import { VolumeControl } from "./volume-control";

vi.mock("react-i18next", async (importActual) => ({
  ...(await importActual<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/use-shortcut-hint", () => ({
  useShortcutHint: () => () => ["↑", "↓"],
}));

describe("VolumeControl", () => {
  afterEach(() => {
    usePlayerStore.setState({ volume: 0.9 });
    vi.restoreAllMocks();
  });

  it("restores the previous audible volume when toggled back from mute", () => {
    usePlayerStore.setState({ volume: 0.42 });
    render(<VolumeControl />);

    const button = screen.getByRole("button", { name: "player.volume" });
    fireEvent.click(button);
    expect(usePlayerStore.getState().volume).toBe(0);

    fireEvent.click(button);
    expect(usePlayerStore.getState().volume).toBe(0.42);
  });

  it("falls back to the default dock volume when initially muted", () => {
    usePlayerStore.setState({ volume: 0 });
    render(<VolumeControl />);

    fireEvent.click(screen.getByRole("button", { name: "player.volume" }));

    expect(usePlayerStore.getState().volume).toBe(0.9);
  });
});
