import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { thumbHashToDataURL } from "thumbhash";
import { base64ToThumbhash } from "@/lib/cover-thumbhash";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";

/**
 * Cover object URLs whose `<img>` has decoded at least once this session. The
 * object-URL cache keeps a cover's URL string stable across unmounts, so when a
 * virtualized wall re-mounts (e.g. returning from a detail page) its covers get
 * the SAME url they had before — already in this set — and start painted instead
 * of replaying the opacity fade. That removes the cover "flash" on the way back.
 * A freshly created `<img>` isn't reliably `complete` in a layout effect even for
 * a cached blob URL, so this remembered signal is what makes the re-mount instant.
 */
const decodedCoverUrls = new Set<string>();

/** Test-only: clear the session decode memory so each test starts from a cold cache. */
export function resetDecodedCoverUrls(): void {
  decodedCoverUrls.clear();
}

/**
 * Shared cover/thumbnail surface (instant-cover-thumbnails PRD Phases 2 & 4).
 *
 * One place to render a cover so every surface (sets, albums, artists, tracks,
 * avatars) behaves the same instead of re-implementing the
 * `coverUrl ? <img/> : <Icon/>` ternary:
 *
 *  - Placeholder ladder (PRD §5.2): a decoded **thumbhash** preview if present →
 *    else a calm `bg-secondary` block → the no-cover icon only when there's no
 *    `url` at all (never during the brief load window).
 *  - The real `<img>` is layered above and fades `opacity 0→1` on load. The fade
 *    is a **CSS** transition (works when a tab is backgrounded and rAF is
 *    throttled), so it survives even when app-level rAF work is paused.
 *  - An image the browser already has decoded (a cache hit from the cross-mount
 *    `coverUrlCache`) reports `complete` on mount, so we start `loaded`, skip the
 *    fade, and never even paint the preview — an instant cover doesn't animate.
 *
 * `children` are layered on top for overlays (liked heart, hover affordance).
 */
export function CoverImage({
  url,
  thumbhash,
  alt = "",
  placeholder,
  rounded,
  className,
  imgClassName,
  style,
  children,
}: {
  /** Object URL (from `useTrackCoverUrl` & friends) or null when there's no cover. */
  url: string | null;
  /** Base64 thumbhash of the cover (owner row) — decoded to a blurred preview. */
  thumbhash?: string | null;
  alt?: string;
  /** Shown only when `url` is null (e.g. a `Disc3` / `User` icon). */
  placeholder?: ReactNode;
  /** Round (artist/avatar) → `rounded-full`. Square covers use the global album-cover radius. */
  rounded?: boolean;
  /** Sizing/layout. Square cover radius is applied by default. */
  className?: string;
  imgClassName?: string;
  /** Inline style on the root box — used to set a `view-transition-name` so the
   *  cover can morph into its detail-page counterpart (gallery → detail). */
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLImageElement>(null);
  // Track which url has finished loading so a url change auto-resets the fade. A
  // url we've already decoded this session (e.g. a wall re-mounting on the way
  // back from a detail page) starts loaded, so it re-appears without re-fading.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(() =>
    url && decodedCoverUrls.has(url) ? url : null,
  );
  const loaded = url != null && loadedUrl === url;

  // Decode the thumbhash to a tiny PNG data URL (pure — no canvas). Memoized by
  // the hash string; a bad hash degrades to no preview.
  const preview = useMemo(() => {
    if (!thumbhash) return null;
    try {
      return thumbHashToDataURL(base64ToThumbhash(thumbhash));
    } catch (err) {
      log.debug("thumbhash decode failed; using plain placeholder", err);
      return null;
    }
  }, [thumbhash]);

  // Mark a reused cover loaded BEFORE paint so it doesn't pointlessly fade: either
  // we decoded this exact url earlier this session, or the freshly-mounted <img>
  // is already `complete` (a same-frame cache hit). The remembered-url check is the
  // reliable one — a new <img> on a cached blob url often isn't `complete` yet.
  useLayoutEffect(() => {
    const img = ref.current;
    if (url && (decodedCoverUrls.has(url) || (img?.complete && img.naturalWidth > 0))) {
      setLoadedUrl(url);
    }
  }, [url]);

  return (
    <span
      className={cn(
        "relative grid place-items-center overflow-hidden bg-secondary",
        rounded ? "rounded-full" : "album-cover-radius album-cover-shadow",
        className,
      )}
      style={style}
    >
      {!url && !preview && placeholder}
      {/* Blurred preview, behind the real image, while the full cover is deferred or loading. */}
      {preview && (!url || !loaded) && (
        <img
          src={preview}
          alt=""
          aria-hidden
          data-cover-preview
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {url && (
        <img
          ref={ref}
          src={url}
          alt={alt}
          data-state={loaded ? "loaded" : "loading"}
          onLoad={() => {
            decodedCoverUrls.add(url);
            setLoadedUrl(url);
          }}
          className={cn(
            "relative size-full object-cover transition-opacity duration-200 ease-out",
            loaded ? "opacity-100" : "opacity-0",
            imgClassName,
          )}
        />
      )}
      {children}
    </span>
  );
}
