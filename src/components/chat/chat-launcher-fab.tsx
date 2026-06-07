import { Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/stores/chat-store";

export function ChatLauncherFab() {
  const mode = useChatStore((state) => state.mode);
  const setMode = useChatStore((state) => state.setMode);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const unread = useChatStore((state) =>
    activeSessionId
      ? Boolean(state.runtimeMetaBySessionId[activeSessionId]?.lastAssistantPreview)
      : false,
  );

  if (mode !== "fab") return null;

  return (
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-4 z-50"
      initial={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.16 }}
    >
      <Button
        aria-label="Open DJ chat"
        className="rounded-full shadow-lg"
        onClick={() => setMode("dock")}
        size="icon-xl"
      >
        <Sparkles />
        {unread && <span className="absolute right-1 top-1 size-2 rounded-full bg-destructive" />}
      </Button>
    </motion.div>
  );
}
