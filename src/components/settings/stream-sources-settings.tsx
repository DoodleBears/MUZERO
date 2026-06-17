import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { StreamCacheControls } from "@/components/settings/stream-cache-controls";
import { PlaylistImportDialog } from "@/components/stream/playlist-import-dialog";
import { QrLoginDialog } from "@/components/stream/qr-login-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import type { StreamSourceId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { hasStreamingSources, resolveDesktopBridge } from "@/lib/desktop/bridge";
import { useNavStore } from "@/stores/nav-store";
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

/** Implemented sources + their quality options (brand names are not i18n'd). */
const SOURCES: { id: StreamSourceId; label: string; qualities: string[] }[] = [
  { id: "netease", label: "网易云", qualities: ["standard", "exhigh", "lossless", "hires"] },
  { id: "bili", label: "Bilibili", qualities: ["low", "medium", "high", "lossless"] },
  // QQ caps at plaintext tiers — no lossless-beyond / encrypted .mflac/.mgg (PRD red line).
  { id: "qq", label: "QQ 音乐", qualities: ["flac", "320", "m4a", "128"] },
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
    await saveSettings({ streamSources: streamSourcesAfterLogout(settings.streamSources, source) });
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
          <StreamCacheControls />
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
  const settings = useSettings();
  const openOnlinePlaylist = useNavStore((s) => s.openOnlinePlaylist);
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
          <div
            key={pl.id}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/60"
          >
            <button
              type="button"
              onClick={() => openOnlinePlaylist(pl)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate font-medium">{pl.name}</span>
              <span className="block truncate text-muted-foreground text-xs">
                {t("streamSources.trackCount", { count: pl.trackCount })}
              </span>
            </button>
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
