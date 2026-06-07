import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { db } from "@/db/muzero-db";
import { useSettings } from "@/hooks/use-app-data";
import { extractDominantImageColor } from "@/lib/image-palette";
import { type Rgb, readPrimaryRgb } from "@/lib/visualizer-color";
import { usePlayerStore } from "@/stores/player-store";
import {
  transitionVisualizerCoverColor,
  useVisualizerCoverColorStore,
} from "@/stores/visualizer-color-store";

const colorCache = new Map<string, Rgb | null>();

/**
 * Scoped dynamic visualizer accent. The color is stored outside the component so
 * tab changes do not flash back to the theme primary before the cover re-loads.
 */
export function useVisualizerCoverColorCss(active = true): string | null {
  const settings = useSettings();
  const coverColorEnabled = settings.visualizerUseCoverColor ?? true;
  const primaryColorVersion = `${settings.theme ?? ""}:${settings.primaryLight ?? ""}:${settings.primaryDark ?? ""}`;
  const enabled = active && coverColorEnabled;
  const css = useVisualizerCoverColorStore((s) => s.css);
  const current = usePlayerStore(
    useShallow((s) => {
      const track = s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined;
      return track ? { id: track.id, coverBlobId: track.coverBlobId } : null;
    }),
  );
  const cover = useLiveQuery(
    async () =>
      enabled && current?.coverBlobId
        ? ((await db.mediaBlobs.get(current.coverBlobId)) ?? null)
        : null,
    [enabled, current?.coverBlobId],
    undefined,
  );

  useEffect(() => {
    if (!active) return;
    if (!coverColorEnabled || !current?.coverBlobId) {
      void primaryColorVersion;
      transitionVisualizerCoverColor("theme-primary", readPrimaryRgb());
      return;
    }
    if (cover === undefined) return;
    if (!cover?.blob) {
      void primaryColorVersion;
      transitionVisualizerCoverColor("theme-primary", readPrimaryRgb());
      return;
    }

    let alive = true;
    const cacheKey = cover.id;
    const cached = colorCache.get(cacheKey);
    if (cached !== undefined) {
      transitionVisualizerCoverColor(cacheKey, cached);
      return;
    }

    void extractDominantImageColor(cover.blob).then((rgb) => {
      if (!alive) return;
      colorCache.set(cacheKey, rgb);
      void primaryColorVersion;
      transitionVisualizerCoverColor(cacheKey, rgb ?? readPrimaryRgb());
    });

    return () => {
      alive = false;
    };
  }, [active, coverColorEnabled, current?.coverBlobId, cover, primaryColorVersion]);

  return active ? css : null;
}
