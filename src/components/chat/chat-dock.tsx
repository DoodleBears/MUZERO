import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useChatBreakpoint } from "@/hooks/use-chat-breakpoint";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { ChatPanel } from "./chat-panel";

interface ChatDockProps {
  renderPanel?: (sessionId: string) => ReactNode;
}

export function ChatDock({ renderPanel }: ChatDockProps) {
  const mode = useChatStore((state) => state.mode);
  const dockSide = useChatStore((state) => state.dockSide);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const setMode = useChatStore((state) => state.setMode);
  const { isMobile } = useChatBreakpoint();
  const expandedMode = mode === "dock" && isMobile ? "fullscreen" : mode;

  if (expandedMode !== "dock" && expandedMode !== "fullscreen") return null;

  return (
    <aside
      aria-modal={expandedMode === "fullscreen"}
      className={cn(
        "fixed z-50 flex min-h-0 flex-col overflow-hidden border bg-background shadow-xl",
        expandedMode === "fullscreen" ? "inset-0" : "bottom-4 top-4 w-[min(33vw,460px)] rounded-lg",
        expandedMode === "dock" && dockSide === "right" && "right-4",
        expandedMode === "dock" && dockSide === "left" && "left-4",
      )}
      role="dialog"
    >
      <div className="flex h-12 shrink-0 items-center justify-end border-b px-2">
        <Button
          aria-label="Close DJ chat"
          onClick={() => setMode("bar")}
          size="icon-sm"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
      {activeSessionId ? (
        (renderPanel?.(activeSessionId) ?? <ChatPanel sessionId={activeSessionId} />)
      ) : (
        <div className="min-h-0 flex-1" />
      )}
    </aside>
  );
}
