import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Tab } from "@/components/nav/dock-nav";

/**
 * The active navigation tab, persisted so the app reopens where you left off.
 * Uses zustand `persist` (localStorage `muzero-nav`) — the same tiny-UI-pref
 * pattern as the locale (`muzero-locale`) and theme (`muzero-theme`); core data
 * still lives in IndexedDB.
 */
interface NavState {
  tab: Tab;
  setTab: (tab: Tab) => void;
  /** Active item in the two-column Settings page (sidebar → detail). */
  settingsItem: string;
  setSettingsItem: (item: string) => void;
}

export const useNavStore = create<NavState>()(
  persist(
    (set) => ({
      tab: "sessions",
      setTab: (tab) => set({ tab }),
      settingsItem: "appearance",
      setSettingsItem: (settingsItem) => set({ settingsItem }),
    }),
    { name: "muzero-nav" },
  ),
);
