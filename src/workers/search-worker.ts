/// <reference lib="webworker" />
/**
 * Off-main-thread search Worker. Owns the transliteration dictionaries
 * (pinyin-pro / wanakana load here, in the Worker's own chunk — never the main
 * bundle) and a precomputed-variant index ({@link createSearchIndex}), so all
 * field transliteration happens once at `set-rows` time and queries are a plain
 * linear scan over stored variants — never re-transliterating per keystroke
 * (PRD Phase 3, kills the ~3s typing latency).
 *
 * `set-rows` diffs the incoming snapshot against the index and rebuilds only the
 * delta, so a library change never re-transliterates the whole library. The
 * build waits for the dictionaries first, so stored variants are always the full
 * pinyin/kana set (never the degraded normalize-only fallback). Build stats are
 * posted back for the client to log (PRD §4 cold/incremental build metrics).
 */

import type { IndexableRow } from "@/lib/search-core";
import { ensureTransliterationLoaded } from "@/lib/search-transliterate";
import { createSearchIndex } from "./search-index";

type SetRowsMessage = { type: "set-rows"; rows: IndexableRow[] };
type QueryMessage = { type: "query"; reqId: number; query: string };
type WorkerRequest = SetRowsMessage | QueryMessage;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const index = createSearchIndex();
// Load the dictionaries once, on startup — off the main thread.
const dictionariesReady = ensureTransliterationLoaded();

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "set-rows") {
    // Build with the FULL dictionaries so stored variants never get frozen at
    // the degraded normalize-only fallback (the cache is cleared on dict load).
    await dictionariesReady;
    const startedAt = performance.now();
    const delta = index.setRows(msg.rows);
    ctx.postMessage({
      type: "index-stats",
      buildMs: performance.now() - startedAt,
      size: index.size(),
      ...delta,
    });
    return;
  }
  if (msg.type === "query") {
    await dictionariesReady; // first query waits for the dictionaries; then instant
    // Time the pure scan so the client can aggregate `worker queryDuration`
    // separately from end-to-end latency (PRD Phase 1 observability).
    const startedAt = performance.now();
    const hits = index.query(msg.query);
    const durationMs = performance.now() - startedAt;
    ctx.postMessage({ type: "result", reqId: msg.reqId, hits, durationMs });
  }
};
