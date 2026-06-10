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
  /**
   * Whether the chrome (Dock / header) is hidden for immersive idle. Mirrored
   * from App so deep surfaces (e.g. the lyrics search affordance) can fade their
   * own controls in sync with the Dock.
   */
  chromeHidden: boolean;
  setChromeHidden: (hidden: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  queueOpen: false,
  setQueueOpen: (open) => set({ queueOpen: open }),
  toggleQueue: () => set((s) => ({ queueOpen: !s.queueOpen })),
  chromeHidden: false,
  setChromeHidden: (hidden) =>
    set((s) => (s.chromeHidden === hidden ? s : { chromeHidden: hidden })),
}));
