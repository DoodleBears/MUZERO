import { create } from "zustand";

interface CoverAppearancePanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
}

export const useCoverAppearancePanelStore = create<CoverAppearancePanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
}));
