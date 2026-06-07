import { estimateChatTokens } from "./dj-chat-tokens";
import type { DjChatUIMessage } from "./types";

export interface ChatContextBudget {
  maxTokens: number;
  warnRatio: number;
  blockRatio: number;
}

export const DEFAULT_CHAT_CONTEXT_BUDGET: ChatContextBudget = {
  maxTokens: 128_000,
  warnRatio: 0.75,
  blockRatio: 0.9,
};

export type ChatContextBudgetStatus = "ok" | "warn" | "block";

export interface ChatContextBudgetResult {
  status: ChatContextBudgetStatus;
  estimatedTokens: number;
  maxTokens: number;
  ratio: number;
}

export function evaluateChatContextBudget(
  messages: readonly DjChatUIMessage[],
  budget: ChatContextBudget = DEFAULT_CHAT_CONTEXT_BUDGET,
): ChatContextBudgetResult {
  const estimatedTokens = estimateChatTokens(messages);
  const ratio = budget.maxTokens <= 0 ? 1 : estimatedTokens / budget.maxTokens;
  return {
    status: ratio >= budget.blockRatio ? "block" : ratio >= budget.warnRatio ? "warn" : "ok",
    estimatedTokens,
    maxTokens: budget.maxTokens,
    ratio,
  };
}

export function nextContextStartIndex(
  messages: readonly DjChatUIMessage[],
  desiredStartIndex: number,
): number {
  if (messages.length === 0) return 0;
  const clamped = Math.min(Math.max(0, desiredStartIndex), messages.length - 1);
  const latestUserIndex = findLatestUserMessageIndex(messages);
  return Math.min(clamped, latestUserIndex);
}

function findLatestUserMessageIndex(messages: readonly DjChatUIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return Math.max(0, messages.length - 1);
}
