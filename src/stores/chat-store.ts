import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DjChatRuntimeMeta } from "@/chat/types";

/**
 * Display state of the dock-integrated chat entry (PRD §3.3/§5):
 * icon (minimize) → chip (normal rounded input, default) → expanded (widget).
 * Whether the entry renders AT ALL is derived via `canUseDjChat(settings)`,
 * not stored here.
 */
export type ChatMode = "icon" | "chip" | "expanded";

const CHAT_UI_VERSION = 1;

/**
 * HITL approval preference (PRD §4.3): "ask" (default) pauses paid tool calls
 * (dj_generate_tracks) on an approval card; "auto" is the user-opted
 * no-approval mode that accepts them automatically. A human setting — the
 * model never chooses it.
 */
export type ChatApprovalMode = "ask" | "auto";

interface ChatState {
  mode: ChatMode;
  approvalMode: ChatApprovalMode;
  activeSessionId: string | null;
  runtimeMetaBySessionId: Record<string, DjChatRuntimeMeta>;
  /**
   * Per-session auto-dispatch switch (PRD §5.8). Ephemeral — NOT persisted, so
   * a reload defaults every session back to off ("reason: reload"), the desired
   * safety behavior. Lives in the store (not the actor) so the queue tray
   * reflects it without a runtime round-trip.
   */
  autoDispatchBySessionId: Record<string, boolean>;
  setMode: (mode: ChatMode) => void;
  setApprovalMode: (approvalMode: ChatApprovalMode) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setRuntimeMeta: (meta: DjChatRuntimeMeta) => void;
  clearRuntimeMeta: (sessionId: string) => void;
  setAutoDispatch: (sessionId: string, enabled: boolean) => void;
}

/**
 * v0 → v1: the retired four-form shell (fab / bar / dock / fullscreen)
 * collapses onto the three dock-entry states; `dockSide` is dropped (the entry
 * is anchored in the dock tool row). Exported for direct unit testing.
 */
export function migrateChatUiState(persisted: unknown, version: number): unknown {
  const state = (persisted ?? {}) as Record<string, unknown>;
  if (version >= CHAT_UI_VERSION) return state;
  const legacy: Record<string, ChatMode> = {
    fab: "icon",
    bar: "chip",
    dock: "expanded",
    fullscreen: "expanded",
    icon: "icon",
    chip: "chip",
    expanded: "expanded",
  };
  const { dockSide: _dropped, ...rest } = state;
  return { ...rest, mode: legacy[String(state.mode)] ?? "chip" };
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      mode: "chip",
      approvalMode: "ask",
      activeSessionId: null,
      runtimeMetaBySessionId: {},
      autoDispatchBySessionId: {},
      setMode: (mode) => set({ mode }),
      setApprovalMode: (approvalMode) => set({ approvalMode }),
      setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
      setRuntimeMeta: (meta) =>
        set((state) => ({
          runtimeMetaBySessionId: {
            ...state.runtimeMetaBySessionId,
            [meta.sessionId]: meta,
          },
        })),
      clearRuntimeMeta: (sessionId) =>
        set((state) => {
          const next = { ...state.runtimeMetaBySessionId };
          delete next[sessionId];
          return { runtimeMetaBySessionId: next };
        }),
      setAutoDispatch: (sessionId, enabled) =>
        set((state) => ({
          autoDispatchBySessionId: { ...state.autoDispatchBySessionId, [sessionId]: enabled },
        })),
    }),
    {
      name: "muzero-chat-ui",
      version: CHAT_UI_VERSION,
      migrate: migrateChatUiState,
      partialize: (state) => ({
        mode: state.mode,
        approvalMode: state.approvalMode,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);
