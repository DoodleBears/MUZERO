import { create } from "zustand";

/**
 * Ephemeral, non-persisted view state — deliberately separate from `player-store`
 * so transient UI toggles don't couple to playback state (and so this stays out
 * of that store's selector surface). Currently just the mobile full-screen Now
 * Playing sheet's open flag.
 */
interface UiState {
  /** Whether the mobile full-screen Now Playing sheet is expanded. */
  isSheetOpen: boolean;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  isSheetOpen: false,
  openSheet: () => set({ isSheetOpen: true }),
  closeSheet: () => set({ isSheetOpen: false }),
}));
