import { create } from "zustand";

interface VisualizerPanelState {
  open: boolean;
  previewOnly: boolean;
  visualizerHidden: boolean;
  setOpen: (open: boolean) => void;
  setPreviewOnly: (previewOnly: boolean) => void;
  setVisualizerHidden: (visualizerHidden: boolean) => void;
  toggleOpen: () => void;
}

export const useVisualizerPanelStore = create<VisualizerPanelState>((set) => ({
  open: false,
  previewOnly: false,
  visualizerHidden: false,
  setOpen: (open) => set({ open }),
  setPreviewOnly: (previewOnly) => set({ previewOnly }),
  setVisualizerHidden: (visualizerHidden) => set({ visualizerHidden }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
}));
