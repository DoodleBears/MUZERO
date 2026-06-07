import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DjChatRuntimeMeta } from "@/chat/types";

export type ChatMode = "fab" | "bar" | "dock" | "fullscreen";

interface ChatState {
  mode: ChatMode;
  dockSide: "left" | "right";
  activeSessionId: string | null;
  runtimeMetaBySessionId: Record<string, DjChatRuntimeMeta>;
  setMode: (mode: ChatMode) => void;
  setDockSide: (dockSide: "left" | "right") => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setRuntimeMeta: (meta: DjChatRuntimeMeta) => void;
  clearRuntimeMeta: (sessionId: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      mode: "bar",
      dockSide: "right",
      activeSessionId: null,
      runtimeMetaBySessionId: {},
      setMode: (mode) => set({ mode }),
      setDockSide: (dockSide) => set({ dockSide }),
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
      partialize: (state) => ({
        mode: state.mode,
        dockSide: state.dockSide,
        activeSessionId: state.activeSessionId,
      }),
    },
  ),
);
