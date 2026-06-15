import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, type SyntheticEvent, useEffect, useState } from "react";
import { useLoadedImageUrl } from "@/hooks/use-image-load";
import { cn } from "@/lib/utils";

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
  className,
}: {
  url: string | null;
  hasCover: boolean;
  holdPreviousWhileLoading: boolean;
  fallback?: ReactNode;
  onAspect?: (aspect: number) => void;
  className?: string;
}) {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(url);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

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
    setDisplayUrl(loadedUrl);
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      onAspect?.(image.naturalWidth / image.naturalHeight);
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
            transition={{ duration: 0.4 }}
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
            transition={{ duration: 0.4 }}
            className={cn("absolute inset-0 size-full object-cover", className)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
