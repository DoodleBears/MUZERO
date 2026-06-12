import { useTranslation } from "react-i18next";
import { LyricsTuningControls } from "@/components/player/lyrics-tuning-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import type { AppSettings } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { LYRICS_PROVIDER_IDS } from "@/lyrics/registry";

const LYRICS_PROVIDER_LABEL_KEY = {
  auto: "settings.lyricsSourceAuto",
  lrclib: "settings.lyricsSourceLrclib",
  netease: "settings.lyricsSourceNetease",
  amll: "settings.lyricsSourceAmll",
} as const satisfies Record<NonNullable<AppSettings["lyricsProviderId"]>, string>;

/**
 * Settings-page wrapper for the shared synced-lyrics appearance controls (also
 * shown in the Now-Playing floating lyrics panel via {@link LyricsTuningControls}).
 */
export function LyricsSettings() {
  const { t } = useTranslation();
  const settings = useSettings();

  async function changeAutoFetchLyrics(enabled: boolean) {
    await saveSettings({ autoFetchLyrics: enabled });
  }

  async function changeLyricsProvider(id: AppSettings["lyricsProviderId"]) {
    await saveSettings({ lyricsProviderId: id });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("lyricsSettings.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={settings.autoFetchLyrics ?? true}
              onChange={(event) => void changeAutoFetchLyrics(event.currentTarget.checked)}
              className="mt-1 size-4 accent-primary"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium text-sm">{t("settings.autoFetchLyrics")}</span>
              <span className="text-muted-foreground text-xs">
                {t("settings.autoFetchLyricsHint")}
              </span>
            </span>
          </label>
          <div className="flex flex-col gap-2">
            <span className="flex flex-col gap-1">
              <span className="font-medium text-sm">{t("settings.lyricsSource")}</span>
              <span className="text-muted-foreground text-xs">
                {t("settings.lyricsSourceHint")}
              </span>
            </span>
            <Select
              value={settings.lyricsProviderId ?? "auto"}
              onValueChange={(value) =>
                void changeLyricsProvider(value as AppSettings["lyricsProviderId"])
              }
            >
              <SelectTrigger>
                <SelectValue>
                  {(value) =>
                    t(
                      LYRICS_PROVIDER_LABEL_KEY[
                        (value ?? "auto") as NonNullable<AppSettings["lyricsProviderId"]>
                      ],
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LYRICS_PROVIDER_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {t(LYRICS_PROVIDER_LABEL_KEY[id])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <LyricsTuningControls />
      </CardContent>
    </Card>
  );
}
