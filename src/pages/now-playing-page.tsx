import { useLiveQuery } from "dexie-react-hooks";
import {
  Check,
  Image as ImageIcon,
  ListMusic,
  Repeat,
  Repeat1,
  Shuffle,
  Video,
} from "lucide-react";
import {
  type CSSProperties,
  memo,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { RenderTraceBoundary } from "@/components/dev/render-trace-boundary";
import { DjConsole } from "@/components/dj/dj-console";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { ListeningNowSection } from "@/components/player/listening-now-section";
import { LyricsModeButton } from "@/components/player/lyrics-mode-button";
import {
  MODE_ICON_BUTTON,
  MODE_ICON_BUTTON_ACTIVE,
  MODE_ICON_BUTTON_IDLE,
  MODE_MENU_OPTION,
  MODE_MENU_OPTION_DESCRIPTION,
  MODE_MENU_OPTION_ICON,
  MODE_MENU_OPTION_LABEL,
  MODE_MENU_OPTION_TEXT,
} from "@/components/player/mode-chip-styles";
import { NowPlayingPanel } from "@/components/player/now-playing-panel";
import { PlaybackSpectrum } from "@/components/player/playback-spectrum";
import { SwipeableCoverStage } from "@/components/player/swipeable-cover-stage";
import { SyncedLyricsView } from "@/components/player/synced-lyrics-view";
import { CurrentTrackContextMenu } from "@/components/player/track-context-menu";
import { TrackInfoCard } from "@/components/player/track-info-card";
import { TrackRatingChip } from "@/components/player/track-rating-chip";
import { TransportControls } from "@/components/player/transport-controls";
import { VisualizerModeButton } from "@/components/player/visualizer-mode-button";
import { AnnotationEditor } from "@/components/track/annotation-editor";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LibraryImportEmptyState } from "@/components/upload/library-import-empty-state";
import { db } from "@/db/muzero-db";
import { addTrackBackground, saveSettings, setTrackCover } from "@/db/repositories";
import type { SetDisplayMode, Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { useBurstSettledValue } from "@/hooks/use-burst-settled-value";
import { useLongPress } from "@/hooks/use-long-press";
import { usePausedLiveQuery } from "@/hooks/use-paused-live-query";
import { useShortcutHint } from "@/hooks/use-shortcut-hint";
import { classifyDrop, dragHasFiles, filesFromTransfer, summarizeDragItems } from "@/lib/file-drop";
import { notePerfWork } from "@/lib/perf-counters";
import { lenisScrollTo, useSmoothScroll } from "@/lib/smooth-scroll/use-smooth-scroll";
import { cn } from "@/lib/utils";
import { dragWindowOnEmptyPress } from "@/lib/window-drag";
import type { RepeatMode } from "@/player/queue";
import { useCoverAppearancePanelStore } from "@/stores/cover-appearance-panel-store";
import { getLastSwitchStartedAt, usePlayerStore } from "@/stores/player-store";

const DISPLAY_MODE_ICONS: Record<SetDisplayMode, typeof Video> = {
  video: Video,
  cover: ImageIcon,
};
const NEXT_DISPLAY_MODE: Record<SetDisplayMode, SetDisplayMode> = {
  video: "cover",
  cover: "video",
};
const REPEAT_OPTIONS: RepeatMode[] = ["off", "all", "one"];
const GLASS_CONTROL_GROUP =
  "rounded-full border border-white/10 bg-black/35 p-1 shadow-lg backdrop-blur-md";
const EMPTY_QUEUE: Track[] = [];
const ANNOTATION_DISPLAY_SETTLE_MS = 360;
const MEMORY_COUNT_TRACK_SETTLE_MS = 360;

function currentTrackIdFromPlayerState(
  state: ReturnType<typeof usePlayerStore.getState>,
): string | undefined {
  return state.currentIndex >= 0 ? state.queue[state.currentIndex]?.id : undefined;
}

/**
 * Now Playing, YouTube-Music style: a wide media area (16:9 for video, a square
 * for audio art) with a track-info card below, and a tabbed queue/lyrics rail on
 * the right (desktop). The ambient slideshow background lives at the app root.
 */
export function NowPlayingPage(props: { foregroundHidden?: boolean; pageActive?: boolean }) {
  if (props.pageActive === false) return <div aria-hidden="true" className="h-full" />;
  return <NowPlayingPageActive {...props} pageActive={props.pageActive ?? true} />;
}

function NowPlayingPageActive({
  foregroundHidden = false,
  pageActive = true,
}: {
  foregroundHidden?: boolean;
  /** True only while the `now` tab is the visible tab. The cover overlay portals out
   *  to `<main>`, which escapes the inactive TabPanel's `display:none` — so we must
   *  explicitly tear it down (and stop pushing the cover-window) when the tab is
   *  hidden, or the coverflow card floats over the library/search tabs. */
  pageActive?: boolean;
}) {
  const queue = usePlayerStore((s) => (pageActive ? s.queue : EMPTY_QUEUE));
  const currentIndex = usePlayerStore((s) => (pageActive ? s.currentIndex : -1));
  const djEnabled = usePlayerStore((s) => (pageActive ? s.djEnabled : false));
  const trackCount = usePausedLiveQuery(() => db.tracks.count(), [], pageActive, 0);
  const settings = useSettings();
  const lyricsVisible = !settings.nowPlayingRightRailCollapsed;
  const toggleLyricsVisible = () =>
    void saveSettings({
      lyricsStageOpen: !lyricsVisible,
      nowPlayingRightRailCollapsed: lyricsVisible,
    });
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const annotationTrack = useBurstSettledValue(current, ANNOTATION_DISPLAY_SETTLE_MS);
  // The lyrics surface lives in the right rail on md+; on narrow there is no rail,
  // so the same lyrics-on/off mode stacks it into the scroll flow below the stage.
  // Centered lyrics are reserved for the global immersive visualizer overlay.
  const isNarrow = useIsNarrow();

  // Reset the scroll to the top when the track changes (the new media/info
  // should be in view), not used as a render value.
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const { lenisRef } = useSmoothScroll(sectionRef);
  // biome-ignore lint/correctness/useExhaustiveDependencies: track id is the reset trigger, not read in the body
  useEffect(() => {
    // Route through Lenis when active so the reset doesn't fight the smoothing.
    if (!lenisScrollTo(lenisRef, 0, { immediate: true })) sectionRef.current?.scrollTo({ top: 0 });
  }, [current?.id]);

  // Perf (switch-fps Phase 4): switch→React-commit. This layout effect fires after the
  // whole now-playing subtree commits, so `toCommit` isolates React render+reconcile;
  // `toFrame - toCommit` is then layout+paint. Recency-guarded so only fresh playIndex
  // switches count (not unrelated re-renders / non-playIndex track changes).
  useLayoutEffect(() => {
    const startedAt = getLastSwitchStartedAt();
    const elapsed = performance.now() - startedAt;
    if (startedAt > 0 && elapsed < 2000) {
      notePerfWork("player.switch.toCommit", elapsed, { trackId: current?.id });
    }
  }, [current?.id]);

  if (!current && trackCount === 0) {
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: passive window-drag surface — no role/keyboard action; it only moves the OS window on desktop.
      <div onMouseDown={dragWindowOnEmptyPress} className="h-full [-webkit-app-region:drag]">
        <div
          className={cn(
            "grid h-full place-items-center px-4 pt-chrome-top pb-chrome-bottom transition-opacity duration-200 lg:px-6",
            foregroundHidden && "pointer-events-none opacity-0",
          )}
        >
          <div
            data-testid="now-playing-empty-library"
            data-no-drag
            className="w-full max-w-xl [-webkit-app-region:no-drag]"
          >
            <LibraryImportEmptyState compact />
          </div>
        </div>
      </div>
    );
  }

  return (
    // Columns are full-bleed (no top reserve) and pad themselves with
    // scroll-padding, so content rests below the bars at rest but scrolls up
    // *under* them. The page is also a desktop window-drag surface (same as the
    // other tabs): empty space / margins move the frameless window, while the
    // media stage (`data-no-drag`, a swipe target) and every control opt out.
    // biome-ignore lint/a11y/noStaticElementInteractions: passive window-drag surface — no role/keyboard action; it only moves the OS window on desktop.
    <div onMouseDown={dragWindowOnEmptyPress} className="h-full [-webkit-app-region:drag]">
      <NowPlayingImageDropLayer current={current} stageRef={stageRef} />
      <div
        className={cn(
          "sm:mx-8 lg:mx-12 grid h-full gap-6 px-4 transition-opacity duration-200 lg:px-6",
          "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]",
          foregroundHidden && "pointer-events-none opacity-0",
        )}
      >
        <section
          ref={sectionRef}
          className="no-scrollbar -mx-[var(--now-playing-stage-bleed)] flex min-h-0 flex-col gap-3 overflow-y-auto overflow-x-visible px-[var(--now-playing-stage-bleed)] pt-chrome-top pb-chrome-bottom [--now-playing-stage-bleed:clamp(1.5rem,7vw,4.5rem)]"
        >
          <CurrentTrackContextMenu className="block">
            <RenderTraceBoundary id="now:stage">
              <div className="flex flex-col gap-2">
                {/* Mobile: a plain tap of the cover flips the right-rail mode
                    (swipes still change tracks). Desktop uses the lyrics button. */}
                <SwipeableCoverStage
                  coverRef={stageRef}
                  foregroundVisible={!foregroundHidden && pageActive}
                  onTap={isNarrow ? toggleLyricsVisible : undefined}
                />
                {current && <TrackInfoCard track={current} />}
                <div className="flex justify-start">
                  <TrackRatingChip />
                </div>
              </div>
            </RenderTraceBoundary>
          </CurrentTrackContextMenu>

          <RenderTraceBoundary id="now:actions">
            <NowPlayingActionRow />
          </RenderTraceBoundary>

          <RenderTraceBoundary id="now:transport">
            <div className="relative mx-auto w-full pb-4">
              <PlaybackSpectrum className="-translate-y-1/2 absolute inset-x-0 top-1/2" />
              <TransportControls className="relative z-10 py-4 " />
            </div>
          </RenderTraceBoundary>

          {/* No key={current.id}: AnnotationEditor + its memory panel reset their
              per-track draft state in place, so a switch no longer tears down and
              rebuilds the whole subtree (PRD Phase 30). */}
          {annotationTrack && (
            <RenderTraceBoundary id="now:annotation">
              <AnnotationEditor track={annotationTrack} />
            </RenderTraceBoundary>
          )}

          {isNarrow && current && lyricsVisible && (
            <div className="min-h-[60svh] p-4">
              <RenderTraceBoundary id="now:lyrics:narrow">
                <SyncedLyricsView track={current} />
              </RenderTraceBoundary>
            </div>
          )}

          {djEnabled && (
            <RenderTraceBoundary id="now:dj-console">
              <DjConsole />
            </RenderTraceBoundary>
          )}

          <RenderTraceBoundary id="now:listening">
            <ListeningNowSection />
          </RenderTraceBoundary>
        </section>

        {!isNarrow && (
          <aside className="min-h-0">
            <RenderTraceBoundary id="now:right-rail">
              <NowPlayingPanel collapsible showFloatingToggle={false} />
            </RenderTraceBoundary>
          </aside>
        )}
      </div>
    </div>
  );
}

type ImageDropTarget = "cover" | "background";

function NowPlayingImageDropLayer({
  current,
  stageRef,
}: {
  current: ReturnType<typeof usePlayerStore.getState>["queue"][number] | undefined;
  stageRef: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<ImageDropTarget | null>(null);
  const [notice, setNotice] = useState<ImageDropTarget | null>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    function eventIsImageDrag(e: DragEvent) {
      if (!current || !dragHasFiles(e.dataTransfer?.types)) return false;
      return summarizeDragItems(e.dataTransfer?.items).allImages;
    }

    function targetFromPoint(e: DragEvent): ImageDropTarget {
      const rect = stageRef.current?.getBoundingClientRect();
      if (
        rect &&
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        return "cover";
      }
      return "background";
    }

    function stop(e: DragEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    function onDragEnter(e: DragEvent) {
      if (!eventIsImageDrag(e)) return;
      stop(e);
      dragDepth.current += 1;
      setTarget(targetFromPoint(e));
    }

    function onDragOver(e: DragEvent) {
      if (!eventIsImageDrag(e)) return;
      stop(e);
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setTarget(targetFromPoint(e));
    }

    function onDragLeave(e: DragEvent) {
      if (!eventIsImageDrag(e)) return;
      stop(e);
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setTarget(null);
    }

    function onDrop(e: DragEvent) {
      if (!eventIsImageDrag(e) || !current) return;
      stop(e);
      dragDepth.current = 0;
      const dropTarget = targetFromPoint(e);
      setTarget(null);
      const { images } = classifyDrop(filesFromTransfer(e.dataTransfer));
      const image = images[0];
      if (!image) return;
      if (dropTarget === "cover") {
        void setTrackCover({
          trackId: current.id,
          blob: image,
          mime: image.type || "image/jpeg",
        }).then(() => setNotice("cover"));
      } else {
        void Promise.all([
          addTrackBackground({
            trackId: current.id,
            blob: image,
            mime: image.type || "image/jpeg",
          }),
          saveSettings({ backgroundMode: "slideshow" }),
        ]).then(() => setNotice("background"));
      }
    }

    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, [current, stageRef]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[75]">
      {target ? (
        <div className="absolute inset-0 bg-background/20 backdrop-blur-[2px]">
          <div
            className={cn(
              "absolute rounded-2xl border-2 border-dashed transition-colors",
              target === "cover"
                ? "border-primary bg-primary/12"
                : "border-border/70 bg-background/10",
            )}
            style={stageOverlayStyle(stageRef.current)}
          >
            <div className="absolute inset-0 grid place-items-center p-4 text-center">
              <span className="rounded-full border border-primary/30 bg-card/95 px-4 py-2 font-medium text-primary text-sm shadow-lg">
                {t("drop.dropAsCover")}
              </span>
            </div>
          </div>
          <div
            className={cn(
              "absolute inset-3 rounded-3xl border-2 border-dashed transition-colors",
              target === "background"
                ? "border-primary bg-primary/12"
                : "border-border/50 bg-transparent",
            )}
          >
            <div className="absolute right-4 bottom-[calc(var(--spacing-chrome-bottom,0px)+1rem)] rounded-full border border-primary/30 bg-card/95 px-4 py-2 font-medium text-primary text-sm shadow-lg">
              {t("drop.dropAsTrackBackground")}
            </div>
          </div>
        </div>
      ) : null}
      {notice ? (
        <div className="absolute bottom-[calc(var(--spacing-chrome-bottom,0px)+1rem)] left-1/2 -translate-x-1/2 rounded-full border bg-card px-4 py-2 text-sm shadow-lg">
          {notice === "cover" ? t("drop.coverApplied") : t("drop.bgApplied")}
        </div>
      ) : null}
    </div>
  );
}

function stageOverlayStyle(el: HTMLDivElement | null): CSSProperties {
  if (!el) return { inset: "1rem" };
  const rect = el.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** True below the `md` breakpoint (768px) — the now-page drops to one column. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(max-width: 767px)").matches
      : false,
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return narrow;
}

const NowPlayingActionRow = memo(function NowPlayingActionRow() {
  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full flex-wrap items-center justify-between gap-2">
        <RenderTraceBoundary id="now:actions:stage-modes">
          <NowPlayingStageModeControls />
        </RenderTraceBoundary>
        <RenderTraceBoundary id="now:actions:playback-modes">
          <NowPlayingPlaybackModeControls />
        </RenderTraceBoundary>
      </div>
    </TooltipProvider>
  );
});

const NowPlayingStageModeControls = memo(function NowPlayingStageModeControls() {
  const displayMode = usePlayerStore((s) => s.displayMode);
  const currentTrackId = useBurstSettledCurrentTrackId(MEMORY_COUNT_TRACK_SETTLE_MS);
  const setDisplayMode = usePlayerStore((s) => s.setDisplayMode);
  const hint = useShortcutHint();
  const memoryCount = useLiveQuery(
    () =>
      currentTrackId
        ? db.memories.where("trackId").equals(currentTrackId).count()
        : Promise.resolve(0),
    [currentTrackId],
    0,
  );

  return (
    <div className={cn("flex items-center gap-1", GLASS_CONTROL_GROUP)}>
      <DisplayModeButton displayMode={displayMode} onChange={setDisplayMode} />
      <LyricsModeButton
        hasMemory={(memoryCount ?? 0) > 0}
        memoryShortcutKeys={hint("memory", { scope: "inspector" })}
      />
      <VisualizerModeButton />
    </div>
  );
});

const NowPlayingPlaybackModeControls = memo(function NowPlayingPlaybackModeControls() {
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const setRepeat = usePlayerStore((s) => s.setRepeat);
  const setShuffle = usePlayerStore((s) => s.setShuffle);
  const hint = useShortcutHint();

  return (
    <div className={cn("flex items-center gap-1", GLASS_CONTROL_GROUP)}>
      <RepeatModeButton onChange={setRepeat} repeat={repeat} shortcutKeys={hint("repeat")} />
      <ShuffleModeButton onChange={setShuffle} shortcutKeys={hint("shuffle")} shuffle={shuffle} />
    </div>
  );
});

function useBurstSettledCurrentTrackId(quietMs: number): string | undefined {
  const [displayed, setDisplayed] = useState(() =>
    currentTrackIdFromPlayerState(usePlayerStore.getState()),
  );
  const appliedRef = useRef(displayed);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const apply = (next: string | undefined) => {
      if (timerRef.current === null) {
        if (Object.is(next, appliedRef.current)) return;
        appliedRef.current = next;
        setDisplayed(next);
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
        }, quietMs);
        return;
      }

      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (!Object.is(next, appliedRef.current)) {
          appliedRef.current = next;
          setDisplayed(next);
        }
      }, quietMs);
    };

    const unsubscribe = usePlayerStore.subscribe((state, prev) => {
      const next = currentTrackIdFromPlayerState(state);
      if (Object.is(next, currentTrackIdFromPlayerState(prev))) return;
      apply(next);
    });
    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [quietMs]);

  return displayed;
}

function DisplayModeButton({
  displayMode,
  onChange,
}: {
  displayMode: SetDisplayMode;
  onChange: (mode: SetDisplayMode) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const setCoverAppearancePanelOpen = useCoverAppearancePanelStore((s) => s.setOpen);
  const nextDisplayMode = NEXT_DISPLAY_MODE[displayMode];
  const DisplayModeIcon = DISPLAY_MODE_ICONS[displayMode];
  const nextDisplayModeLabel = t(`displayMode.${nextDisplayMode}`);
  const displayModeTooltip = t("nowPlaying.switchDisplayMode", {
    mode: nextDisplayModeLabel,
  });
  const openAppearanceSettings = () => {
    setOpen(false);
    setCoverAppearancePanelOpen(true);
  };
  const { handlers, consumeClick } = useLongPress(openAppearanceSettings);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <ControlTooltip label={displayModeTooltip} hint={t("nowPlaying.coverAppearanceSettingsHint")}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                if (!consumeClick()) return;
                e.preventDefault();
                e.stopPropagation();
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openAppearanceSettings();
              }}
              {...handlers}
              aria-label={displayModeTooltip}
              className={cn(MODE_ICON_BUTTON, MODE_ICON_BUTTON_ACTIVE)}
            >
              <DisplayModeIcon className="size-4" />
            </Button>
          }
        />
      </ControlTooltip>
      {open && (
        <PopoverContent className="w-60 p-2" side="top" sideOffset={10}>
          <PopoverTitle className="px-2 pt-1 pb-1">{t("nowPlaying.displayMode")}</PopoverTitle>
          {(["video", "cover"] as const).map((mode) => {
            const Icon = DISPLAY_MODE_ICONS[mode];
            const label = t(`displayMode.${mode}`);
            const selected = mode === displayMode;
            return (
              <button
                type="button"
                aria-pressed={selected}
                className={MODE_MENU_OPTION}
                key={mode}
                onClick={() => {
                  void onChange(mode);
                  setOpen(false);
                }}
              >
                <Icon className={MODE_MENU_OPTION_ICON} />
                <span className={MODE_MENU_OPTION_TEXT}>
                  <span className={MODE_MENU_OPTION_LABEL}>{label}</span>
                  <span className={MODE_MENU_OPTION_DESCRIPTION}>
                    {selected
                      ? t("nowPlaying.modeTitle", { mode: label })
                      : t("nowPlaying.switchDisplayMode", { mode: label })}
                  </span>
                </span>
                {selected && <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
              </button>
            );
          })}
        </PopoverContent>
      )}
    </Popover>
  );
}

const REPEAT_LABEL_KEYS: Record<
  RepeatMode,
  "player.repeatOff" | "player.repeatAll" | "player.repeatOne"
> = {
  off: "player.repeatOff",
  all: "player.repeatAll",
  one: "player.repeatOne",
};

const REPEAT_DESCRIPTION_KEYS: Record<
  RepeatMode,
  "player.repeatOffDescription" | "player.repeatAllDescription" | "player.repeatOneDescription"
> = {
  off: "player.repeatOffDescription",
  all: "player.repeatAllDescription",
  one: "player.repeatOneDescription",
};

function RepeatModeButton({
  onChange,
  repeat,
  shortcutKeys,
}: {
  onChange: (mode: RepeatMode) => void;
  repeat: RepeatMode;
  shortcutKeys: string[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const RepeatIcon = repeat === "one" ? Repeat1 : Repeat;
  const currentLabel = t(REPEAT_LABEL_KEYS[repeat]);
  const tooltip = t("player.repeat", { mode: currentLabel });

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <ControlTooltip label={tooltip} keys={shortcutKeys}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={tooltip}
              aria-pressed={repeat !== "off"}
              className={cn(
                MODE_ICON_BUTTON,
                repeat !== "off" ? MODE_ICON_BUTTON_ACTIVE : MODE_ICON_BUTTON_IDLE,
              )}
            >
              <RepeatIcon className="size-4" />
            </Button>
          }
        />
      </ControlTooltip>
      {open && (
        <PopoverContent className="w-60 p-2" side="top" sideOffset={10}>
          <PopoverTitle className="px-2 pt-1 pb-1">{t("player.repeatLabel")}</PopoverTitle>
          {REPEAT_OPTIONS.map((mode) => {
            const Icon = mode === "one" ? Repeat1 : Repeat;
            return (
              <PlaybackMenuOption
                active={mode === repeat}
                description={t(REPEAT_DESCRIPTION_KEYS[mode])}
                icon={Icon}
                key={mode}
                label={t(REPEAT_LABEL_KEYS[mode])}
                onClick={() => {
                  onChange(mode);
                  setOpen(false);
                }}
              />
            );
          })}
        </PopoverContent>
      )}
    </Popover>
  );
}

function ShuffleModeButton({
  onChange,
  shortcutKeys,
  shuffle,
}: {
  onChange: (shuffle: boolean) => void;
  shortcutKeys: string[];
  shuffle: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const currentLabel = shuffle ? t("player.shuffleOn") : t("player.shuffleOff");
  const tooltip = t("player.shuffleMode", { mode: currentLabel });

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <ControlTooltip label={tooltip} keys={shortcutKeys}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={tooltip}
              aria-pressed={shuffle}
              className={cn(
                MODE_ICON_BUTTON,
                shuffle ? MODE_ICON_BUTTON_ACTIVE : MODE_ICON_BUTTON_IDLE,
              )}
            >
              <Shuffle className="size-4" />
            </Button>
          }
        />
      </ControlTooltip>
      {open && (
        <PopoverContent className="w-60 p-2" side="top" sideOffset={10}>
          <PopoverTitle className="px-2 pt-1 pb-1">{t("player.shuffle")}</PopoverTitle>
          <PlaybackMenuOption
            active={!shuffle}
            description={t("player.shuffleOffDescription")}
            icon={ListMusic}
            label={t("player.shuffleOff")}
            onClick={() => {
              onChange(false);
              setOpen(false);
            }}
          />
          <PlaybackMenuOption
            active={shuffle}
            description={t("player.shuffleOnDescription")}
            icon={Shuffle}
            label={t("player.shuffleOn")}
            onClick={() => {
              onChange(true);
              setOpen(false);
            }}
          />
        </PopoverContent>
      )}
    </Popover>
  );
}

function PlaybackMenuOption({
  active,
  description,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  description: string;
  icon: typeof Repeat;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={active} className={MODE_MENU_OPTION} onClick={onClick}>
      <Icon className={MODE_MENU_OPTION_ICON} />
      <span className={MODE_MENU_OPTION_TEXT}>
        <span className={MODE_MENU_OPTION_LABEL}>{label}</span>
        <span className={MODE_MENU_OPTION_DESCRIPTION}>{description}</span>
      </span>
      {active && <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
    </button>
  );
}
