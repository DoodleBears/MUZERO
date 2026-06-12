import { type DynamicToolUIPart, getToolName, isToolUIPart, type ToolUIPart } from "ai";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import type { DjChatRuntimeSnapshot } from "@/chat/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";

type ChatToolPart = ToolUIPart | DynamicToolUIPart;
type ChatToolState = ChatToolPart["state"];

export interface ChatActivityLabels {
  ariaLabel: string;
  error: string;
  idle: string;
  queued: string;
  thinking: string;
  waitingApproval: string;
  toolStates: Record<ChatToolState, string>;
  tools?: Record<string, { label: string; description?: ReactNode }>;
}

export type ChatActivityTone = "approval" | "done" | "error" | "idle" | "running";

export interface ChatActivity {
  autoHide: boolean;
  preview?: string;
  status: string;
  tone: ChatActivityTone;
}

export function deriveChatActivity(
  snapshot: DjChatRuntimeSnapshot | undefined,
  labels: ChatActivityLabels,
): ChatActivity | undefined {
  if (!snapshot) return undefined;

  const latestTool = latestToolPart(snapshot);
  const preview = latestAssistantText(snapshot) ?? snapshot.meta.lastAssistantPreview?.trim();

  if (latestTool) {
    const toolName = getToolName(latestTool);
    const toolLabel = labels.tools?.[toolName]?.label ?? latestTool.title ?? toolName;
    if (latestTool.state === "approval-requested") {
      return {
        autoHide: false,
        preview,
        status: labels.waitingApproval,
        tone: "approval",
      };
    }
    if (latestTool.state === "output-error") {
      return {
        autoHide: false,
        preview: latestTool.errorText || preview || labels.error,
        status: toolLabel,
        tone: "error",
      };
    }
    return {
      autoHide: latestTool.state === "output-available" || latestTool.state === "output-denied",
      preview,
      status: toolLabel || labels.toolStates[latestTool.state],
      tone:
        latestTool.state === "output-available" || latestTool.state === "output-denied"
          ? "done"
          : "running",
    };
  }

  if (snapshot.meta.pendingApprovalCount > 0) {
    return {
      autoHide: false,
      preview,
      status: labels.waitingApproval,
      tone: "approval",
    };
  }

  if (snapshot.meta.status === "error") {
    return {
      autoHide: false,
      preview: snapshot.meta.errorMessage ?? preview ?? labels.error,
      status: labels.error,
      tone: "error",
    };
  }

  if (snapshot.queuedPrompts.length > 0 && snapshot.meta.status === "idle") {
    return {
      autoHide: true,
      preview: snapshot.queuedPrompts[0]?.composerRaw,
      status: labels.queued,
      tone: "idle",
    };
  }

  if (snapshot.meta.status === "submitted" || snapshot.meta.status === "streaming") {
    return {
      autoHide: true,
      preview,
      status: labels.thinking,
      tone: "running",
    };
  }

  if (preview) {
    return {
      autoHide: true,
      preview,
      status: labels.idle,
      tone: "done",
    };
  }

  return undefined;
}

export function ChatActivityPopover({
  activity,
  className,
  labels,
  onDismiss,
}: {
  activity: ChatActivity | undefined;
  className?: string;
  labels: ChatActivityLabels;
  onDismiss?: () => void;
}) {
  const setMode = useChatStore((state) => state.setMode);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activity || !onDismiss) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onDismiss();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [activity, onDismiss]);

  if (!activity) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-[min(28rem,calc(100vw-1.5rem))]",
        className,
      )}
      ref={rootRef}
    >
      <button
        aria-label={labels.ariaLabel}
        className={cn(
          "pointer-events-auto flex w-full items-start gap-2 rounded-xl border bg-card/95 px-3 py-2 text-left shadow-xl ring-1 ring-border/30 backdrop-blur-xl transition-transform active:scale-[0.98]",
          activity.tone === "error" && "border-destructive/40",
          activity.tone === "approval" && "border-primary/40",
        )}
        onClick={() => setMode("expanded")}
        type="button"
      >
        <ActivityIcon tone={activity.tone} />
        <span className="min-w-0 flex-1 space-y-0.5" role="status">
          <span className="block truncate font-medium text-sm">{activity.status}</span>
          {activity.preview ? (
            <span
              className="no-scrollbar block max-h-[calc(2_*_1.25rem)] overflow-hidden text-muted-foreground text-xs leading-5 motion-reduce:line-clamp-2"
              data-testid="chat-activity-preview"
            >
              <span className="motion-safe:animate-[chat-activity-scroll_7s_linear_infinite] motion-reduce:animate-none">
                {activity.preview}
              </span>
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}

function ActivityIcon({ tone }: { tone: ChatActivityTone }) {
  if (tone === "error")
    return <AlertCircle aria-hidden className="mt-0.5 size-4 text-destructive" />;
  if (tone === "running") {
    return <Loader2 aria-hidden className="mt-0.5 size-4 animate-spin text-primary" />;
  }
  return <Sparkles aria-hidden className="mt-0.5 size-4 text-primary" />;
}

function latestToolPart(snapshot: DjChatRuntimeSnapshot): ChatToolPart | undefined {
  for (let i = snapshot.messages.length - 1; i >= 0; i--) {
    const parts = snapshot.messages[i]?.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];
      if (isToolUIPart(part)) return part;
    }
  }
  return undefined;
}

function latestAssistantText(snapshot: DjChatRuntimeSnapshot): string | undefined {
  for (let i = snapshot.messages.length - 1; i >= 0; i--) {
    const message = snapshot.messages[i];
    if (message?.role !== "assistant") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim();
    if (text) return text;
  }
  return undefined;
}
