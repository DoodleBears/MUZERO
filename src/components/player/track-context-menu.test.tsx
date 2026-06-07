import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrackContextMenuLabels } from "./track-context-menu";
import { TrackContextMenu } from "./track-context-menu";

const labels: TrackContextMenuLabels = {
  audioOnly: "Audio only",
  coverInput: "Cover file",
  displayMode: "Display",
  displayModes: {
    cover: "Cover",
    title: "Title",
    video: "Video",
  },
  menu: "Track options",
  pickCover: "Add cover",
};

describe("TrackContextMenu", () => {
  it("opens on the song/cover target and updates display settings", async () => {
    const onAudioOnlyChange = vi.fn();
    const onDisplayModeChange = vi.fn();
    render(
      <TrackContextMenu
        audioOnly={false}
        displayMode="video"
        labels={labels}
        onAudioOnlyChange={onAudioOnlyChange}
        onDisplayModeChange={onDisplayModeChange}
        track={{ coverBlobId: undefined, id: "trk_1", title: "Rain Loop" }}
      >
        <div>Rain Loop cover</div>
      </TrackContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Rain Loop cover"));

    expect(await screen.findByRole("menu", { name: "Track options" })).toHaveTextContent("Display");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Cover" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Audio only" }));

    expect(onDisplayModeChange).toHaveBeenCalledWith("cover");
    expect(onAudioOnlyChange).toHaveBeenCalledWith(true);
  });

  it("routes cover files through the hidden input", async () => {
    const onCoverFileSelect = vi.fn();
    render(
      <TrackContextMenu
        audioOnly
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
