import { Loader2, Pause, Play } from "lucide-react";
import { motion } from "motion/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ControlTooltip } from "@/components/player/control-tooltip";
import { CoverImage } from "@/components/player/cover-image";
import { Button } from "@/components/ui/button";
import { Disc3Icon } from "@/components/ui/disc-3";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { useShortcutHint } from "@/hooks/use-shortcut-hint";
import { trackHasCover, trackSubtitle } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";
import type { ShortcutScope } from "@/shortcuts/registry";
import { usePlayerStore } from "@/stores/player-store";
import { CurrentTrackContextMenu } from "./track-context-menu";

// Dock song-area swipe: how far / how fast a drag must go to switch tracks.
const DOCK_SWITCH_DISTANCE = 40;
const DOCK_SWITCH_VELOCITY = 380;
// Trackpad pan (no press needed): accumulated delta to switch, how long after
// the last tick the pan is treated as finished, and the per-tick magnitude
// below which a flick's momentum tail counts as "dead" (so the next deliberate
// pan re-arms and switches again).
const DOCK_WHEEL_SWITCH_PX = 56;
const DOCK_WHEEL_END_MS = 140;
const DOCK_WHEEL_REARM_PX = 4;

/**
 * Row 1 of the player-dock: cover + title/artist + the single play/pause button.
 * Subscribes via a narrow `useShallow` selector to only the current track's
 * *display* scalars — so editing any track (like, tags, cover of another song),
 * which rebuilds the queue array, never re-renders this row.
 *
 * The cover is NOT a motion `layout`/`layoutId` element: the Dock→Now Playing open
 * uses the native View Transition (`transitionState`), not a motion shared-element
 * morph, so a `layoutId` here had no counterpart — it only forced a per-render
 * `getBoundingClientRect` reflow that compounded the drag-to-switch jank (PRD
 * 20260617-dock-swipe-switch-jank).
 */
export function TrackIdentityRow({
  className,
  onOpen,
  controls,
  transportHintScope,
}: {
  className?: string;
  onOpen?: () => void;
  controls?: ReactNode;
  transportHintScope?: ShortcutScope;
}) {
  const { t } = useTranslation();
  const hint = useShortcutHint();
  const track = usePlayerStore(
    useShallow((s) => {
      const c = s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined;
      if (!c) return null;
      const crop = c.coverCrop;
      return {
        id: c.id,
        title: c.title,
        subtitle: trackSubtitle(c),
        coverBlobId: c.coverBlobId,
        remoteCoverUrl: c.remoteCoverUrl,
        cropX: crop?.x,
        cropY: crop?.y,
        cropW: crop?.width,
        cropH: crop?.height,
      };
    }),
  );
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const skipPrev = usePlayerStore((s) => s.skipPrev);
  // Set when a press turns into a drag, so the release doesn't also fire the
  // tap-to-open. Reset on every fresh pointer-down.
  const didDrag = useRef(false);

  // Trackpad two-finger horizontal pan (a wheel gesture, no press) → switch.
  const songRef = useRef<HTMLButtonElement | null>(null);
  const wheelAccum = useRef(0);
  const wheelCommitted = useRef(false);
  const wheelEndTimer = useRef<number | null>(null);
  const wheelDeps = useRef({ hasTrack: false, next, skipPrev });
  wheelDeps.current = { hasTrack: !!track, next, skipPrev };

  useEffect(() => {
    const el = songRef.current;
    if (!el) return;
    // A wheel pan has no pointerup, so the gesture ends on a short debounce; the
    // momentum tail after a commit is swallowed until then.
    const finishPan = () => {
      wheelEndTimer.current = null;
      wheelCommitted.current = false;
      wheelAccum.current = 0;
    };
    const onWheel = (e: WheelEvent) => {
      const d = wheelDeps.current;
      if (!d.hasTrack) return;
      // Dominant axis decides — a left/right OR up/down pan both switch.
      const horizontal = Math.abs(e.deltaX) >= Math.abs(e.deltaY);
      const delta = horizontal ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault(); // no page scroll / history back-swipe
      if (wheelEndTimer.current != null) window.clearTimeout(wheelEndTimer.current);
      wheelEndTimer.current = window.setTimeout(finishPan, DOCK_WHEEL_END_MS);
      if (wheelCommitted.current) {
        // Don't fire again on this flick's momentum tail, but re-arm as soon as
        // it dies down so the *next* deliberate pan switches — letting you pan
        // several times in a row.
        if (Math.abs(delta) <= DOCK_WHEEL_REARM_PX) {
          wheelCommitted.current = false;
          wheelAccum.current = 0;
        }
        return;
      }
      wheelAccum.current += delta;
      if (Math.abs(wheelAccum.current) < DOCK_WHEEL_SWITCH_PX) return;
      // Natural-scroll deltas are inverted vs. finger motion: pan left/up →
      // positive delta → next; pan right/down → negative → previous (matches drag).
      const forward = wheelAccum.current > 0;
      wheelCommitted.current = true;
      wheelAccum.current = 0;
      if (forward) void d.next();
      else void d.skipPrev();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelEndTimer.current != null) window.clearTimeout(wheelEndTimer.current);
    };
  }, []);

  // Reassemble the minimal cover descriptor (stable while the scalars are).
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on scalars, not the picked object, to keep this stable
  const coverInput = useMemo<
    Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl"> | undefined
  >(
    () =>
      track
        ? {
            coverBlobId: track.coverBlobId,
            remoteCoverUrl: track.remoteCoverUrl,
            coverCrop:
              track.cropW != null
                ? {
                    x: track.cropX ?? 0,
                    y: track.cropY ?? 0,
                    width: track.cropW,
                    height: track.cropH ?? 0,
                  }
                : undefined,
          }
        : undefined,
    [
      track?.coverBlobId,
      track?.remoteCoverUrl,
      track?.cropX,
      track?.cropY,
      track?.cropW,
      track?.cropH,
    ],
  );
  const coverUrl = useTrackCoverUrl(coverInput);
  const playbackLoading = usePlayerStore((s) => s.playbackLoading);
  const loadingLabel = playbackLoading
    ? playbackLoading.sourceKind === "remote"
      ? t("player.loadingRemote", { title: playbackLoading.title })
      : t("player.loadingTrack", { title: playbackLoading.title })
    : null;

  // Dock identity always navigates to the Now Playing tab, including mobile.
  function handleOpen() {
    if (!track) return;
    if (onOpen) transitionState(onOpen);
  }

  const nowTransportRows =
    transportHintScope === "now"
      ? [
          {
            label: `${t("player.previous")} · ${t("shortcuts.scope.now")}`,
            keys: hint("prev", { scope: "now" }),
          },
          {
            label: `${t("player.next")} · ${t("shortcuts.scope.now")}`,
            keys: hint("next", { scope: "now" }),
          },
        ]
      : [];
  const globalTransportRows = [
    {
      label: `${t("player.previous")} · ${t("shortcuts.scope.global")}`,
      keys: hint("prev", { scope: "global" }),
    },
    {
      label: `${t("player.next")} · ${t("shortcuts.scope.global")}`,
      keys: hint("next", { scope: "global" }),
    },
  ];
  const dockTransportRows =
    transportHintScope === "now"
      ? [...nowTransportRows, ...globalTransportRows]
      : [
          { label: t("player.previous"), keys: hint("prev") },
          { label: t("player.next"), keys: hint("next") },
        ];
  const dragShortcutRows = [
    { label: t("player.dragPrevious"), keys: ["→", "↓"] },
    { label: t("player.dragNext"), keys: ["←", "↑"] },
    ...nowTransportRows,
  ].filter((row) => row.keys.length > 0);

  return (
    <div className={cn("flex items-center gap-2 sm:gap-3", className)}>
      <CurrentTrackContextMenu className="min-w-0 flex-1">
        <ControlTooltip label={t("player.dragSwitch")} shortcutRows={dragShortcutRows}>
          <motion.button
            ref={songRef}
            type="button"
            data-testid="dock-song-drag"
            onPointerDown={() => {
              didDrag.current = false;
            }}
            onClick={() => {
              // Swallow the click that trails a drag; a plain tap still opens.
              if (didDrag.current) return;
              handleOpen();
            }}
            disabled={!track}
            aria-label={t("nav.now")}
            drag={!!track}
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            dragElastic={0.16}
            dragMomentum={false}
            dragDirectionLock={false}
            dragSnapToOrigin
            onDragStart={() => {
              didDrag.current = true;
            }}
            onDragEnd={(_, info) => {
              // Drag left OR up → next; right OR down → previous. The dominant
              // axis decides, so a diagonal still resolves cleanly.
              const horizontal = Math.abs(info.offset.x) >= Math.abs(info.offset.y);
              const dist = horizontal ? info.offset.x : info.offset.y;
              const vel = horizontal ? info.velocity.x : info.velocity.y;
              if (dist <= -DOCK_SWITCH_DISTANCE || vel <= -DOCK_SWITCH_VELOCITY) void next();
              else if (dist >= DOCK_SWITCH_DISTANCE || vel >= DOCK_SWITCH_VELOCITY) void skipPrev();
            }}
            className="flex w-full min-w-0 cursor-grab items-center gap-2.5 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-default sm:gap-3"
          >
            <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden bg-secondary album-cover-radius album-cover-shadow">
              {/* Crossfades to the next cover only once it has decoded (no flash). */}
              <CoverImage
                url={coverUrl}
                hasCover={trackHasCover(track ?? undefined)}
                holdPreviousWhileLoading={Boolean(track?.coverBlobId && !track.remoteCoverUrl)}
                fallback={<Disc3Icon className="text-muted-foreground" size={20} />}
                loadStrategy="dom"
              />
              {loadingLabel && (
                <span
                  aria-label={loadingLabel}
                  aria-live="polite"
                  className="absolute inset-0 z-10 grid place-items-center bg-background/45 backdrop-blur-[1px]"
                  data-testid="dock-cover-loading"
                  role="status"
                >
                  <Loader2 aria-hidden="true" className="size-5 animate-spin text-primary" />
                </span>
              )}
            </span>
            <span className="relative min-w-0 flex-1">
              <motion.span
                key={track?.id ?? "none"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="block min-w-0"
              >
                <span className="block truncate text-sm font-semibold">
                  {track?.title ?? "MUZERO"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {track ? track.subtitle : t("app.pressPlay")}
                </span>
              </motion.span>
            </span>
          </motion.button>
        </ControlTooltip>
      </CurrentTrackContextMenu>
      {controls && <div className="shrink-0">{controls}</div>}
      <ControlTooltip
        label={isPlaying ? t("player.pause") : t("player.play")}
        keys={hint("play")}
        shortcutRows={[
          ...dockTransportRows,
          { label: t("track.like"), keys: hint("like") },
          { label: t("nowPlaying.upNext"), keys: hint("queue") },
          { label: t("lyrics.toggleStage"), keys: hint("lyrics") },
          { label: t("visualizer.title"), keys: hint("visualizer") },
        ].filter((row) => row.keys.length > 0)}
      >
        <Button
          size="icon-lg"
          onClick={togglePlay}
          aria-label={isPlaying ? t("player.pause") : t("player.play")}
          className="shrink-0 rounded-full"
        >
          {isPlaying ? <Pause /> : <Play />}
        </Button>
      </ControlTooltip>
    </div>
  );
}
