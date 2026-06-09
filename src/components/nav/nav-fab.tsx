import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Tab } from "@/components/nav/dock-nav";
import type { AnimatedNavIconHandle, NavFabItem } from "@/components/nav/nav-fab-items";
import { NAV_ITEMS } from "@/components/nav/nav-fab-items";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isMac, modifierSymbol } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";

function shortcutKeys(index: number, mac: boolean): string[] {
  return [modifierSymbol(mac), String(index + 1)];
}

function NavFabChip({
  item,
  index,
  active,
  label,
  mac,
  onPick,
}: {
  item: NavFabItem;
  index: number;
  active: boolean;
  label: string;
  mac: boolean;
  onPick: (id: Tab) => void;
}) {
  const iconRef = useRef<AnimatedNavIconHandle>(null);
  const Icon = item.icon;
  const keys = shortcutKeys(index, mac);

  function startIconAnimation() {
    iconRef.current?.startAnimation();
  }

  function stopIconAnimation() {
    iconRef.current?.stopAnimation();
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <motion.button
            type="button"
            onClick={() => onPick(item.id)}
            onMouseEnter={startIconAnimation}
            onMouseLeave={stopIconAnimation}
            onFocus={startIconAnimation}
            onBlur={stopIconAnimation}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            initial={{ opacity: 0, y: 10, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.85 }}
            transition={{ delay: (NAV_ITEMS.length - 1 - index) * 0.035 }}
            className={cn(
              "flex items-center gap-2.5 rounded-full bg-card py-2.5 pe-4 ps-4 shadow-md ring-1 ring-border/40 outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring",
              active ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon ref={iconRef} size={20} />
            <span className="whitespace-nowrap text-[15px] font-medium">{label}</span>
          </motion.button>
        }
      />
      <TooltipContent side="left">
        <span className="flex items-center gap-2">
          <span>{label}</span>
          <KbdGroup>
            {keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        </span>
      </TooltipContent>
    </Tooltip>
  );
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
  const mac = isMac();

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
    <TooltipProvider>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover-intent wrapper; all destinations are reachable via the FAB button + Cmd/Ctrl+1..3 */}
      <div className="relative shrink-0" onMouseEnter={open} onMouseLeave={scheduleClose}>
        <AnimatePresence>
          {expanded && (
            <motion.div
              onMouseEnter={open}
              onMouseLeave={scheduleClose}
              className="absolute bottom-full right-0 z-50 mb-2 flex flex-col items-end gap-2.5"
            >
              {NAV_ITEMS.map((item, i) => (
                <NavFabChip
                  key={item.id}
                  item={item}
                  index={i}
                  active={item.id === value}
                  label={t(`nav.${item.labelKey}`)}
                  mac={mac}
                  onPick={pick}
                />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-label={t("nav.menu")}
          aria-expanded={expanded}
          className={cn(
            "relative z-50 grid size-11 place-items-center rounded-full bg-card/90 shadow-lg ring-1 ring-border/40 outline-none backdrop-blur-md transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring",
            expanded ? "bg-accent text-foreground" : "text-primary hover:bg-card",
          )}
        >
          {expanded ? <X size={20} /> : <CurrentIcon size={20} />}
        </button>
      </div>
    </TooltipProvider>
  );
}
