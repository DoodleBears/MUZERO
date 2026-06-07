import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import type { DjChatUIMessage } from "@/chat/types";
import { cn } from "@/lib/utils";

interface ChatTurnsProps {
  messages: DjChatUIMessage[];
}

export function ChatTurns({ messages }: ChatTurnsProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
      {messages.map((message) => (
        <article
          className={cn(
            "max-w-[85%] rounded-lg border px-3 py-2 text-sm",
            message.role === "user"
              ? "ml-auto border-primary/20 bg-primary text-primary-foreground"
              : "mr-auto border-border bg-card text-card-foreground",
          )}
          key={message.id}
        >
          <Streamdown className="prose prose-sm max-w-none dark:prose-invert">
            {message.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("")}
          </Streamdown>
        </article>
      ))}
    </div>
  );
}
