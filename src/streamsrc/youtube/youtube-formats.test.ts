import { describe, expect, it } from "vitest";
import {
  audioCodecOf,
  audioMimeFor,
  pickAdaptiveAudio,
  type YoutubeFormat,
} from "./youtube-formats";

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
