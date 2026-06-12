import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import type { TrayLabels } from "./menu-model";
import { buildTraySnapshotFromPlayback } from "./snapshot";

const labels: TrayLabels = {
  appName: "MUZERO",
  currentPrefix: "Current",
  noTrack: "No song playing",
  previous: "Previous",
  play: "Play",
  pause: "Pause",
  next: "Next",
  like: "Like current song",
  unlike: "Unlike current song",
  repeat: "Repeat",
  repeatOff: "Off",
  repeatAll: "Repeat all",
  repeatOne: "Repeat one",
  displayMode: "Display mode",
  displayVideo: "Video",
  displayCover: "Cover",
  openApp: "Open MUZERO",
  openNowPlaying: "Open Now Playing",
  settings: "Settings",
  exit: "Exit MUZERO",
};

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: "trk_1",
    sessionId: "ses_1",
    title: "Levitating",
    status: "ready",
    kind: "audio",
    origin: "uploaded",
    tags: [],
    liked: false,
    createdAt: 1,
    updatedAt: 1,
    brief: { caption: "Dua Lipa" },
    ...overrides,
  } as Track;
}

describe("buildTraySnapshotFromPlayback", () => {
  it("projects the current track into a localized tray snapshot", () => {
    const snapshot = buildTraySnapshotFromPlayback({
      currentTrack: track(),
      displayMode: "video",
      isPlaying: true,
      labels,
      liked: true,
      repeat: "all",
    });

    expect(snapshot.currentTrack).toEqual({
      id: "trk_1",
      liked: true,
      subtitle: "Dua Lipa",
      title: "Levitating",
    });
    expect(snapshot.isPlaying).toBe(true);
    expect(snapshot.repeat).toBe("all");
  });

  it("does not include playback progress in the tray snapshot", () => {
    const base = buildTraySnapshotFromPlayback({
      currentTrack: track(),
      displayMode: "cover",
      durationSec: 200,
      isPlaying: false,
      labels,
      liked: false,
      positionSec: 12,
      repeat: "one",
    });

    const afterProgressTick = buildTraySnapshotFromPlayback({
      currentTrack: track(),
      displayMode: "cover",
      durationSec: 200,
      isPlaying: false,
      labels,
      liked: false,
      positionSec: 47,
      repeat: "one",
    });

    expect(afterProgressTick).toEqual(base);
  });

  it("omits title-only subtitle fallbacks from the tray snapshot", () => {
    const snapshot = buildTraySnapshotFromPlayback({
      currentTrack: track({ brief: undefined, mediaMetadata: undefined, note: undefined }),
      displayMode: "video",
      isPlaying: false,
      labels,
      repeat: "off",
    });

    expect(snapshot.currentTrack?.subtitle).toBeUndefined();
  });
});
