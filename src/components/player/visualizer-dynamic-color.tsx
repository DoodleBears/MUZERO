import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveMediaBlob } from "@/db/media-blob-storage";
import { db } from "@/db/muzero-db";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import {
  coverPaletteFields,
  coverPaletteFromThumbhash,
  extractCoverPalette,
  normalizeCoverPalette,
} from "@/lib/cover-palette";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { sanitizeUrlForTrace } from "@/lib/diagnostics";
import { extractImagePaletteFromFetchedUrl } from "@/lib/image-palette";
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

type CurrentCoverState = {
  id: string;
  cloudSource: Track["cloudSource"];
  coverBlobId?: string;
  coverCrop?: Track["coverCrop"];
  remoteCoverUrl?: string;
  coverThumbhash?: string;
  coverPalette?: Rgb[];
  coverPaletteSource?: string;
};

function paletteCacheEntry(palette: readonly Rgb[] | undefined | null): {
  rgb: Rgb;
  palette: Rgb[];
} | null {
  const clean = normalizeCoverPalette(palette);
  const rgb = clean[0];
  return rgb ? { rgb, palette: clean } : null;
}

function cachedTrackPalette(
  current: CurrentCoverState,
  cacheKey: string | undefined,
): { rgb: Rgb; palette: Rgb[] } | null {
  const entry = paletteCacheEntry(current.coverPalette);
  if (!entry) return null;
  const source = current.coverPaletteSource;
  if (source && current.coverBlobId && source !== current.coverBlobId && source !== cacheKey) {
    return null;
  }
  if (
    source &&
    !current.coverBlobId &&
    current.remoteCoverUrl &&
    source !== current.remoteCoverUrl &&
    source !== cacheKey
  ) {
    return null;
  }
  return entry;
}

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
        ? ({
            id: track.id,
            cloudSource: track.cloudSource,
            coverBlobId: track.coverBlobId,
            coverCrop: track.coverCrop,
            coverPalette: track.coverPalette,
            coverPaletteSource: track.coverPaletteSource,
            coverThumbhash: track.coverThumbhash,
            remoteCoverUrl: track.remoteCoverUrl,
          } satisfies CurrentCoverState)
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
      const stored = cachedTrackPalette(current, cacheKey);
      const thumbhashFallback = paletteCacheEntry(
        coverPaletteFromThumbhash(current.coverThumbhash),
      );
      const coverSource = describeTrackCoverSource({
        cloudSource: current.cloudSource,
        remoteCoverUrl,
      });
      const safeUrl = sanitizeUrlForTrace(remoteCoverUrl);
      if (stored) {
        coverColorLog.debug("cover.palette.track-metadata", {
          message: "cover palette loaded from track metadata",
          trackId: current.id,
          category: "media",
          phase: "state",
          coverSourceKind: coverSource.kind,
          coverSourceHost: coverSource.host || safeUrl.host || undefined,
          paletteCount: stored.palette.length,
        });
        colorCache.set(cacheKey, stored);
        transitionVisualizerCoverColor(cacheKey, stored.rgb, stored.palette);
        return;
      }
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
      if (thumbhashFallback) {
        transitionVisualizerCoverColor(
          `thumbhash:${current.coverThumbhash}`,
          thumbhashFallback.rgb,
          thumbhashFallback.palette,
        );
      }
      if (thumbhashFallback && resolveDesktopBridge().kind === "web") {
        coverColorLog.debug("cover.palette.thumbhash-fallback", {
          message: "remote cover palette uses thumbhash fallback in browser",
          trackId: current.id,
          category: "media",
          phase: "state",
          coverSourceKind: coverSource.kind,
          coverSourceHost: coverSource.host || safeUrl.host || undefined,
          paletteCount: thumbhashFallback.palette.length,
        });
        colorCache.set(cacheKey, thumbhashFallback);
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
        const clean = normalizeCoverPalette(palette);
        const extracted = paletteCacheEntry(clean) ?? thumbhashFallback;
        const rgb = extracted?.rgb ?? null;
        const resolvedPalette = extracted?.palette ?? [];
        if (clean.length > 0) {
          void db.tracks.update(current.id, coverPaletteFields(clean, remoteCoverUrl));
        }
        colorCache.set(cacheKey, { rgb, palette: resolvedPalette });
        coverColorLog.info("cover.palette.success", {
          message: "remote cover palette extraction finished",
          trackId: current.id,
          category: "media",
          phase: clean.length > 0 ? "success" : thumbhashFallback ? "state" : "skip",
          fallbackKind: thumbhashFallback && clean.length === 0 ? "thumbhash" : undefined,
          coverSourceKind: coverSource.kind,
          coverSourceHost: coverSource.host || safeUrl.host || undefined,
          paletteCount: resolvedPalette.length,
          fallbackToTheme: resolvedPalette.length === 0,
        });
        transitionVisualizerCoverColor(cacheKey, rgb ?? readPrimaryRgb(), resolvedPalette);
      });
      return () => {
        alive = false;
        controller.abort();
      };
    }

    const stored = cachedTrackPalette(current, current.coverBlobId);
    if (stored && current.coverBlobId) {
      colorCache.set(current.coverBlobId, stored);
      coverColorLog.debug("cover.palette.track-metadata", {
        message: "cover palette loaded from track metadata",
        trackId: current.id,
        category: "media",
        phase: "state",
        coverSourceKind: "local-cover",
        coverBlobId: current.coverBlobId,
        paletteCount: stored.palette.length,
      });
      transitionVisualizerCoverColor(current.coverBlobId, stored.rgb, stored.palette);
      return;
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
    const thumbhashFallback = paletteCacheEntry(coverPaletteFromThumbhash(current.coverThumbhash));
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
    if (thumbhashFallback) {
      transitionVisualizerCoverColor(
        `thumbhash:${current.coverThumbhash}`,
        thumbhashFallback.rgb,
        thumbhashFallback.palette,
      );
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
    void extractCoverPalette(cover.blob, current.coverCrop, cover.mime)
      .then((palette) => {
        if (!alive) return;
        const clean = normalizeCoverPalette(palette);
        const extracted = paletteCacheEntry(clean) ?? thumbhashFallback;
        const rgb = extracted?.rgb ?? null;
        const resolvedPalette = extracted?.palette ?? [];
        if (clean.length > 0) {
          void db.tracks.update(current.id, coverPaletteFields(clean, cover.id));
        }
        colorCache.set(cacheKey, { rgb, palette: resolvedPalette });
        void primaryColorVersion;
        coverColorLog.info("cover.palette.success", {
          message: "local cover palette extraction finished",
          trackId: current?.id,
          category: "media",
          phase: clean.length > 0 ? "success" : thumbhashFallback ? "state" : "skip",
          fallbackKind: thumbhashFallback && clean.length === 0 ? "thumbhash" : undefined,
          coverSourceKind: "local-cover",
          coverBlobId: cover.id,
          mime: cover.mime,
          bytes: cover.bytes,
          paletteCount: resolvedPalette.length,
          fallbackToTheme: resolvedPalette.length === 0,
        });
        transitionVisualizerCoverColor(cacheKey, rgb ?? readPrimaryRgb(), resolvedPalette);
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
  }, [active, coverColorEnabled, current, cover, primaryColorVersion]);

  return active ? css : null;
}
