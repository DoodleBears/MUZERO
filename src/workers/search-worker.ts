/// <reference lib="webworker" />
/**
 * Off-main-thread search Worker. Owns the transliteration dictionaries
 * (pinyin-pro / wanakana load here, in the Worker's own chunk — never the main
 * bundle) and the per-field variant cache, so phonetic scanning of the whole
 * library never blocks the renderer.
 *
 * It holds the latest row snapshot pushed from the main thread (`set-rows`) and
 * answers `query` messages with ranked hits. The expensive variant computation
 * is memoized in `search-transliterate`, so steady-state queries cost only
 * query-side variants + scoring.
 */

import { type IndexableRow, queryRows } from "@/lib/search-core";
import { ensureTransliterationLoaded } from "@/lib/search-transliterate";

type SetRowsMessage = { type: "set-rows"; rows: IndexableRow[] };
type QueryMessage = { type: "query"; reqId: number; query: string };
type WorkerRequest = SetRowsMessage | QueryMessage;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let rows: readonly IndexableRow[] = [];
// Load the dictionaries once, on startup — off the main thread.
const dictionariesReady = ensureTransliterationLoaded();

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "set-rows") {
    rows = msg.rows;
    return;
  }
  if (msg.type === "query") {
    await dictionariesReady; // first query waits for the dictionaries; then instant
    ctx.postMessage({ type: "result", reqId: msg.reqId, hits: queryRows(rows, msg.query) });
  }
};
