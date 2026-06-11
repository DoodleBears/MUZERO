import { setSessionCover } from "@/db/repositories";
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";

export interface CacheStreamPlaylistCoverInput {
  sessionId: string;
  coverUrl?: string;
}

export interface CacheStreamPlaylistCoverDeps {
  fetcher?: typeof globalThis.fetch;
  storeCover?: typeof setSessionCover;
}

export async function cacheStreamPlaylistCover(
  input: CacheStreamPlaylistCoverInput,
  deps: CacheStreamPlaylistCoverDeps = {},
): Promise<boolean> {
  const coverUrl = input.coverUrl?.trim();
  if (!coverUrl) return false;

  try {
    const fetcher = deps.fetcher ?? (await getAppFetch());
    const response = await fetcher(coverUrl);
    if (!response.ok) return false;

    const blob = await response.blob();
    const mime = response.headers.get("content-type") ?? blob.type;
    if (!mime.startsWith("image/") || blob.size === 0) return false;

    await (deps.storeCover ?? setSessionCover)({
      sessionId: input.sessionId,
      blob,
      mime,
    });
    return true;
  } catch (error) {
    log.warn("stream", "playlist cover cache failed", { sessionId: input.sessionId, error });
    return false;
  }
}
