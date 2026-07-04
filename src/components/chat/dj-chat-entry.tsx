import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowUp,
  CircleStop,
  History,
  ListEnd,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { isAsrConfigured } from "@/asr/registry";
import { canUseDjChat } from "@/chat/dj-chat-availability";
import {
  getOrCreateDjChatRuntimeActor,
  useDjChatRuntimeSnapshot,
} from "@/chat/dj-chat-runtime-registry";
import {
  createChatSession,
  deleteChatSession,
  listChatSessions,
  renameChatSession,
} from "@/chat/dj-chat-sessions";
import { DJ_CHAT_TOOL_METADATA } from "@/chat/dj-chat-tool-metadata";
import { ChatActivityPopover, deriveChatActivity } from "@/components/chat/chat-activity-popover";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatSessionHome } from "@/components/chat/chat-session-home";
import { DjToolActivityNotifier } from "@/components/chat/dj-tool-activity-notifier";
import { type SlashCommand, SlashMenu, useSlashCommands } from "@/components/chat/slash-commands";
import { useSettings } from "@/hooks/use-app-data";
import { useVoiceRecordingState } from "@/hooks/use-voice-recording";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { getVoiceInputController } from "@/voice/voice-input-runtime";

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
export function DjChatEntry({
  className,
  onUploadLibrary,
}: {
  className?: string;
  /** Navigate to the 歌单 gallery (empty-state "upload to your library"). */
  onUploadLibrary?: () => void;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const available = canUseDjChat(settings);
  const asrReady = isAsrConfigured(settings);
  const voiceState = useVoiceRecordingState();
  const mode = useChatStore((s) => s.mode);
  const setMode = useChatStore((s) => s.setMode);
  const approvalMode = useChatStore((s) => s.approvalMode);
  const setApprovalMode = useChatStore((s) => s.setApprovalMode);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSessionId = useChatStore((s) => s.setActiveSessionId);
  // Default ON: queued prompts fire automatically once the turn settles, unless
  // the listener explicitly turned auto-dispatch off for this session.
  const autoDispatchEnabled = useChatStore((s) =>
    s.activeSessionId ? (s.autoDispatchBySessionId[s.activeSessionId] ?? true) : true,
  );
  const setAutoDispatch = useChatStore((s) => s.setAutoDispatch);
  const runtimeStatus = useChatStore((s) =>
    s.activeSessionId ? s.runtimeMetaBySessionId[s.activeSessionId]?.status : undefined,
  );
  const [draft, setDraft] = useState("");
  const [dismissedActivityKey, setDismissedActivityKey] = useState<string | null>(null);
  // History view inside the expanded widget (session home). Switching sessions
  // only swaps the panel's sessionId — per-session runtime actors are
  // module-scope, so a streaming session keeps streaming in the background.
  const [showHome, setShowHome] = useState(false);
  const sessions = useLiveQuery(() => listChatSessions(), [], []);
  const isRunning = runtimeStatus === "submitted" || runtimeStatus === "streaming";
  const compactSnapshot = useDjChatRuntimeSnapshot(mode === "expanded" ? null : activeSessionId);
  const toolLabelMap = Object.fromEntries(
    DJ_CHAT_TOOL_METADATA.map((tool) => [
      tool.id,
      {
        description: t(tool.descriptionKey),
        label: t(tool.labelKey),
      },
    ]),
  );
  const activityLabels = {
    ariaLabel: t("chat.activityAria"),
    error: t("chat.activityError"),
    idle: t("chat.activityIdle"),
    queued: t("chat.activityQueued"),
    thinking: t("chat.activityThinking"),
    waitingApproval: t("chat.activityWaitingApproval"),
    toolStates: {
      "approval-requested": t("chat.toolStateApproval"),
      "approval-responded": t("chat.toolStateResponded"),
      "input-available": t("chat.toolStateRunning"),
      "input-streaming": t("chat.toolStateRunning"),
      "output-available": t("chat.toolStateDone"),
      "output-denied": t("chat.toolStateDenied"),
      "output-error": t("chat.toolStateError"),
    },
    tools: toolLabelMap,
  };
  const compactActivity =
    mode === "expanded" ? undefined : deriveChatActivity(compactSnapshot, activityLabels);
  const compactActivityKey =
    compactSnapshot && compactActivity
      ? [
          compactSnapshot.meta.sessionId,
          compactSnapshot.meta.messageCount,
          compactSnapshot.meta.status,
          compactSnapshot.meta.pendingApprovalCount,
          compactSnapshot.meta.queuedPromptCount,
        ].join(":")
      : undefined;
  const visibleCompactActivity =
    compactActivityKey === dismissedActivityKey ? undefined : compactActivity;

  // Esc collapses the widget back to the chip.
  useEffect(() => {
    if (mode !== "expanded") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMode("chip");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, setMode]);

  // `/` commands, shared by the chip (below) and the expanded composer (passed to
  // ChatPanel). `/history` expands first so it's useful from the collapsed chip.
  const slashCommands: SlashCommand[] = [
    {
      id: "new",
      label: t("chat.slashNew"),
      run: async () => {
        const session = await createChatSession({});
        setActiveSessionId(session.id);
        setShowHome(false);
      },
    },
    {
      id: "history",
      label: t("chat.slashHistory"),
      run: () => {
        setMode("expanded");
        setShowHome(true);
      },
    },
  ];
  const chipSlash = useSlashCommands(draft, slashCommands, () => setDraft(""));

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
    // Always flex-1 so the Sparkles icon stays pinned at the SAME far-left spot
    // in both chip and mini (the dock row right-aligns the memory/nav icons).
    <div className={cn("relative flex min-w-0 flex-1", className)}>
      {/* Mirror each DJ tool-call step into the notification stack (toggleable).
          A null-render leaf with its own subscription so it fires in any mode. */}
      <DjToolActivityNotifier />
      <ChatActivityPopover
        activity={visibleCompactActivity}
        labels={activityLabels}
        onDismiss={() => {
          if (compactActivityKey) setDismissedActivityKey(compactActivityKey);
        }}
      />
      {mode !== "expanded" && (
        // The Sparkles icon is ONE always-present, fixed element (the same icon
        // in chip + mini). Only the input + actions collapse their WIDTH — no
        // box-scale, so the icon never stretches (the old `layout` morph did).
        // The pill hugs its content (`w-fit`): a circle in mini, a wide pill in
        // chip; `max-w-full` keeps it from overflowing past the nav icons.
        <div
          className={cn(
            "flex h-11 w-fit max-w-full items-center overflow-hidden rounded-full",
            surface,
          )}
        >
          <button
            aria-label={mode === "chip" ? t("chat.minimize") : t("chat.open")}
            className="grid size-11 shrink-0 place-items-center rounded-full text-primary outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setMode(mode === "chip" ? "icon" : "chip")}
            type="button"
          >
            <Sparkles aria-hidden="true" className="size-5" />
          </button>

          <AnimatePresence initial={false}>
            {mode === "chip" && (
              <motion.form
                animate={{ width: "auto", opacity: 1 }}
                className="flex items-center gap-1 overflow-hidden pe-1"
                exit={{ width: 0, opacity: 0 }}
                initial={{ width: 0, opacity: 0 }}
                key="dj-chat-chip-body"
                onSubmit={handleSubmit}
                transition={{
                  type: "spring",
                  stiffness: 480,
                  damping: 40,
                  opacity: { duration: 0.1 },
                }}
              >
                <input
                  className="h-9 w-[min(56vw,30rem)] min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  onChange={(e) => {
                    setDraft(e.target.value);
                    chipSlash.notifyChange();
                  }}
                  onKeyDown={(e) => {
                    chipSlash.onKeyDown(e);
                  }}
                  placeholder={t("chat.placeholder")}
                  value={draft}
                />
                {asrReady && !draft.trim() && (
                  // Manual push-to-talk: click to start/stop recording (besides
                  // the global voice.talkToDj shortcut). Recording state comes
                  // from the controller's multi-listener subscribeState.
                  <button
                    aria-label={voiceState === "idle" ? t("chat.voiceRecord") : t("chat.voiceStop")}
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      voiceState === "idle"
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-primary",
                    )}
                    onClick={() => void getVoiceInputController().toggle()}
                    type="button"
                  >
                    {voiceState === "transcribing" ? (
                      <Loader2 aria-hidden className="size-4.5 animate-spin" />
                    ) : voiceState === "recording" ? (
                      <span className="relative grid place-items-center">
                        <span className="absolute size-6 animate-ping rounded-full bg-primary/30" />
                        <Mic aria-hidden className="size-4.5" />
                      </span>
                    ) : (
                      <Mic aria-hidden className="size-4.5" />
                    )}
                  </button>
                )}
                {isRunning && !draft.trim() ? (
                  <button
                    aria-label={t("chat.stop")}
                    className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      if (activeSessionId)
                        void getOrCreateDjChatRuntimeActor(activeSessionId).stop();
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
          </AnimatePresence>
        </div>
      )}

      {mode === "chip" && chipSlash.open && (
        <SlashMenu
          activeIndex={chipSlash.activeIndex}
          className="left-11 min-w-[14rem]"
          matches={chipSlash.matches}
          onHighlight={chipSlash.setHighlight}
          onRun={chipSlash.run}
        />
      )}

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
                  "inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+9.5rem)] mx-auto h-[min(75vh,48rem)] w-[min(40rem,calc(100vw-1.5rem))]",
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
                    aria-label={t("chat.newSession")}
                    className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => {
                      void createChatSession({}).then((session) => {
                        setActiveSessionId(session.id);
                        setShowHome(false);
                      });
                    }}
                    type="button"
                  >
                    <SquarePen aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    aria-label={t("chat.history")}
                    aria-pressed={showHome}
                    className={cn(
                      "grid size-8 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      showHome ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setShowHome((v) => !v)}
                    type="button"
                  >
                    <History aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    aria-label={
                      approvalMode === "auto" ? t("chat.approvalAuto") : t("chat.approvalAsk")
                    }
                    aria-pressed={approvalMode === "auto"}
                    className={cn(
                      "grid size-8 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      approvalMode === "auto"
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setApprovalMode(approvalMode === "auto" ? "ask" : "auto")}
                    title={approvalMode === "auto" ? t("chat.approvalAuto") : t("chat.approvalAsk")}
                    type="button"
                  >
                    {approvalMode === "auto" ? (
                      <ShieldCheck aria-hidden="true" className="size-4" />
                    ) : (
                      <ShieldQuestion aria-hidden="true" className="size-4" />
                    )}
                  </button>
                  <button
                    aria-label={t("chat.minimize")}
                    className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setMode("chip")}
                    type="button"
                  >
                    <Minimize2 aria-hidden="true" className="size-4" />
                  </button>
                </header>
                {showHome && (
                  <ChatSessionHome
                    activeSessionId={activeSessionId}
                    className="min-h-0 flex-1 overflow-y-auto p-3"
                    labels={{
                      cancel: t("chat.homeCancel"),
                      delete: t("chat.homeDelete"),
                      empty: t("chat.homeEmpty"),
                      itemMeta: ({ messageCount, queuedPromptCount }) =>
                        queuedPromptCount > 0
                          ? `${messageCount} · +${queuedPromptCount}`
                          : `${messageCount}`,
                      open: t("chat.homeOpen"),
                      rename: t("chat.homeRename"),
                      saveRename: t("chat.homeSave"),
                      searchPlaceholder: t("chat.homeSearch"),
                      title: t("chat.homeTitle"),
                      titleInput: t("chat.homeTitleInput"),
                      updatedAt: (updatedAt) => new Date(updatedAt).toLocaleString(),
                    }}
                    onDeleteSession={(sessionId) => {
                      void deleteChatSession(sessionId);
                      if (sessionId === activeSessionId) setActiveSessionId(null);
                    }}
                    onOpenSession={(sessionId) => {
                      setActiveSessionId(sessionId);
                      setShowHome(false);
                    }}
                    onRenameSession={(sessionId, title) => {
                      void renameChatSession(sessionId, title);
                    }}
                    sessions={sessions}
                  />
                )}
                {!showHome && activeSessionId && (
                  <ChatPanel
                    autoApprove={approvalMode === "auto"}
                    autoDispatchEnabled={autoDispatchEnabled}
                    emptyState={{
                      labels: {
                        body: t("chat.emptyBody"),
                        presets: t("chat.emptyPresets"),
                        startWithVibe: t("chat.emptyStartVibe"),
                        title: t("chat.emptyTitle"),
                        uploadLibrary: t("chat.emptyUpload"),
                      },
                      presets: [
                        {
                          id: "focus",
                          label: t("chat.presetFocus"),
                          prompt: t("chat.presetFocusPrompt"),
                        },
                        {
                          id: "chill",
                          label: t("chat.presetChill"),
                          prompt: t("chat.presetChillPrompt"),
                        },
                        {
                          id: "hype",
                          label: t("chat.presetHype"),
                          prompt: t("chat.presetHypePrompt"),
                        },
                      ],
                    }}
                    budgetLabels={{
                      compress: t("chat.budgetCompress"),
                      detail: (result) =>
                        `~${result.estimatedTokens.toLocaleString()} / ${result.maxTokens.toLocaleString()} tokens`,
                      states: {
                        block: t("chat.budgetBlock"),
                        ok: "",
                        warn: t("chat.budgetWarn"),
                      },
                    }}
                    onAutoDispatchChange={(enabled) => setAutoDispatch(activeSessionId, enabled)}
                    onUploadLibrary={() => {
                      setMode("chip");
                      onUploadLibrary?.();
                    }}
                    queueLabels={{
                      autoDispatch: t("chat.queueAutoDispatch"),
                      delete: t("chat.queueDelete"),
                      dragHandle: t("chat.queueDragHandle"),
                      empty: t("chat.queueEmpty"),
                      itemPosition: (index, total) => `${index + 1} / ${total}`,
                      moveDown: t("chat.queueMoveDown"),
                      moveUp: t("chat.queueMoveUp"),
                      send: t("chat.queueSend"),
                      title: t("chat.queueTitle"),
                    }}
                    contextMaxTokens={settings.chatMaxContextTokens}
                    scrollToBottomLabel={t("chat.scrollToBottom")}
                    sessionId={activeSessionId}
                    slashCommands={slashCommands}
                    toolLabels={{
                      approve: t("chat.toolApprove"),
                      error: t("chat.toolError"),
                      input: t("chat.toolInput"),
                      output: t("chat.toolOutput"),
                      reject: t("chat.toolReject"),
                      states: {
                        "approval-requested": t("chat.toolStateApproval"),
                        "approval-responded": t("chat.toolStateResponded"),
                        "input-available": t("chat.toolStateRunning"),
                        "input-streaming": t("chat.toolStateRunning"),
                        "output-available": t("chat.toolStateDone"),
                        "output-denied": t("chat.toolStateDenied"),
                        "output-error": t("chat.toolStateError"),
                      },
                      tools: toolLabelMap,
                    }}
                  />
                )}
              </motion.section>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
