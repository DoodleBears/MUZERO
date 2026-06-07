import { create } from "zustand";

/**
 * Where app-wide dropped / pasted MEDIA (audio/video) should land — set by the
 * current view so the window-level {@link GlobalDropZone} routes without fighting
 * per-view listeners:
 *  - `pick`   — the 歌单 gallery (level 1): show a target-set picker
 *  - `set`    — a 歌单 detail page (level 2): straight into that set
 *  - `active` — anywhere else: the existing "active set / new upload set" behavior
 */
export type UploadTarget = { kind: "active" } | { kind: "set"; setId: string } | { kind: "pick" };

interface UploadTargetState {
  target: UploadTarget;
  setTarget: (target: UploadTarget) => void;
}

export const useUploadTargetStore = create<UploadTargetState>((set) => ({
  target: { kind: "active" },
  setTarget: (target) => set({ target }),
}));
