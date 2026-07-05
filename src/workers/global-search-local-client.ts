import { db } from "@/db/muzero-db";
import { notePerfWork } from "@/lib/perf-counters";
import { ensureTransliterationLoaded } from "@/lib/search-transliterate";
import {
  buildGlobalSearchLocalResults,
  type GlobalSearchLocalInput,
  type GlobalSearchLocalResults,
} from "./global-search-local-core";

type Pending = {
  input: GlobalSearchLocalInput;
  reject: (error: Error) => void;
  resolve: (results: GlobalSearchLocalResults) => void;
  startedAt: number;
};

type WorkerResultMessage = {
  durationMs?: number;
  reqId: number;
  results: GlobalSearchLocalResults;
  rows?: number;
  type: "search-local-result";
};
type WorkerErrorMessage = {
  message?: string;
  name?: string;
  reqId: number;
  type: "error";
};
type WorkerResponse = WorkerResultMessage | WorkerErrorMessage;

let worker: Worker | null = null;
let workerUnavailable = false;
let nextReqId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./global-search-local-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const entry = pending.get(msg.reqId);
      if (!entry) return;
      pending.delete(msg.reqId);
      if (msg.type === "search-local-result") {
        notePerfWork("globalSearch.localWorker", performance.now() - entry.startedAt, {
          albums: msg.results.albums.length,
          artists: msg.results.artists.length,
          rows: msg.rows ?? 0,
          tracks: msg.results.trackIds.length,
          workerMs: msg.durationMs ?? 0,
        });
        entry.resolve(msg.results);
        return;
      }
      entry.reject(
        Object.assign(new Error(msg.message ?? "Global local search worker failed"), {
          name: msg.name ?? "Error",
        }),
      );
    };
    worker.onerror = () => {
      workerUnavailable = true;
      for (const entry of pending.values()) entry.reject(new Error("Global local search crashed"));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

export async function searchGlobalLocalLibrary(
  input: GlobalSearchLocalInput,
): Promise<GlobalSearchLocalResults> {
  const w = getWorker();
  if (!w) return searchGlobalLocalLibraryInline(input);
  const reqId = nextReqId++;
  return new Promise<GlobalSearchLocalResults>((resolve, reject) => {
    pending.set(reqId, { input, reject, resolve, startedAt: performance.now() });
    w.postMessage({ input, reqId, type: "search-local" });
  }).catch(() => searchGlobalLocalLibraryInline(input));
}

async function searchGlobalLocalLibraryInline(
  input: GlobalSearchLocalInput,
): Promise<GlobalSearchLocalResults> {
  const startedAt = performance.now();
  await ensureTransliterationLoaded();
  const [tracks, memories, trackPlaybackStats] = await Promise.all([
    db.tracks.toArray(),
    db.memories.toArray(),
    db.trackPlaybackStats.toArray(),
  ]);
  const results = buildGlobalSearchLocalResults(tracks, memories, { ...input, trackPlaybackStats });
  notePerfWork("globalSearch.localInline", performance.now() - startedAt, {
    albums: results.albums.length,
    artists: results.artists.length,
    rows: tracks.length,
    tracks: results.trackIds.length,
  });
  return results;
}

export function __resetGlobalSearchLocalClientForTests(): void {
  worker = null;
  workerUnavailable = false;
  nextReqId = 1;
  pending.clear();
}
