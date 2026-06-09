import { create } from "zustand";

/**
 * The track whose cover an app-wide pasted / dropped image should set — published
 * by views that show a selected track in the inspector (the library 所有歌曲 list,
 * an artist / album entity page). The window-level {@link GlobalDropZone} reads
 * this so an image lands on the song you're looking at instead of falling back to
 * the "playing track or global gallery" routing when nothing is playing.
 *
 * Sibling of {@link useUploadTargetStore} (which routes app-wide MEDIA). Ephemeral
 * UI routing only — never persisted, never the player store (rule #6).
 */
interface CoverTargetState {
  /** Selected track in the current view, or null when no view publishes one. */
  trackId: string | null;
  setCoverTarget: (trackId: string | null) => void;
}

export const useCoverTargetStore = create<CoverTargetState>((set) => ({
  trackId: null,
  setCoverTarget: (trackId) => set({ trackId }),
}));
