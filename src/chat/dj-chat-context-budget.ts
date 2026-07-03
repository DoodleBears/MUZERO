import { estimateChatTokens, estimateMessageTokens } from "./dj-chat-tokens";
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

export interface ContextWindowOptions {
  /** Token budget for the recent-history window sent to the model. */
  maxTokens: number;
  /** Manual lower bound (the user's `contextStartIndex`); the window never
   *  reaches before it. The effective start = max(this, budget-derived start). */
  minStartIndex?: number;
}

/**
 * Dynamic sliding context window (voice-DJ PRD §3.4). For hands-free voice chat
 * the conversation grows without a UI to manually compact, so instead of ever
 * "blocking" we auto-keep only the most recent messages that fit `maxTokens`,
 * dropping the oldest WHOLE turns. Invariants:
 *   1) The latest user turn (the current utterance) is always kept, even if it
 *      alone exceeds the budget.
 *   2) The window starts on a `user` message — a clean turn boundary — so a tool
 *      call is never separated from its result (they ride the same assistant
 *      message, and we only slice at message boundaries).
 *   3) Nothing before `minStartIndex` is ever included (manual compaction floor).
 * The system prompt + per-turn now-playing snapshot are assembled separately by
 * the transport and are NOT counted here.
 */
export function selectContextWindow(
  messages: readonly DjChatUIMessage[],
  { maxTokens, minStartIndex = 0 }: ContextWindowOptions,
): DjChatUIMessage[] {
  if (messages.length === 0) return [];
  const floor = Math.max(0, Math.min(minStartIndex, messages.length - 1));
  const latestUser = Math.max(floor, findLatestUserMessageIndex(messages));

  // The current turn (latest user message + any responses after it) is always in.
  let total = 0;
  for (let i = latestUser; i < messages.length; i++) {
    total += estimateMessageTokens(messages[i]);
  }
  // Extend backward while there's budget, stopping before a turn that overflows.
  let start = latestUser;
  for (let i = latestUser - 1; i >= floor; i--) {
    const cost = estimateMessageTokens(messages[i]);
    if (total + cost > maxTokens) break;
    total += cost;
    start = i;
  }
  // Snap forward to the nearest user message so the window opens on a turn.
  while (start < latestUser && messages[start].role !== "user") start++;
  return messages.slice(Math.max(start, floor));
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
