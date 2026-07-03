import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDjChatTools, executeDjSay } from "./dj-chat-tools";
import { type DjReplyEvent, emitDjReply, onDjReply, resetDjReplyDedup } from "./dj-reply-bus";

describe("dj-reply-bus", () => {
  beforeEach(() => resetDjReplyDedup());

  it("delivers events to all subscribers and unsubscribes cleanly", () => {
    const seen: DjReplyEvent[] = [];
    const off = onDjReply((e) => seen.push(e));
    emitDjReply({ text: "hi" });
    off();
    emitDjReply({ text: "after" });
    expect(seen).toEqual([{ text: "hi" }]);
  });

  it("drops a back-to-back duplicate reply but not a later repeat", () => {
    const seen: string[] = [];
    const off = onDjReply((e) => seen.push(e.text));
    emitDjReply({ text: "switching to jazz" });
    emitDjReply({ text: "switching to jazz" }); // consecutive dup → dropped
    emitDjReply({ text: "now playing" });
    emitDjReply({ text: "switching to jazz" }); // not consecutive → delivered
    off();
    expect(seen).toEqual(["switching to jazz", "now playing", "switching to jazz"]);
  });

  it("isolates a throwing subscriber from the others", () => {
    const good = vi.fn();
    const offBad = onDjReply(() => {
      throw new Error("boom");
    });
    const offGood = onDjReply(good);
    expect(() => emitDjReply({ text: "x" })).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
    offBad();
    offGood();
  });
});

describe("executeDjSay", () => {
  it("normalizes a legacy single text into one part and emits plain text", () => {
    const emit = vi.fn();
    const result = executeDjSay({ text: "  Switching to lofi.  ", tone: "chill" }, { emit });
    expect(emit).toHaveBeenCalledWith({
      text: "Switching to lofi.",
      parts: [{ text: "Switching to lofi.", emotion: undefined }],
      tone: "chill",
    });
    expect(result).toMatchObject({
      status: "ok",
      commandId: "muzero.dj.say",
      diff: { text: "Switching to lofi." },
    });
  });

  it("carries a multi-part say array with per-part emotions; text is the plain join", () => {
    const emit = vi.fn();
    const result = executeDjSay(
      {
        say: [
          { text: "Great pick!", emotion: "happy" },
          { text: "Cueing it up now.", emotion: "gentle" },
        ],
      },
      { emit },
    );
    expect(emit).toHaveBeenCalledWith({
      text: "Great pick! Cueing it up now.",
      parts: [
        { text: "Great pick!", emotion: "happy" },
        { text: "Cueing it up now.", emotion: "gentle" },
      ],
      tone: undefined,
    });
    expect(result.diff).toEqual({ text: "Great pick! Cueing it up now." });
  });

  it("falls back to the module bus when no sink is injected", () => {
    const seen: DjReplyEvent[] = [];
    const off = onDjReply((e) => seen.push(e));
    executeDjSay({ text: "default sink" });
    off();
    expect(seen).toEqual([
      {
        text: "default sink",
        parts: [{ text: "default sink", emotion: undefined }],
        tone: undefined,
      },
    ]);
  });
});

describe("createDjChatTools dj_say", () => {
  it("always registers dj_say and it posts a say array to the injected emitReply sink", async () => {
    const emitReply = vi.fn();
    const tools = createDjChatTools({ emitReply });
    expect(tools.dj_say).toBeDefined();
    const result = await tools.dj_say?.execute?.(
      { say: [{ text: "On it — queuing something upbeat.", emotion: "excited" }] },
      { toolCallId: "t1", messages: [] },
    );
    expect(emitReply).toHaveBeenCalledWith({
      text: "On it — queuing something upbeat.",
      parts: [{ text: "On it — queuing something upbeat.", emotion: "excited" }],
      tone: undefined,
    });
    expect(result).toMatchObject({ commandId: "muzero.dj.say" });
  });
});
