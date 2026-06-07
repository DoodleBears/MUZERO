import type { ChatSession, DjChatMessageMetadata, DjChatUIMessage } from "@/db/types";

export type { ChatSession, DjChatMessageMetadata, DjChatUIMessage };

export type DjChatRuntimeStatus =
  | "idle"
  | "submitted"
  | "streaming"
  | "awaiting-approval"
  | "error"
  | "stopped";

export interface DjChatRuntimeMeta {
  sessionId: string;
  status: DjChatRuntimeStatus;
  messageCount: number;
  lastAssistantPreview?: string;
  pendingApprovalCount: number;
  errorMessage?: string;
}

export interface DjChatRuntimeSnapshot {
  messages: DjChatUIMessage[];
  meta: DjChatRuntimeMeta;
}
