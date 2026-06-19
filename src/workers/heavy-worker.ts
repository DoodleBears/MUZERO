/// <reference lib="webworker" />
/**
 * Off-main-thread heavy worker. Owns the CPU + IndexedDB cost of importing media
 * (music-metadata parse + Dexie write) so the renderer stays responsive during
 * large folder imports. It re-opens the SAME Dexie database (`@/db/muzero-db`
 * instantiates the schema in this context), so writes land in the one store the
 * main thread reads — Dexie's cross-context observability refreshes liveQueries;
 * the `db-changed` ping is a belt-and-suspenders nudge.
 */

import {
  createReferencedUploadedTracks,
  insertTrackIdsAfter,
  listTrackSourcePathRefs,
} from "@/db/repositories";
import {
  buildReferencedUploadedTrackInputs,
  type CreateReferencedTracksInput,
  type FolderSyncPlanInput,
  type PublishTrackIdsInput,
  planFolderSyncFiles,
} from "./folder-sync-core";
import {
  decodeNcmMediaBytes,
  decodeNcmMetadataBytes,
  type IngestBytesInput,
  ingestMediaBytes,
} from "./ingest-core";

type IngestRequest = { type: "ingest"; reqId: number } & IngestBytesInput;
type DecodeNcmRequest = { type: "decode-ncm"; reqId: number } & IngestBytesInput;
type DecodeNcmMetadataRequest = { type: "decode-ncm-metadata"; reqId: number } & IngestBytesInput;
type FolderSyncPlanRequest = {
  type: "folder-sync-plan";
  reqId: number;
  input: FolderSyncPlanInput;
};
type FolderSyncPlanDbRequest = {
  type: "folder-sync-plan-db";
  reqId: number;
  input: Omit<FolderSyncPlanInput, "existingRefs">;
};
type CreateReferencedTracksRequest = {
  type: "create-referenced-tracks";
  reqId: number;
  input: CreateReferencedTracksInput;
};
type PublishTrackIdsRequest = {
  type: "publish-track-ids";
  reqId: number;
  input: PublishTrackIdsInput;
};
type WorkerRequest =
  | CreateReferencedTracksRequest
  | DecodeNcmMetadataRequest
  | DecodeNcmRequest
  | FolderSyncPlanDbRequest
  | FolderSyncPlanRequest
  | IngestRequest
  | PublishTrackIdsRequest;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "decode-ncm") {
      const result = await decodeNcmMediaBytes(msg);
      const transfers = result.embeddedCover
        ? [result.audio, result.embeddedCover.bytes]
        : [result.audio];
      ctx.postMessage({ type: "decoded-ncm", reqId: msg.reqId, ...result }, transfers);
      return;
    }
    if (msg.type === "decode-ncm-metadata") {
      const result = await decodeNcmMetadataBytes(msg);
      const transfers = result.embeddedCover ? [result.embeddedCover.bytes] : [];
      ctx.postMessage({ type: "decoded-ncm-metadata", reqId: msg.reqId, ...result }, transfers);
      return;
    }
    if (msg.type === "folder-sync-plan") {
      const result = planFolderSyncFiles(msg.input);
      ctx.postMessage({ type: "folder-sync-planned", reqId: msg.reqId, result });
      return;
    }
    if (msg.type === "folder-sync-plan-db") {
      const existingRefs = await listTrackSourcePathRefs(msg.input.media.map((file) => file.path));
      const result = planFolderSyncFiles({ ...msg.input, existingRefs });
      ctx.postMessage({ type: "folder-sync-planned", reqId: msg.reqId, result });
      return;
    }
    if (msg.type === "create-referenced-tracks") {
      const tracks = await createReferencedUploadedTracks(
        buildReferencedUploadedTrackInputs(msg.input),
      );
      ctx.postMessage({
        type: "referenced-tracks-created",
        reqId: msg.reqId,
        trackIds: tracks.map((track) => track.id),
      });
      ctx.postMessage({ type: "db-changed" });
      return;
    }
    if (msg.type === "publish-track-ids") {
      await insertTrackIdsAfter(msg.input.setId, msg.input.ids, msg.input.afterTrackId);
      ctx.postMessage({
        type: "track-ids-published",
        reqId: msg.reqId,
        afterTrackId: msg.input.ids.at(-1) ?? msg.input.afterTrackId,
      });
      ctx.postMessage({ type: "db-changed" });
      return;
    }
    if (msg.type !== "ingest") return;
    const result = await ingestMediaBytes(msg);
    ctx.postMessage({ type: "ingested", reqId: msg.reqId, ...result });
    ctx.postMessage({ type: "db-changed" });
  } catch (err) {
    ctx.postMessage({ type: "ingest-error", reqId: msg.reqId, error: String(err) });
  }
};
