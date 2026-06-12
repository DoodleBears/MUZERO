import { isToolUIPart } from "ai";
import type { ReactNode } from "react";
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
            {renderMessageBlocks(message, { onApproveTool, onRejectTool, toolLabels })}
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Render a message's parts in their actual emission order, interleaving text and
 * tool calls (a multi-step turn is "text → call → text → call"). Contiguous text
 * parts are merged into one Streamdown block so markdown across deltas still
 * renders as a unit, but a tool call between two text runs splits them — text no
 * longer always floats above the tools.
 */
function renderMessageBlocks(
  message: DjChatUIMessage,
  opts: {
    onApproveTool?: (approvalId: string) => void;
    onRejectTool?: (approvalId: string) => void;
    toolLabels?: ChatToolLabels;
  },
): ReactNode[] {
  const blocks: ReactNode[] = [];
  let textRun: string[] = [];
  let runStart = 0;

  const flushText = () => {
    if (textRun.length === 0) return;
    const text = textRun.join("");
    textRun = [];
    if (!text.trim()) return;
    blocks.push(
      <Streamdown className="prose prose-sm max-w-none dark:prose-invert" key={`text-${runStart}`}>
        {text}
      </Streamdown>,
    );
  };

  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      if (textRun.length === 0) runStart = index;
      textRun.push(part.text);
      return;
    }
    const candidate = part as Parameters<typeof isToolUIPart>[0];
    if (opts.toolLabels && isToolUIPart(candidate)) {
      flushText();
      const toolPart = candidate as ChatToolPart;
      blocks.push(
        <ChatToolCollapsible
          key={toolPart.toolCallId}
          labels={opts.toolLabels}
          onApprove={opts.onApproveTool}
          onReject={opts.onRejectTool}
          part={toolPart}
        />,
      );
    }
  });
  flushText();
  return blocks;
}
