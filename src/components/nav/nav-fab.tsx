import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Tab } from "@/components/nav/dock-nav";
import { AudioLinesIcon } from "@/components/ui/audio-lines";
import { SettingsIcon } from "@/components/ui/settings";
import { SparklesIcon } from "@/components/ui/sparkles";
import { tabForShortcutKey } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";

type AnimatedIcon = ComponentType<{ size?: number; className?: string }>;

export interface NavFabItem {
  id: Exclude<Tab, "queue" | "sessions">;
  labelKey: "now" | "sets" | "settings";
  icon: AnimatedIcon;
}

/**
 * The three destinations of the merged nav FAB: playback · 歌单 gallery · settings.
 * Queue lives inside Now Playing; sets are browsed in the gallery; the AI helper
 * is its own draggable FAB. Order matches SHORTCUT_TABS (Cmd/Ctrl+1..3).
 */
export const NAV_ITEMS: NavFabItem[] = [
  { id: "now", labelKey: "now", icon: AudioLinesIcon },
  { id: "search", labelKey: "sets", icon: SparklesIcon },
  { id: "settings", labelKey: "settings", icon: SettingsIcon },
];

/** Cmd/Ctrl+1..3 jump straight to a destination (no need to open the FAB). */
function useNavShortcuts(onChange: (tab: Tab) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const tab = tabForShortcutKey(e.key);
      if (!tab) return;
      e.preventDefault();
      transitionState(() => onChange(tab));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChange]);
}

/**
 * The nav, collapsed into a single small round FAB sitting to the right of the
 * player-info rows. Tapping it expands a vertical stack of the three destinations
 * (motion-animated); picking one navigates and collapses. The collapsed button
 * shows the current destination's icon so you always see where you are.
 */
export function NavFab({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  useNavShortcuts(onChange);

  const current = NAV_ITEMS.find((i) => i.id === value) ?? NAV_ITEMS[0];
  const CurrentIcon = current.icon;

  function pick(id: Tab) {
    transitionState(() => onChange(id));
    setExpanded(false);
  }

  return (
    <div className="relative shrink-0">
      <AnimatePresence>
        {expanded && (
          <>
            {/* Click-away backdrop. */}
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setExpanded(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <motion.div className="absolute bottom-full right-0 z-50 mb-2 flex flex-col items-end gap-2">
              {NAV_ITEMS.map((item, i) => {
                const Icon = item.icon;
                const active = item.id === value;
                const label = t(`nav.${item.labelKey}`);
                return (
                  <motion.button
                    key={item.id}
                    type="button"
                    onClick={() => pick(item.id)}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                    initial={{ opacity: 0, y: 8, scale: 0.85 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.85 }}
                    transition={{ delay: (NAV_ITEMS.length - 1 - i) * 0.03 }}
                    className={cn(
                      "flex items-center gap-2 rounded-full bg-card py-2 pe-3 ps-3 shadow-md ring-1 ring-border/40 outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon size={18} />
                    <span className="whitespace-nowrap text-sm font-medium">{label}</span>
                  </motion.button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-label={t("nav.menu")}
        aria-expanded={expanded}
        className={cn(
          "relative z-50 grid size-11 place-items-center rounded-full outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring",
          expanded ? "bg-accent text-foreground" : "text-primary hover:bg-accent/50",
        )}
      >
        {expanded ? <X size={20} /> : <CurrentIcon size={20} />}
      </button>
    </div>
  );
}
