import {
  type MediaBlobStorageOptions,
  putMediaBlob,
  resolveMediaBlob,
} from "@/db/media-blob-storage";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { CoverDerivative, CoverDerivativeKind, CropRect, Track } from "@/db/types";
import { newId } from "@/lib/id";
import { extractCoverMetadataViaWorker } from "@/workers/cover-client";
import type { CoverMetadataResult } from "@/workers/cover-derivative-core";

export const COVER_DERIVATIVE_VERSION = 1;

type CoverDerivativeSource = Pick<CoverDerivative, "sourceKey" | "sourceKind" | "sourceRef">;

export interface ResolvedCoverDerivative {
  blob: Blob;
  blobId: string;
  derivative: CoverDerivative;
}

export interface EnsureCoverDerivativeOptions {
  extract?: (
    input: Parameters<typeof extractCoverMetadataViaWorker>[0],
  ) => Promise<CoverMetadataResult>;
  storage?: MediaBlobStorageOptions;
}

const imageDerivativeInFlight = new Map<string, Promise<ResolvedCoverDerivative | undefined>>();

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

export async function ensureCoverThumbnailDerivative(
  track: Pick<Track, "id" | "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  db: MuzeroDB = defaultDb,
  options: EnsureCoverDerivativeOptions = {},
): Promise<ResolvedCoverDerivative | undefined> {
  return ensureCoverImageDerivative(track, "thumbnail", db, options);
}

export async function ensureCoverBacklightDerivative(
  track: Pick<Track, "id" | "coverBlobId" | "coverCrop" | "remoteCoverUrl">,
  db: MuzeroDB = defaultDb,
  options: EnsureCoverDerivativeOptions = {},
): Promise<ResolvedCoverDerivative | undefined> {
  return ensureCoverImageDerivative(track, "backlight", db, options);
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
  const result = await extract({
    blob: cover.blob,
    crop: input.track.coverCrop,
    mime: cover.mime,
    sourceKey: input.source.sourceKey,
    targets: [input.kind],
  });
  const image = input.kind === "backlight" ? result.backlight : result.thumbnail;
  if (!image) return undefined;
  const derivativeBlob = new Blob([image.bytes], { type: image.mime });
  const media = await putMediaBlob(
    {
      id: newId("blb"),
      trackId: input.source.sourceKey,
      role: "cover-derivative",
      mime: image.mime,
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
    height: image.height,
    kind: input.kind,
    mime: image.mime,
    sourceKey: input.source.sourceKey,
    sourceKind: input.source.sourceKind,
    sourceRef: input.source.sourceRef,
    updatedAt: now,
    version: COVER_DERIVATIVE_VERSION,
    width: image.width,
  };
  await db.coverDerivatives.put(derivative);
  return { blob: derivativeBlob, blobId: media.id, derivative };
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
