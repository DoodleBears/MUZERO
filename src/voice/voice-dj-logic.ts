/**
 * Pure decision logic for the voice-DJ wiring (`use-voice-dj`). Kept React-free
 * and dependency-light so transcript routing, reply delivery, and the paid-action
 * approval decision are exhaustively unit-testable (voice-DJ PRD Phase 3).
 */

import type { DjReplyEvent } from "@/chat/dj-reply-bus";
import type { DjChatRuntimeStatus } from "@/chat/types";

/** A turn is mid-flight for these statuses — a new utterance interrupts it. */
const BUSY_STATUSES: ReadonlySet<DjChatRuntimeStatus> = new Set(["submitted", "streaming"]);

export interface VoiceRuntime {
  getStatus(): DjChatRuntimeStatus;
  sendMessage(text: string): Promise<void>;
  interruptWithMessage(text: string): Promise<void>;
}

/**
 * Feed a transcript to the active DJ runtime: interrupt the current turn if one
 * is streaming, otherwise send it as the next message (voice-DJ PRD §6).
 */
export async function routeVoiceTranscript(runtime: VoiceRuntime, text: string): Promise<void> {
  const clean = text.trim();
  if (!clean) return;
  if (BUSY_STATUSES.has(runtime.getStatus())) {
    await runtime.interruptWithMessage(clean);
  } else {
    await runtime.sendMessage(clean);
  }
}

export interface ReplyDelivery {
  notifyReply: (text: string) => void;
  speak: (text: string) => void;
  autoSpeak: boolean;
  ttsReady: boolean;
}

/**
 * Guard the reply against a model that occasionally emits the `dj_say`
 * `AgentWriteResult` JSON (or another JSON blob) as text instead of a clean line
 * — otherwise the raw JSON would show in the notification AND be read aloud. Plain
 * text passes through; a recognized dj_say result is unwrapped to `diff.text` / a
 * top-level `text`; any other JSON object is dropped (better silent than garbage).
 */
export function sanitizeReplyText(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  if (text[0] !== "{" && text[0] !== "[") return text; // plain prose
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text; // starts with a brace but isn't JSON — treat as prose
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as { text?: unknown; diff?: { text?: unknown } };
    const diffText = obj.diff?.text;
    if (typeof diffText === "string" && diffText.trim()) return diffText.trim();
    if (typeof obj.text === "string" && obj.text.trim()) return obj.text.trim();
  }
  return ""; // unrecognized JSON — don't surface raw JSON to the listener
}

/** Post a DJ reply to the notification stack and speak it when configured + ready. */
export function deliverDjReply(event: DjReplyEvent, deps: ReplyDelivery): void {
  const text = sanitizeReplyText(event.text);
  if (!text) return;
  deps.notifyReply(text);
  if (deps.autoSpeak && deps.ttsReady) deps.speak(text);
}

export type ApprovalDecision =
  | { kind: "auto-approve"; ids: string[] }
  | { kind: "prompt"; ids: string[] }
  | { kind: "none" };

/**
 * How to handle pending paid-generation approvals in a hands-free voice turn:
 * prompt with Approve/Deny by default (PRD Q5), or auto-approve when the user has
 * explicitly opted in via `voiceAutoApproveGenerate`.
 */
export function decideApproval(pendingIds: string[], autoApprove: boolean): ApprovalDecision {
  if (pendingIds.length === 0) return { kind: "none" };
  return autoApprove
    ? { kind: "auto-approve", ids: pendingIds }
    : { kind: "prompt", ids: pendingIds };
}
