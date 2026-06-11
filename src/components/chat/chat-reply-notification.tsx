import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useChatStore } from "@/stores/chat-store";

export function ChatReplyNotification() {
  const mode = useChatStore((state) => state.mode);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const setMode = useChatStore((state) => state.setMode);
  const meta = useChatStore((state) =>
    activeSessionId ? state.runtimeMetaBySessionId[activeSessionId] : undefined,
  );
  const preview = meta?.lastAssistantPreview?.trim();
  // Folded states only (icon/chip); the expanded widget already shows the reply.
  const shouldShow = mode !== "expanded" && Boolean(preview);

  return (
    <AnimatePresence mode="wait">
      {shouldShow && (
        <motion.div
          animate={{ opacity: 1, y: 0, scale: 1 }}
          className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]"
          exit={{ opacity: 0, y: -20, scale: 0.97 }}
          initial={{ opacity: 0, y: -40, scale: 0.95 }}
          key={activeSessionId}
          transition={{ damping: 28, stiffness: 380, type: "spring" }}
        >
          <button
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-lg border bg-card/95 px-3 py-2 text-left text-card-foreground shadow-lg backdrop-blur-xl transition-transform active:scale-[0.98]"
            onClick={() => setMode("expanded")}
            type="button"
          >
            <Sparkles className="size-4 shrink-0 opacity-80" />
            <span className="min-w-0 flex-1 truncate text-sm" role="status">
              {preview}
            </span>
            {meta?.status === "streaming" && (
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
            )}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
