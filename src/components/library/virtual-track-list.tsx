import { elementScroll, useVirtualizer } from "@tanstack/react-virtual";
import { motion, useMotionValue, useSpring } from "motion/react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createSession,
  deleteTrack as deleteTrackRepo,
  prependTrackIds,
  setTrackLiked,
} from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSessions } from "@/hooks/use-app-data";
import { useShortcutMatcher } from "@/hooks/use-shortcut-matcher";
import { buildAlphabetIndex } from "@/lib/alphabet-index";
import { hasModalDialogOpen, isTypingTarget } from "@/lib/dom-keys";
import { downloadTrackMedia } from "@/lib/download-track";
import { useSmoothScroll } from "@/lib/smooth-scroll/use-smooth-scroll";
import { cn } from "@/lib/utils";
import { notify } from "@/stores/notification-store";
import { usePlayerStore } from "@/stores/player-store";
import { AlphabetIndex } from "./alphabet-index";
import { HoverScrollbar } from "./hover-scrollbar";
import { TrackRow } from "./track-row";

const TRACK_ROW_HEIGHT = 60;
const TRACK_ROW_SELECTOR = "[data-muzero-track-row]";
const GALLERY_CARD_SELECTOR = "[data-gallery-card]";
const TRACK_LIST_EDGE_PULL_THRESHOLD = 96;
const TRACK_LIST_EDGE_PULL_MAX = 56;
const TRACK_LIST_EDGE_PULL_ARM_MS = 80;
const TRACK_LIST_EDGE_PULL_RESET_MS = 180;
const TRACK_LIST_EDGE_PULL_TRANSITION = {
  damping: 30,
  mass: 0.7,
  stiffness: 420,
  type: "spring",
} as const;

/**
 * Virtualized track list (TanStack Virtual). An endless set can grow to hundreds
 * of tracks; only the visible rows mount. The active set's queue plays by index;
 * cross-set lists (search/library) pass `onPlay` to play a specific track.
 */
export function VirtualTrackList({
  tracks,
  onPlay,
  onView,
  emptyHint,
  className,
  selectedTrackId,
  edgePullFeedback = false,
  onPullPastStart,
  onPullPastEnd,
  selectable = false,
  selectedIds,
  onToggleSelect,
  onDeleteTrack,
  getTrackSupplement,
  getTrackColumns,
  header,
  initialScrollIndex,
  alphabetLetterOf,
}: {
  tracks: Track[];
  onPlay?: (track: Track, index: number) => void;
  onView?: (track: Track, index: number) => void;
  emptyHint?: string;
  /** Extra classes for the scroll element — e.g. `pb-chrome-bottom` to clear the dock. */
  className?: string;
  /** Content rendered INSIDE the scroll container, above the rows — it scrolls with
   *  them (e.g. sort chips + a toolbar). The virtualizer offsets by its height via
   *  `scrollMargin`, so rows stay correctly placed. */
  header?: ReactNode;
  selectedTrackId?: string;
  edgePullFeedback?: boolean;
  onPullPastStart?: () => void;
  onPullPastEnd?: () => void;
  /** Select mode: render per-row checkboxes; row click toggles selection. */
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (trackId: string, opts?: { index?: number; shiftKey?: boolean }) => void;
  /** Context-aware delete for the row's trash button. Falls back to permanent
   *  delete (the historical behavior) when not provided. */
  onDeleteTrack?: (track: Track) => void;
  getTrackSupplement?: (track: Track) => ReactNode;
  getTrackColumns?: (track: Track) => ReactNode;
  /** Scroll to this row index on MOUNT — e.g. returning from select mode's reorder
   *  list (a different scroll container). Restored through the virtualizer so it
   *  routes via Lenis. */
  initialScrollIndex?: number;
  /** When provided (name-sorted lists only), mounts the right-edge A–Z fast-scroll
   *  strip. Returns each track's bucket letter — the caller transliterates CJK
   *  titles (pinyin/kana) before bucketing. `tracks` must already be name-sorted. */
  alphabetLetterOf?: (track: Track) => string;
}) {
  const { t } = useTranslation();
  const parentRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const edgePullContentRef = useRef<HTMLDivElement | null>(null);
  // A scrollable `header` sits above the rows inside the scroller; tell the virtualizer
  // how far down the rows start so it positions them correctly. Re-measured on resize
  // (chips wrap, facets appear) so the offset stays accurate.
  const [scrollMargin, setScrollMargin] = useState(0);
  const hasHeader = !!header;
  const edgePullArmTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const edgePullResetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const edgePullDistanceRef = useRef(0);
  const edgePullReadyRef = useRef({ end: true, start: true });
  const edgePullRaw = useMotionValue(0);
  const edgePull = useSpring(edgePullRaw, TRACK_LIST_EDGE_PULL_TRANSITION);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const queue = usePlayerStore((s) => s.queue);
  const playIndex = usePlayerStore((s) => s.playIndex);
  const sessions = useSessions();
  // Row nav resolves through the configurable registry (library.focusPrev/Next),
  // so rebinds apply. Held in a ref so the window listener stays stable.
  const matches = useShortcutMatcher();
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  // Opt this scroll container into smooth scrolling when enabled. `lenisRef`
  // routes programmatic jumps so they don't fight it.
  const { lenisRef } = useSmoothScroll(parentRef);

  const currentTrackId = currentIndex >= 0 ? queue[currentIndex]?.id : undefined;
  const handlePlay = onPlay ?? ((_track: Track, index: number) => void playIndex(index));
  const handleView = onView ?? handlePlay;
  // Route the hover-scrollbar drag through Lenis (immediate, no smoothing) so it
  // doesn't fight the smooth scroll; fall back to raw scrollTo when Lenis is off.
  const scrollToTop = useCallback(
    (top: number) => {
      if (lenisRef.current) lenisRef.current.scrollTo(top, { immediate: true });
      else parentRef.current?.scrollTo({ top });
    },
    [lenisRef],
  );

  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    estimateSize: () => TRACK_ROW_HEIGHT,
    getItemKey: (index) => tracks[index]?.id ?? index,
    getScrollElement: () => parentRef.current,
    overscan: 8,
    scrollMargin,
    // Route scrollToIndex through Lenis when active (a raw element.scrollTo
    // desyncs the smoothing); fall back to the exact default otherwise.
    scrollToFn: (offset, opts, instance) => {
      if (lenisRef.current) {
        lenisRef.current.scrollTo(offset, { immediate: opts.behavior !== "smooth" });
        return;
      }
      elementScroll(offset, opts, instance);
    },
  });
  const deferRowCoverLoad = rowVirtualizer.isScrolling;

  // A–Z fast-scroll buckets — only when the caller opts in (name-sorted lists).
  // `tracks` is already sorted, so buildAlphabetIndex walks it once for the first
  // row of each letter group; jumps route through the virtualizer (→ Lenis).
  const alphabetBuckets = useMemo(
    () => (alphabetLetterOf ? buildAlphabetIndex(tracks, alphabetLetterOf) : []),
    [tracks, alphabetLetterOf],
  );
  // When the A–Z strip is mounted it owns the right gutter: inset the hover
  // scrollbar to its left, and pad the rows so cover/duration clear the strip.
  const hasAlphabet = alphabetBuckets.length >= 2;

  // Restore scroll to a row on MOUNT (returning from select mode's reorder list).
  // Through the virtualizer's scrollToFn so it routes via Lenis; the rAF lets Lenis
  // attach first (it's created in a passive effect a tick after mount) — otherwise
  // it would snap the fresh container back to the top. Mount-only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only restore
  useLayoutEffect(() => {
    if (initialScrollIndex === undefined || initialScrollIndex <= 0) return;
    rowVirtualizer.scrollToIndex(initialScrollIndex, { align: "start" });
    const raf = requestAnimationFrame(() =>
      rowVirtualizer.scrollToIndex(initialScrollIndex, { align: "start" }),
    );
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keep `scrollMargin` in sync with the rows container's offset within the scroller
  // (= header height + top padding). Only when a header is present; otherwise 0.
  useLayoutEffect(() => {
    if (!hasHeader) {
      setScrollMargin(0);
      return;
    }
    const measure = () => {
      const offset = edgePullContentRef.current?.offsetTop ?? 0;
      setScrollMargin((prev) => (prev === offset ? prev : offset));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (headerRef.current) ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, [hasHeader]);

  useEffect(
    () => () => {
      if (edgePullArmTimerRef.current) clearTimeout(edgePullArmTimerRef.current);
      if (edgePullResetTimerRef.current) clearTimeout(edgePullResetTimerRef.current);
    },
    [],
  );

  // Keep Lenis' cached scroll limit in sync with the list height. Lenis derives its
  // limit from `scrollElement.scrollHeight`, but only recomputes when its
  // ResizeObserver fires for the scroller's firstElementChild (the header, when
  // present) — not this virtual rows container. Fixed-row lists are usually correct
  // on first paint, but the count grows after mount (the DJ appends tracks; async
  // loads), and Lenis would then clamp scrolling above the new bottom. `resize()`
  // re-reads the dimensions and realigns to the current scroll, no jump.
  const totalSize = rowVirtualizer.getTotalSize();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync Lenis when the content height changes
  useEffect(() => {
    lenisRef.current?.resize();
  }, [totalSize]);

  function focusTrackAt(index: number) {
    rowVirtualizer.scrollToIndex(index, { align: "center" });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        parentRef.current
          ?.querySelector<HTMLElement>(`${TRACK_ROW_SELECTOR}[data-track-index="${index}"]`)
          ?.focus();
      });
    });
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // Row nav via the registry (library.focusPrev/Next — W/S/↑/↓ by default); A/←
    // back and D/→ open are handled by the surrounding detail view / the row itself.
    const intent = matchesRef.current(event, "library.focusPrev")
      ? "prev"
      : matchesRef.current(event, "library.focusNext")
        ? "next"
        : null;
    if (!intent) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const row =
      target?.closest<HTMLElement>(TRACK_ROW_SELECTOR) ??
      active?.closest<HTMLElement>(TRACK_ROW_SELECTOR);
    if (!row) return;
    const current = Number(row.dataset.trackIndex);
    if (!Number.isFinite(current)) return;
    const next = intent === "next" ? current + 1 : current - 1;
    if (next < 0 || next >= tracks.length) return;
    event.preventDefault();
    handleView(tracks[next], next);
    focusTrackAt(next);
  }

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;
    const target = element;

    function onWheel(event: WheelEvent) {
      handleWheel(target, event);
    }

    target.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => target.removeEventListener("wheel", onWheel, { capture: true });
  });

  // When this list is on screen but nothing is focused (you clicked into the
  // detail with the mouse), W/S/↑/↓ land on the FIRST row so keyboard nav starts
  // cleanly. A focused row keeps its own onKeyDown; a focused gallery card belongs
  // to the wall's roving handler. Capture-phase so ↑/↓ don't hit volume first.
  const focusFirstRef = useRef<() => void>(() => {});
  focusFirstRef.current = () => {
    if (tracks.length === 0) return;
    handleView(tracks[0], 0);
    focusTrackAt(0);
  };
  const hasTracksRef = useRef(false);
  hasTracksRef.current = tracks.length > 0;
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (
        !matchesRef.current(event, "library.focusPrev") &&
        !matchesRef.current(event, "library.focusNext")
      ) {
        return;
      }
      if (!hasTracksRef.current || !parentRef.current) return;
      if (isTypingTarget(event.target) || hasModalDialogOpen()) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.closest(TRACK_ROW_SELECTOR) || active.closest(GALLERY_CARD_SELECTOR))
      ) {
        return; // a row / card is focused → its own handler owns the key
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      focusFirstRef.current();
    };
    window.addEventListener("keydown", onWindowKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onWindowKeyDown, { capture: true });
  }, []);

  function handleWheel(element: HTMLDivElement, event: WheelEvent) {
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    const canScroll = maxScrollTop > 1;
    const atTop = element.scrollTop <= 0;
    const atBottom = element.scrollTop >= maxScrollTop - 1;
    const pullingPastStart = event.deltaY < 0 && atTop;
    const pullingPastEnd = event.deltaY > 0 && atBottom;
    const handlesStart = canScroll && pullingPastStart && (edgePullFeedback || onPullPastStart);
    const handlesEnd = canScroll && pullingPastEnd && (edgePullFeedback || onPullPastEnd);

    if (!handlesStart && !handlesEnd) {
      edgePullDistanceRef.current = 0;
      setEdgePullValue(0);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const ready = pullingPastStart ? edgePullReadyRef.current.start : edgePullReadyRef.current.end;
    if (!ready) return;

    const direction = pullingPastStart ? 1 : -1;
    edgePullDistanceRef.current += Math.abs(event.deltaY);
    setEdgePullValue(direction * easeEdgePull(edgePullDistanceRef.current));
    resetEdgePullSoon();

    if (edgePullDistanceRef.current < TRACK_LIST_EDGE_PULL_THRESHOLD) return;
    edgePullDistanceRef.current = 0;
    setEdgePullValue(0);
    if (pullingPastStart) onPullPastStart?.();
    if (pullingPastEnd) onPullPastEnd?.();
  }

  function onScroll() {
    const element = parentRef.current;
    if (!element) return;

    edgePullDistanceRef.current = 0;
    setEdgePullValue(0);
    if (edgePullArmTimerRef.current) clearTimeout(edgePullArmTimerRef.current);

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    edgePullReadyRef.current = { end: false, start: false };

    if (element.scrollTop <= 0) {
      edgePullArmTimerRef.current = setTimeout(() => {
        edgePullReadyRef.current.start = true;
      }, TRACK_LIST_EDGE_PULL_ARM_MS);
      return;
    }

    if (element.scrollTop >= maxScrollTop - 1) {
      edgePullArmTimerRef.current = setTimeout(() => {
        edgePullReadyRef.current.end = true;
      }, TRACK_LIST_EDGE_PULL_ARM_MS);
    }
  }

  function resetEdgePullSoon() {
    if (edgePullResetTimerRef.current) clearTimeout(edgePullResetTimerRef.current);
    edgePullResetTimerRef.current = setTimeout(() => {
      edgePullDistanceRef.current = 0;
      setEdgePullValue(0);
    }, TRACK_LIST_EDGE_PULL_RESET_MS);
  }

  function setEdgePullValue(value: number) {
    edgePullRaw.set(value);
    if (edgePullContentRef.current) {
      edgePullContentRef.current.dataset.edgePull = `${Math.round(value)}`;
    }
  }

  if (tracks.length === 0) {
    // Keep the scrollable header visible when empty (e.g. a search that matched only
    // artists/albums, not track titles) so the chips/facets don't vanish.
    if (header) {
      return (
        <div
          className={cn("relative h-full overflow-y-auto", className)}
          data-testid="virtual-track-list"
        >
          <div ref={headerRef}>{header}</div>
          <p className="p-8 text-center text-sm text-muted-foreground">
            {emptyHint ?? t("track.empty")}
          </p>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {emptyHint ?? t("track.empty")}
      </div>
    );
  }

  return (
    <div
      className={cn("group/list relative h-full overflow-y-auto", className)}
      data-testid="virtual-track-list"
      data-virtualized="fixed-size"
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      ref={parentRef}
      role="listbox"
    >
      <HoverScrollbar
        scrollRef={parentRef}
        scrollToTop={scrollToTop}
        rightInset={hasAlphabet ? 24 : 0}
      />
      <AlphabetIndex
        scrollRef={parentRef}
        buckets={alphabetBuckets}
        onJump={(index) => rowVirtualizer.scrollToIndex(index, { align: "start" })}
      />
      {header ? <div ref={headerRef}>{header}</div> : null}
      <motion.div
        className="relative w-full"
        data-edge-pull="0"
        ref={edgePullContentRef}
        style={{ height: `${rowVirtualizer.getTotalSize()}px`, y: edgePull }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const track = tracks[virtualRow.index];
          return (
            <div
              className={cn(
                "absolute left-0 top-0 flex w-full items-center",
                hasAlphabet && "pr-6",
              )}
              data-index={virtualRow.index}
              data-testid={`virtual-track-row-${track.id}`}
              key={track.id}
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              }}
            >
              <TrackRow
                track={track}
                deferCoverLoad={deferRowCoverLoad}
                isCurrent={track.id === currentTrackId}
                isSelected={track.id === selectedTrackId}
                listIndex={virtualRow.index}
                secondaryMeta={getTrackSupplement?.(track)}
                metricColumns={getTrackColumns?.(track)}
                sessions={sessions}
                selectable={selectable}
                checked={selectedIds?.has(track.id) ?? false}
                onToggleSelect={(shiftKey) =>
                  onToggleSelect?.(track.id, { index: virtualRow.index, shiftKey })
                }
                onPlay={() => handlePlay(track, virtualRow.index)}
                onView={() => handleView(track, virtualRow.index)}
                onToggleLike={() => void setTrackLiked(track.id, !track.liked)}
                onDelete={() =>
                  onDeleteTrack ? onDeleteTrack(track) : void deleteTrackRepo(track.id)
                }
                onDownloadOriginal={() => {
                  void downloadTrackMedia(track, "original").catch((error: unknown) =>
                    notify.error(t("track.downloadFailed"), { error, source: "track-download" }),
                  );
                }}
                onExportWithMetadata={() => {
                  void downloadTrackMedia(track, "withMetadata").catch((error: unknown) =>
                    notify.error(t("track.downloadFailed"), { error, source: "track-download" }),
                  );
                }}
                onDownloadToDevice={() =>
                  void usePlayerStore.getState().downloadStreamedTrack(track.id)
                }
                onAddToSession={(sessionId) => void prependTrackIds(sessionId, [track.id])}
                onAddToNewSession={(name) => void addTrackToNewSet(name, track.id)}
              />
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

function easeEdgePull(distance: number) {
  return Math.min(TRACK_LIST_EDGE_PULL_MAX, distance * 0.45);
}

/**
 * Create a manual (non-DJ) set named `name` and drop `trackId` into it — the
 * "no matching set, make one from the typed name" path of the row's add-to-set
 * menu. `autoExtend: false` mirrors the gallery's "New set" so the DJ doesn't
 * start refilling a set the user assembled by hand.
 */
async function addTrackToNewSet(name: string, trackId: string) {
  const set = await createSession({ name, seedPrompt: "", config: { autoExtend: false } });
  await prependTrackIds(set.id, [trackId]);
}
