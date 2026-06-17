import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { saveSettings } from "@/db/repositories";
import type { StreamSourceId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import {
  clearPlaybackCache,
  PLAYBACK_CACHE_GB_OPTIONS,
  playbackCacheLimitBytes,
  summarizePlaybackCache,
} from "@/player/playback-cache";
import { useNavStore } from "@/stores/nav-store";
import { notify } from "@/stores/notification-store";
import {
  clearStreamedCache,
  clearStreamedCacheForSource,
  type StreamCacheSummary,
  summarizeStreamedCache,
} from "@/streamsrc/streamed-track-repo";

const EMPTY_CACHE = { count: 0, bytes: 0, sources: [] } satisfies StreamCacheSummary;

const SOURCE_LABELS: Record<StreamSourceId, string> = {
  netease: "网易云",
  bili: "Bilibili",
  youtube: "YouTube",
  qq: "QQ 音乐",
};

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

/**
 * Offline cache controls: auto-download toggle + on-device usage + clear buttons.
 * Rendered from Storage and Online sources so cache management has one implementation.
 */
export function StreamCacheControls() {
  const { t } = useTranslation();
  const settings = useSettings();
  // These observe the media cache, which the playback warmup WRITES during playback /
  // song switches — so a hidden Settings tab re-rendered every cache write (PRD
  // reactivity-render-observability F3). Gate on the settings tab being active: while
  // hidden, return a stable empty + don't observe the cache. Re-reads on tab enter.
  const settingsActive = useNavStore((s) => s.tab === "settings");
  const summary = useLiveQuery(
    () => (settingsActive ? summarizeStreamedCache() : Promise.resolve(EMPTY_CACHE)),
    [settingsActive],
    EMPTY_CACHE,
  );
  const playbackSummary = useLiveQuery(
    () => (settingsActive ? summarizePlaybackCache() : Promise.resolve(EMPTY_CACHE)),
    [settingsActive],
    EMPTY_CACHE,
  );
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
