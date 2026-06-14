import { getAppFetch } from "@/lib/platform";

export interface RemoteCoverAsset {
  blob: Blob;
  bytes: number;
  cacheKey: string;
  mime: string;
  url: string;
}

type FetchFn = typeof globalThis.fetch;

const remoteCoverAssets = new Map<string, RemoteCoverAsset>();
const remoteCoverInFlight = new Map<string, Promise<RemoteCoverAsset>>();

export function remoteCoverAssetKey(url: string): string {
  return `remote:${url.trim()}`;
}

export function peekRemoteCoverAsset(url: string): RemoteCoverAsset | undefined {
  return remoteCoverAssets.get(remoteCoverAssetKey(url));
}

export async function getOrFetchRemoteCoverAsset(
  url: string,
  options: { cache?: RequestCache; fetcher?: FetchFn } = {},
): Promise<RemoteCoverAsset> {
  const cleanUrl = url.trim();
  if (!cleanUrl) throw new Error("remote cover URL is empty");

  const cacheKey = remoteCoverAssetKey(cleanUrl);
  const cached = remoteCoverAssets.get(cacheKey);
  if (cached) return cached;

  const inFlight = remoteCoverInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const fetcher = options.fetcher ?? (await getAppFetch());
    const response = await fetcher(cleanUrl, { cache: options.cache ?? "force-cache" });
    if (!response.ok) throw new Error(`remote cover fetch failed: ${response.status}`);

    const rawBlob = await response.blob();
    if (rawBlob.size === 0) throw new Error("remote cover response is empty");

    const mime =
      normalizeImageMime(response.headers.get("content-type")) ??
      normalizeImageMime(rawBlob.type) ??
      inferImageMimeFromUrl(cleanUrl);
    if (!mime) throw new Error("remote cover response is not an image");

    const blob = rawBlob.type === mime ? rawBlob : rawBlob.slice(0, rawBlob.size, mime);
    const asset: RemoteCoverAsset = {
      blob,
      bytes: blob.size,
      cacheKey,
      mime,
      url: cleanUrl,
    };
    remoteCoverAssets.set(cacheKey, asset);
    return asset;
  })().finally(() => {
    if (remoteCoverInFlight.get(cacheKey) === promise) remoteCoverInFlight.delete(cacheKey);
  });

  remoteCoverInFlight.set(cacheKey, promise);
  return promise;
}

export function clearRemoteCoverAssetCacheForTests(): void {
  remoteCoverAssets.clear();
  remoteCoverInFlight.clear();
}

function normalizeImageMime(value: string | null | undefined): string | null {
  const mime = value?.split(";")[0]?.trim().toLowerCase();
  if (!mime?.startsWith("image/")) return null;
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function inferImageMimeFromUrl(rawUrl: string): string | null {
  const pathname = safeUrlPath(rawUrl).toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".avif")) return "image/avif";
  if (pathname.endsWith(".bmp")) return "image/bmp";
  return null;
}

function safeUrlPath(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname;
  } catch {
    return rawUrl.split("?")[0] ?? rawUrl;
  }
}
