import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/db/types";
import { createMockMusicGenProvider } from "./mock-provider";
import {
  generatedTrackMemoryNote,
  musicGenProviderPresetKeyFromProvider,
  musicGenProviderPresetKeyFromSettings,
} from "./provenance";

describe("musicgen provenance", () => {
  it("derives a cloud vendor/model key from settings", () => {
    expect(
      musicGenProviderPresetKeyFromSettings({
        ...DEFAULT_SETTINGS,
        musicGenProvider: "cloud",
        musicCloudPreset: "mureka",
        musicCloudModel: "mureka-6",
      }),
    ).toBe("mureka:mureka-6");
  });

  it("keeps mock provenance out of automatic Memory notes", () => {
    const provider = createMockMusicGenProvider();

    expect(musicGenProviderPresetKeyFromProvider(provider)).toBe("mock");
    expect(
      generatedTrackMemoryNote({
        seedPrompt: "rain",
        providerPreset: "mock",
        brief: { title: "Mock", caption: "tone", lyrics: "", durationSec: 30 },
      }),
    ).toBeUndefined();
  });
});
