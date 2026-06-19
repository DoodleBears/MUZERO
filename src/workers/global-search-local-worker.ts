/// <reference lib="webworker" />

import { MuzeroDB } from "@/db/muzero-db";
import { ensureTransliterationLoaded } from "@/lib/search-transliterate";
import type { GlobalSearchLocalInput } from "./global-search-local-core";
import { buildGlobalSearchLocalResults } from "./global-search-local-core";

type SearchMessage = { input: GlobalSearchLocalInput; reqId: number; type: "search-local" };
type WorkerRequest = SearchMessage;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const db = new MuzeroDB();
const dictionariesReady = ensureTransliterationLoaded();

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type !== "search-local") return;
  const startedAt = performance.now();
  try {
    await dictionariesReady;
    const [tracks, memories] = await Promise.all([db.tracks.toArray(), db.memories.toArray()]);
    const results = buildGlobalSearchLocalResults(tracks, memories, msg.input);
    ctx.postMessage({
      durationMs: performance.now() - startedAt,
      reqId: msg.reqId,
      results,
      rows: tracks.length,
      type: "search-local-result",
    });
  } catch (error) {
    ctx.postMessage({
      message: error instanceof Error ? error.message : "Global local search worker failed",
      name: error instanceof Error ? error.name : "Error",
      reqId: msg.reqId,
      type: "error",
    });
  }
};
