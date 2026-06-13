/**
 * React-query reads for the online-discover (Gallery 发现) tab — netease 每日推荐歌曲
 * and 推荐歌单. These are **live, online-only** reads: they go through the existing
 * netease provider and are cached only in react-query's in-memory store. They NEVER
 * write IndexedDB (a track lands in the DB only when the user actively plays it, via
 * the existing `playStreamedHit`). See
 * docs/prd/20260614-muzero-netease-online-recommendations-prd §4.3.
 */

import { useQuery } from "@tanstack/react-query";
import type { StreamSourceId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { cookieStringHasAuth, STREAM_LOGIN_CONFIGS } from "@/streamsrc/login";
import type { StreamPlaylist, StreamSearchHit } from "@/streamsrc/provider";
import { createStreamSource } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";

const NETEASE_AUTH_COOKIE = STREAM_LOGIN_CONFIGS.netease?.authCookie ?? "MUSIC_U";
const HOUR = 1000 * 60 * 60;
// The daily feed rolls over once a day, so an hour-stale window with a long GC keeps
// the tab instant on flip-back without re-hitting netease on every visit.
const RECOMMEND_STALE_TIME = HOUR;
const RECOMMEND_GC_TIME = 6 * HOUR;

function neteaseSource(getCookie: (id: StreamSourceId) => string | undefined) {
  return createStreamSource("netease", {
    http: createStreamHttp(),
    now: () => Date.now(),
    getCookie,
  });
}

/**
 * 每日推荐歌曲 — personalized, so it only runs when logged in (`enabled` gated on the
 * MUSIC_U cookie); the UI shows a non-blocking login chip otherwise. The query key
 * carries an auth/anon fingerprint so login/logout invalidates without crossing
 * states. `afresh` forces a reroll ("换一批"); the same key replaces the cached list.
 */
export function useNeteaseDailyTracks(opts?: { afresh?: boolean }) {
  const settings = useSettings();
  const cookie = settings.streamSources?.netease?.cookie;
  const loggedIn = cookieStringHasAuth(cookie, NETEASE_AUTH_COOKIE);
  const afresh = opts?.afresh ?? false;
  return useQuery<StreamSearchHit[]>({
    queryKey: ["netease", "daily-tracks", loggedIn ? "auth" : "anon"],
    queryFn: ({ signal }) =>
      neteaseSource((id) => settings.streamSources?.[id]?.cookie)?.getDailyRecommendedTracks?.({
        signal,
        afresh,
      }) ?? Promise.resolve<StreamSearchHit[]>([]),
    enabled: loggedIn,
    staleTime: RECOMMEND_STALE_TIME,
    gcTime: RECOMMEND_GC_TIME,
    retry: 1,
  });
}

/**
 * 推荐歌单 — works anonymously (personalized/playlist base), and the provider merges
 * the logged-in 每日推荐歌单 ahead when authed. Always enabled; the auth/anon key
 * fingerprint refetches the richer logged-in variant after login.
 */
export function useNeteaseRecommendedPlaylists() {
  const settings = useSettings();
  const cookie = settings.streamSources?.netease?.cookie;
  const loggedIn = cookieStringHasAuth(cookie, NETEASE_AUTH_COOKIE);
  return useQuery<StreamPlaylist[]>({
    queryKey: ["netease", "recommended-playlists", loggedIn ? "auth" : "anon"],
    queryFn: ({ signal }) =>
      neteaseSource((id) => settings.streamSources?.[id]?.cookie)?.getRecommendedPlaylists?.({
        signal,
      }) ?? Promise.resolve<StreamPlaylist[]>([]),
    enabled: true,
    staleTime: RECOMMEND_STALE_TIME,
    gcTime: RECOMMEND_GC_TIME,
    retry: 1,
  });
}
