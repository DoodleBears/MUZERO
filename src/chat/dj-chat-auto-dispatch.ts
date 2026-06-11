import type { DjChatRuntimeStatus } from "@/chat/types";

/**
 * Whether the runtime should automatically dispatch the head of the queued
 * prompts (PRD §5.8 auto-dispatch). Pure so the ChatPanel driver stays a thin
 * effect. Gated on: the user's auto switch is on, the current turn has finished
 * (idle — not submitted/streaming/error), the queue is non-empty, and no tool
 * approval is pending (the paid-action cost gate outranks auto-dispatch).
 */
export function shouldAutoDispatchQueued(params: {
  enabled: boolean;
  status: DjChatRuntimeStatus | undefined;
  queueLength: number;
  pendingApprovalCount: number;
}): boolean {
  return (
    params.enabled &&
    params.status === "idle" &&
    params.queueLength > 0 &&
    params.pendingApprovalCount === 0
  );
}
