import type { DjChatUIMessage } from "./types";

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateTextTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / CHARS_PER_TOKEN));
}

export function messageText(message: DjChatUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function estimateMessageTokens(message: DjChatUIMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(messageText(message));
}

export function estimateChatTokens(messages: readonly DjChatUIMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}
