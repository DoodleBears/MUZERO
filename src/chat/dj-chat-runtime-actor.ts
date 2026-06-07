import { Chat } from "@ai-sdk/react";
import {
  type ChatStatus,
  type ChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { log } from "@/lib/logger";
import { createDjChatTransport } from "./dj-chat-agent";
import { nextContextStartIndex } from "./dj-chat-context-budget";
import {
  enqueueChatPrompt,
  getChatSession,
  parseChatMessages,
  parseQueuedPrompts,
  removeQueuedPrompt as removeSessionQueuedPrompt,
  reorderQueuedPrompts as reorderSessionQueuedPrompts,
  saveChatSessionSnapshot,
  setChatContextStartIndex,
} from "./dj-chat-sessions";
import type {
  DjChatQueuedPrompt,
  DjChatRuntimeMeta,
  DjChatRuntimeSnapshot,
  DjChatRuntimeStatus,
  DjChatUIMessage,
} from "./types";

const SNAPSHOT_THROTTLE_MS = 1200;

export interface DjChatRuntimeActorOptions {
  db?: MuzeroDB;
  transport?: ChatTransport<DjChatUIMessage>;
}

export class DjChatRuntimeActor {
  readonly ready: Promise<void>;

  private chat: Chat<DjChatUIMessage> | undefined;
  private snapshot: DjChatRuntimeSnapshot;
  private listeners = new Set<() => void>();
  private unsubscribers: Array<() => void> = [];
  private persistTimer: number | undefined;
  private lastPersistSig = "";
  private pendingPersist: Promise<void> | undefined;
  private composerDraftRaw: string | undefined;
  private queuedPrompts: DjChatQueuedPrompt[] = [];
  private contextStartIndex = 0;
  private disposed = false;
  private db: MuzeroDB;
  private transport: ChatTransport<DjChatUIMessage>;

  constructor(
    readonly sessionId: string,
    options: DjChatRuntimeActorOptions = {},
  ) {
    this.db = options.db ?? defaultDb;
    this.transport = options.transport ?? createDjChatTransport({ db: this.db });
    this.snapshot = {
      messages: [],
      meta: emptyMeta(sessionId),
    };
    this.ready = this.initialize();
  }

  getSnapshot(): DjChatRuntimeSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendMessage(text: string): Promise<void> {
    await this.ready;
    const clean = text.trim();
    if (!clean) return;
    this.composerDraftRaw = undefined;
    await this.sendText(clean, { composerRaw: text });
    await this.flush();
  }

  async queuePrompt(text: string): Promise<DjChatQueuedPrompt | undefined> {
    await this.ready;
    const queued = await enqueueChatPrompt(
      { sessionId: this.sessionId, composerRaw: text },
      this.db,
    );
    if (!queued) return undefined;
    this.queuedPrompts = [...this.queuedPrompts, queued];
    this.setSnapshot(
      this.snapshot.messages,
      withRuntimePointers(this.snapshot.meta, {
        queuedPromptCount: this.queuedPrompts.length,
        contextStartIndex: this.contextStartIndex,
      }),
    );
    return queued;
  }

  async sendQueuedPrompt(promptId: string): Promise<boolean> {
    await this.ready;
    if (this.snapshot.meta.pendingApprovalCount > 0) return false;
    const queued = await removeSessionQueuedPrompt(
      { sessionId: this.sessionId, promptId },
      this.db,
    );
    if (!queued) return false;
    this.queuedPrompts = this.queuedPrompts.filter((prompt) => prompt.id !== promptId);
    this.setSnapshot(
      this.snapshot.messages,
      withRuntimePointers(this.snapshot.meta, {
        queuedPromptCount: this.queuedPrompts.length,
        contextStartIndex: this.contextStartIndex,
      }),
    );
    await this.sendMessage(queued.composerRaw);
    return true;
  }

  async reorderQueuedPrompts(promptIds: string[]): Promise<DjChatQueuedPrompt[]> {
    await this.ready;
    this.queuedPrompts = await reorderSessionQueuedPrompts(
      { sessionId: this.sessionId, promptIds },
      this.db,
    );
    this.setSnapshot(
      this.snapshot.messages,
      withRuntimePointers(this.snapshot.meta, {
        queuedPromptCount: this.queuedPrompts.length,
        contextStartIndex: this.contextStartIndex,
      }),
    );
    return this.queuedPrompts;
  }

  async deleteQueuedPrompt(promptId: string): Promise<DjChatQueuedPrompt | undefined> {
    await this.ready;
    const removed = await removeSessionQueuedPrompt(
      { sessionId: this.sessionId, promptId },
      this.db,
    );
    if (!removed) return undefined;
    this.queuedPrompts = this.queuedPrompts.filter((prompt) => prompt.id !== promptId);
    this.setSnapshot(
      this.snapshot.messages,
      withRuntimePointers(this.snapshot.meta, {
        queuedPromptCount: this.queuedPrompts.length,
        contextStartIndex: this.contextStartIndex,
      }),
    );
    return removed;
  }

  async interruptWithMessage(text: string): Promise<void> {
    await this.ready;
    const clean = text.trim();
    if (!clean) return;
    await this.chat?.stop();
    this.composerDraftRaw = undefined;
    await this.sendText(clean, { composerRaw: text, interruptionMarker: true });
    await this.flush();
  }

  async setContextStartIndex(desiredStartIndex: number): Promise<number> {
    await this.ready;
    this.contextStartIndex = nextContextStartIndex(this.snapshot.messages, desiredStartIndex);
    await setChatContextStartIndex(
      { sessionId: this.sessionId, contextStartIndex: this.contextStartIndex },
      this.db,
    );
    this.setSnapshot(
      this.snapshot.messages,
      withRuntimePointers(this.snapshot.meta, {
        queuedPromptCount: this.queuedPrompts.length,
        contextStartIndex: this.contextStartIndex,
      }),
    );
    return this.contextStartIndex;
  }

  async stop(): Promise<void> {
    await this.ready;
    await this.chat?.stop();
    this.setSnapshot(this.snapshot.messages, {
      ...this.snapshot.meta,
      status: "stopped",
    });
    await this.flush();
  }

  async regenerateUserMessage(messageId: string, text: string): Promise<void> {
    await this.ready;
    const clean = text.trim();
    if (!clean || !this.chat) return;
    await this.chat.sendMessage({ text: clean, messageId, metadata: { composerRaw: text } });
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.persistTimer !== undefined) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    await this.persistNow();
  }

  dispose(): void {
    this.disposed = true;
    if (this.persistTimer !== undefined) clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    void this.persistNow().catch((error: Error) => {
      log.warn("chat-runtime", "chat snapshot persist failed", error.name);
    });
  }

  private async initialize(): Promise<void> {
    const session = await getChatSession(this.sessionId, this.db);
    if (!session) throw new Error(`Chat session ${this.sessionId} not found`);
    const messages = parseChatMessages(session.messagesJson);
    this.queuedPrompts = parseQueuedPrompts(session.queuedPromptsJson);
    this.contextStartIndex = nextContextStartIndex(messages, session.contextStartIndex ?? 0);
    this.composerDraftRaw = session.composerDraftRaw;
    this.chat = new Chat<DjChatUIMessage>({
      id: this.sessionId,
      messages,
      transport: this.transport,
      sendAutomaticallyWhen: ({ messages }) =>
        lastAssistantMessageIsCompleteWithApprovalResponses({ messages }) ||
        lastAssistantMessageIsCompleteWithToolCalls({ messages }),
      onError: (error) => {
        log.warn("chat-runtime", "chat stream failed", error.name);
      },
      onFinish: () => {
        void this.flush().catch((error: Error) => {
          log.warn("chat-runtime", "chat snapshot persist failed", error.name);
        });
      },
    });
    this.unsubscribers = [
      this.chat["~registerMessagesCallback"](() => this.handleChatChanged()),
      this.chat["~registerStatusCallback"](() => this.handleChatChanged()),
      this.chat["~registerErrorCallback"](() => this.handleChatChanged()),
    ];
    this.handleChatChanged();
  }

  private handleChatChanged(): void {
    if (!this.chat || this.disposed) return;
    const messages = this.chat.messages;
    const meta = runtimeMeta(
      this.sessionId,
      messages,
      this.chat.status,
      this.chat.error,
      this.queuedPrompts.length,
      this.contextStartIndex,
    );
    this.setSnapshot(messages, meta);
    this.schedulePersist();
  }

  private async sendText(
    text: string,
    metadata: NonNullable<DjChatUIMessage["metadata"]>,
  ): Promise<void> {
    if (!this.chat) return;
    await this.chat.sendMessage({ text, metadata });
  }

  private setSnapshot(messages: DjChatUIMessage[], meta: DjChatRuntimeMeta): void {
    this.snapshot = {
      messages: [...messages],
      meta,
    };
    for (const listener of this.listeners) listener();
  }

  private schedulePersist(): void {
    if (this.persistTimer !== undefined) return;
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = undefined;
      void this.persistNow().catch((error: Error) => {
        log.warn("chat-runtime", "chat snapshot persist failed", error.name);
      });
    }, SNAPSHOT_THROTTLE_MS);
  }

  private async persistNow(): Promise<void> {
    const sig = JSON.stringify({
      messages: this.snapshot.messages,
      draft: this.composerDraftRaw,
      queuedPrompts: this.queuedPrompts,
      contextStartIndex: this.contextStartIndex,
    });
    if (sig === this.lastPersistSig) {
      await this.pendingPersist;
      return;
    }
    this.lastPersistSig = sig;
    const write = saveChatSessionSnapshot(
      {
        sessionId: this.sessionId,
        messages: this.snapshot.messages,
        composerDraftRaw: this.composerDraftRaw,
        queuedPrompts: this.queuedPrompts,
        contextStartIndex: this.contextStartIndex,
      },
      this.db,
    );
    this.pendingPersist = write;
    try {
      await write;
    } finally {
      if (this.pendingPersist === write) this.pendingPersist = undefined;
    }
  }
}

function emptyMeta(sessionId: string): DjChatRuntimeMeta {
  return {
    sessionId,
    status: "idle",
    messageCount: 0,
    pendingApprovalCount: 0,
    queuedPromptCount: 0,
    contextStartIndex: 0,
  };
}

function runtimeMeta(
  sessionId: string,
  messages: DjChatUIMessage[],
  status: ChatStatus,
  error: Error | undefined,
  queuedPromptCount: number,
  contextStartIndex: number,
): DjChatRuntimeMeta {
  const pendingApprovalCount = countPendingApprovals(messages);
  return {
    sessionId,
    status: pendingApprovalCount > 0 ? "awaiting-approval" : mapStatus(status),
    messageCount: messages.length,
    lastAssistantPreview: lastAssistantText(messages),
    pendingApprovalCount,
    queuedPromptCount,
    contextStartIndex,
    errorMessage: error?.message,
  };
}

function withRuntimePointers(
  meta: DjChatRuntimeMeta,
  input: { queuedPromptCount: number; contextStartIndex: number },
): DjChatRuntimeMeta {
  return { ...meta, ...input };
}

function mapStatus(status: ChatStatus): DjChatRuntimeStatus {
  switch (status) {
    case "submitted":
      return "submitted";
    case "streaming":
      return "streaming";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

function lastAssistantText(messages: DjChatUIMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
    if (text) return text;
  }
  return undefined;
}

function countPendingApprovals(messages: DjChatUIMessage[]): number {
  return messages.reduce(
    (count, message) =>
      count +
      message.parts.filter((part) => isToolUIPart(part) && part.state === "approval-requested")
        .length,
    0,
  );
}
