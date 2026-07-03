import { describe, expect, it, vi } from "vitest";
import type { TtsResult } from "@/tts/provider";
import { createTtsPlayback, type TtsPlaybackDeps } from "./tts-playback";

function makeBlob(tag: string): TtsResult {
  return { blob: new Blob([tag], { type: "audio/mpeg" }), mime: "audio/mpeg" };
}

/** Build a playback harness whose sink/ducker/synth record an ordered event log. */
function harness(overrides: Partial<TtsPlaybackDeps> = {}) {
  const events: string[] = [];
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;

  const deps: TtsPlaybackDeps = {
    synthesize: vi.fn(async (text: string) => {
      events.push(`synth:${text}`);
      return makeBlob(text);
    }),
    sink: {
      play: vi.fn(async (url: string) => {
        events.push(`play:${url}`);
      }),
      stop: vi.fn(() => events.push("sink-stop")),
    },
    ducker: {
      duck: vi.fn((v: number) => events.push(`duck:${v}`)),
      restore: vi.fn(() => events.push("restore")),
    },
    getConfig: () => ({ duckEnabled: true, duckVolume: 0.25 }),
    createObjectUrl: (_blob) => {
      const url = `blob:${seq++}`;
      created.push(url);
      return url;
    },
    revokeObjectUrl: (url) => revoked.push(url),
    ...overrides,
  };

  return { playback: createTtsPlayback(deps), events, created, revoked, deps };
}

/** Flush the serial queue's microtasks. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("createTtsPlayback", () => {
  it("serializes replies: synth→play in order, no overlap", async () => {
    const h = harness();
    h.playback.speak("a");
    h.playback.speak("b");
    await flush();
    expect(h.events).toEqual([
      "duck:0.25",
      "synth:a",
      "play:blob:0",
      "synth:b",
      "play:blob:1",
      "restore",
    ]);
  });

  it("ducks once at the start of a batch and restores when it drains", async () => {
    const h = harness();
    h.playback.speak("x");
    await flush();
    expect(h.deps.ducker.duck).toHaveBeenCalledTimes(1);
    expect(h.deps.ducker.restore).toHaveBeenCalledTimes(1);
  });

  it("does not duck when ducking is disabled", async () => {
    const h = harness({ getConfig: () => ({ duckEnabled: false, duckVolume: 0.25 }) });
    h.playback.speak("x");
    await flush();
    expect(h.deps.ducker.duck).not.toHaveBeenCalled();
    expect(h.deps.ducker.restore).not.toHaveBeenCalled();
    expect(h.events).toEqual(["synth:x", "play:blob:0"]);
  });

  it("revokes every object URL it creates (no leaks)", async () => {
    const h = harness();
    h.playback.speak("a");
    h.playback.speak("b");
    await flush();
    expect(h.revoked.sort()).toEqual(h.created.sort());
  });

  it("degrades on synth failure without throwing and keeps going", async () => {
    const onError = vi.fn();
    let n = 0;
    const h = harness({
      onError,
      synthesize: vi.fn(async (text: string) => {
        if (n++ === 0) throw new Error("synth failed");
        return makeBlob(text);
      }),
    });
    h.playback.speak("bad");
    h.playback.speak("good");
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    // Music is still un-ducked at the end, and the good reply played.
    expect(h.deps.ducker.restore).toHaveBeenCalledTimes(1);
    expect(h.events).toContain("play:blob:0");
  });

  it("stop() clears the queue, stops the sink, and restores the music", async () => {
    const deferred: { resolve: (() => void) | null } = { resolve: null };
    const h = harness({
      sink: {
        play: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              deferred.resolve = resolve;
            }),
        ),
        stop: vi.fn(),
      },
    });
    h.playback.speak("a");
    h.playback.speak("b");
    await flush();
    expect(h.playback.isSpeaking()).toBe(true);
    h.playback.stop();
    deferred.resolve?.();
    await flush();
    expect(h.deps.sink.stop).toHaveBeenCalled();
    expect(h.deps.ducker.restore).toHaveBeenCalled();
    expect(h.playback.isSpeaking()).toBe(false);
  });
});
