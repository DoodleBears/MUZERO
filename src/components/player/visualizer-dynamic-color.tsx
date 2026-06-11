import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveMediaBlob } from "@/db/media-blob-storage";
import { db } from "@/db/muzero-db";
import { useSettings } from "@/hooks/use-app-data";
import { extractImagePalette, extractImagePaletteFromFetchedUrl } from "@/lib/image-palette";
import { getAppFetch } from "@/lib/platform";
import { type Rgb, readPrimaryRgb } from "@/lib/visualizer-color";
import { usePlayerStore } from "@/stores/player-store";
import {
  transitionVisualizerCoverColor,
  useVisualizerCoverColorStore,
} from "@/stores/visualizer-color-store";

const colorCache = new Map<string, { rgb: Rgb | null; palette: Rgb[] }>();

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
      return track
        ? { id: track.id, coverBlobId: track.coverBlobId, remoteCoverUrl: track.remoteCoverUrl }
        : null;
    }),
  );
  const cover = useLiveQuery(
    async () =>
      enabled && current?.coverBlobId
        ? ((await resolveMediaBlob(current.coverBlobId, db)) ?? null)
        : null,
    [enabled, current?.coverBlobId],
    undefined,
  );

  useEffect(() => {
    if (!active) return;
    const remoteCoverUrl = current?.remoteCoverUrl;
    // Feature off, or the track has no cover at all → follow the theme primary.
    if (!coverColorEnabled || (!current?.coverBlobId && !remoteCoverUrl)) {
      void primaryColorVersion;
      transitionVisualizerCoverColor("theme-primary", readPrimaryRgb());
      return;
    }

    // Remote cover: bytes aren't in a local Blob yet, so fetch them through the
    // app fetch path first and then extract from the resulting same-origin Blob.
    // Keep the current color while it resolves — no flash to theme.
    if (!current.coverBlobId && remoteCoverUrl) {
      let alive = true;
      const controller = new AbortController();
      const cacheKey = `remote:${remoteCoverUrl}`;
      const cached = colorCache.get(cacheKey);
      if (cached !== undefined) {
        transitionVisualizerCoverColor(cacheKey, cached.rgb ?? readPrimaryRgb(), cached.palette);
        return;
      }
      void (async () => {
        try {
          const fetcher = await getAppFetch();
          return await extractImagePaletteFromFetchedUrl(remoteCoverUrl, {
            fetcher,
            signal: controller.signal,
          });
        } catch {
          return [];
        }
      })().then((palette) => {
        if (!alive) return;
        const rgb = palette[0] ?? null;
        colorCache.set(cacheKey, { rgb, palette });
        transitionVisualizerCoverColor(cacheKey, rgb ?? readPrimaryRgb(), palette);
      });
      return () => {
        alive = false;
        controller.abort();
      };
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
      transitionVisualizerCoverColor(cacheKey, cached.rgb ?? readPrimaryRgb(), cached.palette);
      return;
    }

    void extractImagePalette(cover.blob).then((palette) => {
      if (!alive) return;
      const rgb = palette[0] ?? null;
      colorCache.set(cacheKey, { rgb, palette });
      void primaryColorVersion;
      transitionVisualizerCoverColor(cacheKey, rgb ?? readPrimaryRgb(), palette);
    });

    return () => {
      alive = false;
    };
  }, [
    active,
    coverColorEnabled,
    current?.coverBlobId,
    current?.remoteCoverUrl,
    cover,
    primaryColorVersion,
  ]);

  return active ? css : null;
}
