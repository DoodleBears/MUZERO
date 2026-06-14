import { useEffect, useState } from "react";

export type LoadedImageStatus = "idle" | "loading" | "loaded" | "error";

export interface LoadedImageResult {
  aspect: number | null;
  displayUrl: string | null;
  status: LoadedImageStatus;
  targetUrl: string | null;
}

interface CachedImage {
  aspect: number | null;
}

const loadedImages = new Map<string, CachedImage>();
const imageLoads = new Map<string, Promise<CachedImage>>();

/**
 * Load/decode an image URL before it is treated as displayable. Local covers can
 * keep the previous image during the short object-URL/crop window; remote covers
 * should usually clear to fallback while loading so a slow/broken network image
 * never masquerades as the previous track's cover.
 */
export function useLoadedImageUrl(
  url: string | null | undefined,
  options: {
    holdPreviousWhileLoading?: boolean;
    referrerPolicy?: ReferrerPolicy;
  } = {},
): LoadedImageResult {
  const holdPreviousWhileLoading = options.holdPreviousWhileLoading ?? true;
  const referrerPolicy = options.referrerPolicy ?? "no-referrer";
  const targetUrl = url ?? null;
  const [state, setState] = useState<LoadedImageResult>(() => {
    if (!targetUrl) return emptyResult(null);
    const cached = loadedImages.get(targetUrl);
    return cached
      ? { aspect: cached.aspect, displayUrl: targetUrl, status: "loaded", targetUrl }
      : { aspect: null, displayUrl: null, status: "loading", targetUrl };
  });

  useEffect(() => {
    if (!targetUrl) {
      setState(emptyResult(null));
      return;
    }

    const cached = loadedImages.get(targetUrl);
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

    void loadImage(targetUrl, referrerPolicy).then(
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
  }, [holdPreviousWhileLoading, referrerPolicy, targetUrl]);

  if (!targetUrl) return emptyResult(null);
  const cachedForTarget = loadedImages.get(targetUrl);
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

function loadImage(url: string, referrerPolicy: ReferrerPolicy): Promise<CachedImage> {
  const cached = loadedImages.get(url);
  if (cached) return Promise.resolve(cached);
  const inFlight = imageLoads.get(url);
  if (inFlight) return inFlight;

  if (typeof Image === "undefined") {
    const loaded = { aspect: null };
    loadedImages.set(url, loaded);
    return Promise.resolve(loaded);
  }

  const promise = new Promise<CachedImage>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.referrerPolicy = referrerPolicy;
    image.onload = () => {
      const loaded = {
        aspect:
          image.naturalWidth > 0 && image.naturalHeight > 0
            ? image.naturalWidth / image.naturalHeight
            : null,
      };
      const done = () => resolve(loaded);
      const decode = image.decode?.();
      if (decode) void decode.then(done, done);
      else done();
    };
    image.onerror = () => reject(new Error("image load failed"));
    image.src = url;
  })
    .then((loaded) => {
      loadedImages.set(url, loaded);
      return loaded;
    })
    .finally(() => {
      imageLoads.delete(url);
    });

  imageLoads.set(url, promise);
  return promise;
}
