import { describe, expect, it } from "vitest";
import type { TrackBrief } from "@/dj/dj-brief-schema";
import { toAceStepPayload } from "./acestep-local";
import { createMockMusicGenProvider } from "./mock-provider";
import { encodeWav, synthTone } from "./wav";

describe("encodeWav", () => {
  it("writes a valid 16-bit mono RIFF/WAVE header", () => {
    const bytes = encodeWav({ sampleRate: 8000, samples: new Float32Array([0, 0.5, -0.5, 1]) });
    const view = new DataView(bytes.buffer);
    const str = (o: number, n: number) =>
      Array.from({ length: n }, (_, i) => String.fromCharCode(view.getUint8(o + i))).join("");
    expect(str(0, 4)).toBe("RIFF");
    expect(str(8, 4)).toBe("WAVE");
    expect(str(36, 4)).toBe("data");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(bytes.length).toBe(44 + 4 * 2);
  });
});

describe("synthTone", () => {
  it("is deterministic for a given seed", () => {
    const a = synthTone("lofi-A", 0.1);
    const b = synthTone("lofi-A", 0.1);
    expect(Array.from(a.samples)).toEqual(Array.from(b.samples));
  });
  it("differs across seeds and stays within [-1, 1]", () => {
    const a = synthTone("seed-one", 0.1);
    const c = synthTone("seed-two", 0.1);
    expect(Array.from(a.samples)).not.toEqual(Array.from(c.samples));
    for (const s of a.samples) expect(Math.abs(s)).toBeLessThanOrEqual(1);
  });
});

describe("toAceStepPayload", () => {
  it("maps a brief onto ACE-Step's request shape", () => {
    const brief: TrackBrief = {
      title: "Neon Rain",
      caption: "lofi hip hop, mellow piano",
      lyrics: "[verse]\nNeon rain",
      durationSec: 45,
      bpm: 82,
      keyscale: "A minor",
      timeSignature: "4",
      vocalLanguage: "en",
    };
    const payload = toAceStepPayload(brief, { baseUrl: "http://localhost:8085" });
    expect(payload).toMatchObject({
      caption: "lofi hip hop, mellow piano",
      duration: 45,
      bpm: 82,
      keyscale: "A minor",
      timesignature: "4",
      vocal_language: "en",
      inference_steps: 8,
    });
  });
  it("falls back to [instrumental] when lyrics are empty", () => {
    const brief: TrackBrief = { title: "Drift", caption: "ambient", lyrics: "", durationSec: 60 };
    const payload = toAceStepPayload(brief, { baseUrl: "http://x" });
    expect(payload.lyrics).toBe("[instrumental]");
  });
});

describe("mock provider", () => {
  it("renders a real audio/wav Blob with content", async () => {
    const provider = createMockMusicGenProvider();
    const result = await provider.generate({
      brief: { title: "Test", caption: "lofi", lyrics: "[instrumental]", durationSec: 30 },
    });
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.mime).toBe("audio/wav");
    expect(result.blob.size).toBeGreaterThan(44);
    expect(result.durationSec).toBeGreaterThan(0);
    expect(result.provider).toBe("mock");
  });
});
