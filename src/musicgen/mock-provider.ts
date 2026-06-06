import type { MusicGenProvider, MusicGenRequest, MusicGenResult } from "./provider";
import { encodeWav, synthTone } from "./wav";

/**
 * Local synthesized provider. Renders a short deterministic tone from the brief
 * so the full DJ → generate → enqueue → play loop works with zero setup, and so
 * tests can run without a model or network. Not music — a stand-in.
 */
export function createMockMusicGenProvider(opts?: {
  latencyMs?: number;
  seconds?: number;
}): MusicGenProvider {
  const latencyMs = opts?.latencyMs ?? 0;
  const seconds = opts?.seconds ?? 2;

  return {
    id: "mock",
    label: "Mock synth (offline)",
    requiresConfig: false,

    async generate({ brief, signal, onProgress }: MusicGenRequest): Promise<MusicGenResult> {
      if (latencyMs > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, latencyMs);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      onProgress?.(1);
      const seed = `${brief.title}|${brief.caption}|${brief.bpm ?? ""}`;
      const clip = synthTone(seed, seconds);
      const bytes = encodeWav(clip);
      const blob = new Blob([bytes as BlobPart], { type: "audio/wav" });
      return {
        blob,
        mime: "audio/wav",
        durationSec: clip.samples.length / clip.sampleRate,
        provider: "mock",
      };
    },

    async health() {
      return true;
    },
  };
}
