import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrackContextMenuLabels } from "./track-context-menu";
import { TrackContextMenu } from "./track-context-menu";

vi.mock("@/components/library/track-add-to-set", () => ({
  TrackAddToSetDialog: ({ open, title }: { open: boolean; title?: ReactNode }) =>
    open ? <div role="dialog">{title}</div> : null,
}));

afterEach(() => {
  vi.useRealTimers();
});

const labels: TrackContextMenuLabels = {
  addToSet: "Add to set",
  coverInput: "Cover file",
  displayMode: "Display",
  displayModes: {
    cover: "Cover",
    video: "Video",
  },
  menu: "Track options",
  pickCover: "Add cover",
};

describe("TrackContextMenu", () => {
  it("opens on the song/cover target and updates display settings", async () => {
    const onDisplayModeChange = vi.fn();
    render(
      <TrackContextMenu
        displayMode="video"
        labels={labels}
        onDisplayModeChange={onDisplayModeChange}
        track={{ coverBlobId: undefined, id: "trk_1", title: "Rain Loop" }}
      >
        <div>Rain Loop cover</div>
      </TrackContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Rain Loop cover"));

    expect(await screen.findByRole("menu", { name: "Track options" })).toHaveTextContent("Display");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Cover" }));

    expect(onDisplayModeChange).toHaveBeenCalledWith("cover");
    expect(screen.queryByRole("menuitemcheckbox", { name: "Audio only" })).not.toBeInTheDocument();
  });

  it("opens the add-to-set picker from the song menu", async () => {
    render(
      <TrackContextMenu
        displayMode="cover"
        labels={labels}
        track={{ coverBlobId: undefined, id: "trk_1", title: "Rain Loop" }}
      >
        <div>Rain Loop title</div>
      </TrackContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Rain Loop title"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add to set" }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Add to set");
  });

  it("opens the song menu on touch long press", async () => {
    vi.useFakeTimers();
    try {
      render(
        <TrackContextMenu
          displayMode="cover"
          labels={labels}
          track={{ coverBlobId: undefined, id: "trk_1", title: "Rain Loop" }}
        >
          <div>Rain Loop cover touch target</div>
        </TrackContextMenu>,
      );

      fireEvent.pointerDown(screen.getByText("Rain Loop cover touch target"), {
        clientX: 12,
        clientY: 24,
        pointerType: "touch",
      });
      await act(async () => {
        vi.advanceTimersByTime(520);
        await Promise.resolve();
      });

      expect(screen.getByRole("menu", { name: "Track options" })).toHaveTextContent("Add to set");
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes cover files through the hidden input", async () => {
    const onCoverFileSelect = vi.fn();
    render(
      <TrackContextMenu
        displayMode="cover"
        labels={{ ...labels, pickCover: "Change cover" }}
        onCoverFileSelect={onCoverFileSelect}
        track={{ coverBlobId: "blb_cover", id: "trk_2", title: "City Lights" }}
      >
        <div>City Lights cover</div>
      </TrackContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("City Lights cover"));
    expect(await screen.findByRole("menuitem", { name: "Change cover" })).toBeInTheDocument();

    const file = new File(["image"], "cover.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Cover file"), { target: { files: [file] } });

    expect(onCoverFileSelect).toHaveBeenCalledWith(file);
  });
});
