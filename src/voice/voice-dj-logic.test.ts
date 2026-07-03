import { describe, expect, it, vi } from "vitest";
import type { DjChatRuntimeStatus } from "@/chat/types";
import {
  decideApproval,
  deliverDjReply,
  routeVoiceTranscript,
  sanitizeReplyText,
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

  it("unwraps a dj_say AgentWriteResult JSON the model emitted as text (notify + speak)", () => {
    const notifyReply = vi.fn();
    const speak = vi.fn();
    const json =
      '{"status":"ok","commandId":"muzero.dj.say","summary":"Replied to the listener.","diff":{"text":"好的，爵士乐已经开始播放，祝你工作顺利！"},"warnings":[]}';
    deliverDjReply({ text: json }, { notifyReply, speak, autoSpeak: true, ttsReady: true });
    expect(notifyReply).toHaveBeenCalledWith("好的，爵士乐已经开始播放，祝你工作顺利！");
    expect(speak).toHaveBeenCalledWith("好的，爵士乐已经开始播放，祝你工作顺利！");
  });

  it("drops an unrecognized JSON blob rather than showing/speaking raw JSON", () => {
    const notifyReply = vi.fn();
    const speak = vi.fn();
    deliverDjReply(
      { text: '{"foo":123,"bar":"baz"}' },
      { notifyReply, speak, autoSpeak: true, ttsReady: true },
    );
    expect(notifyReply).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });
});

describe("sanitizeReplyText", () => {
  it("passes plain prose through untouched", () => {
    expect(sanitizeReplyText("  好的，切到 lofi。 ")).toBe("好的，切到 lofi。");
  });

  it("unwraps a dj_say result JSON to diff.text", () => {
    expect(
      sanitizeReplyText('{"commandId":"muzero.dj.say","diff":{"text":"Switching to jazz."}}'),
    ).toBe("Switching to jazz.");
  });

  it("unwraps a top-level text field", () => {
    expect(sanitizeReplyText('{"text":"Playing something chill."}')).toBe(
      "Playing something chill.",
    );
  });

  it("drops unrecognized JSON objects/arrays", () => {
    expect(sanitizeReplyText('{"status":"ok","warnings":[]}')).toBe("");
    expect(sanitizeReplyText("[1,2,3]")).toBe("");
  });

  it("treats a brace-leading non-JSON string as prose", () => {
    expect(sanitizeReplyText("{not json} but a vibe")).toBe("{not json} but a vibe");
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
