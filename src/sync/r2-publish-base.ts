import type { ZodType } from "zod";
import type { R2LocalCredentials } from "@/db/types";
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import {
  type R2DevicesIndex,
  type R2Manifest,
  type R2PresenceIndex,
  type R2SetIndex,
  type R2StatsIndex,
  r2DevicesIndexSchema,
  r2ManifestSchema,
  r2PresenceIndexSchema,
  r2SetIndexSchema,
  r2StatsIndexSchema,
} from "./r2-manifest-schema";
import { r2SignedFetch } from "./r2-s3";
import type { SyncFetch } from "./r2-subscription";

/**
 * The "remote publish base" for a read-merge-write publish (PRD §12.4): the
 * current remote manifest + discovery indexes, each with its ETag so the
 * subsequent writes can be conditional (`If-Match`). Reads are SIGNED S3 GETs —
 * they work whether or not the bucket has public access (Tier ①-ready).
 *
 * Failure policy: 404 → the object simply doesn't exist yet (first publish);
 * unparseable JSON → treated as absent with a warning (overwriting garbage is
 * the recovery); any other failure → throw, because publishing without the
 * base would blind-overwrite another device's state.
 */
export interface RemoteBaseObject<T> {
  value: T;
  etag?: string;
}

export interface RemotePublishBase {
  manifest?: RemoteBaseObject<R2Manifest>;
  devicesIndex?: RemoteBaseObject<R2DevicesIndex>;
  statsIndex?: RemoteBaseObject<R2StatsIndex>;
  presenceIndex?: RemoteBaseObject<R2PresenceIndex>;
  /** Current remote set indexes by PUBLISHED set id — co-editing merge input (PRD §12.5). */
  setIndexes?: Record<string, RemoteBaseObject<R2SetIndex>>;
}

export interface FetchRemotePublishBaseInput {
  credentials: R2LocalCredentials;
  /** Published set ids whose remote indexes should be fetched for the merge. */
  setRemoteIds?: string[];
  fetcher?: SyncFetch;
  now?: () => Date;
  signal?: AbortSignal;
}

export async function fetchRemotePublishBase(
  input: FetchRemotePublishBaseInput,
): Promise<RemotePublishBase> {
  const fetcher = input.fetcher ?? (await getAppFetch());
  const ctx = { ...input, fetcher };
  const [manifest, devicesIndex, statsIndex, presenceIndex] = await Promise.all([
    readRemoteJson("manifest.json", r2ManifestSchema, ctx),
    readRemoteJson("devices/index.json", r2DevicesIndexSchema, ctx),
    readRemoteJson("stats/index.json", r2StatsIndexSchema, ctx),
    readRemoteJson("presence/index.json", r2PresenceIndexSchema, ctx),
  ]);
  let setIndexes: RemotePublishBase["setIndexes"];
  const setRemoteIds = [...new Set(input.setRemoteIds ?? [])];
  if (setRemoteIds.length > 0) {
    const fetched = await Promise.all(
      setRemoteIds.map((id) => readRemoteJson(`sets/${id}/index.json`, r2SetIndexSchema, ctx)),
    );
    setIndexes = {};
    setRemoteIds.forEach((id, i) => {
      const value = fetched[i];
      if (value && setIndexes) setIndexes[id] = value;
    });
  }
  return { manifest, devicesIndex, statsIndex, presenceIndex, setIndexes };
}

async function readRemoteJson<T>(
  key: string,
  schema: ZodType<T>,
  ctx: FetchRemotePublishBaseInput & { fetcher: SyncFetch },
): Promise<RemoteBaseObject<T> | undefined> {
  const response = await r2SignedFetch({
    fetcher: ctx.fetcher,
    credentials: ctx.credentials,
    method: "GET",
    key,
    contentType: "application/json",
    now: ctx.now,
    signal: ctx.signal,
  });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(`Failed to read publish base ${key}: HTTP ${response.status}`);
  }
  const etag = response.headers.get("etag") ?? undefined;
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    log.warn("sync", "publish base object is not JSON; treating as absent", { key });
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    log.warn("sync", "publish base object failed schema validation; treating as absent", { key });
    return undefined;
  }
  return { value: parsed.data, etag };
}
