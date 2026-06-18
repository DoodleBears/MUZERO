import { fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DjSession, Track } from "@/db/types";
import { clearTrace, getTraceEntries } from "@/lib/trace";
import { TrackRow } from "./track-row";

const { popoverMockState } = vi.hoisted(() => ({
  popoverMockState: {
    onOpenChange: undefined as ((open: boolean) => void) | undefined,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Counts as a render probe: TrackThumb calls this once per TrackRow render.
const { coverHook } = vi.hoisted(() => ({ coverHook: vi.fn(() => null) }));
vi.mock("@/hooks/use-media", () => ({
  useCoverDerivativeUrl: coverHook,
  useTrackCoverUrl: () => null,
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => {
    popoverMockState.onOpenChange = onOpenChange;
    return <>{children}</>;
  },
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button
      type="button"
      {...props}
      onClick={(event) => {
        onClick?.(event);
        popoverMockState.onOpenChange?.(true);
      }}
    >
      {children}
    </button>
  ),
}));

afterEach(() => {
  clearTrace();
  popoverMockState.onOpenChange = undefined;
  vi.restoreAllMocks();
});

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
  track: rowTrack = track(),
}: {
  isCurrent?: boolean;
  isSelected?: boolean;
  sessions?: DjSession[];
  track?: Track;
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
    track: rowTrack,
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

  it("records a safe user-action breadcrumb when playback is requested", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { container } = renderRow({ isSelected: true });
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]");

    fireEvent.click(row as HTMLElement);

    expect(getTraceEntries()).toEqual([
      expect.objectContaining({
        level: "info",
        scope: "ui.action",
        event: "play.click",
        context: expect.objectContaining({
          category: "user-action",
          phase: "start",
          trackId: "trk_1",
          sessionId: "ses_1",
          uiSurface: "track-row",
          controlId: "track.play",
          actionKind: "click",
        }),
      }),
    ]);
  });

  it("searches add-to-set targets before selecting a set", () => {
    const { container, props } = renderRow({
      sessions: [session("ses_lofi", "Lofi Focus"), session("ses_night", "Night Drive")],
    });

    // The hover toolbar (incl. the add-to-set popover) is lazy-mounted on hover.
    fireEvent.mouseEnter(container.querySelector("[data-muzero-track-row]") as HTMLElement);
    fireEvent.change(screen.getByLabelText("track.searchOrCreateSet"), {
      target: { value: "night" },
    });

    expect(screen.queryByRole("option", { name: "Lofi Focus" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Night Drive" }));

    expect(props.onAddToSession).toHaveBeenCalledWith("ses_night");
  });

  it("creates a new set from the typed name when nothing matches", () => {
    const { container, props } = renderRow({ sessions: [session("ses_lofi", "Lofi Focus")] });

    fireEvent.mouseEnter(container.querySelector("[data-muzero-track-row]") as HTMLElement);
    fireEvent.change(screen.getByLabelText("track.searchOrCreateSet"), {
      target: { value: "Roadtrip" },
    });

    // The non-matching existing set drops out, leaving only the create row.
    expect(screen.queryByRole("option", { name: "Lofi Focus" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "track.createSet" }));

    expect(props.onAddToNewSession).toHaveBeenCalledWith("Roadtrip");
    expect(props.onAddToSession).not.toHaveBeenCalled();
  });

  it("shows source attribution for cloud-imported tracks", () => {
    renderRow({
      track: {
        ...track(),
        cloudSource: {
          driveId: "drv_friend",
          driveLabel: "Friend Drive",
          devicePublicId: "dvc_friend",
          displayName: "Friend phone",
          avatarSeed: "green",
        },
      },
    });

    expect(screen.getByText("Friend phone")).toBeInTheDocument();
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

  it("plays the selected current row so a paused track can resume", () => {
    const { container, props } = renderRow({ isCurrent: true, isSelected: true });
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]");

    fireEvent.click(row as HTMLElement);

    expect(props.onPlay).toHaveBeenCalledTimes(1);
    expect(props.onView).not.toHaveBeenCalled();
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

  it("plays the selected current row from the library drill-in key", () => {
    const { container, props } = renderRow({ isCurrent: true, isSelected: true });
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]");

    fireEvent.keyDown(row as HTMLElement, { code: "KeyD", key: "d" });

    expect(props.onPlay).toHaveBeenCalledTimes(1);
    expect(props.onView).not.toHaveBeenCalled();
  });

  it("lazy-mounts the hover action toolbar only once the row is hovered/focused", () => {
    const { container } = renderRow();
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]") as HTMLElement;

    // Not mounted at rest — this is what keeps the popovers off the scroll path.
    expect(screen.queryByLabelText("track.delete")).not.toBeInTheDocument();

    fireEvent.mouseEnter(row);
    expect(screen.getByLabelText("track.delete")).toBeInTheDocument();

    fireEvent.mouseLeave(row);
    expect(screen.queryByLabelText("track.delete")).not.toBeInTheDocument();

    // Keyboard focus reveals it too (so tab-to-actions still works).
    fireEvent.focus(row);
    expect(screen.getByLabelText("track.delete")).toBeInTheDocument();
  });

  it("keeps the add-to-set picker mounted after the pointer leaves the row", () => {
    const { container } = renderRow({
      sessions: [session("ses_lofi", "Lofi Focus"), session("ses_night", "Night Drive")],
    });
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]") as HTMLElement;

    fireEvent.mouseEnter(row);
    fireEvent.click(screen.getByLabelText("track.addToSet"));
    fireEvent.mouseLeave(row);

    expect(screen.getByLabelText("track.searchOrCreateSet")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Night Drive" })).toBeInTheDocument();
  });

  it("skips re-render when only callback identities change (memo comparator)", () => {
    // The virtualized list passes fresh inline-arrow handlers every scroll frame;
    // the comparator must ignore them so visible rows don't re-render on scroll.
    coverHook.mockClear();
    const base = {
      isCurrent: false,
      onAddToNewSession: vi.fn(),
      onAddToSession: vi.fn(),
      onDelete: vi.fn(),
      onDownloadOriginal: vi.fn(),
      onExportWithMetadata: vi.fn(),
      onPlay: vi.fn(),
      onToggleLike: vi.fn(),
      onView: vi.fn(),
      sessions: [] as DjSession[],
      track: track(), // one stable object across rerenders
    };
    const { rerender } = render(<TrackRow {...base} />);
    const afterMount = coverHook.mock.calls.length;

    // Same data, brand-new callback identities → comparator skips the re-render.
    rerender(<TrackRow {...base} onPlay={vi.fn()} onDelete={vi.fn()} onToggleLike={vi.fn()} />);
    expect(coverHook.mock.calls.length).toBe(afterMount);

    // A real data change (now the current track) DOES re-render the row.
    rerender(<TrackRow {...base} isCurrent onPlay={vi.fn()} />);
    expect(coverHook.mock.calls.length).toBeGreaterThan(afterMount);
  });

  it("does not view or play only because the row receives focus", () => {
    const { container, props } = renderRow({ isSelected: true });
    const row = container.querySelector<HTMLElement>("[data-muzero-track-row]");

    fireEvent.focus(row as HTMLElement);

    expect(props.onView).not.toHaveBeenCalled();
    expect(props.onPlay).not.toHaveBeenCalled();
  });
});
