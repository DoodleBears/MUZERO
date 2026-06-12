import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Tab } from "@/components/nav/dock-nav";

/**
 * The active navigation tab, persisted so the app reopens where you left off.
 * Uses zustand `persist` (localStorage `muzero-nav`) — the same tiny-UI-pref
 * pattern as the locale (`muzero-locale`) and theme (`muzero-theme`); core data
 * still lives in IndexedDB.
 */
/**
 * An ephemeral "open this derived entity in the library" intent, set from any
 * track surface (rows, inspector — which render outside the library tab) and
 * consumed by the library page once it mounts/activates. Set resolves by id,
 * artist by normalized name, and album by track membership (compilation-safe),
 * so the caller never needs the derived album key.
 */
export type LibraryEntityTarget =
  | { kind: "set"; id: string }
  | { kind: "artist"; name: string }
  | { kind: "album"; trackId: string };

interface NavState {
  tab: Tab;
  setTab: (tab: Tab) => void;
  /** Active item in the two-column Settings page (sidebar → detail). */
  settingsItem: string;
  setSettingsItem: (item: string) => void;
  /** Pending library entity to open; ephemeral, never persisted. */
  pendingLibraryEntity: LibraryEntityTarget | null;
  /** Switch to the library tab and queue a set to open. */
  openSet: (id: string) => void;
  /** Switch to the library tab and queue an artist to open. */
  openArtist: (name: string) => void;
  /** Switch to the library tab and queue the album containing a track. */
  openAlbumForTrack: (trackId: string) => void;
  /** Read + clear the pending entity (the library page calls this on mount). */
  consumeLibraryEntity: () => LibraryEntityTarget | null;
}

export const useNavStore = create<NavState>()(
  persist(
    (set, get) => ({
      tab: "sessions",
      setTab: (tab) => set({ tab }),
      settingsItem: "appearance",
      setSettingsItem: (settingsItem) => set({ settingsItem }),
      pendingLibraryEntity: null,
      openSet: (id) => set({ tab: "search", pendingLibraryEntity: { kind: "set", id } }),
      openArtist: (name) => set({ tab: "search", pendingLibraryEntity: { kind: "artist", name } }),
      openAlbumForTrack: (trackId) =>
        set({ tab: "search", pendingLibraryEntity: { kind: "album", trackId } }),
      consumeLibraryEntity: () => {
        const pending = get().pendingLibraryEntity;
        if (pending) set({ pendingLibraryEntity: null });
        return pending;
      },
    }),
    {
      name: "muzero-nav",
      // Only persist navigation position — never the ephemeral open intent.
      partialize: (state) => ({ tab: state.tab, settingsItem: state.settingsItem }),
    },
  ),
);
