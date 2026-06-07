import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ComponentType, useEffect, useRef, useState } from "react";
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
 * The nav, collapsed into a single small round FAB to the right of the player-info
 * rows. It expands ON HOVER (a short close-delay bridges the gap to the pills, so
 * moving the cursor up to them never collapses it) into a vertical stack of the
 * three destinations; clicking still toggles it for touch. Picking one navigates
 * and collapses. The collapsed button shows the current destination's icon.
 */
export function NavFab({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useNavShortcuts(onChange);

  function open() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setExpanded(true);
  }
  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setExpanded(false), 140);
  }
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const current = NAV_ITEMS.find((i) => i.id === value) ?? NAV_ITEMS[0];
  const CurrentIcon = current.icon;

  function pick(id: Tab) {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    transitionState(() => onChange(id));
    setExpanded(false);
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-intent wrapper; all destinations are reachable via the FAB button + Cmd/Ctrl+1..3
    <div className="relative shrink-0" onMouseEnter={open} onMouseLeave={scheduleClose}>
      <AnimatePresence>
        {expanded && (
          <motion.div
            onMouseEnter={open}
            onMouseLeave={scheduleClose}
            className="absolute bottom-full right-0 z-50 mb-2 flex flex-col items-end gap-2.5"
          >
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
                  initial={{ opacity: 0, y: 10, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.85 }}
                  transition={{ delay: (NAV_ITEMS.length - 1 - i) * 0.035 }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-full bg-card py-2.5 pe-4 ps-4 shadow-md ring-1 ring-border/40 outline-none transition-colors",
                    "focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon size={20} />
                  <span className="whitespace-nowrap text-[15px] font-medium">{label}</span>
                </motion.button>
              );
            })}
          </motion.div>
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
