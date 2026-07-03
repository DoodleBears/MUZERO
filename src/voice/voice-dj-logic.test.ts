import { describe, expect, it, vi } from "vitest";
import type { DjChatRuntimeStatus } from "@/chat/types";
import {
  decideApproval,
  deliverDjReply,
  routeVoiceTranscript,
  type VoiceRuntime,
} from "./voice-dj-logic";

function fakeRuntime(status: DjChatRuntimeStatus) {
  const runtime: VoiceRuntime & {
    sent: string[];
    interrupted: string[];
  } = {
    sent: [],
    interrupted: [],
    getStatus: () => status,
    sendMessage: vi.fn(async (t: string) => {
      runtime.sent.push(t);
    }),
    interruptWithMessage: vi.fn(async (t: string) => {
      runtime.interrupted.push(t);
    }),
  };
  return runtime;
}

describe("routeVoiceTranscript", () => {
  it("sends when idle", async () => {
    const r = fakeRuntime("idle");
    await routeVoiceTranscript(r, "  play something chill  ");
    expect(r.sent).toEqual(["play something chill"]);
    expect(r.interrupted).toEqual([]);
  });

  it("interrupts when a turn is streaming", async () => {
    const r = fakeRuntime("streaming");
    await routeVoiceTranscript(r, "actually, skip that");
    expect(r.interrupted).toEqual(["actually, skip that"]);
    expect(r.sent).toEqual([]);
  });

  it("ignores empty transcripts", async () => {
    const r = fakeRuntime("idle");
    await routeVoiceTranscript(r, "   ");
    expect(r.sent).toEqual([]);
  });
});

describe("deliverDjReply", () => {
  const base = { notifyReply: vi.fn(), speak: vi.fn() };

  it("always notifies and speaks only when auto-speak + TTS are ready", () => {
    const notifyReply = vi.fn();
    const speak = vi.fn();
    deliverDjReply(
      { text: "Switching to lofi." },
      { notifyReply, speak, autoSpeak: true, ttsReady: true },
    );
    expect(notifyReply).toHaveBeenCalledWith("Switching to lofi.");
    expect(speak).toHaveBeenCalledWith("Switching to lofi.");
  });

  it("notifies but does not speak when auto-speak is off", () => {
    const notifyReply = vi.fn();
    const speak = vi.fn();
    deliverDjReply({ text: "Done." }, { notifyReply, speak, autoSpeak: false, ttsReady: true });
    expect(notifyReply).toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("does not speak when TTS isn't ready even if auto-speak is on", () => {
    const speak = vi.fn();
    deliverDjReply(
      { text: "Done." },
      { notifyReply: base.notifyReply, speak, autoSpeak: true, ttsReady: false },
    );
    expect(speak).not.toHaveBeenCalled();
  });

  it("skips blank replies", () => {
    const notifyReply = vi.fn();
    deliverDjReply(
      { text: "  " },
      { notifyReply, speak: vi.fn(), autoSpeak: true, ttsReady: true },
    );
    expect(notifyReply).not.toHaveBeenCalled();
  });
});

describe("decideApproval", () => {
  it("prompts by default", () => {
    expect(decideApproval(["a1"], false)).toEqual({ kind: "prompt", ids: ["a1"] });
  });
  it("auto-approves when the user opted in", () => {
    expect(decideApproval(["a1", "a2"], true)).toEqual({ kind: "auto-approve", ids: ["a1", "a2"] });
  });
  it("is a no-op with no pending approvals", () => {
    expect(decideApproval([], false)).toEqual({ kind: "none" });
    expect(decideApproval([], true)).toEqual({ kind: "none" });
  });
});
