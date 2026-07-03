/**
 * Flatten the tool calls across a chat's messages, in order — a dev/E2E lens on
 * what the DJ actually DID (which tools, with what inputs/outputs), so tool-call
 * design issues (redundant tools, chatty multi-round patterns) can be observed
 * rather than guessed. Pure + unit-testable; surfaced read-only over the dev
 * control endpoint (never in a packaged build).
 */

import { getToolName, isToolUIPart } from "ai";
import type { DjChatUIMessage } from "./types";

export interface ToolCallTrace {
  tool: string;
  /** AI-SDK tool part state, e.g. "input-available" | "output-available". */
  state: string;
  input?: unknown;
  output?: unknown;
}

export function extractToolCalls(messages: readonly DjChatUIMessage[]): ToolCallTrace[] {
  const calls: ToolCallTrace[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      const tp = part as unknown as { state: string; input?: unknown; output?: unknown };
      calls.push({ tool: getToolName(part), state: tp.state, input: tp.input, output: tp.output });
    }
  }
  return calls;
}

/** A compact per-tool count of the trace — the quickest signal for "did it call
 *  X three times?" / "did it use the heavy path?". */
export function summarizeToolCalls(calls: readonly ToolCallTrace[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of calls) counts[call.tool] = (counts[call.tool] ?? 0) + 1;
  return counts;
}
