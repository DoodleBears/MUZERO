/**
 * Stream-source registry — resolve `StreamSourceProvider`s from on-device settings,
 * the same discipline as the musicgen registry: callers ask for sources by id /
 * "the enabled ones" and never branch on a concrete source. Adding a source = add
 * its `create*Source` case here + a `StreamSourceId` union member; nothing else in
 * the app learns a new `if`.
 *
 * Providers take an injected HTTP client + a per-source cookie getter, so the
 * registry stays free of any bridge/Electron dependency (those are wired in by the
 * caller that builds `StreamSourceDeps`).
 */

import type { AppSettings, StreamSourceId } from "@/db/types";
import { createBiliSource } from "./bili/bili-source";
import type { StreamHttp } from "./http";
import { createNeteaseSource } from "./netease/netease-source";
import type { StreamSourceProvider } from "./provider";
import { createQqSource } from "./qq/qq-source";
import { createYoutubeSource } from "./youtube/youtube-source";
import { createYtjsRuntime } from "./youtube/youtube-ytjs";

/** Codename-stable order (CLAUDE.md rule 4). */
export const STREAM_SOURCE_IDS: StreamSourceId[] = ["netease", "bili", "youtube", "qq"];

export interface StreamSourceDeps {
  http: StreamHttp;
  now: () => number;
  /** Per-source cookie/session string from settings (decrypted on-device). */
  getCookie: (id: StreamSourceId) => string | undefined;
}

/** Build one source provider. */
export function createStreamSource(
  id: StreamSourceId,
  deps: StreamSourceDeps,
): StreamSourceProvider | null {
  switch (id) {
    case "bili":
      return createBiliSource({
        http: deps.http,
        now: deps.now,
        getCookie: () => deps.getCookie("bili"),
      });
    case "netease":
      return createNeteaseSource({ http: deps.http, getCookie: () => deps.getCookie("netease") });
    case "qq":
      return createQqSource({ http: deps.http, getCookie: () => deps.getCookie("qq") });
    case "youtube":
      // Search + resolve both need the muzfetch proxy for youtube.com (Electron).
      // Resolve delegates sig/n deciphering to youtubei.js (its browser eval runs
      // player.js's own functions); the InnerTube request + format pick stay ours.
      return createYoutubeSource({
        http: deps.http,
        now: deps.now,
        getCookie: () => deps.getCookie("youtube"),
        runtime: createYtjsRuntime(),
      });
  }
}

/** The providers the user has enabled in settings (and that are implemented). */
export function resolveEnabledStreamSources(
  settings: Pick<AppSettings, "streamSources">,
  deps: StreamSourceDeps,
): StreamSourceProvider[] {
  const out: StreamSourceProvider[] = [];
  for (const id of STREAM_SOURCE_IDS) {
    if (!settings.streamSources?.[id]?.enabled) continue;
    const provider = createStreamSource(id, deps);
    if (provider) out.push(provider);
  }
  return out;
}
