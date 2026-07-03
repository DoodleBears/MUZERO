import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AsrResult } from "@/asr/provider";
import {
  createVoiceInputController,
  type MediaRecorderLike,
  type MediaStreamLike,
  pickSupportedMimeType,
  type VoiceInputState,
} from "./voice-input-controller";

/** A controllable fake MediaRecorder: `stop()` emits one data chunk then onstop. */
function fakeRecorder(chunkBytes: number, mimeType = "audio/webm"): MediaRecorderLike {
  const rec: MediaRecorderLike & { emit: () => void } = {
    state: "inactive",
    mimeType,
    ondataavailable: null,
    onstop: null,
    onerror: null,
    start() {
      (rec as { state: string }).state = "recording";
    },
    stop() {
      (rec as { state: string }).state = "inactive";
      rec.ondataavailable?.({ data: new Blob([new Uint8Array(chunkBytes)], { type: mimeType }) });
      rec.onstop?.();
    },
    emit() {},
  };
  return rec;
}

function fakeStream(): MediaStreamLike & { stopped: boolean } {
  const stream = {
    stopped: false,
    getTracks: () => [{ stop: () => (stream.stopped = true) }],
  };
  return stream;
}

interface Harness {
  transcribe: ReturnType<typeof vi.fn>;
  states: VoiceInputState[];
  transcripts: string[];
  errors: unknown[];
  stream: ReturnType<typeof fakeStream>;
  blurHandlers: Array<() => void>;
  controller: ReturnType<typeof createVoiceInputController>;
}

function makeHarness(
  opts: {
    chunkBytes?: number;
    transcribeResult?: AsrResult | (() => Promise<AsrResult>);
    getMediaError?: unknown;
  } = {},
): Harness {
  const chunkBytes = opts.chunkBytes ?? 4000;
  const stream = fakeStream();
  const states: VoiceInputState[] = [];
  const transcripts: string[] = [];
  const errors: unknown[] = [];
  const blurHandlers: Array<() => void> = [];
  const transcribe = vi.fn(async () => {
    if (typeof opts.transcribeResult === "function") return opts.transcribeResult();
    return opts.transcribeResult ?? { text: "放点更 chill 的" };
  });

  const controller = createVoiceInputController({
    getMedia: async () => {
      if (opts.getMediaError) throw opts.getMediaError;
      return stream;
    },
    createRecorder: () => fakeRecorder(chunkBytes),
    pickMimeType: () => "audio/webm",
    transcribe,
    onBlur: (handler) => {
      blurHandlers.push(handler);
      return () => {};
    },
    callbacks: {
      onStateChange: (s) => states.push(s),
      onTranscript: (text) => transcripts.push(text),
      onError: (e) => errors.push(e),
    },
  });

  return { transcribe, states, transcripts, errors, stream, blurHandlers, controller };
}

describe("pickSupportedMimeType", () => {
  it("picks the first supported preferred type", () => {
    const isSupported = (m: string) => m === "audio/ogg;codecs=opus" || m === "audio/ogg";
    expect(pickSupportedMimeType(isSupported)).toBe("audio/ogg;codecs=opus");
  });

  it("returns '' (let the browser choose) when none are supported", () => {
    expect(pickSupportedMimeType(() => false)).toBe("");
  });
});

describe("VoiceInputController", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("start → stop records, transcribes, and emits the transcript", async () => {
    await h.controller.start();
    expect(h.controller.getState()).toBe("recording");

    const result = await h.controller.stop();

    expect(result?.text).toBe("放点更 chill 的");
    expect(h.transcribe).toHaveBeenCalledTimes(1);
    expect(h.transcripts).toEqual(["放点更 chill 的"]);
    expect(h.controller.getState()).toBe("idle");
    expect(h.stream.stopped).toBe(true);
    // state transitions: recording → transcribing → idle
    expect(h.states).toEqual(["recording", "transcribing", "idle"]);
  });

  it("toggle flips idle→recording→idle", async () => {
    await h.controller.toggle();
    expect(h.controller.getState()).toBe("recording");
    await h.controller.toggle();
    expect(h.controller.getState()).toBe("idle");
    expect(h.transcripts).toHaveLength(1);
  });

  it("drops recordings that are too short to transcribe", async () => {
    h = makeHarness({ chunkBytes: 200 });
    await h.controller.start();
    const result = await h.controller.stop();
    expect(result).toBeNull();
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(h.transcripts).toHaveLength(0);
    expect(h.controller.getState()).toBe("idle");
  });

  it("cancel stops recording without transcribing", async () => {
    await h.controller.start();
    h.controller.cancel();
    expect(h.controller.getState()).toBe("idle");
    expect(h.stream.stopped).toBe(true);
    // Give any (incorrect) async transcription a chance to run.
    await Promise.resolve();
    expect(h.transcribe).not.toHaveBeenCalled();
  });

  it("cancels the active recording when focus is lost", async () => {
    await h.controller.start();
    expect(h.blurHandlers).toHaveLength(1);
    h.blurHandlers[0]?.();
    expect(h.controller.getState()).toBe("idle");
    expect(h.stream.stopped).toBe(true);
    await Promise.resolve();
    expect(h.transcribe).not.toHaveBeenCalled();
  });

  it("ignores a second start while already recording (debounce)", async () => {
    await h.controller.start();
    await h.controller.start();
    await h.controller.stop();
    expect(h.transcribe).toHaveBeenCalledTimes(1);
  });

  it("surfaces getUserMedia permission errors and stays idle", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    h = makeHarness({ getMediaError: denied });
    await h.controller.start();
    expect(h.errors).toEqual([denied]);
    expect(h.controller.getState()).toBe("idle");
  });

  it("reports transcription failures via onError and returns to idle", async () => {
    h = makeHarness({
      transcribeResult: async () => {
        throw new Error("groq 429");
      },
    });
    await h.controller.start();
    const result = await h.controller.stop();
    expect(result).toBeNull();
    expect(h.errors).toHaveLength(1);
    expect(h.controller.getState()).toBe("idle");
  });

  it("does not emit an empty transcript (silence)", async () => {
    h = makeHarness({ transcribeResult: { text: "   " } });
    await h.controller.start();
    await h.controller.stop();
    expect(h.transcripts).toHaveLength(0);
  });
});
