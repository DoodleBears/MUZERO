import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { AudioLinesIcon } from "@/components/ui/audio-lines";
import { buttonVariants } from "@/components/ui/button";
import { Dock, DockIcon } from "@/components/ui/dock";
import { RadioIcon } from "@/components/ui/radio";
import { SearchIcon } from "@/components/ui/search";
import { Separator } from "@/components/ui/separator";
import { SettingsIcon } from "@/components/ui/settings";
import { SparklesIcon } from "@/components/ui/sparkles";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type Tab = "now" | "queue" | "search" | "sessions" | "settings";

// lucide-animated icons (animate on hover; https://lucide-animated.com). Each is
// a div-wrapped SVG that takes a numeric `size` and inherits color via currentColor.
type AnimatedIcon = ComponentType<{ size?: number; className?: string }>;

interface NavItem {
  id: Tab;
  labelKey: "now" | "queue" | "search" | "sets" | "settings";
  icon: AnimatedIcon;
}

// Navigation grouped: content tabs · separator · settings (mirrors the Magic UI
// dock demo's navbar | social split).
const NAV_ITEMS: NavItem[] = [
  { id: "now", labelKey: "now", icon: RadioIcon },
  { id: "queue", labelKey: "queue", icon: AudioLinesIcon },
  { id: "search", labelKey: "search", icon: SearchIcon },
  { id: "sessions", labelKey: "sets", icon: SparklesIcon },
];
const META_ITEMS: NavItem[] = [{ id: "settings", labelKey: "settings", icon: SettingsIcon }];

/**
 * MUZERO's bottom navigation: a Magic UI macOS-style Dock of ghost icon-buttons
 * with Tooltip labels. The icons are lucide-animated — they animate on hover —
 * and dock magnification is kept subtle (44 → 50px) so hovering lifts gently.
 */
export function DockNav({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  const { t } = useTranslation();
  const renderItem = ({ id, labelKey, icon: Icon }: NavItem) => {
    const active = value === id;
    const label = t(`nav.${labelKey}`);
    return (
      <DockIcon key={id}>
        <Tooltip>
          <TooltipTrigger
            onClick={() => onChange(id)}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "size-11 rounded-full",
              active ? "bg-accent text-primary" : "text-muted-foreground",
            )}
          >
            {/* The icon's hover-sensing wrapper div fills the whole button, so the
                animation fires on hovering anywhere on the nav item — not just the
                ~20px glyph. */}
            <Icon size={20} className="flex size-full items-center justify-center" />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </DockIcon>
    );
  };

  return (
    <div className="flex justify-center px-4 pb-3">
      <TooltipProvider>
        <Dock
          direction="bottom"
          className="mt-1"
          iconSize={44}
          iconMagnification={50}
          iconDistance={100}
        >
          {NAV_ITEMS.map(renderItem)}
          <Separator orientation="vertical" className="h-full" />
          {META_ITEMS.map(renderItem)}
        </Dock>
      </TooltipProvider>
    </div>
  );
}
