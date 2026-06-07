import { ArrowDown, ArrowUp, GripVertical, Send, Trash2 } from "lucide-react";
import { type DragEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DjChatQueuedPrompt } from "@/db/types";
import { cn } from "@/lib/utils";

export interface ChatQueueTrayLabels {
  autoDispatch: string;
  delete: string;
  dragHandle: string;
  empty: ReactNode;
  itemPosition: (index: number, total: number) => ReactNode;
  moveDown: string;
  moveUp: string;
  send: string;
  title: ReactNode;
}

interface ChatQueueTrayProps {
  autoDispatchEnabled?: boolean;
  className?: string;
  labels: ChatQueueTrayLabels;
  onAutoDispatchChange?: (enabled: boolean) => void;
  onDelete?: (promptId: string) => void;
  onReorder?: (promptIds: string[]) => void;
  onSend?: (promptId: string) => void;
  prompts: DjChatQueuedPrompt[];
}

export function ChatQueueTray({
  autoDispatchEnabled = false,
  className,
  labels,
  onAutoDispatchChange,
  onDelete,
  onReorder,
  onSend,
  prompts,
}: ChatQueueTrayProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function reorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    const next = [...prompts];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    onReorder?.(next.map((prompt) => prompt.id));
  }

  function dropOn(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    reorder(
      prompts.findIndex((prompt) => prompt.id === draggingId),
      prompts.findIndex((prompt) => prompt.id === targetId),
    );
    setDraggingId(null);
  }

  return (
    <section
      aria-labelledby="chat-queue-tray-title"
      className={cn("space-y-3 border-border border-t bg-background p-3", className)}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-medium text-sm" id="chat-queue-tray-title">
          {labels.title}
        </h2>
        <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground text-xs">
          <input
            checked={autoDispatchEnabled}
            className="peer sr-only"
            onChange={(event) => onAutoDispatchChange?.(event.target.checked)}
            type="checkbox"
          />
          <span
            className={cn(
              "h-5 w-9 rounded-full p-0.5 transition-colors",
              autoDispatchEnabled ? "bg-primary" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "block size-4 rounded-full bg-background shadow-sm transition-transform",
                autoDispatchEnabled && "translate-x-4",
              )}
            />
          </span>
          <span>{labels.autoDispatch}</span>
        </label>
      </div>

      {prompts.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
          {labels.empty}
        </p>
      ) : (
        <ol className="space-y-2">
          {prompts.map((prompt, index) => (
            <li
              className="group rounded-lg border bg-muted/20 p-2 transition-colors data-[dragging=true]:opacity-60 data-[drop-target=true]:border-primary"
              data-dragging={draggingId === prompt.id}
              data-drop-target={draggingId !== null && draggingId !== prompt.id}
              data-testid={`queued-prompt-${prompt.id}`}
              draggable={prompts.length > 1}
              key={prompt.id}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event: DragEvent<HTMLLIElement>) => event.preventDefault()}
              onDragStart={() => setDraggingId(prompt.id)}
              onDrop={(event: DragEvent<HTMLLIElement>) => {
                event.preventDefault();
                dropOn(prompt.id);
              }}
            >
              <div className="flex items-start gap-2">
                <span
                  aria-label={labels.dragHandle}
                  className="mt-1 shrink-0 text-muted-foreground"
                  role="img"
                >
                  <GripVertical className="size-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="text-muted-foreground text-xs">
                    {labels.itemPosition(index, prompts.length)}
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">
                    {prompt.composerRaw}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    aria-label={labels.moveUp}
                    disabled={index === 0}
                    onClick={() => reorder(index, index - 1)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    aria-label={labels.moveDown}
                    disabled={index === prompts.length - 1}
                    onClick={() => reorder(index, index + 1)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    aria-label={labels.send}
                    onClick={() => onSend?.(prompt.id)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Send />
                  </Button>
                  <Button
                    aria-label={labels.delete}
                    onClick={() => onDelete?.(prompt.id)}
                    size="icon-xs"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
