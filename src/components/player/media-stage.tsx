import { motion } from "motion/react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/use-app-data";
import { useBurstSettledValue } from "@/hooks/use-burst-settled-value";
import { useCoverDerivativeUrl, useTrackCoverUrl } from "@/hooks/use-media";
import {
  resolveNowPlayingCoverBacklightAppearance,
  resolveNowPlayingCoverEffectMode,
  shouldRequestCoverBacklightDerivative,
} from "@/lib/album-cover-appearance";
import { resolveStageContent, trackHasCover } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";
import { CoverImage } from "./cover-image";
import { StageTitleFallback } from "./stage-title-fallback";

const DEFAULT_VIDEO_ASPECT = 16 / 9;
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
  onCoverReady,
}: {
  className?: string;
  coverBacklightEnabled?: boolean;
  coverBacklightFadeIn?: boolean;
  /** Fired with the track id once the base cover image has painted that track's cover. */
  onCoverReady?: (trackId: string) => void;
}) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const displayMode = usePlayerStore((s) => s.displayMode);
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
  const coverEffectMode = resolveNowPlayingCoverEffectMode(settings.nowPlayingCoverEffectMode);
  // Only the "backlight" effect renders the blurred derivative — gate the request
  // so the default "shadow" mode no longer fires a worker render + DB write + blob
  // URL for an image it never shows on every track switch (audit O1).
  const coverBacklightUrl = useCoverDerivativeUrl(
    shouldRequestCoverBacklightDerivative(coverEffectMode, coverBacklightEnabled)
      ? displayTrack
      : undefined,
    "backlight",
  );
  const [videoError, setVideoError] = useState(false);
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const content = resolveStageContent({
    track: displayTrack,
    displayMode,
    // Whether a cover *exists* (sync) — not whether its URL has resolved yet — so
    // the stage doesn't flip to the visualizer during a track change.
    hasCover: trackHasCover(displayTrack),
  });
  const showVideo = content === "video";
  // A video track the WebView accepted as "video" but failed to decode.
  const videoBroke = showVideo && videoError;

  // Adopt the persistent media element into this stage; release on unmount
  // (playback keeps going while the element is detached).
  useEffect(() => {
    const engine = getMediaEngine();
    const container = containerRef.current;
    if (engine && container) engine.mount(container);
    return () => getMediaEngine()?.unmount();
  }, []);

  // Reset per-track view state (decode failure + intrinsic aspect) on track change.
  // Keyed to the displayed track so it stays in lockstep with the shown content.
  // biome-ignore lint/correctness/useExhaustiveDependencies: id is the reset trigger, not used in the body
  useEffect(() => {
    setVideoError(false);
    setVideoAspect(null);
  }, [displayTrack?.id]);
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

  // Show/hide the video element based on the resolved stage content. object-cover
  // fills the box edge-to-edge — the box already matches the video's aspect, so
  // nothing is cropped and there are no bars.
  useEffect(() => {
    const el = getMediaEngine()?.element;
    if (!el) return;
    el.className =
      showVideo && !videoError
        ? "absolute inset-0 z-10 h-full w-full bg-black object-cover"
        : "pointer-events-none absolute h-0 w-0 opacity-0";
  }, [showVideo, videoError]);

  const showCover = content === "cover";
  const showGeneratedBackdrop = content === "title" || videoError;
  const backlight = resolveNowPlayingCoverBacklightAppearance(settings);
  const useCoverShadow = coverEffectMode === "shadow";
  const showCoverBacklight =
    coverBacklightEnabled && showCover && coverEffectMode === "backlight" && !!coverBacklightUrl;

  // Video keeps its intrinsic ratio. Covers and title cards stay square like
  // album artwork, which keeps direct switches and swipe handoffs on one stable
  // geometry instead of jumping when an uploaded cover is wide/tall.
  const aspect = showVideo ? (videoAspect ?? DEFAULT_VIDEO_ASPECT) : showCover ? 1 : null;

  return (
    <div
      ref={stageRef}
      style={aspect != null ? { aspectRatio: String(aspect) } : undefined}
      className={cn(
        "relative isolate shrink-0 overflow-visible",
        showVideo ? "w-full" : showCover ? "mx-auto w-full" : "mx-auto aspect-square w-full",
        className,
      )}
    >
      <NowPlayingCoverBacklight
        active={showCoverBacklight}
        anchorRef={stageRef}
        fadeIn={coverBacklightFadeIn}
        opacity={backlight.opacity / 100}
        url={coverBacklightUrl}
      />
      <div
        ref={containerRef}
        className={cn(
          "relative z-10 size-full",
          showVideo
            ? "overflow-hidden rounded-lg bg-black shadow-md"
            : "overflow-hidden bg-muted album-cover-radius",
          !showVideo && useCoverShadow && "album-cover-shadow",
        )}
      >
        {showGeneratedBackdrop && <StageTitleFallback track={displayTrack} dim={asBgActive} />}
        {/* Crossfades to the next cover only once it has decoded (no flash of the
            previous track's cover), and reports its aspect for the box ratio. */}
        {content === "cover" && (
          <CoverImage
            url={coverUrl}
            hasCover={trackHasCover(displayTrack)}
            holdPreviousWhileLoading={Boolean(
              displayTrack?.coverBlobId && !displayTrack.remoteCoverUrl,
            )}
            fallback={<StageTitleFallback track={displayTrack} dim={asBgActive} />}
            className="z-10 album-cover-radius"
            loadStrategy="dom"
            onShown={displayTrack ? () => onCoverReady?.(displayTrack.id) : undefined}
            trackId={displayTrack?.id}
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
  opacity,
  url,
}: {
  active: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  fadeIn: boolean;
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
          transition={{ duration: 0.42, ease: "easeOut" }}
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
