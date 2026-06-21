import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteTracks, removeTracksFromSession } from "@/db/repositories";
import type { Track } from "@/db/types";
import { TrackListSection } from "./track-list-section";

// Hoisted so the `vi.mock` factories below (lifted above imports) can safely
// reference them — vitest only permits hoisted-factory access to vi.hoisted values.
const { virtualTrackListMock, confirmDialogMock } = vi.hoisted(() => ({
  virtualTrackListMock: vi.fn(),
  confirmDialogMock: vi.fn(),
}));

vi.mock("@/db/repositories", () => ({
  deleteTracks: vi.fn(() => Promise.resolve()),
  prependTrackIds: vi.fn(() => Promise.resolve()),
  removeTracksFromSession: vi.fn(() => Promise.resolve()),
  reorderTracksInSession: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/stores/notification-store", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/library/batch-action-bar", () => ({
  BatchActionBar: () => null,
}));

vi.mock("@/components/library/reorderable-track-list", () => ({
  ReorderableTrackList: () => null,
}));

vi.mock("@/components/library/track-list-menu", () => ({
  TrackListMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) => {
    confirmDialogMock(props);
    return null;
  },
}));

vi.mock("./add-to-set-menu", () => ({
  AddToSetMenu: () => null,
}));

vi.mock("./use-list-scroll-preservation", () => ({
  useListScrollPreservation: () => ({
    anchorIndexRef: { current: null },
    rootRef: { current: null },
  }),
}));

vi.mock("./virtual-track-list", () => ({
  VirtualTrackList: (props: unknown) => {
    virtualTrackListMock(props);
    return null;
  },
}));

function track(id: string): Track {
  return { id, sessionId: "ses_1", title: id } as Track;
}

describe("TrackListSection", () => {
  afterEach(() => {
    virtualTrackListMock.mockClear();
  });

  it("maps an anchor track id to the shown-list index and selected row", () => {
    render(<TrackListSection anchorTrackId="trk_3" tracks={[track("trk_1"), track("trk_3")]} />);

    expect(virtualTrackListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialScrollAlign: "start",
        jumpFocusIndex: 1,
        jumpScrollIndex: 1,
        selectedTrackId: "trk_3",
      }),
    );
  });

  it("silently skips anchoring when the track is not visible", () => {
    render(<TrackListSection anchorTrackId="trk_missing" tracks={[track("trk_1")]} />);

    expect(virtualTrackListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jumpFocusIndex: undefined,
        jumpScrollIndex: undefined,
        initialScrollIndex: undefined,
        selectedTrackId: undefined,
      }),
    );
  });

  it("a set row's trash offers remove-from-set vs delete-everywhere", async () => {
    render(<TrackListSection setId="ses_1" tracks={[track("trk_1")]} />);
    const props = virtualTrackListMock.mock.calls.at(-1)?.[0] as {
      onDeleteTrack: (track: Track) => void;
    };

    // The row trash opens a two-choice dialog (it no longer silently removes).
    await act(async () => props.onDeleteTrack(track("trk_1")));
    const dialog = confirmDialogMock.mock.calls
      .map(
        (call) =>
          call[0] as { open: boolean; confirm: ConfirmActionMock; secondary?: ConfirmActionMock },
      )
      .filter((p) => p.open && p.secondary)
      .at(-1);
    expect(dialog).toBeTruthy();

    // Primary = remove from THIS set only (reversible); the song is not deleted.
    await act(async () => dialog?.confirm.onConfirm());
    expect(removeTracksFromSession).toHaveBeenCalledWith("ses_1", ["trk_1"]);
    expect(deleteTracks).not.toHaveBeenCalled();

    // Secondary = delete the song everywhere (irreversible).
    await act(async () => dialog?.secondary?.onConfirm());
    expect(deleteTracks).toHaveBeenCalledWith(["trk_1"]);
  });

  it("the global library row trash goes straight to a permanent-delete confirm", async () => {
    render(<TrackListSection tracks={[track("trk_1")]} />);
    const props = virtualTrackListMock.mock.calls.at(-1)?.[0] as {
      onDeleteTrack: (track: Track) => void;
    };

    await act(async () => props.onDeleteTrack(track("trk_1")));
    // No set context → no remove-from-set choice (single permanent confirm only).
    const opened = confirmDialogMock.mock.calls
      .map((call) => call[0] as { open: boolean; secondary?: ConfirmActionMock })
      .filter((p) => p.open)
      .at(-1);
    expect(opened?.secondary).toBeUndefined();
  });
});

interface ConfirmActionMock {
  onConfirm: () => void | Promise<void>;
}
