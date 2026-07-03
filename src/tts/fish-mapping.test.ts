import { describe, expect, it } from "vitest";
import {
  classifyFishError,
  mapReplyToTtsBody,
  parseVoiceModel,
  parseVoiceModelList,
} from "./fish-mapping";

describe("mapReplyToTtsBody", () => {
  it("maps text + voiceId + speed into the Fish TTS body", () => {
    const body = mapReplyToTtsBody(
      { text: "切到 lofi 器乐。", voiceId: "vox-1", speed: 1.2 },
      { format: "mp3" },
    );
    expect(body.text).toBe("切到 lofi 器乐。");
    expect(body.reference_id).toBe("vox-1");
    expect(body.format).toBe("mp3");
    expect((body.prosody as { speed: number }).speed).toBe(1.2);
    expect(body.normalize).toBe(true);
    expect(body.chunk_length).toBe(300);
    expect(body.latency).toBe("normal");
  });

  it("defaults speed to 1", () => {
    const body = mapReplyToTtsBody({ text: "hi", voiceId: "v" }, { format: "mp3" });
    expect((body.prosody as { speed: number }).speed).toBe(1);
  });

  it("includes mp3_bitrate only for mp3", () => {
    expect(mapReplyToTtsBody({ text: "a", voiceId: "v" }, { format: "mp3" }).mp3_bitrate).toBe(128);
    expect(
      mapReplyToTtsBody({ text: "a", voiceId: "v" }, { format: "opus" }).mp3_bitrate,
    ).toBeUndefined();
  });
});

describe("parseVoiceModel", () => {
  it("normalizes a Fish ModelEntity (_id → id, cover_image → coverImage, samples)", () => {
    const model = parseVoiceModel({
      _id: "abc123",
      title: "Warm Narrator",
      description: "calm",
      cover_image: "https://cdn/cover.jpg",
      tags: ["calm", "warm"],
      languages: ["en", "zh"],
      samples: [{ audio: "https://cdn/s1.mp3", text: "hello" }, { audio: "https://cdn/s2.mp3" }],
    });
    expect(model.id).toBe("abc123");
    expect(model.title).toBe("Warm Narrator");
    expect(model.coverImage).toBe("https://cdn/cover.jpg");
    expect(model.samples).toHaveLength(2);
    expect(model.samples[0]).toEqual({ audio: "https://cdn/s1.mp3", text: "hello" });
    expect(model.tags).toEqual(["calm", "warm"]);
    expect(model.languages).toEqual(["en", "zh"]);
  });

  it("falls back to `id` and tolerates missing optional fields", () => {
    const model = parseVoiceModel({ id: "xyz", title: "Bare" });
    expect(model.id).toBe("xyz");
    expect(model.samples).toEqual([]);
    expect(model.tags).toEqual([]);
    expect(model.languages).toEqual([]);
    expect(model.coverImage).toBeUndefined();
  });

  it("drops samples without a usable audio url", () => {
    const model = parseVoiceModel({
      id: "x",
      title: "t",
      samples: [{ text: "no audio" }, { audio: "https://cdn/ok.mp3" }],
    });
    expect(model.samples).toEqual([{ audio: "https://cdn/ok.mp3", text: undefined }]);
  });
});

describe("parseVoiceModelList", () => {
  it("maps a PaginatedResponse's items", () => {
    const list = parseVoiceModelList({
      items: [
        { _id: "a", title: "A" },
        { _id: "b", title: "B" },
      ],
      total: 2,
    });
    expect(list.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("returns [] when items are missing or malformed", () => {
    expect(parseVoiceModelList({})).toEqual([]);
    expect(parseVoiceModelList(null)).toEqual([]);
    expect(parseVoiceModelList({ items: "nope" })).toEqual([]);
  });
});

describe("classifyFishError", () => {
  it("classifies by status code", () => {
    expect(classifyFishError(401)).toBe("auth");
    expect(classifyFishError(402)).toBe("auth");
    expect(classifyFishError(429)).toBe("rate-limit");
    expect(classifyFishError(500)).toBe("unknown");
  });
});
