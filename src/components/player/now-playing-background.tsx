import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { getTrackCover, listGalleryImages, listTrackBackgrounds } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useObjectUrls } from "@/hooks/use-media";
import { resolveBackgroundSource } from "@/lib/background";
import { nextSlideIndex } from "@/lib/slideshow";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

const EMPTY: Blob[] = [];

/**
 * The Now-Playing ambient backdrop: a blurred, dimmed image (or cross-fading
 * slideshow) behind the page. Source follows the user's background mode —
 * "cover" shows the track's cover; "slideshow" prefers the song's own bound
 * backgrounds, then the global gallery (see resolveBackgroundSource). Its own
 * component so the slideshow timer never re-renders the rest of the page.
 *
 * Transitions are decode-gated via a fixed two-buffer ping-pong: the next frame
 * — a slideshow advance OR a new track's cover — is preloaded off-screen and
 * only swapped in once fully decoded, so a slow image never flashes blank or
 * half-painted; the outgoing layer holds until the cross-fade. Exactly two
 * <img>s are ever mounted (keyed by slot, never by URL), so layers never pile
 * up no matter how often the source changes.
 */
export function NowPlayingBackground({ className }: { className?: string }) {
  const settings = useSettings();
  const mode = settings.backgroundMode ?? "cover";
  const galleryFallback = settings.backgroundGalleryFallback ?? true;
  const blurPx = settings.backgroundBlur ?? 12;
  const maskOpacity = (settings.backgroundMaskOpacity ?? 25) / 100;
  const intervalSec = settings.backgroundSlideshowIntervalSec ?? 10;
  const shuffle = settings.backgroundSlideshowShuffle ?? false;
  // `filter: blur()` samples transparent pixels beyond the image box, so its
  // edges fade out and reveal the app background (a washed-out border). Extend
  // the image past the viewport by ~3× the blur radius so that fringe falls
  // outside the clipped (overflow-hidden) backdrop. Scales with the blur slider,
  // so even max blur stays edge-to-edge.
  const bleedMargin = blurPx * 3;
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;

  const coverBlob = useLiveQuery(
    async () => (current?.coverBlobId ? (await getTrackCover(current))?.blob : undefined),
    [current?.coverBlobId],
    undefined,
  );
  const trackBgBlobs = useLiveQuery(
    async () => (current ? (await listTrackBackgrounds(current.id)).map((b) => b.blob) : EMPTY),
    [current?.id],
    EMPTY,
  );
  const galleryBlobs = useLiveQuery(
    async () => (await listGalleryImages()).map((b) => b.blob),
    [],
    EMPTY,
  );

  const source = resolveBackgroundSource({
    mode,
    galleryFallback,
    hasCover: !!coverBlob,
    trackBackgroundCount: trackBgBlobs.length,
    galleryCount: galleryBlobs.length,
  });

  const blobs = useMemo(() => {
    if (source === "track-slideshow") return trackBgBlobs;
    if (source === "gallery-slideshow") return galleryBlobs;
    if (source === "cover" && coverBlob) return [coverBlob];
    return EMPTY;
  }, [source, trackBgBlobs, galleryBlobs, coverBlob]);

  const urls = useObjectUrls(blobs);

  // Advance the slideshow; reset to the first frame whenever the set changes.
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (urls.length <= 1) return;
    const ms = Math.max(1, intervalSec) * 1000;
    const timer = window.setInterval(
      () => setIdx((i) => nextSlideIndex(i, urls.length, shuffle)),
      ms,
    );
    return () => window.clearInterval(timer);
  }, [urls, intervalSec, shuffle]);

  // The frame we *want* to show next. `idx` is reset on set change, but guard
  // the modulo so a stale index (one render before the reset lands) stays valid.
  const targetUrl = urls.length > 0 ? (urls[idx % urls.length] ?? urls[0]) : null;

  // Two-buffer ping-pong. `front` is the visible layer; the other holds the
  // outgoing image during a fade. We preload the target, then flip — CSS
  // opacity does the cross-fade.
  const [buffers, setBuffers] = useState<[string | null, string | null]>([null, null]);
  const [front, setFront] = useState<0 | 1>(0);
  const frontRef = useRef<0 | 1>(0);
  const primedRef = useRef(false);

  useEffect(() => {
    if (!targetUrl) {
      primedRef.current = false;
      frontRef.current = 0;
      setBuffers([null, null]);
      setFront(0);
      return;
    }
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      if (!primedRef.current) {
        // First frame: prime both buffers so the next swap can cross-fade from a
        // real image instead of a freshly-mounted (un-faded) layer.
        primedRef.current = true;
        frontRef.current = 0;
        setBuffers([targetUrl, targetUrl]);
        setFront(0);
        return;
      }
      const back = frontRef.current === 0 ? 1 : 0;
      frontRef.current = back;
      setBuffers((b) => (back === 0 ? [targetUrl, b[1]] : [b[0], targetUrl]));
      setFront(back);
    };
    img.src = targetUrl;
    return () => {
      alive = false;
    };
  }, [targetUrl]);

  if (!buffers[0] && !buffers[1]) return null;

  // Shared blur + overscan for every layer (see bleedMargin above). Explicit
  // width/height push the blur's transparent fringe off-screen; `max-w-none`
  // defeats the Tailwind preflight `img { max-width: 100% }` that would clamp it
  // (`inset` can't size a replaced <img>).
  const layerStyle = {
    filter: `blur(${blurPx}px)`,
    top: `-${bleedMargin}px`,
    left: `-${bleedMargin}px`,
    width: `calc(100% + ${bleedMargin * 2}px)`,
    height: `calc(100% + ${bleedMargin * 2}px)`,
  };

  // The outgoing frame, held fully opaque *underneath* the cross-fading buffers.
  // Opacity cross-fades alone only cover ~75% at the midpoint, so without this the
  // app background bleeds through the whole frame (a wash) during every transition.
  // Backing the fade with the previous image keeps the blend image→image.
  const backplate = buffers[1 - front] ?? buffers[front];

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
      aria-hidden="true"
    >
      {backplate ? (
        <img
          src={backplate}
          alt=""
          style={layerStyle}
          className="absolute max-w-none object-cover"
        />
      ) : null}
      {([0, 1] as const).map((i) =>
        buffers[i] ? (
          <img
            key={i}
            src={buffers[i] as string}
            alt=""
            style={{ ...layerStyle, opacity: front === i ? 1 : 0 }}
            className="absolute max-w-none object-cover transition-opacity duration-1000"
          />
        ) : null,
      )}
      {/* Dim for legibility (ambient backdrop, not the focus) — opacity is configurable. */}
      <div className="absolute inset-0 bg-background" style={{ opacity: maskOpacity }} />
    </div>
  );
}
