import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
// Side-effect: initialize i18next so t() returns real (en) copy for label queries.
import "@/i18n/i18n";
import { useUiStore } from "@/stores/ui-store";
import { NowPlayingSheet } from "./now-playing-sheet";

afterEach(() => {
  useUiStore.setState({ isSheetOpen: false });
});

describe("NowPlayingSheet", () => {
  it("renders nothing while collapsed", () => {
    render(<NowPlayingSheet />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a dialog carrying the full transport when expanded", () => {
    useUiStore.setState({ isSheetOpen: true });
    render(<NowPlayingSheet />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Full transport — the controls the collapsed dock intentionally omits.
    expect(screen.getByLabelText("Play")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous")).toBeInTheDocument();
    expect(screen.getByLabelText("Next")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();
  });
});
