import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_CONTEXT_BUDGET,
  evaluateChatContextBudget,
  nextContextStartIndex,
} from "./dj-chat-context-budget";
import { estimateChatTokens, estimateTextTokens } from "./dj-chat-tokens";
import type { DjChatUIMessage } from "./types";

const msg = (id: string, role: "user" | "assistant", text: string): DjChatUIMessage => ({
  id,
  role,
  parts: [{ type: "text", text }],
});

describe("DJ chat token estimates", () => {
  it("uses a conservative character-based estimate with per-message overhead", () => {
    expect(estimateTextTokens("abcd")).toBe(1);
    expect(estimateChatTokens([msg("u1", "user", "abcdefgh")])).toBeGreaterThan(2);
  });
});

describe("DJ chat context budget", () => {
  it("reports ok/warn/block thresholds without silently truncating", () => {
    const small = [msg("u1", "user", "short")];
    expect(evaluateChatContextBudget(small, DEFAULT_CHAT_CONTEXT_BUDGET).status).toBe("ok");

    const near = [msg("u1", "user", "x".repeat(320))];
    expect(
      evaluateChatContextBudget(near, { maxTokens: 100, warnRatio: 0.75, blockRatio: 0.9 }).status,
    ).toBe("warn");

    const huge = [msg("u1", "user", "x".repeat(380))];
    expect(
      evaluateChatContextBudget(huge, { maxTokens: 100, warnRatio: 0.75, blockRatio: 0.9 }).status,
    ).toBe("block");
  });

  it("keeps the latest user turn when advancing a compression pointer", () => {
    const messages = [
      msg("u1", "user", "old"),
      msg("a1", "assistant", "old reply"),
      msg("u2", "user", "middle"),
      msg("a2", "assistant", "middle reply"),
      msg("u3", "user", "latest"),
    ];

    expect(nextContextStartIndex(messages, 2)).toBe(2);
    expect(nextContextStartIndex(messages, 99)).toBe(4);
  });
});
