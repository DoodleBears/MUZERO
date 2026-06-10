import { useTranslation } from "react-i18next";
import { LyricsTuningControls } from "@/components/player/lyrics-tuning-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Settings-page wrapper for the shared synced-lyrics appearance controls (also
 * shown in the Now-Playing floating lyrics panel via {@link LyricsTuningControls}).
 */
export function LyricsSettings() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("lyricsSettings.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <LyricsTuningControls />
      </CardContent>
    </Card>
  );
}
