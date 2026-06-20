import {
  deleteMediaBlob,
  type MediaBlobStorageOptions,
  putSizeAwareImageBlob,
  resolveMediaBlob,
} from "@/db/media-blob-storage";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type {
  CoverDerivative,
  CoverDerivativeKind,
  CoverPaletteRgb,
  CropRect,
  Track,
} from "@/db/types";
import { normalizeCoverPalette } from "@/lib/cover-palette";
import { newId } from "@/lib/id";
import { arePerfCountersEnabled, notePerfWork } from "@/lib/perf-counters";
import { extractCoverMetadataViaWorker } from "@/workers/cover-client";
import type { CoverMetadataResult } from "@/workers/cover-derivative-core";

// v2: thumbnail max edge 160→320 + quality 0.82→0.9. Bumping invalidates the old
// `cvd_…` ids so existing covers regenerate sharper derivatives on next access.
export const COVER_DERIVATIVE_VERSION = 2;
export const COVER_THUMBNAIL_DERIVATIVE_BUDGET_BYTES = 64 * 1024 * 1024;

type CoverDerivativeSource = Pick<CoverDerivative, "sourceKey" | "sourceKind" | "sourceRef">;

export interface ResolvedCoverDerivative {
  blob: Blob;
  blobId: string;
  derivative: CoverDerivative;
}

export interface ResolvedCoverPaletteDerivative {
  derivative: CoverDerivative;
  palette: NonNullable<CoverDerivative["palette"]>;
}

export type PrecomputedCoverImageDerivativeResult = Partial<
  Record<"backlight" | "thumbnail", ResolvedCoverDerivative>
>;

export interface EnsureCoverDerivativeOptions {
  extract?: (
    input: Parameters<typeof extractCoverMetadataViaWorker>[0],
  ) => Promise<CoverMetadataResult>;
  limit?: number;
  skip?: ReadonlySet<string>;
  storage?: MediaBlobStorageOptions;
  thumbnailBudgetBytes?: number;
  traceSource?: string;
}

export interface CoverDerivativeRepairProgress {
  attempted: string[];
  failed: number;
  processed: number;
  updated: number;
}

export interface CoverDerivativeBudgetResult {
  bytesFreed: number;
  deleted: number;
  keptBytes: number;
}

const imageDerivativeInFlight = new Map<string, Promise<ResolvedCoverDerivative | undefined>>();
const paletteDerivativeInFlight = new Map<
  string,
  Promise<ResolvedCoverPaletteDerivative | undefined>
>();

export function coverDerivativeSourceForTrack(
  track: Pick<Track, "coverBlobId" | "remoteCoverUrl">,
): CoverDerivativeSource | null {
  if (track.coverBlobId) {
    return {
      sourceKey: `local:${track.coverBlobId}`,
      sourceKind: "local-cover",
      sourceRef: track.coverBlobId,
    };
  }
  if (track.remoteCoverUrl) {
    return {
      sourceKey: `remote:${stableHash(track.remoteCoverUrl)}`,
      sourceKind: "remote-cover",
      sourceRef: track.remoteCoverUrl,
    };
  }
  return null;
}

export function coverDerivativeId(input: {
  cropSig: string;
  kind: CoverDerivativeKind;
  sourceKey: string;
  version?: number;
}): string {
  return `cvd_${stableHash(
    `${input.sourceKey}|${input.kind}|${input.cropSig}|v${input.version ?? COVER_DERIVATIVE_VERSION}`,
  )}`;
}

export function coverCropSignature(crop?: CropRect): string {
  if (!crop) return "full";
  return [crop.x, crop.y, crop.width, crop.height].map((value) => Math.round(value)).join(":");
}

/**
 * The cross-mount object-URL cache key for a cover IMAGE derivative — the very
 * `cvd_…` id `ensureCover{Thumbnail,Backlight}Derivative` resolves to, computed
 * synchronously from row fields. `useCoverDerivativeUrl` peeks the cache with this
 * on frame 0 so a re-mount (back from a detail page, tab switch) paints the cached
 * thumbnail immediately instead of flashing the thumbhash placeholder. Returns null
 * for sources with no local derivative (remote-only covers), matching
 * `ensureCoverImageDerivative`'s early-out. Pass the SAME (crop-setting–gated) crop
 * the resolver receives so the signatures match.
 */
export function coverImageDerivativeKey(
  track: Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  kind: "backlight" | "thumbnail",
): string | null {
  const source = coverDerivativeSourceForTrack(track);
  if (source?.sourceKind !== "local-cover") return null;
  return coverDerivativeId({
    cropSig: coverCropSignature(track.coverCrop),
    kind,
    sourceKey: source.sourceKey,
  });
}

export async function ensureCoverThumbnailDerivative(
  track: Pick<Track, "id" | "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  db: MuzeroDB = defaultDb,
  options: EnsureCoverDerivativeOptions = {},
): Promise<ResolvedCoverDerivative | undefined> {
  return ensureCoverImageDerivative(track, "thumbnail", db, options);
}

export async function resolveCoverThumbnailDerivative(
  track: Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  db: MuzeroDB = defaultDb,
  storage?: MediaBlobStorageOptions,
): Promise<ResolvedCoverDerivative | undefined> {
  const id = coverImageDerivativeKey(track, "thumbnail");
  return id ? resolveCoverDerivative(id, db, storage) : undefined;
}

export async function ensureCoverBacklightDerivative(
  track: Pick<Track, "id" | "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  db: MuzeroDB = defaultDb,
  options: EnsureCoverDerivativeOptions = {},
): Promise<ResolvedCoverDerivative | undefined> {
  return ensureCoverImageDerivative(track, "backlight", db, options);
}

export async function resolveCoverBacklightDerivative(
  track: Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  db: MuzeroDB = defaultDb,
  storage?: MediaBlobStorageOptions,
): Promise<ResolvedCoverDerivative | undefined> {
  const id = coverImageDerivativeKey(track, "backlight");
  return id ? resolveCoverDerivative(id, db, storage) : undefined;
}

export async function resolveCoverPaletteDerivative(
  track: Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  db: MuzeroDB = defaultDb,
): Promise<ResolvedCoverPaletteDerivative | undefined> {
  const source = coverDerivativeSourceForTrack(track);
  if (!source) return undefined;
  const derivative = await db.coverDerivatives.get(
    coverDerivativeId({
      cropSig: coverCropSignature(track.coverCrop),
      kind: "palette",
      sourceKey: source.sourceKey,
    }),
  );
  const palette = normalizeCoverPalette(derivative?.palette);
  return derivative && palette.length > 0 ? { derivative, palette } : undefined;
}

export async function ensureCoverPaletteDerivative(
  track: Pick<Track, "id" | "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  db: MuzeroDB = defaultDb,
  options: EnsureCoverDerivativeOptions = {},
): Promise<ResolvedCoverPaletteDerivative | undefined> {
  const cached = await resolveCoverPaletteDerivative(track, db);
  if (cached) return cached;
  const source = coverDerivativeSourceForTrack(track);
  if (source?.sourceKind !== "local-cover" || !track.coverBlobId) return undefined;
  const cropSig = coverCropSignature(track.coverCrop);
  const id = coverDerivativeId({ cropSig, kind: "palette", sourceKey: source.sourceKey });
  const existing = paletteDerivativeInFlight.get(id);
  if (existing) return existing;
  const promise = createPaletteDerivative({ cropSig, id, source, track }, db, options).finally(
    () => {
      if (paletteDerivativeInFlight.get(id) === promise) paletteDerivativeInFlight.delete(id);
    },
  );
  paletteDerivativeInFlight.set(id, promise);
  return promise;
}

export async function putCoverPaletteDerivative(
  track: Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  palette: readonly CoverPaletteRgb[],
  db: MuzeroDB = defaultDb,
): Promise<ResolvedCoverPaletteDerivative | undefined> {
  const source = coverDerivativeSourceForTrack(track);
  if (!source) return undefined;
  const cleanPalette = normalizeCoverPalette(palette);
  if (cleanPalette.length === 0) return undefined;
  const cropSig = coverCropSignature(track.coverCrop);
  const now = Date.now();
  const derivative: CoverDerivative = {
    id: coverDerivativeId({ cropSig, kind: "palette", sourceKey: source.sourceKey }),
    cropSig,
    generatedAt: now,
    kind: "palette",
    palette: cleanPalette,
    sourceKey: source.sourceKey,
    sourceKind: source.sourceKind,
    sourceRef: source.sourceRef,
    updatedAt: now,
    version: COVER_DERIVATIVE_VERSION,
  };
  await db.coverDerivatives.put(derivative);
  return { derivative, palette: cleanPalette };
}

export async function putPrecomputedCoverImageDerivatives(
  track: Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  metadata: Pick<CoverMetadataResult, "backlight" | "thumbnail">,
  db: MuzeroDB = defaultDb,
  options: Pick<EnsureCoverDerivativeOptions, "storage" | "thumbnailBudgetBytes"> = {},
): Promise<PrecomputedCoverImageDerivativeResult> {
  const source = coverDerivativeSourceForTrack(track);
  if (source?.sourceKind !== "local-cover") return {};
  const cropSig = coverCropSignature(track.coverCrop);
  const result: PrecomputedCoverImageDerivativeResult = {};
  for (const kind of ["backlight", "thumbnail"] as const) {
    const image = metadata[kind];
    if (!image) continue;
    const id = coverDerivativeId({ cropSig, kind, sourceKey: source.sourceKey });
    const cached = await resolveCoverDerivative(id, db, options.storage);
    if (cached) {
      result[kind] = cached;
      continue;
    }
    const persisted = await putImageDerivativeResult(
      {
        cropSig,
        id,
        image,
        kind,
        source,
      },
      db,
      options,
    );
    if (persisted) result[kind] = persisted;
  }
  return result;
}

export async function countMissingCoverDerivatives(
  kind: "backlight" | "thumbnail",
  db: MuzeroDB = defaultDb,
): Promise<number> {
  const tracks = await db.tracks.filter((track) => Boolean(track.coverBlobId)).toArray();
  let count = 0;
  for (const track of tracks) {
    const source = coverDerivativeSourceForTrack(track);
    if (source?.sourceKind !== "local-cover") continue;
    const id = coverDerivativeId({
      cropSig: coverCropSignature(track.coverCrop),
      kind,
      sourceKey: source.sourceKey,
    });
    const derivative = await db.coverDerivatives.get(id);
    if (!derivative?.blobId) count += 1;
  }
  return count;
}

export async function repairMissingCoverDerivatives(
  kind: "backlight" | "thumbnail",
  db: MuzeroDB = defaultDb,
  options: EnsureCoverDerivativeOptions = {},
): Promise<CoverDerivativeRepairProgress> {
  const limit = options.limit ?? 25;
  const tracks = await db.tracks.filter((track) => Boolean(track.coverBlobId)).toArray();
  const attempted: string[] = [];
  let failed = 0;
  let updated = 0;
  for (const track of tracks) {
    if (attempted.length >= limit) break;
    const source = coverDerivativeSourceForTrack(track);
    if (source?.sourceKind !== "local-cover" || !track.coverBlobId) continue;
    if (options.skip?.has(track.coverBlobId)) continue;
    const id = coverDerivativeId({
      cropSig: coverCropSignature(track.coverCrop),
      kind,
      sourceKey: source.sourceKey,
    });
    const existing = await db.coverDerivatives.get(id);
    if (existing?.blobId) continue;
    attempted.push(track.coverBlobId);
    const resolved =
      kind === "backlight"
        ? await ensureCoverBacklightDerivative(track, db, options)
        : await ensureCoverThumbnailDerivative(track, db, options);
    if (resolved) updated += 1;
    else failed += 1;
  }
  return { attempted, failed, processed: attempted.length, updated };
}

export async function deleteCoverDerivativesForSource(
  sourceKey: string,
  db: MuzeroDB = defaultDb,
  storage: MediaBlobStorageOptions = {},
): Promise<number> {
  const rows = await db.coverDerivatives.where("sourceKey").equals(sourceKey).toArray();
  for (const row of rows) {
    await db.coverDerivatives.delete(row.id);
    if (row.blobId) await deleteMediaBlob(row.blobId, db, storage);
  }
  return rows.length;
}

export async function enforceCoverDerivativeBudget(
  kind: "thumbnail",
  maxBytes: number,
  db: MuzeroDB = defaultDb,
  storage: MediaBlobStorageOptions = {},
  options: { preserveIds?: ReadonlySet<string> } = {},
): Promise<CoverDerivativeBudgetResult> {
  const rows = (await db.coverDerivatives.where("kind").equals(kind).toArray()).filter(
    (row) => row.blobId,
  );
  let total = rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
  let bytesFreed = 0;
  let deleted = 0;
  const targetBytes = Math.max(0, maxBytes);
  for (const row of rows.sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (total <= targetBytes) break;
    if (options.preserveIds?.has(row.id) || !row.blobId) continue;
    await db.coverDerivatives.delete(row.id);
    await deleteMediaBlob(row.blobId, db, storage);
    const bytes = row.bytes ?? 0;
    total = Math.max(0, total - bytes);
    bytesFreed += bytes;
    deleted += 1;
  }
  return { bytesFreed, deleted, keptBytes: total };
}

async function ensureCoverImageDerivative(
  track: Pick<Track, "id" | "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  kind: "backlight" | "thumbnail",
  db: MuzeroDB,
  options: EnsureCoverDerivativeOptions,
): Promise<ResolvedCoverDerivative | undefined> {
  const source = coverDerivativeSourceForTrack(track);
  if (source?.sourceKind !== "local-cover" || !track.coverBlobId) return undefined;
  const cropSig = coverCropSignature(track.coverCrop);
  const id = coverDerivativeId({ cropSig, kind, sourceKey: source.sourceKey });
  const cached = await resolveCoverDerivative(id, db, options.storage);
  if (cached) return cached;
  const existing = imageDerivativeInFlight.get(id);
  if (existing) return existing;
  const promise = createImageDerivative({ cropSig, id, kind, source, track }, db, options).finally(
    () => {
      if (imageDerivativeInFlight.get(id) === promise) imageDerivativeInFlight.delete(id);
    },
  );
  imageDerivativeInFlight.set(id, promise);
  return promise;
}

async function resolveCoverDerivative(
  id: string,
  db: MuzeroDB,
  storage: MediaBlobStorageOptions | undefined,
): Promise<ResolvedCoverDerivative | undefined> {
  const derivative = await db.coverDerivatives.get(id);
  if (!derivative?.blobId) return undefined;
  const resolved = await resolveMediaBlob(derivative.blobId, db, storage);
  if (!resolved?.blob) return undefined;
  return { blob: resolved.blob, blobId: derivative.blobId, derivative };
}

async function createImageDerivative(
  input: {
    cropSig: string;
    id: string;
    kind: "backlight" | "thumbnail";
    source: CoverDerivativeSource;
    track: Pick<Track, "id" | "coverBlobId" | "coverCrop">;
  },
  db: MuzeroDB,
  options: EnsureCoverDerivativeOptions,
): Promise<ResolvedCoverDerivative | undefined> {
  if (!input.track.coverBlobId) return undefined;
  const cover = await resolveMediaBlob(input.track.coverBlobId, db, options.storage);
  if (!cover?.blob) return undefined;
  const extract = options.extract ?? extractCoverMetadataViaWorker;
  // PERF PROBE (switch-fps cover commit): wall-clock of one derivative pass. The
  // pixel work runs in a worker, but serializing the full-res cover blob into the
  // worker (structured clone) is on this thread — so a cover edit that regenerates
  // backlight + thumbnail pays it twice. Attributes the post-commit cover cost.
  const perfEnabled = arePerfCountersEnabled();
  const extractStart = perfEnabled ? performance.now() : 0;
  const result = await extract({
    blob: cover.blob,
    crop: input.track.coverCrop,
    mime: cover.mime,
    sourceKey: input.source.sourceKey,
    targets: [input.kind],
  });
  if (perfEnabled) {
    notePerfWork("cover.derivative.extract", performance.now() - extractStart, {
      bytes: cover.blob.size,
      kind: input.kind,
      sourceKind: input.source.sourceKind,
      traceSource: options.traceSource,
      trackId: input.track.id,
    });
  }
  const image = input.kind === "backlight" ? result.backlight : result.thumbnail;
  if (!image) return undefined;
  return putImageDerivativeResult(
    {
      cropSig: input.cropSig,
      id: input.id,
      image,
      kind: input.kind,
      source: input.source,
    },
    db,
    options,
  );
}

async function putImageDerivativeResult(
  input: {
    cropSig: string;
    id: string;
    image: NonNullable<CoverMetadataResult["backlight"]>;
    kind: "backlight" | "thumbnail";
    source: CoverDerivativeSource;
  },
  db: MuzeroDB,
  options: Pick<EnsureCoverDerivativeOptions, "storage" | "thumbnailBudgetBytes">,
): Promise<ResolvedCoverDerivative | undefined> {
  const derivativeBlob = new Blob([input.image.bytes], { type: input.image.mime });
  const media = await putSizeAwareImageBlob(
    {
      id: newId("blb"),
      trackId: input.source.sourceKey,
      role: "cover-derivative",
      mime: input.image.mime,
      bytes: derivativeBlob.size,
      blob: derivativeBlob,
      suggestedName: input.kind === "backlight" ? "Cover backlight" : "Cover thumbnail",
    },
    db,
    options.storage,
  );
  const now = Date.now();
  const derivative: CoverDerivative = {
    id: input.id,
    blobId: media.id,
    bytes: media.bytes,
    cropSig: input.cropSig,
    generatedAt: now,
    height: input.image.height,
    kind: input.kind,
    mime: input.image.mime,
    sourceKey: input.source.sourceKey,
    sourceKind: input.source.sourceKind,
    sourceRef: input.source.sourceRef,
    updatedAt: now,
    version: COVER_DERIVATIVE_VERSION,
    width: input.image.width,
  };
  await db.coverDerivatives.put(derivative);
  if (input.kind === "thumbnail") {
    await enforceCoverDerivativeBudget(
      "thumbnail",
      options.thumbnailBudgetBytes ?? COVER_THUMBNAIL_DERIVATIVE_BUDGET_BYTES,
      db,
      options.storage,
      { preserveIds: new Set([input.id]) },
    );
  }
  return { blob: derivativeBlob, blobId: media.id, derivative };
}

async function createPaletteDerivative(
  input: {
    cropSig: string;
    id: string;
    source: CoverDerivativeSource;
    track: Pick<Track, "id" | "coverBlobId" | "coverCrop">;
  },
  db: MuzeroDB,
  options: EnsureCoverDerivativeOptions,
): Promise<ResolvedCoverPaletteDerivative | undefined> {
  if (!input.track.coverBlobId) return undefined;
  const cover = await resolveMediaBlob(input.track.coverBlobId, db, options.storage);
  if (!cover?.blob) return undefined;
  const extract = options.extract ?? extractCoverMetadataViaWorker;
  const result = await extract({
    blob: cover.blob,
    crop: input.track.coverCrop,
    mime: cover.mime,
    sourceKey: input.source.sourceKey,
    targets: ["palette"],
  });
  return putCoverPaletteDerivative(input.track, result.palette, db);
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
