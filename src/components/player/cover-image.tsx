import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect } from "react";
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
  className,
}: {
  url: string | null;
  hasCover: boolean;
  holdPreviousWhileLoading?: boolean;
  fallback?: ReactNode;
  onAspect?: (aspect: number) => void;
  className?: string;
}) {
  const loaded = useLoadedImageUrl(url, { holdPreviousWhileLoading });
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
