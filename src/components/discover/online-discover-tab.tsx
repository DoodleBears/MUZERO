import { AlertCircle, ListMusic, LogIn, Play, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Disc3Icon } from "@/components/ui/disc-3";
import { useSettings } from "@/hooks/use-app-data";
import {
  useNeteaseDailyTracks,
  useNeteaseRecommendedPlaylists,
} from "@/hooks/use-netease-recommend";
import { formatDuration } from "@/lib/utils";
import { useNavStore } from "@/stores/nav-store";
import { cookieStringHasAuth, STREAM_LOGIN_CONFIGS } from "@/streamsrc/login";
import type { StreamPlaylist, StreamSearchHit } from "@/streamsrc/provider";

const NETEASE_AUTH_COOKIE = STREAM_LOGIN_CONFIGS.netease?.authCookie ?? "MUSIC_U";
/** The Settings sidebar item that hosts the netease login (see settings-page.tsx). */
const STREAM_SETTINGS_ITEM = "stream-sources";

/**
 * 发现 (Discover) — the Gallery's 5th tab. Two live, online-only sections fed by
 * react-query (never persisted): the personalized 每日推荐歌曲 (login-gated, with a
 * non-blocking login chip otherwise) and the 推荐歌单 grid (works anonymously). This
 * module owns the browse + loading/error/empty/login states; playback + "save as a
 * set" are wired by the parent via the optional row/card handlers.
 */
export function OnlineDiscoverTab({
  onPlayTrack,
  onPlayAll,
  onReroll,
  onOpenPlaylist,
}: {
  /** Play a single daily-recommended song (Phase 4). */
  onPlayTrack?: (hit: StreamSearchHit) => void;
  /** Play the whole daily list (Phase 4). */
  onPlayAll?: (hits: StreamSearchHit[]) => void;
  /** Reroll the daily list ("换一批", afresh) (Phase 4). */
  onReroll?: () => void;
  /** Open a recommended playlist to save it as a set (Phase 4). */
  onOpenPlaylist?: (playlist: StreamPlaylist) => void;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const loggedIn = cookieStringHasAuth(
    settings.streamSources?.netease?.cookie,
    NETEASE_AUTH_COOKIE,
  );
  const daily = useNeteaseDailyTracks();
  const playlists = useNeteaseRecommendedPlaylists();
  const dailyHits = daily.data ?? [];

  return (
    <div className="flex flex-col gap-8 pb-4">
      <section className="flex flex-col gap-3">
        <SectionHeader title={t("discover.dailyTracks")}>
          {loggedIn && dailyHits.length > 0 && (
            <div className="flex items-center gap-1.5">
              {onPlayAll && (
                <Button size="sm" variant="outline" onClick={() => onPlayAll(dailyHits)}>
                  <Play className="size-4" />
                  {t("discover.playAll")}
                </Button>
              )}
              {onReroll && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onReroll()}
                  disabled={daily.isFetching}
                  title={t("discover.reroll")}
                >
                  <RotateCw className={daily.isFetching ? "size-4 animate-spin" : "size-4"} />
                  {t("discover.reroll")}
                </Button>
              )}
            </div>
          )}
        </SectionHeader>
        {!loggedIn ? (
          <LoginChip />
        ) : daily.isLoading ? (
          <RowSkeletons />
        ) : daily.isError ? (
          <ErrorRetry onRetry={() => void daily.refetch()} />
        ) : dailyHits.length === 0 ? (
          <EmptyHint text={t("discover.dailyEmpty")} />
        ) : (
          <ul className="flex flex-col">
            {dailyHits.map((hit) => (
              <DiscoverTrackRow
                key={`${hit.source}:${hit.externalId}`}
                hit={hit}
                onPlay={onPlayTrack}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeader title={t("discover.recommendedPlaylists")} />
        {playlists.isLoading ? (
          <CardSkeletons />
        ) : playlists.isError ? (
          <ErrorRetry onRetry={() => void playlists.refetch()} />
        ) : (playlists.data?.length ?? 0) === 0 ? (
          <EmptyHint text={t("discover.playlistsEmpty")} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {playlists.data?.map((playlist) => (
              <DiscoverPlaylistCard key={playlist.id} playlist={playlist} onOpen={onOpenPlaylist} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <h2 className="font-semibold text-base">{title}</h2>
      {children}
    </div>
  );
}

/** A non-blocking nudge: anonymous users still get the playlists below; this only
 *  gates the personalized daily songs and routes to the Settings login on click. */
function LoginChip() {
  const { t } = useTranslation();
  const setTab = useNavStore((s) => s.setTab);
  const setSettingsItem = useNavStore((s) => s.setSettingsItem);
  return (
    <button
      type="button"
      onClick={() => {
        setSettingsItem(STREAM_SETTINGS_ITEM);
        setTab("settings");
      }}
      className="flex items-center gap-2.5 self-start rounded-xl border border-border border-dashed px-4 py-3 text-left text-sm transition-colors hover:border-primary hover:bg-accent/50"
    >
      <LogIn className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{t("discover.loginToUnlock")}</span>
    </button>
  );
}

/** One daily-recommended song. Inert until the parent passes `onPlay` (Phase 4). */
function DiscoverTrackRow({
  hit,
  onPlay,
}: {
  hit: StreamSearchHit;
  onPlay?: (hit: StreamSearchHit) => void;
}) {
  const subtitle = [hit.artist, hit.album].filter(Boolean).join(" · ");
  const body = (
    <>
      <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-muted-foreground">
        {hit.coverUrl ? (
          <img
            src={hit.coverUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : (
          <Disc3Icon size={16} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">{hit.title}</div>
        <div className="truncate text-muted-foreground text-xs">{subtitle || hit.source}</div>
      </div>
      {hit.durationSec ? (
        <span className="w-10 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          {formatDuration(hit.durationSec)}
        </span>
      ) : null}
    </>
  );
  if (!onPlay) {
    return <li className="flex items-center gap-3 rounded-xl px-3 py-2">{body}</li>;
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => onPlay(hit)}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent/60"
      >
        {body}
      </button>
    </li>
  );
}

/** One recommended-playlist card. Inert until the parent passes `onOpen` (Phase 4). */
function DiscoverPlaylistCard({
  playlist,
  onOpen,
}: {
  playlist: StreamPlaylist;
  onOpen?: (playlist: StreamPlaylist) => void;
}) {
  const { t } = useTranslation();
  const inner = (
    <>
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-secondary text-muted-foreground">
        {playlist.coverUrl ? (
          <img
            src={playlist.coverUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center">
            <ListMusic className="size-8" />
          </div>
        )}
      </div>
      <div className="mt-1.5 line-clamp-2 font-medium text-sm leading-tight">{playlist.name}</div>
      <div className="text-muted-foreground text-xs">
        {t("streamSources.trackCount", { count: playlist.trackCount })}
      </div>
    </>
  );
  if (!onOpen) {
    return <div className="flex flex-col">{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(playlist)}
      className="flex flex-col rounded-xl text-left transition-transform hover:scale-[1.02]"
    >
      {inner}
    </button>
  );
}

function RowSkeletons() {
  return (
    <ul className="flex flex-col gap-1">
      {Array.from({ length: 6 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static skeleton
        <li key={i} className="flex items-center gap-3 rounded-xl px-3 py-2">
          <div className="size-11 shrink-0 animate-pulse rounded-lg bg-secondary" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="h-3.5 w-2/5 animate-pulse rounded bg-secondary" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-secondary" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function CardSkeletons() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length static skeleton
        <div key={i} className="flex flex-col gap-1.5">
          <div className="aspect-square w-full animate-pulse rounded-xl bg-secondary" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-secondary" />
        </div>
      ))}
    </div>
  );
}

function ErrorRetry({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-border px-4 py-3">
      <span className="flex items-center gap-2 text-muted-foreground text-sm">
        <AlertCircle className="size-4" />
        {t("discover.error")}
      </span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        <RotateCw className="size-4" />
        {t("discover.retry")}
      </Button>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-1 py-6 text-center text-muted-foreground text-sm">{text}</p>;
}
