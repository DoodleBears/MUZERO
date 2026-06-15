import { AlertCircle, ListMusic, LogIn, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/use-app-data";
import {
  useNeteaseDailyTracks,
  useNeteaseRecommendedPlaylists,
} from "@/hooks/use-netease-recommend";
import { useNavStore } from "@/stores/nav-store";
import { cookieStringHasAuth, STREAM_LOGIN_CONFIGS } from "@/streamsrc/login";
import type { StreamPlaylist } from "@/streamsrc/provider";
import { NETEASE_DAILY_PLAYLIST_ID } from "@/streamsrc/virtual-playlists";

const NETEASE_AUTH_COOKIE = STREAM_LOGIN_CONFIGS.netease?.authCookie ?? "MUSIC_U";
/** The Settings sidebar item that hosts the netease login (see settings-page.tsx). */
const STREAM_SETTINGS_ITEM = "stream-sources";

/**
 * 发现 (Discover) — the Gallery's 5th tab. Live, online-only recommendations fed by
 * react-query (never persisted). The personalized 每日推荐歌曲 is shown as the first
 * fixed card in the 推荐歌单 grid once logged in; anonymous users get a login card in
 * that same slot. Nothing here writes IndexedDB until the user plays or imports.
 */
export function OnlineDiscoverTab({
  onOpenPlaylist,
}: {
  onOpenPlaylist: (playlist: StreamPlaylist) => void;
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
  const recommendedPlaylists = playlists.data ?? [];
  const dailyPlaylist: StreamPlaylist | null = loggedIn
    ? {
        id: NETEASE_DAILY_PLAYLIST_ID,
        name: t("discover.dailyTracks"),
        source: "netease",
        trackCount: dailyHits.length || 30,
        coverUrl: dailyHits.find((hit) => hit.coverUrl)?.coverUrl,
      }
    : null;

  return (
    <div className="flex flex-col gap-8 pb-4">
      <section className="flex flex-col gap-3">
        <SectionHeader title={t("discover.recommendedPlaylists")} />
        {playlists.isLoading ? (
          <CardSkeletons />
        ) : playlists.isError ? (
          <ErrorRetry onRetry={() => void playlists.refetch()} />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {dailyPlaylist ? (
              <DiscoverPlaylistCard
                playlist={dailyPlaylist}
                onOpen={onOpenPlaylist}
                loadingCover={daily.isLoading}
              />
            ) : (
              <LoginCard />
            )}
            {recommendedPlaylists.map((playlist) => (
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

/** A non-blocking nudge in the first fixed slot: anonymous users still get public playlists. */
function LoginCard() {
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
      className="flex aspect-square flex-col items-center justify-center gap-3 rounded-xl border border-border border-dashed px-4 text-center text-sm transition-colors hover:border-primary hover:bg-accent/50"
    >
      <LogIn className="size-6 shrink-0 text-muted-foreground" />
      <span className="text-muted-foreground">{t("discover.loginToUnlock")}</span>
    </button>
  );
}

/** One recommended-playlist card; enters the online playlist detail page. */
function DiscoverPlaylistCard({
  playlist,
  onOpen,
  loadingCover = false,
}: {
  playlist: StreamPlaylist;
  onOpen: (playlist: StreamPlaylist) => void;
  loadingCover?: boolean;
}) {
  const { t } = useTranslation();
  return (
    // Same card affordance as the local 歌单/专辑 gallery cards (SetCard /
    // EntityCard): a rounded `bg-accent/40` hover highlight with `p-2` padding +
    // focus ring — NOT a scale transform — so Discover feels consistent with the
    // library walls.
    <button
      type="button"
      onClick={() => onOpen(playlist)}
      className="flex w-full flex-col gap-2 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-secondary text-muted-foreground">
        {loadingCover ? (
          <div className="size-full animate-pulse bg-secondary" />
        ) : playlist.coverUrl ? (
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
      <span className="min-w-0">
        <span className="block line-clamp-2 font-medium text-sm leading-tight">
          {playlist.name}
        </span>
        <span className="block text-muted-foreground text-xs">
          {t("streamSources.trackCount", { count: playlist.trackCount })}
        </span>
      </span>
    </button>
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
