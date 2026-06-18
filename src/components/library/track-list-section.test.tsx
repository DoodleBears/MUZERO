import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { TrackListSection } from "./track-list-section";

// Hoisted so the `vi.mock` factory below (lifted above imports) can safely
// reference it — vitest only permits hoisted-factory access to vi.hoisted values.
const { virtualTrackListMock } = vi.hoisted(() => ({ virtualTrackListMock: vi.fn() }));

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
  ConfirmDialog: () => null,
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
        initialFocusIndex: 1,
        initialScrollAlign: "center",
        initialScrollIndex: 1,
        selectedTrackId: "trk_3",
      }),
    );
  });

  it("silently skips anchoring when the track is not visible", () => {
    render(<TrackListSection anchorTrackId="trk_missing" tracks={[track("trk_1")]} />);

    expect(virtualTrackListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        initialFocusIndex: undefined,
        initialScrollIndex: undefined,
        selectedTrackId: undefined,
      }),
    );
  });
});
