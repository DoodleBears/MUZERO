import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveMediaBlob } from "@/db/media-blob-storage";
import { db } from "@/db/muzero-db";
import { useSettings } from "@/hooks/use-app-data";
import { sanitizeUrlForTrace } from "@/lib/diagnostics";
import { extractImagePalette, extractImagePaletteFromFetchedUrl } from "@/lib/image-palette";
import { createDiagnosticLogger } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import { describeTrackCoverSource } from "@/lib/track-source";
import { type Rgb, readPrimaryRgb } from "@/lib/visualizer-color";
import { usePlayerStore } from "@/stores/player-store";
import {
  transitionVisualizerCoverColor,
  useVisualizerCoverColorStore,
} from "@/stores/visualizer-color-store";

const colorCache = new Map<string, { rgb: Rgb | null; palette: Rgb[] }>();
const coverColorLog = createDiagnosticLogger("cover.palette");

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
        ? {
            id: track.id,
            cloudSource: track.cloudSource,
            coverBlobId: track.coverBlobId,
            remoteCoverUrl: track.remoteCoverUrl,
          }
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
      coverColorLog.debug("cover.palette.fallback", {
        message: "cover color fallback to theme primary",
        trackId: current?.id,
        category: "media",
        phase: "skip",
        reason: coverColorEnabled ? "no-cover" : "disabled",
      });
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
      const coverSource = describeTrackCoverSource({
        cloudSource: current.cloudSource,
        remoteCoverUrl,
      });
      const safeUrl = sanitizeUrlForTrace(remoteCoverUrl);
      if (cached !== undefined) {
        coverColorLog.debug("cover.palette.cache", {
          message: "cover palette cache hit",
          trackId: current.id,
          category: "media",
          phase: "state",
          coverSourceKind: coverSource.kind,
          coverSourceHost: coverSource.host || safeUrl.host || undefined,
          paletteCount: cached.palette.length,
        });
        transitionVisualizerCoverColor(cacheKey, cached.rgb ?? readPrimaryRgb(), cached.palette);
        return;
      }
      void (async () => {
        try {
          coverColorLog.debug("cover.palette.start", {
            message: "remote cover palette extraction started",
            trackId: current.id,
            category: "media",
            phase: "start",
            coverSourceKind: coverSource.kind,
            coverSourceHost: coverSource.host || safeUrl.host || undefined,
            requestHost: safeUrl.host ?? undefined,
            requestPathHash: safeUrl.pathHash,
            safeQuery: safeUrl.safeQuery,
            redactions: safeUrl.redactions,
          });
          const fetcher = await getAppFetch();
          return await extractImagePaletteFromFetchedUrl(remoteCoverUrl, {
            fetcher,
            signal: controller.signal,
          });
        } catch (error) {
          coverColorLog.warn("cover.palette.failed", {
            message: "remote cover palette extraction failed",
            trackId: current.id,
            category: "media",
            phase: "fail",
            coverSourceKind: coverSource.kind,
            coverSourceHost: coverSource.host || safeUrl.host || undefined,
            error,
          });
          return [];
        }
      })().then((palette) => {
        if (!alive) return;
        const rgb = palette[0] ?? null;
        colorCache.set(cacheKey, { rgb, palette });
        coverColorLog.info("cover.palette.success", {
          message: "remote cover palette extraction finished",
          trackId: current.id,
          category: "media",
          phase: palette.length > 0 ? "success" : "skip",
          coverSourceKind: coverSource.kind,
          coverSourceHost: coverSource.host || safeUrl.host || undefined,
          paletteCount: palette.length,
          fallbackToTheme: palette.length === 0,
        });
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
      coverColorLog.warn("cover.palette.fallback", {
        message: "local cover palette fallback to theme primary",
        trackId: current?.id,
        category: "media",
        phase: "skip",
        coverBlobId: current?.coverBlobId,
        reason: cover ? "missing-blob-bytes" : "missing-cover-row",
      });
      transitionVisualizerCoverColor("theme-primary", readPrimaryRgb());
      return;
    }

    let alive = true;
    const cacheKey = cover.id;
    const cached = colorCache.get(cacheKey);
    if (cached !== undefined) {
      coverColorLog.debug("cover.palette.cache", {
        message: "cover palette cache hit",
        trackId: current?.id,
        category: "media",
        phase: "state",
        coverSourceKind: "local-cover",
        coverBlobId: cover.id,
        paletteCount: cached.palette.length,
      });
      transitionVisualizerCoverColor(cacheKey, cached.rgb ?? readPrimaryRgb(), cached.palette);
      return;
    }

    coverColorLog.debug("cover.palette.start", {
      message: "local cover palette extraction started",
      trackId: current?.id,
      category: "media",
      phase: "start",
      coverSourceKind: "local-cover",
      coverBlobId: cover.id,
      mime: cover.mime,
      bytes: cover.bytes,
    });
    void extractImagePalette(cover.blob)
      .then((palette) => {
        if (!alive) return;
        const rgb = palette[0] ?? null;
        colorCache.set(cacheKey, { rgb, palette });
        void primaryColorVersion;
        coverColorLog.info("cover.palette.success", {
          message: "local cover palette extraction finished",
          trackId: current?.id,
          category: "media",
          phase: palette.length > 0 ? "success" : "skip",
          coverSourceKind: "local-cover",
          coverBlobId: cover.id,
          mime: cover.mime,
          bytes: cover.bytes,
          paletteCount: palette.length,
          fallbackToTheme: palette.length === 0,
        });
        transitionVisualizerCoverColor(cacheKey, rgb ?? readPrimaryRgb(), palette);
      })
      .catch((error) => {
        if (!alive) return;
        coverColorLog.warn("cover.palette.failed", {
          message: "local cover palette extraction failed",
          trackId: current?.id,
          category: "media",
          phase: "fail",
          coverSourceKind: "local-cover",
          coverBlobId: cover.id,
          mime: cover.mime,
          bytes: cover.bytes,
          error,
        });
        transitionVisualizerCoverColor(cacheKey, readPrimaryRgb(), []);
      });

    return () => {
      alive = false;
    };
  }, [
    active,
    coverColorEnabled,
    current?.cloudSource,
    current?.coverBlobId,
    current?.id,
    current?.remoteCoverUrl,
    cover,
    primaryColorVersion,
  ]);

  return active ? css : null;
}
