import {
  Activity,
  AudioLines,
  BarChart3,
  BrainCircuit,
  Captions,
  Cloud,
  CloudCog,
  Download,
  FolderOpen,
  Gauge,
  HardDrive,
  ImageIcon,
  Info,
  Keyboard,
  type LucideIcon,
  MonitorSmartphone,
  Palette,
  PlayCircle,
  Radio,
  Sparkles,
  Waves,
} from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useTransliterationReady } from "@/hooks/use-transliteration-ready";
import { freeTextMatches } from "@/lib/search-core";
import { cn } from "@/lib/utils";
import { SETTINGS_NAV } from "./settings-nav";

type DragAxis = "x" | "y";

const SETTINGS_ICONS = {
  activity: Activity,
  "audio-lines": AudioLines,
  "bar-chart-3": BarChart3,
  "brain-circuit": BrainCircuit,
  captions: Captions,
  cloud: Cloud,
  "cloud-cog": CloudCog,
  download: Download,
  "folder-open": FolderOpen,
  gauge: Gauge,
  "hard-drive": HardDrive,
  image: ImageIcon,
  info: Info,
  keyboard: Keyboard,
  "monitor-smartphone": MonitorSmartphone,
  palette: Palette,
  "play-circle": PlayCircle,
  radio: Radio,
  sparkles: Sparkles,
  waves: Waves,
} as const satisfies Record<string, LucideIcon>;

/**
 * Left rail for the two-column Settings page: a search box that filters the
 * sections/items (transliteration-aware — Chinese pinyin / Japanese kana↔romaji,
 * same engine as ⌘F), then sections (group headers) → item buttons. The active
 * item is owned by `nav-store`. Under `md` it collapses to a horizontal,
 * scrollable row above the detail pane.
 */
export function SettingsSidebar({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  useTransliterationReady(); // load pinyin/kana so CJK search "snaps in"
  const [query, setQuery] = useState("");
  const dragRef = useRef({
    axis: "x" as DragAxis,
    dragged: false,
    pointerId: null as number | null,
    startScrollLeft: 0,
    startScrollTop: 0,
    startX: 0,
    startY: 0,
    suppressClick: false,
    target: null as HTMLElement | null,
  });

  const sections = SETTINGS_NAV.map((section) => ({
    section,
    items: section.items.filter((item) =>
      freeTextMatches(query, [t(item.labelKey), t(section.labelKey), item.id]),
    ),
  })).filter((entry) => entry.items.length > 0);

  function beginDragScroll(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;

    const nav = event.currentTarget;
    const canScrollHorizontally = nav.scrollWidth > nav.clientWidth + 1;
    const target = canScrollHorizontally
      ? nav
      : (nav.closest<HTMLElement>(".settings-scroll-surface") ?? nav);
    const axis: DragAxis = canScrollHorizontally ? "x" : "y";

    dragRef.current = {
      axis,
      dragged: false,
      pointerId: event.pointerId,
      startScrollLeft: target.scrollLeft,
      startScrollTop: target.scrollTop,
      startX: event.clientX,
      startY: event.clientY,
      suppressClick: false,
      target,
    };
  }

  function dragScroll(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const delta = drag.axis === "x" ? event.clientX - drag.startX : event.clientY - drag.startY;
    if (Math.abs(delta) > 4) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      drag.dragged = true;
    }

    if (!drag.dragged) return;

    event.preventDefault();
    const target = drag.target ?? event.currentTarget;
    if (drag.axis === "x") {
      target.scrollLeft = drag.startScrollLeft - delta;
    } else {
      target.scrollTop = drag.startScrollTop - delta;
    }
  }

  function endDragScroll(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    drag.pointerId = null;
    drag.suppressClick = drag.dragged;

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    window.setTimeout(() => {
      drag.suppressClick = false;
      drag.target = null;
    }, 0);
  }

  function suppressClickAfterDrag(event: ReactMouseEvent<HTMLElement>) {
    if (!dragRef.current.suppressClick) return;

    event.preventDefault();
    event.stopPropagation();
    dragRef.current.suppressClick = false;
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 md:w-52 px-1">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("settings.searchSettings")}
        className="h-8"
        data-settings-search
      />
      <nav
        aria-label={t("settings.searchSettings")}
        className="-mx-1 no-scrollbar flex cursor-grab select-none gap-1 overflow-x-auto px-1 active:cursor-grabbing md:mx-0 md:flex-col md:overflow-visible md:px-0"
        onClickCapture={suppressClickAfterDrag}
        onPointerCancel={endDragScroll}
        onPointerDown={beginDragScroll}
        onPointerMove={dragScroll}
        onPointerUp={endDragScroll}
      >
        {sections.map(({ section, items }) => (
          <div key={section.labelKey} className="flex shrink-0 gap-1 md:flex-col">
            <p className="hidden px-2 pl-0 pt-3 pb-1 font-medium text-foreground/70 text-xs uppercase tracking-wide md:block">
              {t(section.labelKey)}
            </p>
            {items.map((item) => {
              const Icon = SETTINGS_ICONS[item.icon] ?? Info;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-settings-item={item.id}
                  onClick={() => onSelect(item.id)}
                  className={cn(
                    "inline-flex min-h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm transition-colors md:w-full",
                    active === item.id
                      ? "bg-primary/15 font-medium text-primary"
                      : "text-foreground hover:bg-muted/70 hover:text-primary",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t(item.labelKey)}</span>
                </button>
              );
            })}
          </div>
        ))}
        {sections.length === 0 && (
          <p className="px-2 py-2 text-muted-foreground text-xs">{t("settings.searchNoResults")}</p>
        )}
      </nav>
    </div>
  );
}
