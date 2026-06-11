import { fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import type { DjSession, Track } from "@/db/types";
import { TrackRow } from "./track-row";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-media", () => ({
  useTrackCoverUrl: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

function track(): Track {
  return {
    createdAt: 1,
    durationSec: 60,
    id: "trk_1",
    kind: "audio",
    liked: false,
    origin: "uploaded",
    playCount: 0,
    provider: "mock",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title: "First",
    updatedAt: 1,
  } as Track;
}

function session(id: string, name: string): DjSession {
  return {
    config: {
      allowVocals: true,
      autoExtend: false,
      batchSize: 1,
      refillThreshold: 2,
      targetDurationSec: 60,
    },
    createdAt: 1,
    displayMode: "cover",
    id,
    name,
    seedPrompt: "",
    status: "idle",
    trackIds: [],
    updatedAt: 1,
  };
}

function renderRow({
  isCurrent = false,
  isSelected,
  sessions = [],
}: {
  isCurrent?: boolean;
  isSelected?: boolean;
  sessions?: DjSession[];
} = {}) {
  const props = {
    isCurrent,
    isSelected,
    onAddToNewSession: vi.fn(),
    onAddToSession: vi.fn(),
    onDelete: vi.fn(),
    onDownloadOriginal: vi.fn(),
    onExportWithMetadata: vi.fn(),
    onPlay: vi.fn(),
    onToggleLike: vi.fn(),
    onView: vi.fn(),
    sessions,
    track: track(),
  };

  const view = render(<TrackRow {...props} />);
  return { ...view, props };
}

describe("TrackRow", () => {
  it("uses the cover base for view and the overlay button for play", () => {
    const { container, props } = renderRow();
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]");
    expect(row).not.toBeNull();

    fireEvent.click(row as HTMLElement);
    expect(props.onView).toHaveBeenCalledTimes(1);
    expect(props.onPlay).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("player.play"));
    expect(props.onPlay).toHaveBeenCalledTimes(1);
  });

  it("searches add-to-set targets before selecting a set", () => {
    const { props } = renderRow({
      sessions: [session("ses_lofi", "Lofi Focus"), session("ses_night", "Night Drive")],
    });

    fireEvent.change(screen.getByLabelText("track.searchOrCreateSet"), {
      target: { value: "night" },
    });

    expect(screen.queryByRole("option", { name: "Lofi Focus" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Night Drive" }));

    expect(props.onAddToSession).toHaveBeenCalledWith("ses_night");
  });

  it("creates a new set from the typed name when nothing matches", () => {
    const { props } = renderRow({ sessions: [session("ses_lofi", "Lofi Focus")] });

    fireEvent.change(screen.getByLabelText("track.searchOrCreateSet"), {
      target: { value: "Roadtrip" },
    });

    // The non-matching existing set drops out, leaving only the create row.
    expect(screen.queryByRole("option", { name: "Lofi Focus" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "track.createSet" }));

    expect(props.onAddToNewSession).toHaveBeenCalledWith("Roadtrip");
    expect(props.onAddToSession).not.toHaveBeenCalled();
  });

  it("selects an unselected row on click without playing", () => {
    const { container, props } = renderRow({ isSelected: false });
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]");

    fireEvent.click(row as HTMLElement);

    expect(props.onView).toHaveBeenCalledTimes(1);
    expect(props.onPlay).not.toHaveBeenCalled();
  });

  it("plays an already-selected row when it is clicked again", () => {
    const { container, props } = renderRow({ isSelected: true });
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]");

    fireEvent.click(row as HTMLElement);

    expect(props.onPlay).toHaveBeenCalledTimes(1);
    expect(props.onView).not.toHaveBeenCalled();
  });

  it("does not replay the currently playing row when it is clicked", () => {
    const { container, props } = renderRow({ isCurrent: true, isSelected: true });
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]");

    fireEvent.click(row as HTMLElement);

    expect(props.onPlay).not.toHaveBeenCalled();
    expect(props.onView).toHaveBeenCalledTimes(1);
  });

  it("plays the selected focused row on Enter, but only selects an unselected one", () => {
    const selected = renderRow({ isSelected: true });
    fireEvent.keyDown(selected.container.querySelector("[data-muzero-track-row]") as HTMLElement, {
      key: "Enter",
    });
    expect(selected.props.onPlay).toHaveBeenCalledTimes(1);
    expect(selected.props.onView).not.toHaveBeenCalled();

    const unselected = renderRow({ isSelected: false });
    fireEvent.keyDown(
      unselected.container.querySelector("[data-muzero-track-row]") as HTMLElement,
      { key: "Enter" },
    );
    expect(unselected.props.onView).toHaveBeenCalledTimes(1);
    expect(unselected.props.onPlay).not.toHaveBeenCalled();
  });

  it("does not view or play only because the row receives focus", () => {
    const { container, props } = renderRow({ isSelected: true });
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]");

    fireEvent.focus(row as HTMLElement);

    expect(props.onView).not.toHaveBeenCalled();
    expect(props.onPlay).not.toHaveBeenCalled();
  });
});
