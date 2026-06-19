/**
 * Main-thread client for the heavy worker. Sends file bytes (transferred,
 * zero-copy) to the worker for parse + DB-write, keeping that cost off the
 * renderer's main thread. Falls back to running the ingest core inline when a
 * Worker isn't available (tests, or if worker creation fails) so imports always
 * work — just without the off-thread benefit.
 */

import {
  createReferencedUploadedTracks,
  insertTrackIdsAfter,
  listTrackSourcePathRefs,
} from "@/db/repositories";
import {
  buildReferencedUploadedTrackInputs,
  type CreateReferencedTracksInput,
  type CreateReferencedTracksResult,
  type FolderSyncPlanDbInput,
  type FolderSyncPlanResult,
  type PublishTrackIdsInput,
  type PublishTrackIdsResult,
  planFolderSyncFiles,
} from "./folder-sync-core";
import {
  type DecodedNcmMedia,
  type DecodedNcmMetadata,
  decodeNcmMediaBytes,
  decodeNcmMetadataBytes,
  type IngestBytesInput,
  type IngestResult,
  ingestMediaBytes,
} from "./ingest-core";

type WorkerResult =
  | CreateReferencedTracksResult
  | DecodedNcmMedia
  | DecodedNcmMetadata
  | FolderSyncPlanResult
  | IngestResult
  | PublishTrackIdsResult;
type Pending = { resolve: (r: WorkerResult) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let workerUnavailable = false;
let nextReqId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./heavy-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === "ingested") {
        pending.get(msg.reqId)?.resolve({
          trackId: msg.trackId,
          albumPicUrl: msg.albumPicUrl,
          hasCover: Boolean(msg.hasCover),
        });
        pending.delete(msg.reqId);
      } else if (msg?.type === "decoded-ncm") {
        pending.get(msg.reqId)?.resolve({
          title: msg.title,
          mime: msg.mime,
          durationSec: msg.durationSec,
          mediaMetadata: msg.mediaMetadata,
          audio: msg.audio,
          embeddedCover: msg.embeddedCover,
          albumPicUrl: msg.albumPicUrl,
          hasCover: Boolean(msg.hasCover),
        });
        pending.delete(msg.reqId);
      } else if (msg?.type === "decoded-ncm-metadata") {
        pending.get(msg.reqId)?.resolve({
          title: msg.title,
          mime: msg.mime,
          durationSec: msg.durationSec,
          mediaMetadata: msg.mediaMetadata,
          embeddedCover: msg.embeddedCover,
          albumPicUrl: msg.albumPicUrl,
          hasCover: Boolean(msg.hasCover),
        });
        pending.delete(msg.reqId);
      } else if (msg?.type === "folder-sync-planned") {
        pending.get(msg.reqId)?.resolve(msg.result);
        pending.delete(msg.reqId);
      } else if (msg?.type === "referenced-tracks-created") {
        pending.get(msg.reqId)?.resolve({ trackIds: msg.trackIds });
        pending.delete(msg.reqId);
      } else if (msg?.type === "track-ids-published") {
        pending.get(msg.reqId)?.resolve({ afterTrackId: msg.afterTrackId });
        pending.delete(msg.reqId);
      } else if (msg?.type === "ingest-error") {
        pending.get(msg.reqId)?.reject(new Error(msg.error));
        pending.delete(msg.reqId);
      }
      // `db-changed` relies on Dexie's cross-context liveQuery refresh; no action.
    };
    worker.onerror = () => {
      // Fail every in-flight request; future calls take the inline fallback.
      workerUnavailable = true;
      for (const p of pending.values()) p.reject(new Error("heavy worker crashed"));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

/** Ingest one file's bytes — in the worker when possible, else inline on this thread. */
export function ingestViaWorker(input: IngestBytesInput): Promise<IngestResult> {
  const w = getWorker();
  if (!w) return ingestMediaBytes(input);
  const reqId = nextReqId++;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve: resolve as (r: WorkerResult) => void, reject });
    w.postMessage({ type: "ingest", reqId, ...input }, [input.bytes]);
  });
}

/** Decode one `.ncm` in the worker, leaving DB/media persistence to the caller. */
export function decodeNcmViaWorker(input: IngestBytesInput): Promise<DecodedNcmMedia> {
  const w = getWorker();
  if (!w) return decodeNcmMediaBytes(input);
  const reqId = nextReqId++;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve: resolve as (r: WorkerResult) => void, reject });
    w.postMessage({ type: "decode-ncm", reqId, ...input }, [input.bytes]);
  });
}

/** Parse one `.ncm`'s metadata in the worker without decrypting the audio payload. */
export function decodeNcmMetadataViaWorker(input: IngestBytesInput): Promise<DecodedNcmMetadata> {
  const w = getWorker();
  if (!w) return decodeNcmMetadataBytes(input);
  const reqId = nextReqId++;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve: resolve as (r: WorkerResult) => void, reject });
    w.postMessage({ type: "decode-ncm-metadata", reqId, ...input }, [input.bytes]);
  });
}

/** Plan folder-sync dedup/recovery in the worker when available. */
export async function planFolderSyncViaWorker(
  input: FolderSyncPlanDbInput,
): Promise<FolderSyncPlanResult> {
  const w = getWorker();
  if (!w) {
    const existingRefs = await listTrackSourcePathRefs(input.media.map((file) => file.path));
    return planFolderSyncFiles({ ...input, existingRefs });
  }
  const reqId = nextReqId++;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve: resolve as (r: WorkerResult) => void, reject });
    w.postMessage({ type: "folder-sync-plan-db", reqId, input });
  });
}

/** Create reference-only uploaded Track rows in the worker when possible. */
export async function createReferencedTracksViaWorker(
  input: CreateReferencedTracksInput,
): Promise<CreateReferencedTracksResult> {
  if (input.files.length === 0) return { trackIds: [] };
  const w = getWorker();
  if (!w) {
    const tracks = await createReferencedUploadedTracks(buildReferencedUploadedTrackInputs(input));
    return { trackIds: tracks.map((track) => track.id) };
  }
  const reqId = nextReqId++;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve: resolve as (r: WorkerResult) => void, reject });
    w.postMessage({ type: "create-referenced-tracks", reqId, input });
  });
}

/** Publish imported track ids into a set in the worker when possible. */
export async function publishTrackIdsViaWorker(
  input: PublishTrackIdsInput,
): Promise<PublishTrackIdsResult> {
  if (input.ids.length === 0) return { afterTrackId: input.afterTrackId };
  const nextAfterTrackId = input.ids.at(-1) ?? input.afterTrackId;
  const w = getWorker();
  if (!w) {
    await insertTrackIdsAfter(input.setId, input.ids, input.afterTrackId);
    return { afterTrackId: nextAfterTrackId };
  }
  const reqId = nextReqId++;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve: resolve as (r: WorkerResult) => void, reject });
    w.postMessage({ type: "publish-track-ids", reqId, input });
  });
}
