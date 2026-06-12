import { useTranslation } from "react-i18next";
import { VisualizerControls } from "@/components/player/visualizer-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Visualizer preferences share their exact control order with the Now Playing
 * effect panel. Keep this component as the Settings card shell only.
 */
export function VisualizerSettings() {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("visualizer.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <VisualizerControls />
      </CardContent>
    </Card>
  );
}
