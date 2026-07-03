import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/db/types";
import { isTtsReady, resolveTtsProvider } from "./registry";

const base = DEFAULT_SETTINGS;

describe("resolveTtsProvider", () => {
  it("is null without a Fish key", () => {
    expect(resolveTtsProvider(base)).toBeNull();
  });

  it("builds a fish-audio provider once a key is present", () => {
    const provider = resolveTtsProvider({ ...base, fishAudioApiKey: "sk-fish" });
    expect(provider?.id).toBe("fish-audio");
  });
});

describe("isTtsReady", () => {
  it("requires enabled + key + selected voice", () => {
    expect(isTtsReady(base)).toBe(false);
    expect(isTtsReady({ ...base, fishAudioApiKey: "k" })).toBe(false);
    expect(isTtsReady({ ...base, ttsEnabled: true, fishAudioApiKey: "k" })).toBe(false);
    expect(isTtsReady({ ...base, ttsEnabled: true, fishAudioApiKey: "k", ttsVoiceId: "v" })).toBe(
      true,
    );
  });
});
