import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/use-app-data";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { resolveStageContent } from "@/lib/track-display";
import { trackGradient } from "@/lib/track-gradient";
import { cn } from "@/lib/utils";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";
import { AuraVisualizer } from "./aura-visualizer";
import { CoverImage } from "./cover-image";

const DEFAULT_VIDEO_ASPECT = 16 / 9;

/**
 * The now-playing "stage". Owns the spot where the shared <video> element is
 * mounted. Video fills the full available width and the box adopts the video's
 * own aspect ratio (no letterbox bars); audio/cover/title fall back to a square.
 * If a video can't be decoded by the WebView (e.g. many .mkv files), we hide the
 * black element and surface a clear "format not playable" note over the visualizer.
 */
export function MediaStage({ className }: { className?: string }) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const displayMode = usePlayerStore((s) => s.displayMode);
  const audioOnly = usePlayerStore((s) => s.audioOnly);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const settings = useSettings();
  // When the visualizer is the page background, don't also draw it in a no-cover
  // song's cover area (avoids a double visualizer) — show a per-song gradient
  // placeholder instead, unless the user opts in.
  const asBgActive =
    (settings.visualizerAsBackground ?? false) && (settings.visualizerStyle ?? "aura") !== "off";
  const showStageViz = !asBgActive || (settings.visualizerInCoverArea ?? false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const coverUrl = useTrackCoverUrl(current);
  const [videoError, setVideoError] = useState(false);
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const [coverAspect, setCoverAspect] = useState<number | null>(null);
  const content = resolveStageContent({
    track: current,
    displayMode,
    audioOnly,
    // Whether a cover *exists* (sync) — not whether its URL has resolved yet — so
    // the stage doesn't flip to the visualizer during a track change.
    hasCover: !!current?.coverBlobId,
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: id is the reset trigger, not used in the body
  useEffect(() => {
    setVideoError(false);
    setVideoAspect(null);
    setCoverAspect(null);
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
  // Video and cover both fill the width at their *own* aspect ratio — a 1:1
  // cropped cover shows as a 1:1 square, a wide cover stays wide (no distortion,
  // no bars). Title/visualizer fall back to a centered square.
  const aspect = showVideo
    ? (videoAspect ?? DEFAULT_VIDEO_ASPECT)
    : showCover
      ? (coverAspect ?? 1)
      : null;

  return (
    <div
      ref={containerRef}
      style={aspect != null ? { aspectRatio: String(aspect) } : undefined}
      className={cn(
        // `transform-gpu` + `isolate` flatten the stage (video / cover <img> /
        // canvas) into ONE backing layer. Otherwise the <video> and the cross-
        // fading cover are their own compositor layers that escape the section's
        // fade mask (it's an ancestor) — they'd render crisp over the fade while
        // the canvas visualizer, which has no layer of its own, fades correctly.
        "relative shrink-0 transform-gpu isolate overflow-hidden rounded-2xl",
        showVideo
          ? "w-full bg-black"
          : showCover
            ? "mx-auto w-full max-w-2xl bg-card/40"
            : "mx-auto aspect-square w-full max-w-md bg-card/40",
        className,
      )}
    >
      {(content !== "video" || videoError) &&
        (showStageViz ? (
          <AuraVisualizer active={isPlaying} className="absolute inset-0" />
        ) : (
          // Visualizer is the page background → use a per-song gradient here instead.
          <div
            className="absolute inset-0"
            style={{ background: trackGradient(current?.id ?? "muzero") }}
          />
        ))}
      {/* Crossfades to the next cover only once it has decoded (no flash of the
          previous track's cover), and reports its aspect for the box ratio. */}
      {content === "cover" && (
        <CoverImage
          url={coverUrl}
          hasCover={!!current?.coverBlobId}
          onAspect={setCoverAspect}
          className="z-10"
        />
      )}
      {videoBroke && (
        <div className="absolute inset-x-0 top-1/2 z-20 -translate-y-1/2 px-6 text-center text-sm text-muted-foreground">
          {t("nowPlaying.videoUnsupported")}
        </div>
      )}
    </div>
  );
}
