import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A crossfading cover with no "previous cover" flash on track change. It keeps
 * showing the current image until the *next* one has fully decoded, then cross-
 * fades to it. A transient null `url` (the cover blob / crop still resolving) is
 * ignored while `hasCover` is true — only a genuine "no cover" fades out to the
 * fallback. Renders absolutely; place it in a `relative` box.
 */
export function CoverImage({
  url,
  hasCover,
  fallback,
  onAspect,
  className,
}: {
  url: string | null;
  hasCover: boolean;
  fallback?: ReactNode;
  onAspect?: (aspect: number) => void;
  className?: string;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      // Only fade out when the track genuinely has no cover; ignore the brief
      // null while the next cover's blob/crop is still resolving.
      if (!hasCover) setLoaded(null);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      setLoaded(url);
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        onAspect?.(img.naturalWidth / img.naturalHeight);
      }
    };
    img.onerror = () => {
      if (alive && !hasCover) setLoaded(null);
    };
    img.src = url;
    return () => {
      alive = false;
    };
  }, [url, hasCover, onAspect]);

  return (
    <>
      {!loaded && fallback}
      <AnimatePresence initial={false}>
        {loaded && (
          <motion.img
            key={loaded}
            src={loaded}
            alt=""
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
