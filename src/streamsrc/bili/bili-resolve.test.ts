import { describe, expect, it } from "vitest";
import {
  type BiliAudioStream,
  parseDashAudio,
  prioritizeBiliUrls,
  selectAudioByPreference,
} from "./bili-resolve";

/** A realistic `/x/player/wbi/playurl` `data` body with normal + dolby + flac audio. */
const PLAYURL_DATA = {
  dash: {
    audio: [
      {
        id: 30216,
        baseUrl: "https://cn-gotcha.bilivideo.com/a64.m4s",
        backupUrl: ["https://upos-sz-mirror08c.bilivideo.com/a64.m4s"],
        bandwidth: 67000,
        mimeType: "audio/mp4",
        codecs: "mp4a.40.5",
      },
      {
        id: 30280,
        baseUrl: "https://cn-gotcha.bilivideo.com/a192.m4s",
        backupUrl: ["https://upos-sz-mirror08c.bilivideo.com/a192.m4s"],
        bandwidth: 192000,
        mimeType: "audio/mp4",
        codecs: "mp4a.40.2",
      },
    ],
    dolby: {
      type: 1,
      audio: [
        {
          id: 30250,
          baseUrl: "https://upos-sz-mirror08c.bilivideo.com/dolby.m4s",
          backupUrl: [],
          bandwidth: 434000,
          mimeType: "audio/mp4",
          codecs: "ec-3",
        },
      ],
    },
    flac: {
      display: true,
      audio: {
        id: 30251,
        baseUrl: "https://upos-sz-mirror08c.bilivideo.com/flac.m4s",
        backupUrl: [],
        bandwidth: 1200000,
        mimeType: "audio/mp4",
        codecs: "fLaC",
      },
    },
  },
};

describe("parseDashAudio", () => {
  it("flattens normal + dolby + flac into tagged streams", () => {
    const streams = parseDashAudio(PLAYURL_DATA);
    const byId = (id: number) => streams.find((s) => s.id === id) as BiliAudioStream;
    expect(streams).toHaveLength(4);
    expect(byId(30216).qualityTag).toBe("normal");
    expect(byId(30280).qualityTag).toBe("normal");
    expect(byId(30250).qualityTag).toBe("dolby");
    expect(byId(30251).qualityTag).toBe("hires"); // flac > 1000 kbps
    expect(byId(30280).bitrateKbps).toBe(192);
  });

  it("returns [] when there is no dash audio", () => {
    expect(parseDashAudio({})).toEqual([]);
    expect(parseDashAudio({ dash: { audio: [] } })).toEqual([]);
  });

  it("treats a sub-1000kbps flac as lossless, not hires", () => {
    const streams = parseDashAudio({
      dash: { flac: { display: true, audio: { id: 30251, baseUrl: "x", bandwidth: 700000 } } },
    });
    expect(streams[0].qualityTag).toBe("lossless");
  });
});

describe("selectAudioByPreference", () => {
  const streams = parseDashAudio(PLAYURL_DATA);

  it("picks the exact tier when present", () => {
    expect(selectAudioByPreference(streams, "low")?.id).toBe(30216);
    expect(selectAudioByPreference(streams, "high")?.id).toBe(30280);
    expect(selectAudioByPreference(streams, "dolby")?.id).toBe(30250);
    expect(selectAudioByPreference(streams, "hires")?.id).toBe(30251);
  });

  it("downgrades when the preferred tier is missing", () => {
    const noDolbyNoFlac = streams.filter((s) => s.qualityTag === "normal");
    // dolby missing → walk down to the best normal tier available (high=192k).
    expect(selectAudioByPreference(noDolbyNoFlac, "dolby")?.id).toBe(30280);
  });

  it("upgrades as a last resort when nothing at/below the tier exists", () => {
    const onlyHires = streams.filter((s) => s.qualityTag === "hires");
    expect(selectAudioByPreference(onlyHires, "low")?.id).toBe(30251);
  });

  it("returns null for an empty stream list", () => {
    expect(selectAudioByPreference([], "high")).toBeNull();
  });
});

describe("prioritizeBiliUrls", () => {
  it("ranks upos mirrors ahead of generic CDNs", () => {
    const ordered = prioritizeBiliUrls("https://cn-gotcha.bilivideo.com/a.m4s", [
      "https://upos-sz-mirror08c.bilivideo.com/a.m4s",
    ]);
    expect(ordered[0]).toContain("upos");
  });

  it("dedupes and drops empties", () => {
    expect(prioritizeBiliUrls("https://a/x", ["https://a/x", "", "https://a/x"])).toEqual([
      "https://a/x",
    ]);
  });
});
