import { describe, expect, it } from "vitest";
import { selectContextWindow } from "./dj-chat-context-budget";
import type { DjChatUIMessage } from "./types";

let idSeq = 0;
function msg(role: "user" | "assistant", chars: number): DjChatUIMessage {
  return {
    id: `m${idSeq++}`,
    role,
    parts: [{ type: "text", text: "x".repeat(chars) }],
  } as DjChatUIMessage;
}

/** A turn ≈ user(400 chars ≈ 104 tok) + assistant(400 chars ≈ 104 tok) ≈ 208 tok. */
function turns(n: number): DjChatUIMessage[] {
  const out: DjChatUIMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push(msg("user", 400), msg("assistant", 400));
  }
  return out;
}

describe("selectContextWindow", () => {
  it("returns everything when it fits the budget", () => {
    const messages = turns(3);
    expect(selectContextWindow(messages, { maxTokens: 100_000 })).toEqual(messages);
  });

  it("returns [] for an empty conversation", () => {
    expect(selectContextWindow([], { maxTokens: 1000 })).toEqual([]);
  });

  it("drops the oldest turns to fit the budget and starts on a user turn", () => {
    const messages = turns(10); // ~2080 tokens
    const windowed = selectContextWindow(messages, { maxTokens: 500 });
    expect(windowed.length).toBeLessThan(messages.length);
    // Always starts at a user message (clean turn boundary; no orphan tool result).
    expect(windowed[0]?.role).toBe("user");
    // Keeps the most recent messages.
    expect(windowed.at(-1)).toBe(messages.at(-1));
  });

  it("always includes the latest user turn even if it alone exceeds the budget", () => {
    const messages = [...turns(2), msg("user", 8000)]; // last user ≈ 2004 tokens
    const windowed = selectContextWindow(messages, { maxTokens: 100 });
    expect(windowed.at(-1)).toBe(messages.at(-1));
    expect(windowed[0]?.role).toBe("user");
  });

  it("never returns messages before the manual floor (contextStartIndex)", () => {
    const messages = turns(5);
    const windowed = selectContextWindow(messages, { maxTokens: 100_000, minStartIndex: 6 });
    expect(windowed).toEqual(messages.slice(6));
  });

  it("takes the tighter of the budget window and the manual floor", () => {
    const messages = turns(10);
    // Budget would keep more than the floor allows → floor wins as the lower bound.
    const windowed = selectContextWindow(messages, { maxTokens: 100_000, minStartIndex: 14 });
    expect(windowed).toEqual(messages.slice(14));
    expect(windowed[0]?.role).toBe("user");
  });
});
