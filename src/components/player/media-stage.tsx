import { motion } from "motion/react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/use-app-data";
import { useBurstSettledValue } from "@/hooks/use-burst-settled-value";
import { useTrackCoverUrl } from "@/hooks/use-media";
import {
  resolveNowPlayingCoverBacklightAppearance,
  resolveNowPlayingCoverEffectMode,
} from "@/lib/album-cover-appearance";
import { createDiagnosticLogger } from "@/lib/logger";
import { resolveStageLayers } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";
import { CanvasCover } from "./canvas-cover";
import { StageTitleFallback } from "./stage-title-fallback";

const DEFAULT_VIDEO_ASPECT = 16 / 9;
const stageLog = createDiagnosticLogger("nowplaying.stage");
// Quiet window before the cover/title visual adopts a new track during a rapid
// next/prev burst. A single switch lands on the leading edge (instant); only a
// genuine mash coalesces, so deliberate clicks never feel delayed.
const STAGE_DISPLAY_SETTLE_MS = 300;

/**
 * The now-playing "stage". Owns the spot where the shared <video> element is
 * mounted. Video fills the full available width and the box adopts the video's
 * own aspect ratio (no letterbox bars); audio/cover/title fall back to a square.
 * If a video can't be decoded by the WebView (e.g. many .mkv files), we hide the
 * black element and surface a clear "format not playable" note over the visualizer.
 */
export function MediaStage({
  className,
  coverBacklightEnabled = true,
  coverBacklightFadeIn = true,
  coverBacklightFadeMs,
  onCoverReady,
}: {
  className?: string;
  coverBacklightEnabled?: boolean;
  coverBacklightFadeIn?: boolean;
  /** Backlight fade-in duration (ms). Defaults to the resting 420ms; the coverflow
   *  passes the overlay fade duration at a drag hand-off for a constant-glow crossfade. */
  coverBacklightFadeMs?: number;
  /** Fired with the track id once the base cover image has painted that track's cover. */
  onCoverReady?: (trackId: string) => void;
}) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  // The cover/title visual follows a burst-settled track: an isolated switch is
  // instant (leading edge), but a rapid next/prev burst skips the songs it flies
  // past instead of decoding + reconciling the stage subtree for each (PRD Phase
  // 31). Video element logic stays on the live `current` so playback never lags.
  const displayTrack = useBurstSettledValue(current, STAGE_DISPLAY_SETTLE_MS);
  const settings = useSettings();
  const asBgActive =
    (settings.visualizerAsBackground ?? false) && (settings.visualizerStyle ?? "bars") !== "off";

  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const coverUrl = useTrackCoverUrl(displayTrack);
  // Read by CanvasCover's onShown (which fires async, post-decode) to map the painted
  // url → the still-current track for the coverflow handoff gate, without re-running
  // the decode on every render (a fresh onShown closure would).
  const coverUrlRef = useRef(coverUrl);
  coverUrlRef.current = coverUrl;
  const displayTrackIdRef = useRef(displayTrack?.id);
  displayTrackIdRef.current = displayTrack?.id;
  const coverEffectMode = resolveNowPlayingCoverEffectMode(settings.nowPlayingCoverEffectMode);
  const [videoError, setVideoError] = useState(false);
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  // The VIDEO decision follows the LIVE `current` (so the moving picture shows/hides
  // in lockstep with playback + the ambient background, never lagging behind a
  // burst-settled snapshot); the cover/title STILL image follows `displayTrack` (burst
  // coalescing). Splitting the two is the fix for "切歌后前台只显示封面、背景却在放视频"
  // (PRD 20260621-video-stage-shows-cover-after-switch).
  // The foreground "cover-flow" stage ALWAYS shows the cover (never the moving video):
  // the video now lives in the immersive background (NowPlayingVideoBackdrop), gated on
  // displayMode. Forcing "cover" here keeps the still-image geometry + handoff and means
  // the shared <video> is never mounted to the foreground, so a video file shown as a
  // cover doesn't decode in the card. (displayMode still drives the background.)
  const { showVideo, videoBroke, wantVideo, showCover, showTitle } = resolveStageLayers({
    liveTrack: current,
    displayTrack,
    displayMode: "cover",
    videoError,
  });

  // Observability (PRD …video-stage-shows-cover-after-switch): one line per change
  // (not per frame). `staleStill` = the burst-settled still layer is still lagging the
  // live track at this commit; `coverWhileLiveVideo` must stay false post-fix (a stale
  // cover painting over a live video would be the original bug). No user content — only
  // ids/kind/status + element booleans (CLAUDE.md rule 8 / telemetry whitelist).
  const staleStill = (displayTrack?.id ?? null) !== (current?.id ?? null);
  const coverWhileLiveVideo = wantVideo && showCover;
  // biome-ignore lint/correctness/useExhaustiveDependencies: stage-state inputs are the deps; element booleans are read at log time
  useEffect(() => {
    const el = getMediaEngine()?.element;
    stageLog.debug("content", {
      category: "media",
      phase: coverWhileLiveVideo ? "retry" : "state",
      liveTrackId: current?.id,
      displayTrackId: displayTrack?.id,
      liveKind: current?.kind,
      liveStatus: current?.status,
      displayKind: displayTrack?.kind,
      displayStatus: displayTrack?.status,
      wantVideo,
      showVideo,
      showCover,
      showTitle,
      staleStill,
      coverWhileLiveVideo,
      videoError,
      videoPaused: el?.paused,
      videoInContainer: el ? el.parentElement === containerRef.current : undefined,
      videoReadyState: el?.readyState,
    });
  }, [
    current?.id,
    current?.kind,
    current?.status,
    displayTrack?.id,
    wantVideo,
    showVideo,
    showCover,
    showTitle,
    staleStill,
    coverWhileLiveVideo,
    videoError,
  ]);

  // The shared <video> is no longer adopted here — the foreground always shows the
  // cover. The immersive background (NowPlayingVideoBackdrop) mounts the video when
  // displayMode is "video".

  // Reset per-track view state (decode failure + intrinsic aspect) on track change.
  // Keyed to the LIVE `current` id — the video element loads the live track's media,
  // so its decode error / intrinsic aspect belong to `current`, not the burst-settled
  // displayTrack (which only governs the cover/title still image).
  // biome-ignore lint/correctness/useExhaustiveDependencies: id is the reset trigger, not used in the body
  useEffect(() => {
    setVideoError(false);
    setVideoAspect(null);
  }, [current?.id]);
  useEffect(() => {
    const el = getMediaEngine()?.element;
    if (!el) return;
    const onErr = () => setVideoError(true);
    const onLoaded = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        setVideoError(false);
        setVideoAspect(el.videoWidth / el.videoHeight);
      }
    };
    onLoaded(); // the element may already be loaded when this stage (re)mounts
    el.addEventListener("error", onErr);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("loadeddata", onLoaded);
    return () => {
      el.removeEventListener("error", onErr);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("loadeddata", onLoaded);
    };
  }, []);

  const backlight = resolveNowPlayingCoverBacklightAppearance(settings);
  const useCoverShadow = coverEffectMode === "shadow";
  // The resting backlight blurs the SAME original cover the stage shows (via the CSS
  // blur + saturate in NowPlayingCoverBacklight), exactly like the travelling coverflow
  // card backlight (cover-pager-strip). It used to read a pre-blurred 192px "backlight"
  // derivative, but that derivative is generated lazily off the render path — when
  // neither the playback warmup nor an on-miss generate runs (both were dropped in the
  // import/playback-jank perf pass, c8d93ccc), the derivative never exists and the
  // resting glow silently vanishes, while the drag overlay (already CSS-blurring the raw
  // cover) still shows one — the reported "拖拽才有背光、松手/切歌后没了". Sourcing the raw
  // cover removes that dependency: the glow shows whenever the cover does, with no worker
  // render on the switch frame. (PRD 20260621-now-playing-backlight-derivative-missing.)
  const showCoverBacklight =
    coverBacklightEnabled && showCover && coverEffectMode === "backlight" && !!coverUrl;

  // Video keeps its intrinsic ratio. Covers and title cards stay square like
  // album artwork, which keeps direct switches and swipe handoffs on one stable
  // geometry instead of jumping when an uploaded cover is wide/tall. Geometry tracks
  // `wantVideo` (the live video box) so a video that's loading/broke keeps its shape.
  const aspect = wantVideo ? (videoAspect ?? DEFAULT_VIDEO_ASPECT) : showCover ? 1 : null;

  return (
    <div
      ref={stageRef}
      style={aspect != null ? { aspectRatio: String(aspect) } : undefined}
      className={cn(
        "relative isolate shrink-0 overflow-visible",
        wantVideo ? "w-full" : showCover ? "mx-auto w-full" : "mx-auto aspect-square w-full",
        className,
      )}
    >
      <NowPlayingCoverBacklight
        active={showCoverBacklight}
        anchorRef={stageRef}
        fadeIn={coverBacklightFadeIn}
        fadeMs={coverBacklightFadeMs}
        opacity={backlight.opacity / 100}
        url={coverUrl}
      />
      <div
        ref={containerRef}
        className={cn(
          "relative z-10 size-full",
          wantVideo
            ? "overflow-hidden rounded-lg bg-black shadow-md"
            : "overflow-hidden bg-muted album-cover-radius",
          !wantVideo && useCoverShadow && "album-cover-shadow",
        )}
      >
        {showTitle && <StageTitleFallback track={displayTrack} dim={asBgActive} />}
        {/* Rendered to a persistent canvas (decode-off-thread, hold-previous + crossfade)
            so a cover switch never re-decodes-on-paint = no flash, like the Pixi bg. */}
        {showCover && (
          <CanvasCover
            coverUrl={coverUrl}
            className="z-10 album-cover-radius"
            label="base"
            onShown={(url) => {
              const id = displayTrackIdRef.current;
              if (id && coverUrlRef.current === url) onCoverReady?.(id);
            }}
          />
        )}
        {videoBroke && (
          <div className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-6 text-center text-sm text-muted-foreground">
            {t("nowPlaying.videoUnsupported")}
          </div>
        )}
      </div>
    </div>
  );
}

function NowPlayingCoverBacklight({
  active,
  anchorRef,
  fadeIn,
  fadeMs = 420,
  opacity,
  url,
}: {
  active: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  fadeIn: boolean;
  /** Fade-in duration (ms). Matched to the coverflow overlay's fade-out at a drag
   *  hand-off so the card glow (fading out) + this (fading in) sum to a constant
   *  glow — no brightness dip (PRD 20260618-backlight-shadow-drag #1). */
  fadeMs?: number;
  opacity: number;
  url: string | null;
}) {
  const rect = useViewportRect(anchorRef, active && !!url);
  const target = typeof document !== "undefined" ? anchorRef.current?.closest("main") : null;

  return active && url && rect && target
    ? createPortal(
        <motion.div
          key={url}
          aria-hidden
          initial={fadeIn ? { opacity: 0 } : false}
          animate={{ opacity }}
          transition={{ duration: fadeMs / 1000, ease: "easeOut" }}
          className="pointer-events-none fixed -z-10 now-playing-cover-backlight-clip"
          style={rect}
        >
          <img
            src={url}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
            className="absolute inset-0 size-full object-cover album-cover-radius"
            style={{
              transform: "scale(var(--now-playing-cover-backlight-scale, 1.12))",
              filter: [
                "blur(var(--now-playing-cover-backlight-blur, 20px))",
                "saturate(var(--now-playing-cover-backlight-saturation, 400%))",
              ].join(" "),
            }}
          />
        </motion.div>,
        target,
      )
    : null;
}

type ViewportRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

function useViewportRect(ref: RefObject<HTMLElement | null>, active: boolean) {
  const [rect, setRect] = useState<ViewportRect | null>(null);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) {
      setRect(null);
      return;
    }
    const next = toViewportRect(el.getBoundingClientRect());
    setRect((current) => (sameViewportRect(current, next) ? current : next));
  }, [ref]);

  useEffect(() => {
    if (!active) {
      setRect(null);
      return;
    }
    update();
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    const el = ref.current;
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && el) {
      ro = new ResizeObserver(schedule);
      ro.observe(el);
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [active, ref, update]);

  return rect;
}

function toViewportRect(rect: DOMRect): ViewportRect {
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

function sameViewportRect(a: ViewportRect | null, b: ViewportRect) {
  if (!a) return false;
  return a.height === b.height && a.left === b.left && a.top === b.top && a.width === b.width;
}
