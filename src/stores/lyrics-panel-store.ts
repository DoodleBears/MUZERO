import { create } from "zustand";

/** Open state for the Now-Playing floating lyrics tuning panel (ephemeral). */
interface LyricsPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
}

export const useLyricsPanelStore = create<LyricsPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((s) => ({ open: !s.open })),
}));
