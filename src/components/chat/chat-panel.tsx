import { useEffect } from "react";
import {
  getOrCreateDjChatRuntimeActor,
  useDjChatRuntimeSnapshot,
} from "@/chat/dj-chat-runtime-registry";
import type { MuzeroDB } from "@/db/muzero-db";
import { useChatStore } from "@/stores/chat-store";
import { ChatComposer } from "./chat-composer";
import { ChatQueueTray, type ChatQueueTrayLabels } from "./chat-queue-tray";
import type { ChatToolLabels } from "./chat-tool-collapsible";
import { ChatTurns } from "./chat-turns";

interface ChatPanelProps {
  autoDispatchEnabled?: boolean;
  sessionId: string;
  db?: MuzeroDB;
  onAutoDispatchChange?: (enabled: boolean) => void;
  queueLabels?: ChatQueueTrayLabels;
  toolLabels?: ChatToolLabels;
}

export function ChatPanel({
  autoDispatchEnabled = false,
  sessionId,
  db,
  onAutoDispatchChange,
  queueLabels,
  toolLabels,
}: ChatPanelProps) {
  const snapshot = useDjChatRuntimeSnapshot(sessionId, db);
  const setRuntimeMeta = useChatStore((state) => state.setRuntimeMeta);

  useEffect(() => {
    if (snapshot?.meta) setRuntimeMeta(snapshot.meta);
  }, [setRuntimeMeta, snapshot?.meta]);

  const actor = getOrCreateDjChatRuntimeActor(sessionId, db ? { db } : {});
  const isRunning = snapshot?.meta.status === "submitted" || snapshot?.meta.status === "streaming";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ChatTurns
        messages={snapshot?.messages ?? []}
        onApproveTool={(approvalId) => actor.respondToToolApproval(approvalId, true)}
        onRejectTool={(approvalId) => actor.respondToToolApproval(approvalId, false)}
        toolLabels={toolLabels}
      />
      {queueLabels && (
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
      <ChatComposer
        isRunning={isRunning}
        onInterrupt={(text) => actor.interruptWithMessage(text)}
        onQueue={async (text) => {
          await actor.queuePrompt(text);
        }}
        onSend={(text) => actor.sendMessage(text)}
        onStop={() => actor.stop()}
      />
    </section>
  );
}
