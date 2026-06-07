import { getOrCreateDjChatRuntimeActor } from "@/chat/dj-chat-runtime-registry";
import { createChatSession } from "@/chat/dj-chat-sessions";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { useChatStore } from "@/stores/chat-store";
import { ChatComposer } from "./chat-composer";

interface ChatInputBarProps {
  db?: MuzeroDB;
  onSend?: (text: string) => void | Promise<void>;
}

export function ChatInputBar({ db = defaultDb, onSend }: ChatInputBarProps) {
  const mode = useChatStore((state) => state.mode);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const setActiveSessionId = useChatStore((state) => state.setActiveSessionId);

  if (mode !== "bar") return null;

  async function handleSend(text: string) {
    if (onSend) {
      await onSend(text);
      return;
    }
    const sessionId = activeSessionId ?? (await createChatSession({ firstUserText: text }, db)).id;
    if (!activeSessionId) setActiveSessionId(sessionId);
    const actor = getOrCreateDjChatRuntimeActor(sessionId, { db });
    await actor.ready;
    await actor.sendMessage(text);
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(var(--spacing-chrome-bottom,0px)+env(safe-area-inset-bottom,0px)+0.75rem)] z-40 mx-auto max-w-2xl overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur">
      <ChatComposer onSend={handleSend} />
    </div>
  );
}
