import { useEffect, useState } from "react";
import { notePerfWork } from "@/lib/perf-counters";

export type LoadedImageStatus = "idle" | "loading" | "loaded" | "error";

export interface LoadedImageResult {
  aspect: number | null;
  displayUrl: string | null;
  status: LoadedImageStatus;
  targetUrl: string | null;
}

interface CachedImage {
  aspect: number | null;
  decoded: boolean;
}

const loadedImages = new Map<string, CachedImage>();
const imageLoads = new Map<string, Promise<CachedImage>>();

export function resetLoadedImageCacheForTests(): void {
  loadedImages.clear();
  imageLoads.clear();
}

/**
 * Load/decode an image URL before it is treated as displayable. Local covers can
 * keep the previous image during the short object-URL/crop window; remote covers
 * should usually clear to fallback while loading so a slow/broken network image
 * never masquerades as the previous track's cover.
 */
export function useLoadedImageUrl(
  url: string | null | undefined,
  options: {
    decode?: boolean;
    holdPreviousWhileLoading?: boolean;
    referrerPolicy?: ReferrerPolicy;
    trace?: {
      source?: string;
      surface?: string;
      trackId?: string;
    };
  } = {},
): LoadedImageResult {
  const decode = options.decode ?? true;
  const holdPreviousWhileLoading = options.holdPreviousWhileLoading ?? true;
  const referrerPolicy = options.referrerPolicy ?? "no-referrer";
  const traceSource = options.trace?.source;
  const traceSurface = options.trace?.surface;
  const traceTrackId = options.trace?.trackId;
  const targetUrl = url ?? null;
  const [state, setState] = useState<LoadedImageResult>(() => {
    if (!targetUrl) return emptyResult(null);
    const cached = getCachedImage(targetUrl, decode);
    return cached
      ? { aspect: cached.aspect, displayUrl: targetUrl, status: "loaded", targetUrl }
      : { aspect: null, displayUrl: null, status: "loading", targetUrl };
  });

  useEffect(() => {
    if (!targetUrl) {
      setState(emptyResult(null));
      return;
    }

    const cached = getCachedImage(targetUrl, decode);
    if (cached) {
      setState({ aspect: cached.aspect, displayUrl: targetUrl, status: "loaded", targetUrl });
      return;
    }

    let alive = true;
    setState((current) => ({
      aspect: holdPreviousWhileLoading ? current.aspect : null,
      displayUrl: holdPreviousWhileLoading ? current.displayUrl : null,
      status: "loading",
      targetUrl,
    }));

    void loadImage(targetUrl, {
      decode,
      referrerPolicy,
      trace: {
        source: traceSource,
        surface: traceSurface,
        trackId: traceTrackId,
      },
    }).then(
      (loaded) => {
        if (!alive) return;
        setState({
          aspect: loaded.aspect,
          displayUrl: targetUrl,
          status: "loaded",
          targetUrl,
        });
      },
      () => {
        if (!alive) return;
        setState({ aspect: null, displayUrl: null, status: "error", targetUrl });
      },
    );

    return () => {
      alive = false;
    };
  }, [
    decode,
    holdPreviousWhileLoading,
    referrerPolicy,
    targetUrl,
    traceSource,
    traceSurface,
    traceTrackId,
  ]);

  if (!targetUrl) return emptyResult(null);
  const cachedForTarget = getCachedImage(targetUrl, decode);
  if (cachedForTarget && state.targetUrl !== targetUrl) {
    return {
      aspect: cachedForTarget.aspect,
      displayUrl: targetUrl,
      status: "loaded",
      targetUrl,
    };
  }
  if (state.targetUrl !== targetUrl && !holdPreviousWhileLoading) return emptyResult(targetUrl);
  return state;
}

function emptyResult(targetUrl: string | null): LoadedImageResult {
  return { aspect: null, displayUrl: null, status: targetUrl ? "loading" : "idle", targetUrl };
}

function getCachedImage(url: string, decode: boolean): CachedImage | undefined {
  const cached = loadedImages.get(url);
  if (!cached) return undefined;
  return decode && !cached.decoded ? undefined : cached;
}

function imageLoadKey(url: string, decode: boolean): string {
  return `${decode ? "decode" : "load"}:${url}`;
}

function classifyImageUrl(url: string): "blob" | "data" | "http" | "muzfetch" | "other" {
  if (/^blob:/i.test(url)) return "blob";
  if (/^data:/i.test(url)) return "data";
  if (/^https?:/i.test(url)) return "http";
  if (/^muzfetch:/i.test(url)) return "muzfetch";
  return "other";
}

function loadImage(
  url: string,
  options: {
    decode: boolean;
    referrerPolicy: ReferrerPolicy;
    trace?: {
      source?: string;
      surface?: string;
      trackId?: string;
    };
  },
): Promise<CachedImage> {
  const cached = getCachedImage(url, options.decode);
  if (cached) return Promise.resolve(cached);
  const key = imageLoadKey(url, options.decode);
  const inFlight = imageLoads.get(key);
  if (inFlight) return inFlight;

  if (typeof Image === "undefined") {
    const loaded = { aspect: null, decoded: options.decode };
    loadedImages.set(url, loaded);
    return Promise.resolve(loaded);
  }

  const promise = new Promise<CachedImage>((resolve, reject) => {
    const startedAt = performance.now();
    const image = new Image();
    image.decoding = "async";
    image.referrerPolicy = options.referrerPolicy;
    image.onload = () => {
      const loaded = {
        aspect:
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? image.naturalWidth / image.naturalHeight
            : null,
        decoded: options.decode,
      };
      const traceContext = {
        decode: options.decode,
        height: image.naturalHeight,
        source: options.trace?.source,
        sourceKind: classifyImageUrl(url),
        surface: options.trace?.surface,
        trackId: options.trace?.trackId,
        width: image.naturalWidth,
      };
      notePerfWork("image.load", performance.now() - startedAt, traceContext);
      const done = () => resolve(loaded);
      if (!options.decode) {
        done();
        return;
      }
      const decodeStartedAt = performance.now();
      const decode = image.decode?.();
      if (decode) {
        void decode.then(
          () => {
            notePerfWork("image.decode", performance.now() - decodeStartedAt, traceContext);
            done();
          },
          () => {
            notePerfWork("image.decode", performance.now() - decodeStartedAt, {
              ...traceContext,
              phase: "fail",
            });
            done();
          },
        );
      } else done();
    };
    image.onerror = () => reject(new Error("image load failed"));
    image.src = url;
  })
    .then((loaded) => {
      loadedImages.set(url, loaded);
      return loaded;
    })
    .finally(() => {
      imageLoads.delete(key);
    });

  imageLoads.set(key, promise);
  return promise;
}
