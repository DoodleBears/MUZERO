/// <reference lib="webworker" />
/**
 * Off-main-thread heavy worker. Owns the CPU + IndexedDB cost of importing media
 * (music-metadata parse + Dexie write) so the renderer stays responsive during
 * large folder imports. It re-opens the SAME Dexie database (`@/db/muzero-db`
 * instantiates the schema in this context), so writes land in the one store the
 * main thread reads — Dexie's cross-context observability refreshes liveQueries;
 * the `db-changed` ping is a belt-and-suspenders nudge.
 */

import { decodeNcmMediaBytes, type IngestBytesInput, ingestMediaBytes } from "./ingest-core";

type IngestRequest = { type: "ingest"; reqId: number } & IngestBytesInput;
type DecodeNcmRequest = { type: "decode-ncm"; reqId: number } & IngestBytesInput;
type WorkerRequest = IngestRequest | DecodeNcmRequest;

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
    if (msg.type !== "ingest") return;
    const result = await ingestMediaBytes(msg);
    ctx.postMessage({ type: "ingested", reqId: msg.reqId, ...result });
    ctx.postMessage({ type: "db-changed" });
  } catch (err) {
    ctx.postMessage({ type: "ingest-error", reqId: msg.reqId, error: String(err) });
  }
};
