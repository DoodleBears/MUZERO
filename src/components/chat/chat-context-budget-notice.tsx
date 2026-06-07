import { Gauge } from "lucide-react";
import type { ReactNode } from "react";
import type {
  ChatContextBudgetResult,
  ChatContextBudgetStatus,
} from "@/chat/dj-chat-context-budget";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ChatContextBudgetNoticeLabels {
  compress: string;
  detail: (result: ChatContextBudgetResult) => ReactNode;
  states: Record<ChatContextBudgetStatus, ReactNode>;
}

interface ChatContextBudgetNoticeProps {
  className?: string;
  hideWhenOk?: boolean;
  labels: ChatContextBudgetNoticeLabels;
  onCompress?: () => void;
  result: ChatContextBudgetResult;
}

export function ChatContextBudgetNotice({
  className,
  hideWhenOk = true,
  labels,
  onCompress,
  result,
}: ChatContextBudgetNoticeProps) {
  if (hideWhenOk && result.status === "ok") return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-border border-t bg-muted/20 px-3 py-2 text-sm",
        result.status === "block" && "border-destructive/40 bg-destructive/5",
        className,
      )}
      role={result.status === "block" ? "alert" : "status"}
    >
      <Gauge className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{labels.states[result.status]}</div>
        <div className="text-muted-foreground text-xs">{labels.detail(result)}</div>
      </div>
      {onCompress && (
        <Button onClick={onCompress} size="sm" variant="outline">
          {labels.compress}
        </Button>
      )}
    </div>
  );
}
