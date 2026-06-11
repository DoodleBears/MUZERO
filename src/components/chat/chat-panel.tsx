import { useEffect, useRef, useState } from "react";
import { shouldAutoDispatchQueued } from "@/chat/dj-chat-auto-dispatch";
import { evaluateChatContextBudget } from "@/chat/dj-chat-context-budget";
import { pendingApprovalIds } from "@/chat/dj-chat-runtime-actor";
import {
  getOrCreateDjChatRuntimeActor,
  useDjChatRuntimeSnapshot,
} from "@/chat/dj-chat-runtime-registry";
import type { MuzeroDB } from "@/db/muzero-db";
import { useChatStore } from "@/stores/chat-store";
import { ChatComposer } from "./chat-composer";
import {
  ChatContextBudgetNotice,
  type ChatContextBudgetNoticeLabels,
} from "./chat-context-budget-notice";
import {
  ChatEmptyState,
  type ChatEmptyStateLabels,
  type ChatPromptPreset,
} from "./chat-empty-state";
import { ChatQueueTray, type ChatQueueTrayLabels } from "./chat-queue-tray";
import type { ChatToolLabels } from "./chat-tool-collapsible";
import { ChatTurns } from "./chat-turns";

interface ChatPanelProps {
  /** No-approval mode (PRD §4.3 "auto"): pending approvals are accepted automatically. */
  autoApprove?: boolean;
  autoDispatchEnabled?: boolean;
  sessionId: string;
  db?: MuzeroDB;
  onAutoDispatchChange?: (enabled: boolean) => void;
  /** Onboarding empty state (shown until the session has its first message). */
  emptyState?: { labels: ChatEmptyStateLabels; presets: ChatPromptPreset[] };
  onUploadLibrary?: () => void;
  /** Context-budget notice (warn/block). Block disables the composer until compress. */
  budgetLabels?: ChatContextBudgetNoticeLabels;
  queueLabels?: ChatQueueTrayLabels;
  toolLabels?: ChatToolLabels;
}

export function ChatPanel({
  autoApprove = false,
  autoDispatchEnabled = false,
  sessionId,
  db,
  onAutoDispatchChange,
  emptyState,
  onUploadLibrary,
  budgetLabels,
  queueLabels,
  toolLabels,
}: ChatPanelProps) {
  const snapshot = useDjChatRuntimeSnapshot(sessionId, db);
  const [draft, setDraft] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const setRuntimeMeta = useChatStore((state) => state.setRuntimeMeta);

  useEffect(() => {
    if (snapshot?.meta) setRuntimeMeta(snapshot.meta);
  }, [setRuntimeMeta, snapshot?.meta]);

  const actor = getOrCreateDjChatRuntimeActor(sessionId, db ? { db } : {});

  // Auto-accept paused tool calls in no-approval mode. Approval responses are
  // idempotent per id, so re-runs on snapshot churn are safe.
  const pendingIds = snapshot ? pendingApprovalIds(snapshot.messages) : [];
  const pendingSig = pendingIds.join("|");
  useEffect(() => {
    if (!autoApprove || !pendingSig) return;
    for (const id of pendingSig.split("|")) {
      void actor.respondToToolApproval(id, true);
    }
  }, [autoApprove, pendingSig, actor]);
  const isRunning = snapshot?.meta.status === "submitted" || snapshot?.meta.status === "streaming";

  // Auto-dispatch driver (PRD §5.8): once the turn finishes and nothing is
  // pending, fire the head of the queue. `sendQueuedPrompt` is idempotent on a
  // missing id, so a re-run after the head changes is safe.
  const queueHeadId = snapshot?.queuedPrompts[0]?.id;
  const autoDispatch = shouldAutoDispatchQueued({
    enabled: autoDispatchEnabled,
    status: snapshot?.meta.status,
    queueLength: snapshot?.queuedPrompts.length ?? 0,
    pendingApprovalCount: pendingIds.length,
  });
  useEffect(() => {
    if (autoDispatch && queueHeadId) void actor.sendQueuedPrompt(queueHeadId);
  }, [autoDispatch, queueHeadId, actor]);

  const messages = snapshot?.messages ?? [];
  const showEmptyState = Boolean(emptyState) && messages.length === 0;

  // Context budget over the active window (what would be sent — messages from
  // the compression pointer onward). Block disables the composer (block-and-
  // explain); compress moves the pointer to the latest user turn (old messages
  // stay visible, never silently truncated).
  const contextStartIndex = snapshot?.meta.contextStartIndex ?? 0;
  const budgetResult = evaluateChatContextBudget(messages.slice(contextStartIndex));
  const sendBlocked = budgetResult.status === "block";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background" ref={panelRef}>
      {showEmptyState && emptyState ? (
        <ChatEmptyState
          labels={emptyState.labels}
          onInsertPrompt={(prompt) => setDraft(prompt)}
          onStartWithVibe={() => panelRef.current?.querySelector("textarea")?.focus()}
          onUploadLibrary={onUploadLibrary}
          presets={emptyState.presets}
        />
      ) : (
        <ChatTurns
          messages={messages}
          onApproveTool={(approvalId) => actor.respondToToolApproval(approvalId, true)}
          onRejectTool={(approvalId) => actor.respondToToolApproval(approvalId, false)}
          toolLabels={toolLabels}
        />
      )}
      {queueLabels && (snapshot?.queuedPrompts.length ?? 0) > 0 && (
        <ChatQueueTray
          autoDispatchEnabled={autoDispatchEnabled}
          labels={queueLabels}
          onAutoDispatchChange={onAutoDispatchChange}
          onDelete={(promptId) => {
            void actor.deleteQueuedPrompt(promptId);
          }}
          onReorder={(promptIds) => {
            void actor.reorderQueuedPrompts(promptIds);
          }}
          onSend={(promptId) => {
            void actor.sendQueuedPrompt(promptId);
          }}
          prompts={snapshot?.queuedPrompts ?? []}
        />
      )}
      {budgetLabels && (
        <ChatContextBudgetNotice
          labels={budgetLabels}
          onCompress={() => {
            void actor.setContextStartIndex(messages.length);
          }}
          result={budgetResult}
        />
      )}
      <ChatComposer
        disabled={sendBlocked}
        isRunning={isRunning}
        onInterrupt={(text) => actor.interruptWithMessage(text)}
        onQueue={async (text) => {
          await actor.queuePrompt(text);
        }}
        onSend={(text) => actor.sendMessage(text)}
        onStop={() => actor.stop()}
        onValueChange={setDraft}
        value={draft}
      />
    </section>
  );
}
