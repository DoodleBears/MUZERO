import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { Tab } from "@/components/nav/dock-nav";
import type { AnimatedNavIconHandle, NavFabItem } from "@/components/nav/nav-fab-items";
import { NAV_ITEMS } from "@/components/nav/nav-fab-items";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { isMac, modifierSymbol } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

type HeaderNavTab = (typeof NAV_ITEMS)[number]["id"];

function isHeaderNavTab(value: Tab): value is HeaderNavTab {
  return NAV_ITEMS.some((item) => item.id === value);
}

function shortcutKeys(index: number, mac: boolean): string[] {
  return [modifierSymbol(mac), String(index + 1)];
}

function HeaderNavTabsTab({
  active,
  index,
  item,
  label,
  mac,
  onReselect,
}: {
  active: boolean;
  index: number;
  item: NavFabItem;
  label: string;
  mac: boolean;
  onReselect: () => void;
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
          <TabsTab
            className="h-7 bg-accent/30 px-3 text-xs data-[selected]:bg-transparent"
            // Base UI `Tabs` fires `onValueChange` only on a real change, so
            // re-clicking the already-active tab is swallowed. Route that click
            // through `onReselect` so it still reaches `setTab` (which backs the
            // library tab out of any open detail — the re-tap-to-home behavior).
            onClick={active ? onReselect : undefined}
            onBlur={stopIconAnimation}
            onFocus={startIconAnimation}
            onMouseEnter={startIconAnimation}
            onMouseLeave={stopIconAnimation}
            value={item.id}
          >
            <Icon ref={iconRef} size={15} />
            {label}
          </TabsTab>
        }
      />
      <TooltipContent side="bottom" sideOffset={8}>
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

export function HeaderNavTabs({
  foregroundVisible = true,
  hidden = false,
  value,
  onChange,
  onDoubleClick,
}: {
  foregroundVisible?: boolean;
  hidden?: boolean;
  value: Tab;
  onChange: (tab: Tab) => void;
  onDoubleClick: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mac = isMac();
  const tabValue = isHeaderNavTab(value) ? value : NAV_ITEMS[0].id;

  function clearCloseTimer() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function open() {
    clearCloseTimer();
    setExpanded(true);
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setExpanded(false), 140);
  }

  function pick(next: HeaderNavTab) {
    clearCloseTimer();
    // Plain tab switch — `onChange` routes through `navigateToTab` (App), which is
    // faithful on kept-mounted tabs. Do NOT wrap in a View Transition: that reset
    // the library tab's scroll/sort (tab-switch state-reset alignment PRD).
    onChange(next);
  }

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (foregroundVisible) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setExpanded(false);
  }, [foregroundVisible]);

  if (!foregroundVisible) return null;

  const toolbar = (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover-intent wrapper; the wordmark button and tabs own keyboard interaction.
    <div
      className="group/header-nav fixed top-1 left-1/2 z-[80] flex h-9 w-72 -translate-x-1/2 items-center justify-center bg-transparent [-webkit-app-region:no-drag]"
      data-no-drag
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) scheduleClose();
      }}
      onFocus={open}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      <button
        aria-label="MUZERO"
        className={cn(
          "cursor-default border-0 bg-transparent px-2 py-1 font-semibold tracking-tight text-inherit outline-none transition duration-150 [-webkit-app-region:no-drag]",
          hidden &&
            "-translate-y-0.5 opacity-0 group-hover/header-nav:translate-y-0 group-hover/header-nav:opacity-100 group-focus-within/header-nav:translate-y-0 group-focus-within/header-nav:opacity-100",
          expanded && "-translate-y-0.5 opacity-0",
        )}
        data-no-drag
        onClick={open}
        onDoubleClick={onDoubleClick}
        type="button"
      >
        MUZERO
      </button>

      <AnimatePresence>
        {expanded && (
          <div
            className="absolute left-1/2 top-1/2 z-20 w-max -translate-x-1/2 -translate-y-1/2 [-webkit-app-region:no-drag]"
            data-no-drag
          >
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              initial={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            >
              <TooltipProvider>
                <Tabs
                  className="gap-0"
                  onValueChange={(next) => pick(next as HeaderNavTab)}
                  value={tabValue}
                >
                  <TabsList className="border-0 bg-transparent">
                    <TabsIndicator className="bg-accent/70" />
                    {NAV_ITEMS.map((item, index) => {
                      const label = t(`nav.${item.labelKey}`);

                      return (
                        <HeaderNavTabsTab
                          active={item.id === tabValue}
                          index={index}
                          item={item}
                          key={item.id}
                          label={label}
                          mac={mac}
                          onReselect={() => pick(item.id)}
                        />
                      );
                    })}
                  </TabsList>
                </Tabs>
              </TooltipProvider>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  return createPortal(toolbar, document.body);
}
