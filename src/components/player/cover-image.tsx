import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, type SyntheticEvent, useEffect, useMemo, useState } from "react";
import { thumbHashToDataURL } from "thumbhash";
import { useLoadedImageUrl } from "@/hooks/use-image-load";
import { base64ToThumbhash } from "@/lib/cover-thumbhash";
import { cn } from "@/lib/utils";

// Now Playing cover crossfade duration. Kept at/under the 200ms transport switch
// cap (5/s) so that when the user holds Q/E the cover crossfade finishes before the
// next switch arrives — it stays in lockstep with the current track instead of
// lagging behind a half-finished 0.4s fade (the "封面对不上" on rapid next/prev).
const COVER_CROSSFADE_SEC = 0.2;

/**
 * A crossfading cover with no "previous cover" flash on track change. It keeps
 * showing the current image until the *next* one has fully decoded, then cross-
 * fades to it. For remote covers, callers can disable the hold so a slow/broken
 * network image falls back to the current track's placeholder instead of showing
 * the previous track's art. Renders absolutely; place it in a `relative` box.
 */
export function CoverImage({
  url,
  hasCover,
  holdPreviousWhileLoading = true,
  fallback,
  onAspect,
  onShown,
  thumbhash,
  trackId,
  loadStrategy = "preload",
  className,
}: {
  url: string | null;
  hasCover: boolean;
  holdPreviousWhileLoading?: boolean;
  fallback?: ReactNode;
  loadStrategy?: "dom" | "preload";
  onAspect?: (aspect: number) => void;
  /** Fired once the currently-displayed image IS `url` (the new cover has painted). */
  onShown?: () => void;
  /** Base64 thumbhash → instant blurred preview painted while the cover decodes. */
  thumbhash?: string | null;
  trackId?: string;
  className?: string;
}) {
  if (loadStrategy === "dom") {
    return (
      <DomLoadedCoverImage
        className={className}
        fallback={fallback}
        hasCover={hasCover}
        holdPreviousWhileLoading={holdPreviousWhileLoading}
        onAspect={onAspect}
        onShown={onShown}
        thumbhash={thumbhash}
        url={url}
      />
    );
  }
  return (
    <PreloadedCoverImage
      className={className}
      fallback={fallback}
      hasCover={hasCover}
      holdPreviousWhileLoading={holdPreviousWhileLoading}
      onAspect={onAspect}
      trackId={trackId}
      url={url}
    />
  );
}

function PreloadedCoverImage({
  url,
  hasCover,
  holdPreviousWhileLoading,
  fallback,
  onAspect,
  trackId,
  className,
}: {
  url: string | null;
  hasCover: boolean;
  holdPreviousWhileLoading: boolean;
  fallback?: ReactNode;
  onAspect?: (aspect: number) => void;
  trackId?: string;
  className?: string;
}) {
  const loaded = useLoadedImageUrl(url, {
    decode: false,
    holdPreviousWhileLoading,
    trace: {
      source: "cover",
      surface: "now-playing",
      trackId,
    },
  });
  const displayUrl = loaded.displayUrl;

  useEffect(() => {
    if (loaded.status === "loaded" && loaded.aspect) onAspect?.(loaded.aspect);
  }, [loaded.aspect, loaded.status, onAspect]);

  return (
    <>
      {!displayUrl && (!hasCover || loaded.status !== "loaded") && fallback}
      <AnimatePresence initial={false}>
        {displayUrl && (
          <motion.img
            key={displayUrl}
            src={displayUrl}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className={cn("absolute inset-0 size-full object-cover", className)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function DomLoadedCoverImage({
  url,
  hasCover,
  holdPreviousWhileLoading,
  fallback,
  onAspect,
  onShown,
  thumbhash,
  className,
}: {
  url: string | null;
  hasCover: boolean;
  holdPreviousWhileLoading: boolean;
  fallback?: ReactNode;
  onAspect?: (aspect: number) => void;
  onShown?: () => void;
  thumbhash?: string | null;
  className?: string;
}) {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(url);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  // Instant blurred preview from the thumbhash, painted UNDER the cover while it loads
  // + decodes — so a cover with no previous to hold (first view) sharpens from a blur
  // instead of flashing the empty surface. A bad hash degrades to no preview.
  const preview = useMemo(() => {
    if (!thumbhash) return null;
    try {
      return thumbHashToDataURL(base64ToThumbhash(thumbhash));
    } catch {
      return null;
    }
  }, [thumbhash]);

  // Report "the new cover is painted" once the displayed image IS the current url —
  // lets the coverflow handoff wait for the base to actually show the cover instead
  // of a fixed timer (which could fade the overlay while the base still held the old
  // cover = the "cover flashes ~0.5s after release" at the handoff).
  useEffect(() => {
    if (url && displayUrl === url) onShown?.();
  }, [displayUrl, url, onShown]);

  // Adjust per-URL state DURING RENDER on a prop change rather than in a useEffect:
  // the effect forced an extra render + a stale intermediate commit on EVERY track
  // switch (react-doctor no-adjust-state-on-prop-change / no-cascading-set-state —
  // see react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // React re-renders synchronously here without committing the stale frame, so the
  // crossfade is visually identical but one render+commit lighter per switch.
  const [prevDeps, setPrevDeps] = useState({ holdPreviousWhileLoading, url });
  if (url !== prevDeps.url || holdPreviousWhileLoading !== prevDeps.holdPreviousWhileLoading) {
    setPrevDeps({ holdPreviousWhileLoading, url });
    setFailedUrl(null);
    setPendingUrl(url);
    if (!url || !holdPreviousWhileLoading) setDisplayUrl(null);
  }

  const onPendingLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const loadedUrl = pendingUrl;
    if (!loadedUrl) return;
    const image = event.currentTarget;
    if (image.getAttribute("src") !== loadedUrl) return;
    // Reveal only once the image is DECODED, not merely loaded. `decoding="async"`
    // means a freshly-mounted <img> can become visible while the browser is still
    // decoding it → one frame of the bg-muted square = the "cover flashes black"
    // (worse for large covers, which decode slower). Awaiting decode() — at the
    // element's display size — paints the cover on the frame it appears, like the
    // Pixi background's off-thread createImageBitmap. Falls back to show-on-load.
    const reveal = () => {
      if (image.getAttribute("src") !== loadedUrl) return; // superseded mid-decode
      setDisplayUrl(loadedUrl);
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        onAspect?.(image.naturalWidth / image.naturalHeight);
      }
    };
    if (typeof image.decode === "function") {
      image.decode().then(reveal, reveal);
    } else {
      reveal();
    }
  };
  const onPendingError = () => {
    const failed = pendingUrl;
    if (!failed) return;
    setFailedUrl(failed);
    setPendingUrl(null);
    if (!holdPreviousWhileLoading) setDisplayUrl(null);
  };
  const showFallback = !displayUrl && (!hasCover || !pendingUrl || failedUrl === url);
  const previousUrl = displayUrl && displayUrl !== pendingUrl ? displayUrl : null;
  const pendingDisplayUrl = pendingUrl && failedUrl !== pendingUrl ? pendingUrl : null;

  return (
    <>
      {showFallback && fallback}
      {/* Blurred thumbhash preview behind the cover, while the current cover isn't shown
          yet (and nothing else is held over it) — sharpen-from-blur instead of a gap. */}
      {preview && displayUrl !== url && !previousUrl && (
        <img
          src={preview}
          alt=""
          aria-hidden
          className={cn("absolute inset-0 size-full object-cover", className)}
        />
      )}
      <AnimatePresence initial={false}>
        {previousUrl && (
          <motion.img
            key={previousUrl}
            src={previousUrl}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: COVER_CROSSFADE_SEC }}
            className={cn("absolute inset-0 size-full object-cover", className)}
          />
        )}
        {pendingDisplayUrl && (
          <motion.img
            key={pendingDisplayUrl}
            src={pendingDisplayUrl}
            alt=""
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onError={onPendingError}
            onLoad={onPendingLoad}
            initial={{ opacity: 0 }}
            animate={{ opacity: displayUrl === pendingDisplayUrl ? 1 : 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: COVER_CROSSFADE_SEC }}
            className={cn("absolute inset-0 size-full object-cover", className)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
