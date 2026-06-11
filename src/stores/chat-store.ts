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

interface ChatState {
  mode: ChatMode;
  activeSessionId: string | null;
  runtimeMetaBySessionId: Record<string, DjChatRuntimeMeta>;
  setMode: (mode: ChatMode) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setRuntimeMeta: (meta: DjChatRuntimeMeta) => void;
  clearRuntimeMeta: (sessionId: string) => void;
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
      activeSessionId: null,
      runtimeMetaBySessionId: {},
      setMode: (mode) => set({ mode }),
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
    }),
    {
      name: "muzero-chat-ui",
      version: CHAT_UI_VERSION,
      migrate: migrateChatUiState,
      partialize: (state) => ({
        mode: state.mode,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);
