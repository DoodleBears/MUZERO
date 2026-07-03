import { describe, expect, it, vi } from "vitest";
import { createDjChatTools, executeDjSay } from "./dj-chat-tools";
import { type DjReplyEvent, emitDjReply, onDjReply } from "./dj-reply-bus";

describe("dj-reply-bus", () => {
  it("delivers events to all subscribers and unsubscribes cleanly", () => {
    const seen: DjReplyEvent[] = [];
    const off = onDjReply((e) => seen.push(e));
    emitDjReply({ text: "hi" });
    off();
    emitDjReply({ text: "after" });
    expect(seen).toEqual([{ text: "hi" }]);
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
  it("emits the trimmed reply to the injected sink and returns an AgentWriteResult", () => {
    const emit = vi.fn();
    const result = executeDjSay({ text: "  Switching to lofi.  ", tone: "chill" }, { emit });
    expect(emit).toHaveBeenCalledWith({ text: "Switching to lofi.", tone: "chill" });
    expect(result).toMatchObject({
      status: "ok",
      commandId: "muzero.dj.say",
      diff: { text: "Switching to lofi." },
    });
  });

  it("falls back to the module bus when no sink is injected", () => {
    const seen: DjReplyEvent[] = [];
    const off = onDjReply((e) => seen.push(e));
    executeDjSay({ text: "default sink" });
    off();
    expect(seen).toEqual([{ text: "default sink", tone: undefined }]);
  });
});

describe("createDjChatTools dj_say", () => {
  it("always registers dj_say and it posts to the injected emitReply sink", async () => {
    const emitReply = vi.fn();
    const tools = createDjChatTools({ emitReply });
    expect(tools.dj_say).toBeDefined();
    const result = await tools.dj_say?.execute?.(
      { text: "On it — queuing something upbeat." },
      { toolCallId: "t1", messages: [] },
    );
    expect(emitReply).toHaveBeenCalledWith({
      text: "On it — queuing something upbeat.",
      tone: undefined,
    });
    expect(result).toMatchObject({ commandId: "muzero.dj.say" });
  });
});
