import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PersistentStorageSettings } from "@/components/settings/persistent-storage-settings";
import { PlaylistImportDialog } from "@/components/stream/playlist-import-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveSettings } from "@/db/repositories";
import type { StreamSourceId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { hasStreamingSources, resolveDesktopBridge } from "@/lib/desktop/bridge";
import {
  clearPlaybackCache,
  PLAYBACK_CACHE_GB_OPTIONS,
  playbackCacheLimitBytes,
  summarizePlaybackCache,
} from "@/player/playback-cache";
import { notify } from "@/stores/notification-store";
import {
  cookieStringHasAuth,
  STREAM_LOGIN_CONFIGS,
  streamSourcesAfterLogin,
  streamSourcesAfterLogout,
} from "@/streamsrc/login";
import type { StreamPlaylist } from "@/streamsrc/provider";
import { createStreamSource } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
import {
  clearStreamedCache,
  clearStreamedCacheForSource,
  type StreamCacheSummary,
  summarizeStreamedCache,
} from "@/streamsrc/streamed-track-repo";

const EMPTY_CACHE = { count: 0, bytes: 0, sources: [] } satisfies StreamCacheSummary;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Implemented sources + their quality options (brand names are not i18n'd). */
const SOURCES: { id: StreamSourceId; label: string; qualities: string[] }[] = [
  { id: "netease", label: "网易云", qualities: ["standard", "exhigh", "lossless", "hires"] },
  { id: "bili", label: "Bilibili", qualities: ["low", "medium", "high", "lossless"] },
];

const SOURCE_LABELS: Record<StreamSourceId, string> = {
  netease: "网易云",
  bili: "Bilibili",
  youtube: "YouTube",
};

/**
 * Per-source login (cookie capture) + quality for the external streaming sources.
 * Desktop-only (needs the privileged auth window); off by default. Logging in unlocks
 * VIP / higher quality. Cookies stay on-device (BYOK) — see `src/streamsrc/login.ts`.
 */
export function StreamSourcesSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const [busy, setBusy] = useState<StreamSourceId | null>(null);

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

  async function login(source: StreamSourceId) {
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
      }
    } finally {
      setBusy(null);
    }
  }

  async function logout(source: StreamSourceId) {
    await saveSettings({ streamSources: streamSourcesAfterLogout(settings.streamSources, source) });
  }

  async function setQuality(source: StreamSourceId, quality: string) {
    const current = settings.streamSources ?? {};
    await saveSettings({
      streamSources: { ...current, [source]: { ...current[source], quality } },
    });
  }

  return (
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
                  <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
                    {t("streamSources.quality")}
                    <select
                      value={quality}
                      onChange={(e) => void setQuality(id, e.target.value)}
                      className="rounded-md border border-border bg-transparent px-1.5 py-1 text-foreground text-xs"
                    >
                      {qualities.map((q) => (
                        <option key={q} value={q}>
                          {q}
                        </option>
                      ))}
                    </select>
                  </label>
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
                      onClick={() => void login(id)}
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
        <StreamCacheControls />
        <PersistentStorageSettings />
      </CardContent>
    </Card>
  );
}

/**
 * Offline cache controls (Phase 5): auto-download toggle + on-device usage + a clear
 * button. Cached streamed songs play locally (offline) via the player's blob branch.
 */
function StreamCacheControls() {
  const { t } = useTranslation();
  const settings = useSettings();
  const summary = useLiveQuery(() => summarizeStreamedCache(), [], EMPTY_CACHE);
  const playbackSummary = useLiveQuery(() => summarizePlaybackCache(), [], EMPTY_CACHE);
  const [clearing, setClearing] = useState<StreamSourceId | "all" | "playback" | null>(null);
  const playbackCacheGb = Math.round(playbackCacheLimitBytes(settings) / 1024 ** 3);

  async function toggleAuto(on: boolean) {
    await saveSettings({ autoCacheStreamed: on });
  }

  async function clear(sourceId?: StreamSourceId) {
    setClearing(sourceId ?? "all");
    try {
      if (sourceId) {
        await clearStreamedCacheForSource(sourceId);
      } else {
        await clearStreamedCache();
      }
      notify.success(t("streamCache.cleared"));
    } finally {
      setClearing(null);
    }
  }

  async function setPlaybackCacheSize(gb: string) {
    await saveSettings({
      playbackCacheMaxBytes: Number(gb) * 1024 ** 3,
    });
  }

  async function clearPlayback() {
    setClearing("playback");
    try {
      await clearPlaybackCache();
      notify.success(t("streamCache.playbackCleared"));
    } finally {
      setClearing(null);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <span className="font-medium text-sm">{t("streamCache.title")}</span>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={!!settings.autoCacheStreamed}
          onChange={(e) => void toggleAuto(e.currentTarget.checked)}
          className="mt-1 size-4 accent-primary"
        />
        <span className="flex flex-col gap-1">
          <span className="text-sm">{t("streamCache.autoToggle")}</span>
          <span className="text-muted-foreground text-xs">{t("streamCache.autoToggleHint")}</span>
        </span>
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">
          {summary.count > 0
            ? t("streamCache.usage", { count: summary.count, size: formatBytes(summary.bytes) })
            : t("streamCache.empty")}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!!clearing || summary.count === 0}
          onClick={() => void clear()}
        >
          {t("streamCache.clear")}
        </Button>
      </div>
      {summary.sources.length > 0 && (
        <div className="space-y-2">
          {summary.sources.map((source) => (
            <div
              key={source.sourceId}
              className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2"
            >
              <span className="text-xs">
                <span className="font-medium text-foreground">
                  {SOURCE_LABELS[source.sourceId]}
                </span>
                <span className="ml-2 text-muted-foreground">
                  {t("streamCache.usage", {
                    count: source.count,
                    size: formatBytes(source.bytes),
                  })}
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!!clearing}
                onClick={() => void clear(source.sourceId)}
              >
                {t("streamCache.clear")}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-3 rounded-md bg-muted/35 p-3">
        <div className="space-y-1">
          <span className="font-medium text-sm">{t("streamCache.playbackTitle")}</span>
          <p className="text-muted-foreground text-xs">{t("streamCache.playbackHint")}</p>
        </div>
        <label className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">{t("streamCache.playbackSize")}</span>
          <select
            aria-label={t("streamCache.playbackSize")}
            className="rounded-md border border-border bg-transparent px-2 py-1 text-foreground text-xs"
            value={String(playbackCacheGb)}
            onChange={(event) => void setPlaybackCacheSize(event.currentTarget.value)}
          >
            {PLAYBACK_CACHE_GB_OPTIONS.map((gb) => (
              <option key={gb} value={gb}>
                {t("streamCache.playbackSizeOption", { gb })}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {playbackSummary.count > 0
              ? t("streamCache.playbackUsage", {
                  count: playbackSummary.count,
                  size: formatBytes(playbackSummary.bytes),
                })
              : t("streamCache.playbackEmpty")}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={clearing === "playback" || playbackSummary.count === 0}
            onClick={() => void clearPlayback()}
          >
            {t("streamCache.playbackClear")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The logged-in user's playlists for one source, loaded on demand. Each row opens the
 * {@link PlaylistImportDialog} (new set / incremental re-sync / add to a chosen set);
 * only metadata is persisted, tracks re-resolve on play.
 */
function SourcePlaylists({ sourceId }: { sourceId: StreamSourceId }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const [playlists, setPlaylists] = useState<StreamPlaylist[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [importTarget, setImportTarget] = useState<StreamPlaylist | null>(null);

  async function load() {
    setLoading(true);
    try {
      const source = createStreamSource(sourceId, {
        http: createStreamHttp(),
        now: () => Date.now(),
        getCookie: (sid) => settings.streamSources?.[sid]?.cookie,
      });
      setPlaylists((await source?.getUserPlaylists?.()) ?? []);
    } catch {
      setPlaylists([]);
      notify.error(t("streamSources.playlistsError"));
    } finally {
      setLoading(false);
    }
  }

  const dialog = (
    <PlaylistImportDialog playlist={importTarget} onClose={() => setImportTarget(null)} />
  );

  if (playlists === null) {
    return (
      <>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? t("streamSources.loadingPlaylists") : t("streamSources.syncPlaylists")}
        </Button>
        {dialog}
      </>
    );
  }
  if (playlists.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("streamSources.noPlaylists")}</p>;
  }
  return (
    <>
      <div className="space-y-1 border-border border-t pt-2">
        {playlists.map((pl) => (
          <div key={pl.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{pl.name}</span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {t("streamSources.trackCount", { count: pl.trackCount })}
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setImportTarget(pl)}>
              {t("streamSources.import")}
            </Button>
          </div>
        ))}
      </div>
      {dialog}
    </>
  );
}
