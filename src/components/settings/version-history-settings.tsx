import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { changelog, localize } from "@/content/changelog";
import type { ChangelogLocale } from "@/content/changelog/types";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { currentOsFamily, platformMatchesOs, useReleaseManifest } from "@/lib/release-manifest";
import type { ReleaseEntry, ReleasePlatform } from "@/lib/release-manifest-schema";
import { RELEASE_PLATFORMS } from "@/lib/release-manifest-schema";

const PLATFORM_LABEL = {
  "mac-arm64": "settings.dlMacArm64",
  "mac-x64": "settings.dlMacX64",
  "win-x64": "settings.dlWinX64",
  "linux-x64-appimage": "settings.dlLinuxAppimage",
  "linux-x64-deb": "settings.dlLinuxDeb",
} as const satisfies Record<ReleasePlatform, string>;

function toLocale(lng: string | undefined): ChangelogLocale {
  if (!lng) return "en";
  if (lng.startsWith("zh")) return "zh";
  if (lng.startsWith("ja")) return "ja";
  if (lng.startsWith("ko")) return "ko";
  return "en";
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function download(url: string): void {
  void resolveDesktopBridge().openExternal(url);
}

function ReleaseRow({
  entry,
  locale,
  os,
}: {
  entry: ReleaseEntry;
  locale: ChangelogLocale;
  os: ReturnType<typeof currentOsFamily>;
}) {
  const { t } = useTranslation();
  const notes = changelog.find((r) => r.version === entry.notesRef || r.version === entry.version);
  const summary = notes ? localize(notes.summary, locale) || localize(notes.title, locale) : "";
  const assets = RELEASE_PLATFORMS.filter((p) => entry.platforms[p]);

  return (
    <div className="border-border border-b py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-sm">v{entry.version}</span>
        <span className="text-muted-foreground text-xs tabular-nums">{entry.date}</span>
      </div>
      {summary ? <p className="mt-1 text-muted-foreground text-sm">{summary}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {assets.map((platform) => {
          const asset = entry.platforms[platform];
          if (!asset) return null;
          const recommended = platformMatchesOs(platform, os);
          return (
            <Button
              key={platform}
              size="sm"
              variant={recommended ? "default" : "outline"}
              onClick={() => download(asset.url)}
              title={asset.sha256}
            >
              <Download className="size-3.5" />
              {t(PLATFORM_LABEL[platform])}
              <span className="text-muted-foreground text-xs">{formatBytes(asset.size)}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function VersionHistorySettings() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const os = currentOsFamily();
  const { data, isLoading, isError, refetch } = useReleaseManifest();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.versionHistoryTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-muted-foreground text-sm">{t("settings.versionHistoryLoading")}</p>
        ) : isError || !data ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">{t("settings.versionHistoryError")}</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              {t("settings.versionHistoryRetry")}
            </Button>
          </div>
        ) : data.releases.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("settings.versionHistoryEmpty")}</p>
        ) : (
          <div className="flex flex-col">
            {data.releases.map((entry) => (
              <ReleaseRow key={entry.version} entry={entry} locale={locale} os={os} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
