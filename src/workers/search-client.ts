/**
 * Main-thread client for the search Worker. The Worker owns the heavy
 * transliteration dictionaries (pinyin-pro / wanakana) and the per-field variant
 * cache, so dictionary work and large-library scanning stay off the renderer.
 *
 * The main thread pushes the searchable row snapshot (`setSearchRows`) whenever
 * the library changes — cheap strings, infrequent — and sends only the query
 * string per keystroke. When a Worker can't be created (tests / jsdom / failure)
 * it falls back to scanning inline, exactly like `heavy-client` → `ingestMediaBytes`.
 * The inline path is correct but loads the dictionaries on the main thread, so
 * it's the exception, not the norm.
 */

import { type IndexableRow, type QueryHit, queryRows } from "@/lib/search-core";
import { ensureTransliterationLoaded } from "@/lib/search-transliterate";

type Pending = { resolve: (hits: QueryHit[]) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let workerUnavailable = false;
let nextReqId = 1;
const pending = new Map<number, Pending>();

// Mirror of the latest row snapshot, kept for the inline fallback path.
let inlineRows: readonly IndexableRow[] = [];
let inlineLibsRequested = false;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (workerUnavailable || typeof Worker === "undefined") return null;
  try {
    worker = new Worker(new URL("./search-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === "result") {
        pending.get(msg.reqId)?.resolve(msg.hits as QueryHit[]);
        pending.delete(msg.reqId);
      }
    };
    worker.onerror = () => {
      workerUnavailable = true;
      for (const p of pending.values()) p.reject(new Error("search worker crashed"));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

/** Push the current searchable rows (local + remote) to the Worker / inline mirror. */
export function setSearchRows(rows: readonly IndexableRow[]): void {
  inlineRows = rows;
  const w = getWorker();
  if (w) w.postMessage({ type: "set-rows", rows });
}

/** Query the index off-thread, returning ranked hits. Falls back inline. */
export function searchRows(query: string): Promise<QueryHit[]> {
  const w = getWorker();
  if (!w) {
    // No Worker: scan on this thread. Kick off a dictionary load so subsequent
    // calls (after the UI re-queries) gain pinyin/romaji; the first may be
    // substring-only.
    if (!inlineLibsRequested) {
      inlineLibsRequested = true;
      void ensureTransliterationLoaded();
    }
    return Promise.resolve(queryRows(inlineRows, query));
  }
  const reqId = nextReqId++;
  return new Promise<QueryHit[]>((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    w.postMessage({ type: "query", reqId, query });
  });
}

/** Test seam: reset module state between cases. */
export function __resetSearchClientForTests(): void {
  worker = null;
  workerUnavailable = false;
  pending.clear();
  inlineRows = [];
  inlineLibsRequested = false;
}
