import { type ComponentType, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Tab } from "@/components/nav/dock-nav";
import { AudioLinesIcon } from "@/components/ui/audio-lines";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { SearchIcon } from "@/components/ui/search";
import { SettingsIcon } from "@/components/ui/settings";
import { SparklesIcon } from "@/components/ui/sparkles";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isMac, modifierSymbol, tabForShortcutKey } from "@/lib/shortcuts";
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
// Order matches SHORTCUT_TABS so Cmd/Ctrl+1..4 line up with the visible row.
export const NAV_ITEMS: NavItem[] = [
  { id: "queue", labelKey: "queue", icon: AudioLinesIcon },
  { id: "search", labelKey: "search", icon: SearchIcon },
  { id: "sessions", labelKey: "sets", icon: SparklesIcon },
  { id: "settings", labelKey: "settings", icon: SettingsIcon },
];

/** Cmd/Ctrl+1..4 switch tabs (1-indexed, matching NAV_ITEMS). Either modifier works. */
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
 * Row 3 of the player-dock: a flat, evenly-spaced navigation row integrated into
 * the player container. Desktop gets a gentle hover lift; touch keeps a ≥44px tap
 * target. Each item has a tooltip showing its label + Cmd/Ctrl+N shortcut (Kbd).
 */
export function NavRow({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const { t } = useTranslation();
  const mod = modifierSymbol(isMac());
  useNavShortcuts(onChange);

  return (
    // Short open delay — these tooltips exist to surface the shortcut on a
    // deliberate hover; Base UI's default delay feels like the tip never shows.
    <TooltipProvider delay={200} closeDelay={0}>
      <nav className="flex items-center justify-around gap-1">
        {NAV_ITEMS.map(({ id, labelKey, icon: Icon }, index) => {
          const active = value === id;
          const label = t(`nav.${labelKey}`);
          return (
            <Tooltip key={id}>
              <TooltipTrigger
                onClick={() => transitionState(() => onChange(id))}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid size-11 place-items-center rounded-full outline-none transition-transform",
                  "hover:scale-110 motion-reduce:transition-none motion-reduce:hover:scale-100",
                  "focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={20} />
              </TooltipTrigger>
              <TooltipContent>
                <span className="flex items-center gap-2">
                  {label}
                  <KbdGroup>
                    <Kbd>{mod}</Kbd>
                    <Kbd>{index + 1}</Kbd>
                  </KbdGroup>
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </TooltipProvider>
  );
}
