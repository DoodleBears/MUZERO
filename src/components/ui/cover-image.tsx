import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared cover/thumbnail surface (instant-cover-thumbnails PRD Phase 2).
 *
 * One place to render a cover so every surface (sets, albums, artists, tracks,
 * avatars) behaves the same instead of re-implementing the
 * `coverUrl ? <img/> : <Icon/>` ternary:
 *
 *  - A static `bg-secondary` surface holds the space (and, Phase 4, the thumbhash
 *    preview); the `<img>` is layered above and fades `opacity 0→1` on load.
 *  - The fade is a **CSS** transition (works even when a tab is backgrounded and
 *    rAF is throttled) and is disabled under `prefers-reduced-motion`.
 *  - An image the browser already has decoded (a cache hit from the cross-mount
 *    `coverUrlCache`) reports `complete` on mount, so we start `loaded` and skip
 *    the fade — an instant cover never animates.
 *  - The no-cover icon shows only when there is genuinely no `url` — never during
 *    the brief load window (that's the calm `bg-secondary` block, per PRD Q4).
 *
 * `children` are layered on top for overlays (liked heart, hover affordance).
 */
export function CoverImage({
  url,
  alt = "",
  placeholder,
  rounded,
  className,
  imgClassName,
  children,
}: {
  /** Object URL (from `useTrackCoverUrl` & friends) or null when there's no cover. */
  url: string | null;
  alt?: string;
  /** Shown only when `url` is null (e.g. a `Disc3` / `User` icon). */
  placeholder?: ReactNode;
  /** Round (artist/avatar) → `rounded-full`. For square covers pass the corner
   *  radius in `className` (e.g. `rounded-lg` / `rounded-xl` / `rounded-md`). */
  rounded?: boolean;
  /** Sizing/layout + square corner radius (e.g. `size-12 rounded-lg`, `aspect-square w-full rounded-md`). */
  className?: string;
  imgClassName?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLImageElement>(null);
  // Track which url has finished loading so a url change auto-resets the fade.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const loaded = url != null && loadedUrl === url;

  // A reused object URL is often already decoded → `complete` synchronously.
  // Mark it loaded before paint so an instant cover doesn't pointlessly fade.
  useLayoutEffect(() => {
    const img = ref.current;
    if (url && img?.complete && img.naturalWidth > 0) setLoadedUrl(url);
  }, [url]);

  return (
    <span
      className={cn(
        "relative grid place-items-center overflow-hidden bg-secondary",
        rounded && "rounded-full",
        className,
      )}
    >
      {!url && placeholder}
      {url && (
        <img
          ref={ref}
          src={url}
          alt={alt}
          data-state={loaded ? "loaded" : "loading"}
          onLoad={() => setLoadedUrl(url)}
          className={cn(
            "size-full object-cover transition-opacity duration-200 ease-out motion-reduce:transition-none",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      )}
      {children}
    </span>
  );
}
