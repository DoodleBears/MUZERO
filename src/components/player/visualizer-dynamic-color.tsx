import { useLiveQuery } from "dexie-react-hooks";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { putCoverPaletteDerivative, resolveCoverPaletteDerivative } from "@/db/cover-derivatives";
import { resolveMediaBlob } from "@/db/media-blob-storage";
import { db } from "@/db/muzero-db";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { getOrFetchRemoteCoverAsset, remoteCoverAssetKey } from "@/lib/cover-asset";
import {
  coverPaletteFields,
  coverPaletteFromThumbhash,
  normalizeCoverPalette,
} from "@/lib/cover-palette";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { sanitizeUrlForTrace } from "@/lib/diagnostics";
import { createDiagnosticLogger } from "@/lib/logger";
import { describeTrackCoverSource } from "@/lib/track-source";
import { type Rgb, readPrimaryRgb } from "@/lib/visualizer-color";
import { usePlayerStore } from "@/stores/player-store";
import {
  transitionVisualizerCoverColor,
  useVisualizerCoverColorStore,
} from "@/stores/visualizer-color-store";
import { extractCoverMetadataViaWorker } from "@/workers/cover-client";

const colorCache = new Map<string, { rgb: Rgb | null; palette: Rgb[] }>();
const paletteExtractionInFlight = new Map<string, Promise<PaletteResolution>>();
const coverColorLog = createDiagnosticLogger("cover.palette");
const PALETTE_EXTRACTION_SETTLE_MS = 900;
const PALETTE_EXTRACTION_IDLE_TIMEOUT_MS = 4000;
const DISABLE_COVER_COLOR_FOR_BISECT = false;
const DISABLE_COVER_COLOR_APPLY_FOR_BISECT = false;
let lastAppliedTarget: { key: string | null; rgb: Rgb | null; palette: Rgb[] } | null = null;

type PaletteResolution = {
  rgb: Rgb | null;
  palette: Rgb[];
  cleanPalette: Rgb[];
  fallbackKind?: "thumbhash";
};

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

function sameRgb(a: Rgb | null, b: Rgb | null): boolean {
  return a === b || (!!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b);
}

function samePalette(a: readonly Rgb[], b: readonly Rgb[]): boolean {
  return a.length === b.length && a.every((color, index) => sameRgb(color, b[index] ?? null));
}

function applyVisualizerCoverColorTarget(
  key: string | null,
  rgb: Rgb | null,
  palette: Rgb[] = [],
): boolean {
  if (
    lastAppliedTarget &&
    lastAppliedTarget.key === key &&
    sameRgb(lastAppliedTarget.rgb, rgb) &&
    samePalette(lastAppliedTarget.palette, palette)
  ) {
    return false;
  }
  lastAppliedTarget = {
    key,
    rgb: rgb ? { ...rgb } : null,
    palette: palette.map((color) => ({ ...color })),
  };
  if (DISABLE_COVER_COLOR_APPLY_FOR_BISECT) {
    coverColorLog.debug("cover.palette.apply", {
      message: "cover palette color apply skipped for diagnostic bisect",
      category: "media",
      phase: "skip",
      reason: "diag-bisect",
      targetKey: key ?? undefined,
      paletteCount: palette.length,
      fallbackToTheme: !rgb,
    });
    return true;
  }
  transitionVisualizerCoverColor(key, rgb, palette);
  return true;
}

function resolvePalette(
  palette: readonly Rgb[] | undefined,
  thumbhashFallback: { rgb: Rgb; palette: Rgb[] } | null,
): PaletteResolution {
  const cleanPalette = normalizeCoverPalette(palette);
  const extracted = paletteCacheEntry(cleanPalette) ?? thumbhashFallback;
  return {
    rgb: extracted?.rgb ?? null,
    palette: extracted?.palette ?? [],
    cleanPalette,
    fallbackKind: thumbhashFallback && cleanPalette.length === 0 ? "thumbhash" : undefined,
  };
}

function palettePhase(result: PaletteResolution): "success" | "state" | "skip" {
  if (result.cleanPalette.length > 0) return "success";
  return result.fallbackKind ? "state" : "skip";
}

function cachePaletteResult(cacheKey: string, result: PaletteResolution): void {
  colorCache.set(cacheKey, { rgb: result.rgb, palette: result.palette });
}

function runSettledPaletteExtraction(
  run: () => Promise<PaletteResolution>,
  apply: (result: PaletteResolution) => void,
): () => void {
  let alive = true;
  let idleId: number | null = null;
  let timer: number | null = window.setTimeout(() => {
    timer = null;
    if (!alive) return;
    const execute = () => {
      if (!alive) return;
      void run().then((result) => {
        if (!alive) return;
        apply(result);
      });
    };
    if (typeof requestIdleCallback === "function") {
      idleId = requestIdleCallback(
        () => {
          idleId = null;
          execute();
        },
        { timeout: PALETTE_EXTRACTION_IDLE_TIMEOUT_MS },
      );
      return;
    }
    timer = window.setTimeout(execute, 0);
  }, PALETTE_EXTRACTION_SETTLE_MS);
  return () => {
    alive = false;
    if (timer != null) window.clearTimeout(timer);
    if (idleId != null && typeof cancelIdleCallback === "function") cancelIdleCallback(idleId);
  };
}

function getOrStartRemotePaletteExtraction(args: {
  trackId: string;
  cacheKey: string;
  remoteCoverUrl: string;
  thumbhashFallback: { rgb: Rgb; palette: Rgb[] } | null;
  coverSource: ReturnType<typeof describeTrackCoverSource>;
  safeUrl: ReturnType<typeof sanitizeUrlForTrace>;
}): Promise<PaletteResolution> {
  const inFlight = paletteExtractionInFlight.get(args.cacheKey);
  if (inFlight) {
    coverColorLog.debug("cover.palette.join", {
      message: "remote cover palette joined in-flight extraction",
      trackId: args.trackId,
      category: "media",
      phase: "state",
      coverSourceKind: args.coverSource.kind,
      coverSourceHost: args.coverSource.host || args.safeUrl.host || undefined,
    });
    return inFlight;
  }

  let promise: Promise<PaletteResolution>;
  promise = (async () => {
    try {
      coverColorLog.debug("cover.palette.start", {
        message: "remote cover palette extraction started",
        trackId: args.trackId,
        category: "media",
        phase: "start",
        coverSourceKind: args.coverSource.kind,
        coverSourceHost: args.coverSource.host || args.safeUrl.host || undefined,
        requestHost: args.safeUrl.host ?? undefined,
        requestPathHash: args.safeUrl.pathHash,
        safeQuery: args.safeUrl.safeQuery,
        redactions: args.safeUrl.redactions,
      });
      const asset = await getOrFetchRemoteCoverAsset(args.remoteCoverUrl);
      const { palette } = await extractCoverMetadataViaWorker({
        blob: asset.blob,
        mime: asset.mime,
        sourceKey: args.cacheKey,
        targets: ["palette"],
      });
      const result = resolvePalette(palette, args.thumbhashFallback);
      if (result.cleanPalette.length > 0) {
        void db.tracks.update(
          args.trackId,
          coverPaletteFields(result.cleanPalette, args.remoteCoverUrl),
        );
      }
      cachePaletteResult(args.cacheKey, result);
      coverColorLog.info("cover.palette.success", {
        message: "remote cover palette extraction finished",
        trackId: args.trackId,
        category: "media",
        phase: palettePhase(result),
        fallbackKind: result.fallbackKind,
        coverSourceKind: args.coverSource.kind,
        coverSourceHost: args.coverSource.host || args.safeUrl.host || undefined,
        paletteCount: result.palette.length,
        fallbackToTheme: result.palette.length === 0,
      });
      return result;
    } catch (error) {
      const result = resolvePalette([], args.thumbhashFallback);
      cachePaletteResult(args.cacheKey, result);
      coverColorLog.warn("cover.palette.failed", {
        message: "remote cover palette extraction failed",
        trackId: args.trackId,
        category: "media",
        phase: "fail",
        coverSourceKind: args.coverSource.kind,
        coverSourceHost: args.coverSource.host || args.safeUrl.host || undefined,
        fallbackKind: result.fallbackKind,
        error,
      });
      return result;
    }
  })().finally(() => {
    if (paletteExtractionInFlight.get(args.cacheKey) === promise) {
      paletteExtractionInFlight.delete(args.cacheKey);
    }
  });
  paletteExtractionInFlight.set(args.cacheKey, promise);
  return promise;
}

function getOrStartLocalPaletteExtraction(args: {
  trackId: string;
  cacheKey: string;
  cover: { id: string; blob: Blob; mime: string; bytes: number };
  coverCrop: CurrentCoverState["coverCrop"];
  thumbhashFallback: { rgb: Rgb; palette: Rgb[] } | null;
}): Promise<PaletteResolution> {
  const inFlight = paletteExtractionInFlight.get(args.cacheKey);
  if (inFlight) {
    coverColorLog.debug("cover.palette.join", {
      message: "local cover palette joined in-flight extraction",
      trackId: args.trackId,
      category: "media",
      phase: "state",
      coverSourceKind: "local-cover",
      coverBlobId: args.cover.id,
    });
    return inFlight;
  }

  let promise: Promise<PaletteResolution>;
  promise = (async () => {
    coverColorLog.debug("cover.palette.start", {
      message: "local cover palette extraction started",
      trackId: args.trackId,
      category: "media",
      phase: "start",
      coverSourceKind: "local-cover",
      coverBlobId: args.cover.id,
      mime: args.cover.mime,
      bytes: args.cover.bytes,
    });
    return (
      await extractCoverMetadataViaWorker({
        blob: args.cover.blob,
        crop: args.coverCrop,
        mime: args.cover.mime,
        sourceKey: args.cover.id,
        targets: ["palette"],
      })
    ).palette;
  })()
    .then((palette) => {
      const result = resolvePalette(palette, args.thumbhashFallback);
      if (result.cleanPalette.length > 0) {
        void putCoverPaletteDerivative(
          {
            coverBlobId: args.cover.id,
            coverCrop: args.coverCrop,
          },
          result.cleanPalette,
          db,
        );
      }
      cachePaletteResult(args.cacheKey, result);
      coverColorLog.info("cover.palette.success", {
        message: "local cover palette extraction finished",
        trackId: args.trackId,
        category: "media",
        phase: palettePhase(result),
        fallbackKind: result.fallbackKind,
        coverSourceKind: "local-cover",
        coverBlobId: args.cover.id,
        mime: args.cover.mime,
        bytes: args.cover.bytes,
        paletteCount: result.palette.length,
        fallbackToTheme: result.palette.length === 0,
      });
      return result;
    })
    .catch((error) => {
      const result = resolvePalette([], args.thumbhashFallback);
      cachePaletteResult(args.cacheKey, result);
      coverColorLog.warn("cover.palette.failed", {
        message: "local cover palette extraction failed",
        trackId: args.trackId,
        category: "media",
        phase: "fail",
        coverSourceKind: "local-cover",
        coverBlobId: args.cover.id,
        mime: args.cover.mime,
        bytes: args.cover.bytes,
        fallbackKind: result.fallbackKind,
        error,
      });
      return result;
    })
    .finally(() => {
      if (paletteExtractionInFlight.get(args.cacheKey) === promise) {
        paletteExtractionInFlight.delete(args.cacheKey);
      }
    });
  paletteExtractionInFlight.set(args.cacheKey, promise);
  return promise;
}

/**
 * Scoped dynamic visualizer accent. The color is stored outside the component so
 * tab changes do not flash back to the theme primary before the cover re-loads.
 */
export function useVisualizerCoverColorCss(
  active = true,
  options: { respectVisualizerSetting?: boolean } = {},
): string | null {
  const settings = useSettings();
  const coverColorEnabled =
    options.respectVisualizerSetting === false ? true : (settings.visualizerUseCoverColor ?? true);
  const primaryColorVersion = `${settings.theme ?? ""}:${settings.primaryLight ?? ""}:${settings.primaryDark ?? ""}`;
  const enabled = !DISABLE_COVER_COLOR_FOR_BISECT && active && coverColorEnabled;
  const css = useVisualizerCoverColorStore((s) => s.css);
  const current = usePlayerStore(
    useShallow((s) => {
      if (DISABLE_COVER_COLOR_FOR_BISECT) return null;
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
  const paletteDerivative = useLiveQuery(
    async () =>
      enabled && current?.coverBlobId
        ? ((await resolveCoverPaletteDerivative(current, db)) ?? null)
        : null,
    [enabled, current?.coverBlobId, current?.coverCrop],
    null,
  );

  useEffect(() => {
    if (!active) return;
    const remoteCoverUrl = current?.remoteCoverUrl;
    // Feature off, or the track has no cover at all → follow the theme primary.
    if (!coverColorEnabled || (!current?.coverBlobId && !remoteCoverUrl)) {
      void primaryColorVersion;
      const applied = applyVisualizerCoverColorTarget("theme-primary", readPrimaryRgb());
      if (!applied) return;
      coverColorLog.debug("cover.palette.fallback", {
        message: "cover color fallback to theme primary",
        trackId: current?.id,
        category: "media",
        phase: "skip",
        reason: coverColorEnabled ? "no-cover" : "disabled",
      });
      return;
    }

    // Remote cover: bytes aren't in a local Blob yet, so fetch them through the
    // app fetch path first and then extract from the resulting same-origin Blob.
    // Keep the current color while it resolves — no flash to theme.
    if (!current.coverBlobId && remoteCoverUrl) {
      let alive = true;
      const cacheKey = remoteCoverAssetKey(remoteCoverUrl);
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
        const applied = applyVisualizerCoverColorTarget(cacheKey, stored.rgb, stored.palette);
        if (!applied) return;
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
        return;
      }
      if (cached !== undefined) {
        const applied = applyVisualizerCoverColorTarget(
          cacheKey,
          cached.rgb ?? readPrimaryRgb(),
          cached.palette,
        );
        if (!applied) return;
        coverColorLog.debug("cover.palette.cache", {
          message: "cover palette cache hit",
          trackId: current.id,
          category: "media",
          phase: "state",
          coverSourceKind: coverSource.kind,
          coverSourceHost: coverSource.host || safeUrl.host || undefined,
          paletteCount: cached.palette.length,
        });
        return;
      }
      const thumbhashApplied = thumbhashFallback
        ? applyVisualizerCoverColorTarget(
            `thumbhash:${current.coverThumbhash}`,
            thumbhashFallback.rgb,
            thumbhashFallback.palette,
          )
        : false;
      if (thumbhashFallback && resolveDesktopBridge().kind === "web") {
        if (!thumbhashApplied) return;
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
      const cancelSettledExtraction = runSettledPaletteExtraction(
        () =>
          getOrStartRemotePaletteExtraction({
            trackId: current.id,
            cacheKey,
            remoteCoverUrl,
            thumbhashFallback,
            coverSource,
            safeUrl,
          }),
        (result) => {
          if (!alive) return;
          applyVisualizerCoverColorTarget(cacheKey, result.rgb ?? readPrimaryRgb(), result.palette);
        },
      );
      return () => {
        alive = false;
        cancelSettledExtraction();
      };
    }

    const stored = cachedTrackPalette(current, current.coverBlobId);
    if (stored && current.coverBlobId) {
      colorCache.set(current.coverBlobId, stored);
      const applied = applyVisualizerCoverColorTarget(
        current.coverBlobId,
        stored.rgb,
        stored.palette,
      );
      if (!applied) return;
      coverColorLog.debug("cover.palette.track-metadata", {
        message: "cover palette loaded from track metadata",
        trackId: current.id,
        category: "media",
        phase: "state",
        coverSourceKind: "local-cover",
        coverBlobId: current.coverBlobId,
        paletteCount: stored.palette.length,
      });
      return;
    }
    const derived = paletteCacheEntry(paletteDerivative?.palette);
    if (derived && current.coverBlobId) {
      colorCache.set(current.coverBlobId, derived);
      const applied = applyVisualizerCoverColorTarget(
        current.coverBlobId,
        derived.rgb,
        derived.palette,
      );
      if (!applied) return;
      coverColorLog.debug("cover.palette.derivative", {
        message: "cover palette loaded from derivative metadata",
        trackId: current.id,
        category: "media",
        phase: "state",
        coverSourceKind: "local-cover",
        coverBlobId: current.coverBlobId,
        paletteCount: derived.palette.length,
      });
      return;
    }

    if (cover === undefined) return;
    if (!cover?.blob) {
      void primaryColorVersion;
      const applied = applyVisualizerCoverColorTarget("theme-primary", readPrimaryRgb());
      if (!applied) return;
      coverColorLog.warn("cover.palette.fallback", {
        message: "local cover palette fallback to theme primary",
        trackId: current?.id,
        category: "media",
        phase: "skip",
        coverBlobId: current?.coverBlobId,
        reason: cover ? "missing-blob-bytes" : "missing-cover-row",
      });
      return;
    }

    let alive = true;
    const cacheKey = cover.id;
    const cached = colorCache.get(cacheKey);
    const thumbhashFallback = paletteCacheEntry(coverPaletteFromThumbhash(current.coverThumbhash));
    if (cached !== undefined) {
      const applied = applyVisualizerCoverColorTarget(
        cacheKey,
        cached.rgb ?? readPrimaryRgb(),
        cached.palette,
      );
      if (!applied) return;
      coverColorLog.debug("cover.palette.cache", {
        message: "cover palette cache hit",
        trackId: current?.id,
        category: "media",
        phase: "state",
        coverSourceKind: "local-cover",
        coverBlobId: cover.id,
        paletteCount: cached.palette.length,
      });
      return;
    }
    if (thumbhashFallback) {
      applyVisualizerCoverColorTarget(
        `thumbhash:${current.coverThumbhash}`,
        thumbhashFallback.rgb,
        thumbhashFallback.palette,
      );
    }

    const cancelSettledExtraction = runSettledPaletteExtraction(
      () =>
        getOrStartLocalPaletteExtraction({
          trackId: current.id,
          cacheKey,
          cover: {
            id: cover.id,
            blob: cover.blob,
            mime: cover.mime,
            bytes: cover.bytes,
          },
          coverCrop: current.coverCrop,
          thumbhashFallback,
        }),
      (result) => {
        if (!alive) return;
        void primaryColorVersion;
        applyVisualizerCoverColorTarget(cacheKey, result.rgb ?? readPrimaryRgb(), result.palette);
      },
    );

    return () => {
      alive = false;
      cancelSettledExtraction();
    };
  }, [active, coverColorEnabled, current, cover, paletteDerivative, primaryColorVersion]);

  return active && !DISABLE_COVER_COLOR_FOR_BISECT ? css : null;
}
