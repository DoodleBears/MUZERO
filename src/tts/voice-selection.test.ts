import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/db/types";
import type { VoiceModel } from "./provider";
import { selectVoicePatch } from "./voice-selection";

const voice = (id: string, title = id): VoiceModel => ({
  id,
  title,
  coverImage: `https://cdn/${id}.jpg`,
  samples: [{ audio: `https://cdn/${id}.mp3`, text: "hi" }],
  tags: [],
  languages: [],
});

describe("selectVoicePatch", () => {
  it("selects and remembers a brand-new voice (id + cached metadata)", () => {
    const patch = selectVoicePatch(DEFAULT_SETTINGS, voice("vox-1", "Warm Narrator"));
    expect(patch.ttsVoiceId).toBe("vox-1");
    expect(patch.ttsAddedVoiceIds).toEqual(["vox-1"]);
    expect(patch.ttsAddedVoiceCache).toEqual([
      {
        id: "vox-1",
        title: "Warm Narrator",
        coverImage: "https://cdn/vox-1.jpg",
        samples: [{ audio: "https://cdn/vox-1.mp3", text: "hi" }],
      },
    ]);
  });

  it("appends a second used voice without dropping the first", () => {
    const first = selectVoicePatch(DEFAULT_SETTINGS, voice("a"));
    const settings = { ...DEFAULT_SETTINGS, ...first };
    const patch = selectVoicePatch(settings, voice("b"));
    expect(patch.ttsVoiceId).toBe("b");
    expect(patch.ttsAddedVoiceIds).toEqual(["a", "b"]);
    expect(patch.ttsAddedVoiceCache?.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("re-selecting a known voice is idempotent + refreshes its cached metadata", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      ttsAddedVoiceIds: ["a"],
      ttsAddedVoiceCache: [{ id: "a", title: "Old Title" }],
    };
    const patch = selectVoicePatch(settings, voice("a", "New Title"));
    expect(patch.ttsAddedVoiceIds).toEqual(["a"]); // no duplicate
    expect(patch.ttsAddedVoiceCache).toEqual([
      {
        id: "a",
        title: "New Title",
        coverImage: "https://cdn/a.jpg",
        samples: [{ audio: "https://cdn/a.mp3", text: "hi" }],
      },
    ]);
  });
});
