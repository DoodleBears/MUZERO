import { isToolUIPart } from "ai";
import { ArrowDown } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import type { DjChatUIMessage } from "@/chat/types";
import { isNearBottom } from "@/lib/stick-to-bottom";
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
  /** Aria-label for the floating "back to bottom" button; when absent the button
   *  is hidden (keeps this component's tests i18n-free). */
  scrollToBottomLabel?: string;
}

export function ChatTurns({
  messages,
  onApproveTool,
  onRejectTool,
  toolLabels,
  scrollToBottomLabel,
}: ChatTurnsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow the latest content while the user is at the bottom; leave their
  // position alone once they scroll up to read history. `following` is a ref (not
  // state) so streamed snapshots don't thrash renders; `atBottom` state only
  // drives the floating button's visibility.
  const followingRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // Stable across renders (only touches refs + a setter), so it's a safe effect
  // dependency and the mount effect below runs exactly once.
  const jumpToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (!el) return;
    // `scrollTo` is absent under jsdom; fall back to a plain scrollTop assignment.
    if (typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight, behavior });
    else el.scrollTop = el.scrollHeight;
    followingRef.current = true;
    setAtBottom(true);
  }, []);

  // On open: pin to the newest message immediately (no smooth animation).
  useLayoutEffect(() => {
    jumpToBottom("auto");
  }, [jumpToBottom]);

  // New/streamed content: keep pinned only if the user was already following.
  useEffect(() => {
    if (messages.length === 0 || !followingRef.current) return;
    jumpToBottom("auto");
  }, [messages, jumpToBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    followingRef.current = near;
    setAtBottom(near);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-3"
        onScroll={handleScroll}
        ref={scrollRef}
      >
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
      {scrollToBottomLabel && !atBottom && (
        <button
          aria-label={scrollToBottomLabel}
          className="-translate-x-1/2 absolute bottom-3 left-1/2 grid size-9 place-items-center rounded-full border border-border bg-card/95 text-muted-foreground shadow-lg ring-1 ring-border/30 backdrop-blur-md transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => jumpToBottom("smooth")}
          type="button"
        >
          <ArrowDown aria-hidden className="size-4.5" />
        </button>
      )}
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
