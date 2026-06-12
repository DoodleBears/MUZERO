import { type DynamicToolUIPart, getToolName, type ToolUIPart } from "ai";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChatToolPart = ToolUIPart | DynamicToolUIPart;
type ChatToolState = ChatToolPart["state"];

export interface ChatToolLabels {
  approve: string;
  error: ReactNode;
  input: ReactNode;
  output: ReactNode;
  reject: string;
  states: Record<ChatToolState, ReactNode>;
  tools?: Record<string, { description?: ReactNode; label: ReactNode }>;
}

interface ChatToolCollapsibleProps {
  className?: string;
  defaultOpen?: boolean;
  labels: ChatToolLabels;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string) => void;
  part: ChatToolPart;
}

export function ChatToolCollapsible({
  className,
  defaultOpen,
  labels,
  onApprove,
  onReject,
  part,
}: ChatToolCollapsibleProps) {
  const approvalId =
    part.state === "approval-requested" || part.state === "approval-responded"
      ? part.approval.id
      : undefined;

  // Collapsed by default — the summary row (name + state) is enough at a glance.
  // Auto-open only when the call wants the listener's eyes: an approval to grant
  // or an error to read. An explicit `defaultOpen` overrides.
  const needsAttention = part.state === "approval-requested" || part.state === "output-error";
  const open = defaultOpen ?? needsAttention;
  const toolName = getToolName(part);
  const toolLabel = labels.tools?.[toolName]?.label ?? part.title ?? toolName;
  const toolDescription = labels.tools?.[toolName]?.description;

  return (
    <details
      className={cn("group rounded-lg border border-border bg-muted/30 text-sm", className)}
      open={open}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 flex-1 truncate">
          <span className="block truncate font-medium">{toolLabel}</span>
          {toolDescription ? (
            <span className="block truncate text-muted-foreground text-xs">{toolDescription}</span>
          ) : null}
        </span>
        <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-muted-foreground text-xs">
          {labels.states[part.state]}
        </span>
      </summary>
      <div className="space-y-3 border-border border-t px-3 py-3">
        {hasPayload(part, "input") && (
          <ToolPayloadBlock label={labels.input} value={formatToolPayload(part.input)} />
        )}
        {hasPayload(part, "output") && (
          <ToolPayloadBlock label={labels.output} value={formatToolPayload(part.output)} />
        )}
        {part.state === "output-error" && (
          <div className="space-y-1">
            <div className="font-medium text-muted-foreground text-xs">{labels.error}</div>
            <p className="text-destructive text-xs" role="alert">
              {part.errorText}
            </p>
          </div>
        )}
        {part.state === "approval-requested" && approvalId && (
          <div className="flex justify-end gap-2">
            <Button onClick={() => onReject?.(approvalId)} size="sm" variant="outline">
              {labels.reject}
            </Button>
            <Button onClick={() => onApprove?.(approvalId)} size="sm">
              {labels.approve}
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}

function ToolPayloadBlock({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="space-y-1">
      <div className="font-medium text-muted-foreground text-xs">{label}</div>
      <pre className="max-h-48 overflow-auto rounded-md bg-background p-2 text-xs leading-relaxed">
        {value}
      </pre>
    </div>
  );
}

function hasPayload<T extends "input" | "output">(
  part: ChatToolPart,
  key: T,
): part is ChatToolPart & Record<T, unknown> {
  return key in part && part[key] !== undefined;
}

export function formatToolPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}
