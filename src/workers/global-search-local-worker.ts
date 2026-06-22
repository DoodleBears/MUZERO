/// <reference lib="webworker" />

import { MuzeroDB } from "@/db/muzero-db";
import { buildKanjiTokenizer } from "@/lib/kuromoji-tokenizer";
import { log } from "@/lib/logger";
import { ensureTransliterationLoaded, setKanjiTokenizer } from "@/lib/search-transliterate";
import type { GlobalSearchLocalInput } from "./global-search-local-core";
import { buildGlobalSearchLocalResults } from "./global-search-local-core";

type SearchMessage = { input: GlobalSearchLocalInput; reqId: number; type: "search-local" };
type WorkerRequest = SearchMessage;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const db = new MuzeroDB();
const dictionariesReady = ensureTransliterationLoaded();

// Japanese kanji readings (kuromoji, ~17MB IPADIC dict) load in the BACKGROUND after the
// lighter pinyin/kana dicts — non-blocking, so the first search returns immediately with
// pinyin + kana romaji, and pure-kanji JP romaji (桜 → sakura) "snaps in" once the tokenizer
// is ready (setKanjiTokenizer clears the variant cache so the next search recomputes). A
// failed dict load degrades to pinyin-only, never breaks search.
void dictionariesReady.then(() =>
  buildKanjiTokenizer()
    .then((tokenize) => setKanjiTokenizer(tokenize))
    .catch((error) => log.warn("search", "kuromoji (JP kanji readings) failed to load", { error })),
);

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
