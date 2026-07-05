import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadsPanel } from "@/components/downloads/downloads-panel";
import { PlaylistSyncControls } from "@/components/downloads/playlist-sync-controls";
import { PlaylistSyncPanel } from "@/components/downloads/playlist-sync-panel";
import { StreamCacheControls } from "@/components/settings/stream-cache-controls";
import { PlaylistImportDialog } from "@/components/stream/playlist-import-dialog";
import { QrLoginDialog } from "@/components/stream/qr-login-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import type { DjSession, StreamSourceId } from "@/db/types";
import { useSessions, useSettings } from "@/hooks/use-app-data";
import { useOnlinePlaylistCatalog } from "@/hooks/use-online-playlist-catalog";
import { hasStreamingSources, resolveDesktopBridge } from "@/lib/desktop/bridge";
import { useNavStore } from "@/stores/nav-store";
import { DEFAULT_VIDEO_QUALITY } from "@/streamsrc/download-action";
import {
  cookieStringHasAuth,
  STREAM_LOGIN_CONFIGS,
  streamSourcesAfterLogin,
  streamSourcesAfterLogout,
} from "@/streamsrc/login";
import {
  clearOnlinePlaylistCatalogSource,
  filterOnlinePlaylists,
} from "@/streamsrc/playlist-catalog";
import type { StreamPlaylist } from "@/streamsrc/provider";

/** Implemented sources + their quality options (brand names are not i18n'd). */
const SOURCES: { id: StreamSourceId; label: string; qualities: string[] }[] = [
  { id: "netease", label: "网易云", qualities: ["standard", "exhigh", "lossless", "hires"] },
  { id: "bili", label: "Bilibili", qualities: ["low", "medium", "high", "lossless"] },
  // QQ caps at plaintext tiers — no lossless-beyond / encrypted .mflac/.mgg (PRD red line).
  { id: "qq", label: "QQ 音乐", qualities: ["flac", "320", "m4a", "128"] },
];

/** Default video-download resolution (prefer-match-else-downgrade per source). */
const VIDEO_QUALITY_OPTIONS: { value: string; label: string }[] = [
  { value: "max", label: "Auto" },
  { value: "2160", label: "2160P" },
  { value: "1440", label: "1440P" },
  { value: "1080", label: "1080P" },
  { value: "720", label: "720P" },
  { value: "480", label: "480P" },
  { value: "360", label: "360P" },
];

/**
 * Per-source login (cookie capture) + quality for the external streaming sources.
 * Desktop-only (needs the privileged auth window); off by default. Logging in unlocks
 * VIP / higher quality. Cookies stay on-device (BYOK) — see `src/streamsrc/login.ts`.
 */
export function StreamSourcesSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const [busy, setBusy] = useState<StreamSourceId | null>(null);
  const [qrSource, setQrSource] = useState<StreamSourceId | null>(null);

  const onQrSuccess = useCallback(
    async (source: StreamSourceId, cookie: string) => {
      await saveSettings({
        streamSources: streamSourcesAfterLogin(settings.streamSources, source, cookie, Date.now()),
      });
    },
    [settings.streamSources],
  );

  if (!hasStreamingSources()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("streamSources.title")}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {t("streamSources.desktopOnly")}
        </CardContent>
      </Card>
    );
  }

  async function externalLogin(source: StreamSourceId) {
    const config = STREAM_LOGIN_CONFIGS[source];
    const bridge = resolveDesktopBridge();
    if (!config || !bridge.openSourceLogin) return;
    setBusy(source);
    try {
      const cookie = await bridge.openSourceLogin({
        loginUrl: config.loginUrl,
        cookieUrls: config.cookieUrls,
        authCookie: config.authCookie,
      });
      if (cookie) {
        await saveSettings({
          streamSources: streamSourcesAfterLogin(
            settings.streamSources,
            source,
            cookie,
            Date.now(),
          ),
        });
        setQrSource(null);
      }
    } finally {
      setBusy(null);
    }
  }

  async function logout(source: StreamSourceId) {
    await saveSettings({
      streamSources: streamSourcesAfterLogout(settings.streamSources, source),
      onlinePlaylistCatalog: clearOnlinePlaylistCatalogSource(
        settings.onlinePlaylistCatalog,
        source,
      ),
    });
  }

  async function setQuality(source: StreamSourceId, quality: string) {
    const current = settings.streamSources ?? {};
    await saveSettings({
      streamSources: { ...current, [source]: { ...current[source], quality } },
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("streamSources.title")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("streamSources.redline")}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {SOURCES.map(({ id, label, qualities }) => {
            const config = STREAM_LOGIN_CONFIGS[id];
            const loggedIn = cookieStringHasAuth(
              settings.streamSources?.[id]?.cookie,
              config?.authCookie ?? "",
            );
            const quality = settings.streamSources?.[id]?.quality ?? qualities[1] ?? qualities[0];
            return (
              <div key={id} className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{label}</span>
                    <span
                      className={
                        loggedIn ? "text-green-500 text-xs" : "text-muted-foreground text-xs"
                      }
                    >
                      {loggedIn ? t("streamSources.loggedIn") : t("streamSources.notLoggedIn")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                      <span>{t("streamSources.quality")}</span>
                      <Select
                        value={quality}
                        onValueChange={(value) => {
                          if (value) void setQuality(id, value);
                        }}
                      >
                        <SelectTrigger className="h-8 w-auto min-w-20 px-2 text-foreground text-xs">
                          <SelectValue>{(value) => value as string}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {qualities.map((q) => (
                            <SelectItem key={q} value={q}>
                              {q}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {loggedIn ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void logout(id)}
                      >
                        {t("streamSources.logout")}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy === id}
                        onClick={() =>
                          id === "netease" ? setQrSource(id) : void externalLogin(id)
                        }
                      >
                        {busy === id ? t("streamSources.loggingIn") : t("streamSources.login")}
                      </Button>
                    )}
                  </div>
                </div>
                {loggedIn && <SourcePlaylists sourceId={id} />}
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>{t("streamSources.defaultVideoQuality")}</span>
            <Select
              value={settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY}
              onValueChange={(value) => {
                if (value) void saveSettings({ defaultVideoQuality: value });
              }}
            >
              <SelectTrigger className="h-8 w-auto min-w-24 px-2 text-foreground text-xs">
                <SelectValue>
                  {(value) =>
                    VIDEO_QUALITY_OPTIONS.find((o) => o.value === value)?.label ?? (value as string)
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {VIDEO_QUALITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label
            htmlFor="stream-enter-downloads"
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Checkbox
              id="stream-enter-downloads"
              checked={settings.enterDownloadsVideo !== false}
              onCheckedChange={(checked) =>
                void saveSettings({ enterDownloadsVideo: checked === true })
              }
            />
            <span>{t("streamSources.enterDownloads")}</span>
          </label>
          <label
            htmlFor="stream-auto-download-playlist"
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Checkbox
              id="stream-auto-download-playlist"
              checked={settings.autoDownloadPlaylistVideos !== false}
              onCheckedChange={(checked) =>
                void saveSettings({ autoDownloadPlaylistVideos: checked === true })
              }
            />
            <span>{t("streamSources.autoDownloadPlaylist")}</span>
          </label>
          <StreamCacheControls />
          <DownloadsPanel />
          <PlaylistSyncPanel />
        </CardContent>
      </Card>
      {qrSource && STREAM_LOGIN_CONFIGS[qrSource] && (
        <QrLoginDialog
          source={qrSource}
          label={SOURCES.find((s) => s.id === qrSource)?.label ?? qrSource}
          config={STREAM_LOGIN_CONFIGS[qrSource]}
          onClose={() => setQrSource(null)}
          onExternalLogin={() => void externalLogin(qrSource)}
          onSuccess={(cookie) => onQrSuccess(qrSource, cookie)}
        />
      )}
    </>
  );
}

/**
 * The logged-in user's playlists for one source, loaded on demand. Each row opens the
 * shared online detail page; the import shortcut still opens {@link PlaylistImportDialog}.
 * Only metadata is persisted, tracks re-resolve on play.
 */
function SourcePlaylists({ sourceId }: { sourceId: StreamSourceId }) {
  const { t } = useTranslation();
  const sessions = useSessions();
  const openOnlinePlaylist = useNavStore((s) => s.openOnlinePlaylist);
  const [importTarget, setImportTarget] = useState<StreamPlaylist | null>(null);
  const catalog = useOnlinePlaylistCatalog(false);
  const sourceCatalog = catalog.catalog?.[sourceId];
  const playlists = useMemo(
    () => catalog.playlists.filter((playlist) => playlist.source === sourceId),
    [catalog.playlists, sourceId],
  );
  const loading = catalog.syncingSources.has(sourceId);

  const dialog = (
    <PlaylistImportDialog playlist={importTarget} onClose={() => setImportTarget(null)} />
  );

  if (!sourceCatalog) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void catalog.refreshSource(sourceId)}
        >
          {loading ? t("streamSources.loadingPlaylists") : t("streamSources.syncPlaylists")}
        </Button>
        {dialog}
      </>
    );
  }
  if (playlists.length === 0) {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void catalog.refreshSource(sourceId)}
        >
          {loading ? t("streamSources.loadingPlaylists") : t("streamSources.syncPlaylists")}
        </Button>
        <p className="text-muted-foreground text-xs">{t("streamSources.noPlaylists")}</p>
      </div>
    );
  }
  return (
    <>
      <SourcePlaylistList
        playlists={playlists}
        sessions={sessions}
        onOpen={openOnlinePlaylist}
        onImport={setImportTarget}
        onRefresh={() => void catalog.refreshSource(sourceId)}
        loading={loading}
        syncedAt={sourceCatalog.syncedAt}
      />
      {dialog}
    </>
  );
}

export function SourcePlaylistList({
  playlists,
  sessions,
  onOpen,
  onImport,
  onRefresh,
  loading = false,
  syncedAt,
}: {
  playlists: StreamPlaylist[];
  sessions: DjSession[];
  onOpen: (playlist: StreamPlaylist) => void;
  onImport: (playlist: StreamPlaylist) => void;
  onRefresh?: () => void;
  loading?: boolean;
  syncedAt?: number;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => filterOnlinePlaylists(playlists, query), [playlists, query]);

  return (
    <div className="space-y-2 border-border border-t pt-2">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("streamSources.filterPlaylistsPlaceholder")}
          aria-label={t("streamSources.filterPlaylistsPlaceholder")}
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        {onRefresh ? (
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onRefresh}>
            {loading ? t("streamSources.loadingPlaylists") : t("streamSources.refreshPlaylists")}
          </Button>
        ) : null}
      </div>
      {syncedAt ? (
        <p className="text-muted-foreground text-xs">
          {t("streamSources.lastSynced", { time: new Date(syncedAt).toLocaleString() })}
        </p>
      ) : null}
      {visible.length === 0 ? (
        <p className="py-4 text-center text-muted-foreground text-xs">
          {t("streamSources.filterPlaylistsNoMatches")}
        </p>
      ) : (
        <div
          className="thin-transparent-scrollbar max-h-[min(42vh,420px)] space-y-1 overflow-y-auto pr-1"
          data-stream-playlist-scroll
        >
          {visible.map((pl) => {
            const matched = sessions.find(
              (s) => s.streamPlaylistRef?.source === pl.source && s.streamPlaylistRef?.id === pl.id,
            );
            return (
              <div
                key={pl.id}
                className="space-y-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/60"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(pl)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate font-medium">{pl.name}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {t("streamSources.trackCount", { count: pl.trackCount })}
                    </span>
                  </button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onImport(pl)}>
                    {t("streamSources.import")}
                  </Button>
                </div>
                <PlaylistSyncControls
                  source={pl.source}
                  playlistId={pl.id}
                  name={pl.name}
                  coverUrl={pl.coverUrl}
                  matched={matched}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
