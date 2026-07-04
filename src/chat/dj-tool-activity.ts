/**
 * Pure collector that turns the DJ chat runtime's tool-call parts into
 * one-per-step "activity notices" (icon + tool name + the key input param) for
 * mirroring into the top-left notification stack — the same title + executed
 * content the dock activity card shows above the composer.
 *
 * De-dup is caller-owned via a `seen` set of tool-call ids: each call fires a
 * notice exactly once (when its input first lands), never again on later snapshot
 * churn. `dj_say` is excluded — it has its own reply surface (notification + TTS).
 */

import { getToolName, isToolUIPart } from "ai";
import { summarizeToolInput, toolIconName } from "./dj-tool-display";
import type { DjChatUIMessage } from "./types";

export interface ToolActivityNotice {
  /** Stable de-dup key: the tool-call id. */
  key: string;
  toolName: string;
  /** Lucide icon key (see `dj-tool-display`), for the notification/dock icon. */
  iconKey: string;
  /** The tool's key input param (search query / set name / generated title…). */
  detail?: string;
}

/**
 * Return one notice per tool call in `messages` that has its input available and
 * isn't in `seen` yet, adding each emitted key to `seen` (mutates it). Pass a
 * bounded window (e.g. the last message or two) on hot updates; pass the full
 * history once to seed `seen` without replaying it.
 */
export function collectToolActivityNotices(
  messages: readonly DjChatUIMessage[],
  seen: Set<string>,
): ToolActivityNotice[] {
  const notices: ToolActivityNotice[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      const toolName = getToolName(part);
      if (toolName === "dj_say") continue;
      const id = part.toolCallId;
      if (!id || seen.has(id)) continue;
      // Only once the call has its input — that's the "executed content".
      const input = (part as { input?: unknown }).input;
      if (input === undefined) continue;
      seen.add(id);
      notices.push({
        key: id,
        toolName,
        iconKey: toolIconName(toolName),
        detail: summarizeToolInput(toolName, input),
      });
    }
  }
  return notices;
}
