import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Tab } from "@/components/nav/dock-nav";
import type { SystemPlaylistId } from "@/lib/system-playlists";
import type { StreamPlaylist } from "@/streamsrc/provider";

const VALID_TABS = new Set<Tab>(["now", "queue", "search", "sessions", "settings"]);

export function normalizeTab(value: unknown): Tab {
  if (value === "sets") return "search";
  return typeof value === "string" && VALID_TABS.has(value as Tab) ? (value as Tab) : "search";
}

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
 * artist by normalized name, album by track membership (compilation-safe), and
 * online playlists carry their source metadata snapshot for the detail page.
 */
export type LibraryEntityTarget =
  | { kind: "set"; id: string; anchorTrackId?: string }
  | { kind: "system-playlist"; id: SystemPlaylistId; anchorTrackId?: string }
  | { kind: "artist"; name: string }
  | { kind: "album"; trackId: string }
  | { kind: "online-playlist"; playlist: StreamPlaylist; anchorTrackId?: string };

interface NavState {
  tab: Tab;
  setTab: (tab: Tab) => void;
  /** Active item in the two-column Settings page (sidebar → detail). */
  settingsItem: string;
  setSettingsItem: (item: string) => void;
  /** Pending library entity to open; ephemeral, never persisted. */
  pendingLibraryEntity: LibraryEntityTarget | null;
  /** Switch to the library tab and queue a set to open. */
  openSet: (id: string, anchorTrackId?: string) => void;
  /** Switch to the library tab and queue a system playlist to open. */
  openSystemPlaylist: (id: SystemPlaylistId, anchorTrackId?: string) => void;
  /** Switch to the library tab and queue an artist to open. */
  openArtist: (name: string) => void;
  /** Switch to the library tab and queue the album containing a track. */
  openAlbumForTrack: (trackId: string) => void;
  /** Switch to the online library tab and open an external playlist detail page. */
  openOnlinePlaylist: (playlist: StreamPlaylist, anchorTrackId?: string) => void;
  /** Read + clear the pending entity (the library page calls this on mount). */
  consumeLibraryEntity: () => LibraryEntityTarget | null;
}

export const useNavStore = create<NavState>()(
  persist(
    (set, get) => ({
      tab: "search",
      setTab: (tab) => set({ tab: normalizeTab(tab) }),
      settingsItem: "appearance",
      setSettingsItem: (settingsItem) => set({ settingsItem }),
      pendingLibraryEntity: null,
      openSet: (id, anchorTrackId) =>
        set({
          tab: "search",
          pendingLibraryEntity: {
            kind: "set",
            id,
            ...(anchorTrackId !== undefined ? { anchorTrackId } : {}),
          },
        }),
      openSystemPlaylist: (id, anchorTrackId) =>
        set({
          tab: "search",
          pendingLibraryEntity: {
            kind: "system-playlist",
            id,
            ...(anchorTrackId !== undefined ? { anchorTrackId } : {}),
          },
        }),
      openArtist: (name) => set({ tab: "search", pendingLibraryEntity: { kind: "artist", name } }),
      openAlbumForTrack: (trackId) =>
        set({ tab: "search", pendingLibraryEntity: { kind: "album", trackId } }),
      openOnlinePlaylist: (playlist, anchorTrackId) =>
        set({
          tab: "search",
          pendingLibraryEntity: {
            kind: "online-playlist",
            playlist,
            ...(anchorTrackId !== undefined ? { anchorTrackId } : {}),
          },
        }),
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
      merge: (persisted, current) => {
        const row =
          persisted && typeof persisted === "object"
            ? (persisted as Partial<Pick<NavState, "settingsItem" | "tab">>)
            : {};
        return {
          ...current,
          settingsItem:
            typeof row.settingsItem === "string" ? row.settingsItem : current.settingsItem,
          tab: normalizeTab(row.tab),
        };
      },
    },
  ),
);
