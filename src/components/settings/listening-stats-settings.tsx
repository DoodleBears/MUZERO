import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DjSession, PlaybackAggregate, PlaybackEvent, Track } from "@/db/types";
import { formatDuration } from "@/lib/utils";
import {
  type ListeningStatsRange,
  type ListeningStatsSyncSummary,
  summarizeListeningStats,
} from "./listening-stats-summary";

const RANGES: ListeningStatsRange[] = ["7d", "30d", "all"];

export function ListeningStatsSettings({
  tracks,
  sessions,
  aggregates,
  events,
  sync,
  now = Date.now(),
}: {
  tracks: Track[];
  sessions: DjSession[];
  aggregates: PlaybackAggregate[];
  events: PlaybackEvent[];
  sync: ListeningStatsSyncSummary;
  now?: number;
}) {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<ListeningStatsRange>("all");
  const summary = useMemo(
    () => summarizeListeningStats({ tracks, sessions, aggregates, events, sync, range, now }),
    [tracks, sessions, aggregates, events, sync, range, now],
  );
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }),
    [i18n.language],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("settings.navListeningStats")}</CardTitle>
          <div className="inline-flex rounded-md border border-border p-0.5">
            {RANGES.map((id) => (
              <button
                key={id}
                type="button"
                className={`rounded-sm px-2 py-1 text-xs ${
                  range === id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
                onClick={() => setRange(id)}
              >
                {t(`settings.listeningRange_${id}`)}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <StatCard label={t("settings.deviceTotalPlays")} value={summary.playCount} />
          <StatCard
            label={t("settings.deviceListenedTime")}
            value={formatDuration(summary.listenedSec)}
          />
          <StatCard label={t("settings.listeningUniqueTracks")} value={summary.uniqueTrackCount} />
          <StatCard label={t("settings.listeningActiveDays")} value={summary.activeDayCount} />
          <StatCard
            label={t("settings.devicePendingListens")}
            value={`${summary.pendingEventCount} · ${formatDuration(summary.pendingListenedSec)}`}
          />
          <StatCard
            label={t("settings.deviceUploadedSegments")}
            value={summary.uploadedSegmentCount}
          />
        </div>

        <RankedList
          title={t("settings.listeningTopTime")}
          empty={t("settings.listeningEmpty")}
          items={summary.topTracksByTime.map((item) => ({
            id: item.id,
            label: item.label,
            meta: formatDuration(item.listenedSec),
          }))}
        />
        <RankedList
          title={t("settings.listeningTopPlays")}
          empty={t("settings.listeningEmpty")}
          items={summary.topTracksByPlays.map((item) => ({
            id: item.id,
            label: item.label,
            meta: t("settings.listeningPlayCount", { count: item.playCount }),
          }))}
        />
        <RankedList
          title={t("settings.listeningTopSets")}
          empty={t("settings.listeningEmpty")}
          items={summary.topSets.map((item) => ({
            id: item.id,
            label: item.label,
            meta: formatDuration(item.listenedSec),
          }))}
        />
        <RankedList
          title={t("settings.listeningTopTags")}
          empty={t("settings.listeningEmpty")}
          items={summary.topTags.map((item) => ({
            id: item.tag,
            label: `#${item.tag}`,
            meta: formatDuration(item.listenedSec),
          }))}
        />
        <RankedList
          title={t("settings.listeningRecent")}
          empty={t("settings.listeningEmpty")}
          items={summary.recentlyPlayed.map((item) => ({
            id: item.id,
            label: item.label,
            meta: dateFormat.format(item.startedAt),
          }))}
        />
        <p className="text-muted-foreground text-xs">{t("settings.listeningLocalFirstHint")}</p>
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-muted/25 p-3">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium text-sm">{value}</p>
    </div>
  );
}

function RankedList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; label: string; meta: string }>;
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="font-medium text-sm">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-muted-foreground text-xs">{empty}</p>
      ) : (
        <ol className="mt-2 grid gap-2">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate">
                <span className="mr-2 text-muted-foreground tabular-nums">{index + 1}</span>
                {item.label}
              </span>
              <span className="shrink-0 text-muted-foreground">{item.meta}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ListeningStatsLink({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-border bg-muted/25 p-3">
      <p className="font-medium text-sm">{t("settings.navListeningStats")}</p>
      <p className="mt-1 text-muted-foreground text-xs">{t("settings.listeningDeviceLinkHint")}</p>
      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onOpen}>
        {t("settings.listeningOpenStats")}
      </Button>
    </div>
  );
}
