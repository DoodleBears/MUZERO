import { useEffect } from "react";
import {
  getOrCreateDjChatRuntimeActor,
  useDjChatRuntimeSnapshot,
} from "@/chat/dj-chat-runtime-registry";
import type { MuzeroDB } from "@/db/muzero-db";
import { useChatStore } from "@/stores/chat-store";
import { ChatComposer } from "./chat-composer";
import { ChatTurns } from "./chat-turns";

interface ChatPanelProps {
  sessionId: string;
  db?: MuzeroDB;
}

export function ChatPanel({ sessionId, db }: ChatPanelProps) {
  const snapshot = useDjChatRuntimeSnapshot(sessionId, db);
  const setRuntimeMeta = useChatStore((state) => state.setRuntimeMeta);

  useEffect(() => {
    if (snapshot?.meta) setRuntimeMeta(snapshot.meta);
  }, [setRuntimeMeta, snapshot?.meta]);

  const actor = getOrCreateDjChatRuntimeActor(sessionId, db ? { db } : {});
  const isRunning = snapshot?.meta.status === "submitted" || snapshot?.meta.status === "streaming";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ChatTurns messages={snapshot?.messages ?? []} />
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
