import { describe, expect, it } from "vitest";
import {
  audioCodecOf,
  audioMimeFor,
  pickAdaptiveAudio,
  pickAdaptiveVideo,
  videoCodecOf,
  videoMimeFor,
  type YoutubeFormat,
  type YoutubeVideoFormat,
} from "./youtube-formats";

const vfmt = (over: Partial<YoutubeVideoFormat>): YoutubeVideoFormat => ({
  itag: 0,
  mimeType: 'video/mp4; codecs="avc1.640028"',
  height: 1080,
  ...over,
});

describe("videoCodecOf / videoMimeFor", () => {
  it("classifies codec and strips the mime", () => {
    expect(videoCodecOf('video/mp4; codecs="avc1.640028"')).toBe("avc");
    expect(videoCodecOf('video/webm; codecs="vp9"')).toBe("vp9");
    expect(videoCodecOf('video/mp4; codecs="av01.0.08M.08"')).toBe("av1");
    expect(videoMimeFor(vfmt({ mimeType: 'video/webm; codecs="vp9"' }))).toBe("video/webm");
  });
});

describe("pickAdaptiveVideo", () => {
  const formats: YoutubeVideoFormat[] = [
    vfmt({ itag: 134, mimeType: 'video/mp4; codecs="avc1"', height: 360, bitrate: 600_000 }),
    vfmt({ itag: 136, mimeType: 'video/mp4; codecs="avc1"', height: 720, bitrate: 1_500_000 }),
    vfmt({ itag: 137, mimeType: 'video/mp4; codecs="avc1"', height: 1080, bitrate: 3_000_000 }),
    vfmt({ itag: 248, mimeType: 'video/webm; codecs="vp9"', height: 1080, bitrate: 2_400_000 }),
    vfmt({ itag: 401, mimeType: 'video/mp4; codecs="av01"', height: 2160, bitrate: 12_000_000 }),
    // an audio-only format must be ignored
    { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000 },
  ];

  it("caps at maxHeight and prefers AVC for mp4 copy by default", () => {
    const pick = pickAdaptiveVideo(formats, { maxHeight: 1080 });
    expect(pick?.format.height).toBe(1080);
    expect(pick?.codec).toBe("avc"); // AVC over the VP9 1080p sibling
  });

  it("honors an explicit codec preference", () => {
    const pick = pickAdaptiveVideo(formats, { maxHeight: 1080, codecPreference: ["vp9", "avc"] });
    expect(pick?.codec).toBe("vp9");
  });

  it("returns the highest with no cap; never returns audio-only", () => {
    expect(pickAdaptiveVideo(formats, {})?.format.height).toBe(2160);
    expect(pickAdaptiveVideo([{ itag: 140, mimeType: "audio/mp4" }], {})).toBeNull();
  });

  it("downgrades to 720 when capped there, upgrades to lowest when cap is below all", () => {
    expect(pickAdaptiveVideo(formats, { maxHeight: 720 })?.format.height).toBe(720);
    expect(pickAdaptiveVideo(formats, { maxHeight: 144 })?.format.height).toBe(360);
  });
});

const fmt = (over: Partial<YoutubeFormat>): YoutubeFormat => ({
  itag: 0,
  mimeType: 'audio/mp4; codecs="mp4a.40.2"',
  ...over,
});

describe("audioCodecOf", () => {
  it("classifies the common YouTube audio codecs", () => {
    expect(audioCodecOf('audio/mp4; codecs="mp4a.40.2"')).toBe("aac");
    expect(audioCodecOf('audio/webm; codecs="opus"')).toBe("opus");
    expect(audioCodecOf('audio/webm; codecs="vorbis"')).toBe("vorbis");
    expect(audioCodecOf('video/mp4; codecs="avc1.4d401f"')).toBe("other");
  });
});

describe("pickAdaptiveAudio", () => {
  it("prefers AAC (MP4) over a higher-bitrate Opus (WebM) for compatibility", () => {
    const picked = pickAdaptiveAudio([
      fmt({ itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160_000 }),
      fmt({ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000 }),
    ]);
    expect(picked?.format.itag).toBe(140);
    expect(picked?.codec).toBe("aac");
  });

  it("picks the highest bitrate within the preferred codec", () => {
    const picked = pickAdaptiveAudio([
      fmt({ itag: 139, mimeType: 'audio/mp4; codecs="mp4a.40.5"', bitrate: 48_000 }),
      fmt({ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128_000 }),
    ]);
    expect(picked?.format.itag).toBe(140);
  });

  it("falls back to Opus when there's no AAC", () => {
    const picked = pickAdaptiveAudio([
      fmt({ itag: 250, mimeType: 'audio/webm; codecs="opus"', bitrate: 70_000 }),
      fmt({ itag: 251, mimeType: 'audio/webm; codecs="opus"', bitrate: 160_000 }),
    ]);
    expect(picked?.codec).toBe("opus");
    expect(picked?.format.itag).toBe(251); // highest bitrate opus
  });

  it("ignores video formats and uses averageBitrate when bitrate is absent", () => {
    const picked = pickAdaptiveAudio([
      fmt({ itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"', bitrate: 4_000_000 }),
      fmt({ itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', averageBitrate: 127_000 }),
    ]);
    expect(picked?.format.itag).toBe(140);
  });

  it("returns null when there is no audio-only format", () => {
    expect(pickAdaptiveAudio([fmt({ mimeType: 'video/mp4; codecs="avc1"' })])).toBeNull();
    expect(pickAdaptiveAudio([])).toBeNull();
  });
});

describe("audioMimeFor", () => {
  it("strips the codecs parameter for the media element", () => {
    expect(audioMimeFor(fmt({ mimeType: 'audio/webm; codecs="opus"' }))).toBe("audio/webm");
    expect(audioMimeFor(fmt({ mimeType: "audio/mp4" }))).toBe("audio/mp4");
  });
});
