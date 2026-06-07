import { isToolUIPart } from "ai";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import type { DjChatUIMessage } from "@/chat/types";
import { cn } from "@/lib/utils";
import {
  ChatToolCollapsible,
  type ChatToolLabels,
  type ChatToolPart,
} from "./chat-tool-collapsible";

interface ChatTurnsProps {
  messages: DjChatUIMessage[];
  onApproveTool?: (approvalId: string) => void;
  onRejectTool?: (approvalId: string) => void;
  toolLabels?: ChatToolLabels;
}

export function ChatTurns({ messages, onApproveTool, onRejectTool, toolLabels }: ChatTurnsProps) {
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
          <div className="space-y-3">
            <Streamdown className="prose prose-sm max-w-none dark:prose-invert">
              {message.parts
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("")}
            </Streamdown>
            {toolLabels &&
              toolParts(message).map((part) => (
                <ChatToolCollapsible
                  key={part.toolCallId}
                  labels={toolLabels}
                  onApprove={onApproveTool}
                  onReject={onRejectTool}
                  part={part}
                />
              ))}
          </div>
        </article>
      ))}
    </div>
  );
}

function toolParts(message: DjChatUIMessage): ChatToolPart[] {
  return message.parts.flatMap((part) => {
    const candidate = part as Parameters<typeof isToolUIPart>[0];
    return isToolUIPart(candidate) ? [candidate as ChatToolPart] : [];
  });
}
