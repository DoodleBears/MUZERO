import { ArrowUp, CircleStop, ListEnd, Maximize2, Minimize2, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { canUseDjChat } from "@/chat/dj-chat-availability";
import { getOrCreateDjChatRuntimeActor } from "@/chat/dj-chat-runtime-registry";
import { createChatSession } from "@/chat/dj-chat-sessions";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatReplyNotification } from "@/components/chat/chat-reply-notification";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";

/**
 * The dock-integrated DJ chat entry (PRD §5): lives in the player-dock's upper
 * tool row, left of the memory + nav icons. Three states:
 *   icon (minimize) → chip (rounded single-line input, default) → expanded
 *   (widget hosting the full chat panel — desktop floating card / mobile sheet).
 * icon ↔ chip morph via a shared `layoutId`; the widget animates with its own
 * spring (a cross-portal layout morph deadlocks motion's projection).
 *
 * Renders NOTHING (not even the icon) unless both an LLM and a music-gen
 * provider are usable (`canUseDjChat`, hard gate per requirement #1).
 *
 * The expanded widget + backdrop render through a portal: the dock container
 * is translated (centering transform), which would otherwise make
 * `position: fixed` resolve against the dock instead of the viewport.
 */
export function DjChatEntry({ className }: { className?: string }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const available = canUseDjChat(settings);
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSessionId = useChatStore((s) => s.setActiveSessionId);
  const runtimeStatus = useChatStore((s) =>
    s.activeSessionId ? s.runtimeMetaBySessionId[s.activeSessionId]?.status : undefined,
  );
  const [draft, setDraft] = useState("");
  const isRunning = runtimeStatus === "submitted" || runtimeStatus === "streaming";

  // Esc collapses the widget back to the chip.
  useEffect(() => {
    if (mode !== "expanded") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMode("chip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, setMode]);

  if (!available) return null;

  async function ensureSession(firstUserText?: string): Promise<string> {
    if (activeSessionId) return activeSessionId;
    const session = await createChatSession(firstUserText ? { firstUserText } : {});
    setActiveSessionId(session.id);
    return session.id;
  }

  async function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const sessionId = await ensureSession(text);
    const actor = getOrCreateDjChatRuntimeActor(sessionId);
    if (isRunning) await actor.queuePrompt(text);
    else await actor.sendMessage(text);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submitDraft();
  }

  function expand() {
    setMode("expanded");
    if (!activeSessionId) void ensureSession();
  }

  const surface = "bg-card/90 shadow-lg ring-1 ring-border/40 backdrop-blur-md";

  return (
    <div className={cn("relative min-w-0", mode === "chip" ? "flex-1" : "w-fit", className)}>
      {mode === "icon" && (
        <motion.button
          aria-label={t("chat.open")}
          className={cn(
            "grid size-11 place-items-center rounded-full text-primary outline-none transition-colors",
            "hover:bg-card focus-visible:ring-2 focus-visible:ring-ring",
            surface,
          )}
          layoutId="dj-chat-entry"
          onClick={() => setMode("chip")}
          type="button"
        >
          <Sparkles aria-hidden="true" className="size-5" />
        </motion.button>
      )}

      {mode === "chip" && (
        <motion.form
          className={cn("flex h-11 min-w-0 items-center gap-1 rounded-full pe-1 ps-1", surface)}
          layoutId="dj-chat-entry"
          onSubmit={handleSubmit}
        >
          <button
            aria-label={t("chat.minimize")}
            className="grid size-9 shrink-0 place-items-center rounded-full text-primary outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setMode("icon")}
            type="button"
          >
            <Sparkles aria-hidden="true" className="size-4.5" />
          </button>
          <input
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("chat.placeholder")}
            value={draft}
          />
          {isRunning && !draft.trim() ? (
            <button
              aria-label={t("chat.stop")}
              className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                if (activeSessionId) void getOrCreateDjChatRuntimeActor(activeSessionId).stop();
              }}
              type="button"
            >
              <CircleStop aria-hidden="true" className="size-4.5" />
            </button>
          ) : (
            draft.trim() && (
              <button
                aria-label={isRunning ? t("chat.queue") : t("chat.send")}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                type="submit"
              >
                {isRunning ? (
                  <ListEnd aria-hidden="true" className="size-4.5" />
                ) : (
                  <ArrowUp aria-hidden="true" className="size-4.5" />
                )}
              </button>
            )
          )}
          <button
            aria-label={t("chat.expand")}
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            onClick={expand}
            type="button"
          >
            <Maximize2 aria-hidden="true" className="size-4" />
          </button>
        </motion.form>
      )}

      {typeof document !== "undefined" && createPortal(<ChatReplyNotification />, document.body)}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {/* Keyed direct children (no fragment): AnimatePresence only tracks
                exits on its immediate motion children. */}
            {mode === "expanded" && (
              <motion.div
                animate={{ opacity: 1 }}
                className="pointer-events-auto fixed inset-0 z-40 bg-black/30 md:bg-black/10"
                data-testid="dj-chat-backdrop"
                exit={{ opacity: 0 }}
                initial={{ opacity: 0 }}
                key="dj-chat-backdrop"
                onClick={() => setMode("chip")}
              />
            )}
            {/* Own spring (no shared layoutId): the chip lives in the dock tree
                while this renders through a portal — a cross-portal layout
                morph deadlocks motion's projection (ghost stuck at chip
                scale). Grows up from the dock area instead. */}
            {mode === "expanded" && (
              <motion.section
                animate={{ opacity: 1, scale: 1, y: 0 }}
                key="dj-chat-widget"
                aria-label={t("chat.title")}
                className={cn(
                  "pointer-events-auto fixed z-50 flex origin-bottom flex-col overflow-hidden rounded-3xl bg-card/95 shadow-2xl ring-1 ring-border/40 backdrop-blur-xl",
                  // Desktop: floating card centered above the dock.
                  "inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+9.5rem)] mx-auto h-[min(65vh,38rem)] w-[min(36rem,calc(100vw-1.5rem))]",
                  // Mobile: near-fullscreen sheet.
                  "max-md:inset-x-2 max-md:top-[calc(env(safe-area-inset-top,0px)+0.5rem)] max-md:bottom-2 max-md:mx-0 max-md:h-auto max-md:w-auto",
                )}
                exit={{ opacity: 0, scale: 0.96, y: 24 }}
                initial={{ opacity: 0, scale: 0.96, y: 24 }}
                role="dialog"
                transition={{ damping: 30, stiffness: 380, type: "spring" }}
              >
                <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
                  <Sparkles aria-hidden="true" className="size-4 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {t("chat.title")}
                  </span>
                  <button
                    aria-label={t("chat.minimize")}
                    className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setMode("chip")}
                    type="button"
                  >
                    <Minimize2 aria-hidden="true" className="size-4" />
                  </button>
                </header>
                {activeSessionId && <ChatPanel sessionId={activeSessionId} />}
              </motion.section>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
