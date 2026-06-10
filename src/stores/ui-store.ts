import { create } from "zustand";

/**
 * Ephemeral UI state (drawers / sheets) — never persisted. Lets global surfaces
 * (e.g. the keyboard-shortcut dispatcher) drive UI that's otherwise local to a
 * deep component, such as the Dock's up-next queue Drawer.
 */
interface UiState {
  /** The up-next queue Drawer — opened from the Dock button or the queue shortcut. */
  queueOpen: boolean;
  setQueueOpen: (open: boolean) => void;
  toggleQueue: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  queueOpen: false,
  setQueueOpen: (open) => set({ queueOpen: open }),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
}));
