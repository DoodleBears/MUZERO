import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { Tab } from "@/components/nav/dock-nav";
import { AudioLinesIcon } from "@/components/ui/audio-lines";
import { SearchIcon } from "@/components/ui/search";
import { SettingsIcon } from "@/components/ui/settings";
import { SparklesIcon } from "@/components/ui/sparkles";
import { cn } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";

// lucide-animated icons (animate on hover); inherit color via currentColor.
type AnimatedIcon = ComponentType<{ size?: number; className?: string }>;

export interface NavItem {
  /** Tab id — never "now": Now Playing is reached by tapping the player area. */
  id: Exclude<Tab, "now">;
  labelKey: "queue" | "search" | "sets" | "settings";
  icon: AnimatedIcon;
}

// Q1: four integrated tabs, evenly spaced (Poweramp-style), no "now".
export const NAV_ITEMS: NavItem[] = [
  { id: "queue", labelKey: "queue", icon: AudioLinesIcon },
  { id: "search", labelKey: "search", icon: SearchIcon },
  { id: "sessions", labelKey: "sets", icon: SparklesIcon },
  { id: "settings", labelKey: "settings", icon: SettingsIcon },
];

/**
 * Row 3 of the player-dock: a flat, evenly-spaced navigation row integrated into
 * the player container (replaces the floating Magic UI magnify-dock as the
 * primary nav form). Desktop gets a gentle hover lift; touch keeps a ≥44px tap
 * target with no magnification. Honors reduced motion.
 */
export function NavRow({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const { t } = useTranslation();
  return (
    <nav className="flex items-center justify-around gap-1">
      {NAV_ITEMS.map(({ id, labelKey, icon: Icon }) => {
        const active = value === id;
        const label = t(`nav.${labelKey}`);
        return (
          <button
            key={id}
            type="button"
            onClick={() => transitionState(() => onChange(id))}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            title={label}
            className={cn(
              "grid size-11 place-items-center rounded-full outline-none transition-transform",
              "hover:scale-110 motion-reduce:transition-none motion-reduce:hover:scale-100",
              "focus-visible:ring-2 focus-visible:ring-ring",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon size={20} />
          </button>
        );
      })}
    </nav>
  );
}
