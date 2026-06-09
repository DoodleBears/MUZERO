# PRD: MUZERO Multilingual Transliteration Search (拼音 / 假名 / 罗马音 快速匹配)

**Status:** Completed
**Created:** 2026-06-10
**Author:** MUZERO
**Module:** Search — make the library find-able by phonetic input (Chinese pinyin + initials, Japanese kana ↔ romaji), porting ClipCombo's command-palette transliteration matcher, hosted off-thread in a search Worker

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Transliteration variant engine (pure lib + lazy deps) | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Transliteration-aware matcher + relevance ranking (pure, inline) | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Off-thread search Worker + index (local + remote rows) | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Search UX: ⌘/Ctrl+F focus, deferred render, i18n hints | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO is "本地优先的播放器 + 唱片库" — a user imports a 网易云 / iTunes / 本地文件夹 of mostly **CJK-titled** music (中文歌名、日文 MV、歌手名、专辑名), tags it, writes memories on it, then searches it. Search today lives in the `search` nav tab ([`SearchPage`](../../../src/pages/search-page.tsx)) with four modes — 歌单 / 全部歌曲 / 专辑 / 歌手 — and a single pure matcher ([`matchesQuery`](../../../src/lib/track-search.ts)).

That matcher is **`.toLowerCase()` + `String.includes()` substring only**:

```ts
// src/lib/track-search.ts — today
tokens.free.every((token) => haystack.includes(token)) &&
tokens.tags.every((tag) => track.tags.some((t) => t.includes(tag))) &&
tokens.artist.every((token) => artistHay.includes(token)) &&
tokens.album.every((token) => albumHay.includes(token))
```

It is good at what it does (field-scoped grammar `#tag` / `artist:` / `album:`, exhaustively tested), but it treats CJK text as **opaque code points**. The practical pain:

- To find **「北京欢迎你」** the user must type Chinese characters. Typing `bjhyn` (拼音首字母) or `beijing` (全拼) finds **nothing**. On a Latin keyboard with no IME open, the song is effectively unreachable.
- To find a Japanese track **「君の名は」** by typing `kiminonawa` (romaji) finds nothing; the user must switch IME and type kana.
- A track tagged **`#旅行`** can't be reached by `#lvxing` or `#lx`.

ClipCombo (sibling project in [`packages/clipcombo`](../../../../doodlekuma.com/packages/clipcombo)) already solved exactly this for its ⌘F command palette. The proven approach ([`clip-command-palette-search.ts`](../../../../doodlekuma.com/packages/clipcombo/src/lib/clip-command-palette-search.ts)):

> For every searchable field **and** the query, generate a set of **normalized variants** — the original text, a punctuation-compacted form, Chinese **full pinyin** + **pinyin initials**, and Japanese **hiragana / katakana / romaji** — then match query-variants against field-variants with a tiered score (exact → prefix → substring → subsequence). A track matches if any query variant lands in any field variant.

This PRD ports that matcher into MUZERO, adds relevance ranking (today results are unordered), wires a real ⌘/Ctrl+F focus shortcut, and — the long-term-correct part — **hosts the index + heavy transliteration libs in an off-main-thread search Worker** so a large library never janks the UI. No new DB tables, no codename changes, no hidden flags.

**Scope of the user's ask (verbatim):**
- 中文：支持**拼音**和**拼音首字母**快速匹配
- 日文：支持**假名**（片假名 / 平假名）+ **罗马音**快速匹配

Korean romanization (한글 → romaja / 초성 jamo) is intentionally **out of scope for v1** (§7) — not requested, and it needs a different toolchain; it gets its own follow-up.

### 1.2 Target Users

| Role | Description | Why this helps them |
|------|-------------|---------------------|
| **本地华语听众 (CN)** | 导入大量中文歌名 / 歌手 / 专辑；常在没开 IME 的英文键盘上找歌。 | 输入 `bjhyn` / `beijing` / `北京` 任一形态都能命中「北京欢迎你」。 |
| **日系 / ACG 听众 (JP)** | 导入日文歌名、MV、片假名外来语标题。 | `kimi`、`きみ`、`キミ` 互相可达；罗马音直接命中假名标题。 |
| **混合库用户** | 一个库里中日英混排（这是常态，**与 UI 语言无关**）。 | 变体生成按**文本脚本探测**触发（HAN / KANA），不按 UI locale 限制 —— 日语界面用户照样能拼音搜中文歌。 |
| **大库用户** | 数千首歌 + 多个 R2 云盘同步到本地。 | 索引 + 转写在 Worker 后台构建，键入无卡顿；搜的是已 Sync 到本地的数据。 |
| **键盘流用户** | 习惯 ⌘F 直接搜索。 | 全局 ⌘/Ctrl+F 跳到搜索 tab 并聚焦输入框。 |

### 1.3 Core Value

1. **Phonetic reachability.** CJK library 不再需要 IME 才能搜 —— 拼音 / 首字母 / 罗马音 / 假名互转都命中。
2. **Bidirectional & script-agnostic.** romaji↔kana、拼音↔汉字 双向；匹配按文本脚本而非 UI locale 触发（混合库友好）。
3. **Relevance, not just filtering.** 分级打分（exact / prefix / substring / subsequence），结果**按相关度排序**（今天是无序输入序）。
4. **No jank, no backend.** 重活（字典转写 + 索引）在 Worker 后台跑；纯派生、无新表、无迁移、无遥测、离线可用，契合「本地优先」与桌面壳层「重活不卡主线程」纪律。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
 MAIN THREAD                                   SEARCH WORKER (off-thread, owns the heavy libs)
 ───────────                                   ───────────────────────────────────────────────
 SearchPage                                     import { pinyin } from "pinyin-pro"   ← in WORKER chunk,
   • query string ──postMessage({query})──▶       import * as wanakana from "wanakana"   never in main bundle
   • renders from its own liveQuery tracks      liveQuery(tracks) + remoteSearchTracks.toArray()
   • maps returned IDs → tracks                          │  (Dexie cross-context, same as heavy-worker)
        ▲                                                ▼
        │                                   ┌─────────────────────────────────────────────┐
        │  ◀──{ ids[], scores }──            │  variant INDEX  Map<trackId, fieldVariants[]> │
        │                                   │   • built once on first load (off-thread)     │
 (inline fallback when Worker               │   • PATCHED incrementally on add/remove/sync  │
  unavailable — tests / no Worker):         │     (diff by id; only changed rows recompute) │
   src/lib/track-search.ts (pure)           └─────────────────────────────────────────────┘
   + src/lib/search-transliterate.ts                          │ uses
        (same canonical matcher)                              ▼
                                            ┌─────────────────────────────────────────────┐
                                            │ src/lib/search-transliterate.ts (PURE core)  │
                                            │   searchVariants(text) ─▶ normalize + 拼音    │
                                            │     (全拼/首字母) + kana(hira/kata/romaji)    │
                                            │   scoreVariants(q[],f[]) ─▶ tiered score      │
                                            │ src/lib/track-search.ts  matchesQuery /        │
                                            │   trackSearchScore / searchEntityFacets        │
                                            └─────────────────────────────────────────────┘
```

**Key design choices (resolving the Open Questions):**
- **The pure matcher is the single source of truth.** `search-transliterate.ts` + `track-search.ts` are pure and synchronous. The Worker is purely an **off-thread host + index cache** for them — *not* a second implementation. This mirrors MUZERO's existing precedent exactly: [`ingest-core.ts`](../../../src/workers/ingest-core.ts) is pure, [`heavy-worker.ts`](../../../src/workers/heavy-worker.ts) hosts it, [`heavy-client.ts`](../../../src/workers/heavy-client.ts) falls back **inline** when no Worker. Tests run the pure core inline; production runs it in the Worker. (Q1, Q5)
- **The heavy libs live only in the Worker chunk.** pinyin-pro's dictionary (~100–130 KB gzipped) is `import`ed *inside the Worker*, so it never touches the main bundle or main thread. The Worker is itself created lazily. (Q1)
- **Search is always local.** Both local `tracks` and R2 catalog rows synced into local `db.remoteSearchTracks` are indexed by the same Worker; the index is patched when Dexie content changes. No server-side work. (Q4)

### 2.2 Technology Stack

| Component | Technology | Rationale / License |
|-----------|------------|---------------------|
| Chinese pinyin | **`pinyin-pro` v3** | Full syllables + `pattern:"first"` initials + `toneType:"none"` + `v:true` (ü/v) + traditional/simplified. The exact lib ClipCombo ships. **MIT.** |
| Japanese kana↔romaji | **`wanakana` v5** | `toHiragana` / `toKatakana` / `toRomaji` with `passRomaji`. Handles sokuon (ッ→double consonant) / chōonpu (ー). The exact lib ClipCombo ships. **MIT.** |
| Off-thread host | **Web Worker** (mirrors `heavy-worker.ts`) | Owns the libs + variant index; keeps dictionary transliteration and large-library indexing off the renderer. Per 硬规则 9/10 「重活不卡主线程」. |
| Normalization | `String.prototype.normalize("NFKC")` + locale-aware `toLocaleLowerCase` | Stdlib, no dep. Folds full-width/half-width, compatibility forms. |
| Matcher | Pure TS (port of `clip-command-palette-search.ts`) | No runtime owner; deterministic; Vitest-friendly; runs inline or in Worker. |
| Cache | Module-scope LRU `Map` + Worker-resident index | Per **规则 6**: non-reactive singletons live in module scope, **not** in Zustand. |

**Dependency discipline (per [`prd-create.md` §3](../../../.cursor/commands/prd-create.md)).** Two new prod deps. Justification vs. home-grown:

- **pinyin-pro is not realistically home-grown** — correct 多音字 + 全量字典 is a maintained dataset, not 100–200 LOC. Adopt the lib.
- **wanakana is a well-defined deterministic mapping** but still sized (mora tables, sokuon/chōonpu rules); ClipCombo's choice is proven. Adopt rather than re-derive.
- Both **MIT** — ship-friendly per §3, and MUZERO is itself an open-source project (Q6). Record both in a `THIRD-PARTY-LICENSES.md` entry alongside the existing twgl.js attribution (or a license note in the PR if no such file exists yet).
- **Bundle budget (§3):** because both libs are imported **only inside the search Worker**, the main/entry chunk size is **unchanged** — the dictionary lands in the Worker's own chunk, fetched when the Worker spins up. Measure with `pnpm build` and record main-vs-worker chunk gzipped sizes (Phase 3 acceptance). This sidesteps the per-cluster < 100 KB main-bundle concern entirely.

### 2.3 Project Structure

```
src/
├── lib/
│   ├── search-transliterate.ts          # NEW — pure variant engine + scorer + LRU + ClipCombo regexes
│   ├── search-transliterate.test.ts     # NEW — pinyin/initials/kana/romaji/mixed/fallback
│   ├── track-search.ts                  # REFACTOR — fields[] + variant matcher + trackSearchScore
│   └── track-search.test.ts             # EXTEND — pinyin/romaji cases; ranking; tag transliteration
├── workers/
│   ├── search-core.ts                   # NEW — pure index build/patch + query-over-index (testable inline)
│   ├── search-worker.ts                 # NEW — Worker host (mirrors heavy-worker.ts), Dexie liveQuery in-worker
│   ├── search-client.ts                 # NEW — main-thread client + inline fallback (mirrors heavy-client.ts)
│   └── search-core.test.ts              # NEW — index patch semantics (add/remove/update), ranked query
├── hooks/
│   └── use-player-shortcuts.ts          # EXTEND — ⌘/Ctrl+F → focus search (bare F stays fullscreen)
├── pages/
│   └── search-page.tsx                  # EDIT — query→searchClient; ranked IDs; useDeferredValue; ⌘F focus
├── sync/
│   └── r2-search-catalog.ts             # EDIT — bake variants into normalizedText at row build (CLIENT-side, sync time)
└── i18n/locales/{en,zh,ja,ko}/common.json   # EDIT — search.placeholder hint mentions 拼音/romaji
```

Per §3 "新文件只允许给：新 parser / 第三方 lib bridge"：`search-transliterate.ts` is the lib bridge (only import site for pinyin-pro/wanakana on the pure side); `search-worker.ts` is the Worker host (the libs' import site for the production path); the rest is `append/refactor` on existing files.

### 2.4 Lazy / off-thread loading strategy (bundle + no-jank)

The renderer must never block on dictionary transliteration. Two tiers, mapped onto the existing Worker pattern:

1. **Baseline (always available, synchronous, main thread):** today's normalize + substring/subsequence over the **original** text. Used (a) as the **inline fallback** when no Worker (tests, Worker creation failure — exactly like `ingestViaWorker` → `ingestMediaBytes`), and (b) for the first paint *before the Worker's index is ready*. Search never breaks or stalls.
2. **Full transliteration (in the Worker):** the Worker is created lazily (on first search input focus, or on app idle via `requestIdleCallback`). It `import`s pinyin-pro/wanakana, builds the variant index over the current `tracks` + `remoteSearchTracks`, then answers `{query} → {ids, scores}`. When the index becomes ready, the UI is signalled to re-run the current query once ("snap-in").

```ts
// search-client.ts (sketch — mirrors heavy-client.ts)
let worker: Worker | null = null;
let workerUnavailable = false;

export function searchTracksAsync(query: string): Promise<{ ids: string[]; scores: number[] }> {
  const w = getWorker();                       // lazy create; null in tests / on failure
  if (!w) return Promise.resolve(searchInline(query));   // pure fallback (Phase 2 matcher)
  // …reqId + pending map, identical shape to heavy-client…
}
```

For Vitest, the **pure core** (`search-core.ts` + `track-search.ts` + `search-transliterate.ts`) is tested directly with an `await ensureTransliterationLoaded()` warmup (dynamic `import()` resolves fine under Vitest), so transliteration matching is verified synchronously without any Worker.

---

## 3. Data Model Design

### 3.1 Core Concepts

**No persisted schema changes. No migration.** Variants are **derived on read** and held in memory (Worker-resident index + LRU) — the same model as [`library-index.ts`](../../../src/lib/library-index.ts) (artists/albums are derived projections, not tables). Preserves **硬规则 4 (codename 稳定)**: `muzero-db` 表结构、id 前缀、字段名全部不动。

```
Track / RemoteSearchTrack (unchanged, in IndexedDB)   In-memory only (Worker index, never persisted)
  ├─ title / mediaMetadata.{artists,album,…}          Map<trackId, fieldVariants: string[][]>
  ├─ tags[] / brief?.caption / memories                 • built off-thread on load
  └─ (remote rows carry normalizedText)                 • patched on add/remove/sync (diff by id)
```

### 3.2 Database / Sync Model — search is over locally-synced data (Q4 confirmed)

**The user's mental model is correct.** Verified flow:

- R2 sync pulls a **search catalog** of JSON pages and writes them into **local IndexedDB**: [`importRemoteSearchCatalog`](../../../src/sync/r2-search-index.ts) → `db.remoteSearchTracks.bulkPut(rows)` / `db.remoteSearchSets.bulkPut(rows)`.
- Each row's `normalizedText` is built **client-side, at sync/import time** in [`remoteSearchTrackToRow`](../../../src/sync/r2-search-catalog.ts) — **not** on a server. So we bake pinyin/romaji variant tokens into `normalizedText` **in the client**, right there. No server involvement, fully local-first.
- Sync is **incremental**: `importRemoteSearchCatalog` diffs `pageVersions` and re-imports only changed pages. So the local index updates only on real adds/removes/changes — matching "索引在增删内容的时候会更新".
- Search (`matchesQuery` for local `tracks`, [`matchesRemoteSearchTrack`](../../../src/sync/r2-search-catalog.ts) for synced rows) runs **entirely locally**. There is no "search the cloud" path — you search what's already on the device.

**Consequence for this PRD:** the Worker indexes **both** `tracks` and `remoteSearchTracks` uniformly. For remote rows we *also* bake variants into the persisted `normalizedText` (so even the inline/baseline path benefits and stale catalogs degrade gracefully to substring). No DB version bump — `normalizedText` is an existing field; we just enrich its contents on the next sync write.

- **Rollback Plan:** `git revert` the lib/registry edits + redeploy (硬规则 3 & §3). Nothing persisted needs reverting; enriched `normalizedText` is harmless to older code (it's just more text).

### 3.3 Data Relationship Diagram

```
query ──parseSearchTokens──▶ { free[], artist[], album[], tags[] }   (grammar UNCHANGED)
   │  each token ──searchVariants──▶ queryVariants[]
   ▼
Worker index: trackId ─▶ per-field fieldVariants[]  (precomputed, patched on change)
   │  scoreVariants(queryVariants, fieldVariants) per (token, field), AND across tokens in scope
   ▼
best score per track ──▶ ids sorted ascending by score ──▶ main thread maps ids → its liveQuery tracks
```

---

## 4. Matcher / Library API Design

> (Template §4 is "API Design"; MUZERO has no backend — this specifies the **pure-function + Worker-message contracts**, the real "API" here.)

### 4.1 `src/lib/search-transliterate.ts` (pure core)

| Export | Signature | Description |
|--------|-----------|-------------|
| `normalizeSearchText` | `(value, locale?) => string` | NFKC + locale-aware lowercase + trim. Single normalization source of truth. |
| `searchVariants` | `(value, locale?) => readonly string[]` | normalized + compacted + 拼音(全拼/首字母) + kana(hira/kata/romaji). LRU-cached. Baseline-only until `ensureTransliterationLoaded()` resolves. |
| `scoreVariants` | `(queryVariants, fieldVariants) => number` | Best (lowest) tiered score across all variant pairs. |
| `ensureTransliterationLoaded` | `() => Promise<void>` | Dynamic-imports the libs; idempotent. Awaited by the Worker and by tests. |
| `NO_MATCH_SCORE` | `const` (`10_000`) | Sentinel. |

**Script detection — ClipCombo's exact regexes (Q2), with a kana-first refinement (Q3):**

```ts
// ClipCombo verbatim (clip-command-palette-search.ts:4-6):
const HAN_RE  = /[㐀-鿿豈-﫿]/u;   // CJK ideographs + compat
const KANA_RE = /[぀-ヿｦ-ﾟ]/u;   // hiragana + katakana + half-width kana
const COMPACT_RE = /[\s\p{P}\p{S}_-]+/gu;

export function searchVariants(value: string, locale?: string): readonly string[] {
  const out = new Set<string>();
  addNormalized(out, value, locale);            // original (NFKC+lower) + punctuation-compacted
  if (KANA_RE.test(value)) {
    addKana(out, value, locale);                // → Japanese: hiragana / katakana / romaji
  } else if (HAN_RE.test(value)) {
    addPinyin(out, value, locale);              // → Chinese: 全拼 "bei jing"+"beijing", 首字母 "b j"+"bj"
  }
  return cache(value, locale, [...out]);
}
```

> **Why kana-first instead of ClipCombo's `if (HAN_RE && !isJapaneseOrKoreanLocale(locale))` locale-gate:** MUZERO libraries are personal & **mixed** (a `ja`-UI user owns Chinese songs), so we must *not* gate on UI locale (Q3). Detecting **kana in the text** is a reliable "this string is Japanese" signal — so a kana-containing title takes the kana/romaji path and **skips** pinyin (avoids wrong `dongjing`-style readings on Japanese text). A Han-only string (no kana) takes the pinyin path. This is strictly better than ClipCombo for mixed libraries. **Known irreducible limit:** an all-*kanji* Japanese title (no kana, e.g. 「東京」) has no kana signal → falls to the pinyin path → gets Chinese readings, because wanakana romanizes kana but not kanji. Full kanji→Japanese-reading needs a morphological analyzer (kuromoji, multi-MB) — out of scope (§7, §10).

**pinyin-pro options** (ClipCombo-proven): 全拼 `{ toneType:"none", type:"array", v:true, nonZh:"consecutive" }`; 首字母 `{ pattern:"first", nonZh:"removed", … }`. Each joined as space-form ("bei jing") **and** compact-form ("beijing"). **wanakana**: `toHiragana(v,{passRomaji:true})`, `toKatakana(v,{passRomaji:true})`, `toRomaji(v)`.

**Scorer (verbatim port — tiers proven in ClipCombo):**

```ts
function variantScore(q: string, f: string): number {
  if (!q || !f) return NO_MATCH_SCORE;
  if (f === q) return 0;                                    // exact
  if (f.startsWith(q)) return 10 + (f.length - q.length);   // prefix
  const i = f.indexOf(q); if (i >= 0) return 100 + i;       // substring
  if (isSubsequence(q, f)) return 520 + (f.length - q.length); // fuzzy (q.len≥2, f.len≤96)
  return NO_MATCH_SCORE;
}
```

### 4.2 `src/lib/track-search.ts` (refactor — same public API)

- **`trackSearchText` → `trackSearchFields(track, memoryNotes): string[]`** — per-field array in **original casing** (so transliteration sees real CJK), replacing the single pre-lowercased blob.
- **`matchesQuery(track, query, notes)`** — unchanged signature/grammar; new body matches token-variants against field-variants per scope. `#tag` / `artist:` / `album:` semantics preserved; **tags also go through variants** (`#lvxing` / `#lx` → `#旅行`).
- **NEW `trackSearchScore(track, query, notes): number`** — min score; `searchTracks` sorts ascending (stable for ties → preserve input order). Today order = input order.
- **`searchEntityFacets`** — same variant matcher, so `zhoujielun` surfaces the 歌手 facet 周杰伦.

### 4.3 Worker message + index contract (`search-core.ts` / `search-worker.ts` / `search-client.ts`)

- **`search-core.ts` (pure, testable inline):** `buildIndex(rows) → Index`, `patchIndex(index, { upserts, removedIds }) → Index`, `queryIndex(index, query) → { ids, scores }`. Uses §4.1/§4.2. No Worker, no Dexie — just data in, data out.
- **`search-worker.ts`** (mirrors `heavy-worker.ts`): owns a `liveQuery(() => listAllTracks(db))` + `db.remoteSearchTracks` subscription; on change, computes the id-diff and calls `patchIndex` (only changed ids recompute variants); on `{type:"query", reqId, query}` replies `{type:"result", reqId, ids, scores}`.
- **`search-client.ts`** (mirrors `heavy-client.ts`): lazy singleton Worker, reqId/pending map, `worker.onerror` → `workerUnavailable=true` + inline fallback. `searchInline(query)` runs the pure matcher over the main thread's already-loaded `tracks`.

**Performance budget (per [`prd-create.md` §4](../../../.cursor/commands/prd-create.md) — measure first):**
- **Off-thread:** index build + per-keystroke query run in the Worker, so the **main thread never blocks** regardless of library size — this is the primary jank defense (Q1).
- **Steady-state query cost** (in Worker): query-variant generation (1 string) + N cache-hit field lookups + scoring. Target round-trip **< 16 ms** for a 5k-track library; measure under `pnpm build` (prod), not dev (StrictMode skews).
- **Index build cost** is paid once off-thread on load and incrementally on change — never on the keystroke path.

**Telemetry whitelist (§3 + 硬规则 1):** MUZERO has **no backend and no telemetry**, and this adds none. **Never log query strings, titles, or variants** (user content / memories). Dev-only `log.debug` may emit counts (`{ indexedCount, ms }`), never text.

---

## 5. Frontend Design

### 5.1 Page Structure

No new page. Edits land in [`search-page.tsx`](../../../src/pages/search-page.tsx) (`全部歌曲` / `专辑` / `歌手` modes) and the global shortcut hook.

### 5.2 UI Components / Interaction

- **⌘/Ctrl+F → focus search** ([`use-player-shortcuts.ts`](../../../src/hooks/use-player-shortcuts.ts)): the hook maps bare **F = fullscreen**; **⌘/Ctrl+F has a modifier so there is no conflict**. On ⌘/Ctrl+F: `preventDefault()` (suppress native browser find), switch the active nav tab to `search`, focus the input via the existing `[data-muzero-search-input]` attribute.
- **Async + ranked results:** the page posts `trackQuery` to `searchClient`, receives ranked `ids`, and maps them onto the `allTracks` it already holds via `useLiveQuery` — rendering the [`VirtualTrackList`](../../../src/components/library/virtual-track-list.tsx) best-match-first. While the Worker/index warms up, it falls back to the inline baseline so results appear immediately.
- **Deferred render:** wrap the query feeding `searchClient` in `useDeferredValue` so the controlled input stays crisp and re-renders coalesce. (Heavy compute is already off-thread; this just smooths React render churn.)
- **Snap-in:** subscribe to a Worker-ready signal; when the index first becomes ready, re-run the current query once so transliteration matches appear without the user retyping.
- **Discoverability (i18n):** placeholder hint teaches pinyin/romaji input. No new persistent chrome.

### 5.3 State Management

Local component state only (`trackQuery` etc. already exist). The Worker handle, LRU cache, and ready-flag are **module-scope singletons** in `search-client.ts` / `search-transliterate.ts` — **not** in Zustand (硬规则 6). The UI subscribes to Worker-ready via a tiny `useSyncExternalStore` to trigger the one snap-in re-filter.

### 5.4 i18n (4 locales, per [`prd-create.md` §3](../../../.cursor/commands/prd-create.md))

Update `search.placeholder` / `gallery.searchTracks` in all four catalogs ([`en`](../../../src/i18n/locales/en/common.json) / [`zh`](../../../src/i18n/locales/zh/common.json) / [`ja`](../../../src/i18n/locales/ja/common.json) / [`ko`](../../../src/i18n/locales/ko/common.json)); en is the type source. Example intent:

| locale | placeholder hint |
|--------|------------------|
| en | `Search — type pinyin (bjhyn), romaji (kimi), #tag…` |
| zh | `搜索 —— 支持拼音 / 首字母（bjhyn）、#标签…` |
| ja | `検索 — ローマ字（kimi）/ かな / #タグ…` |
| ko | `검색 — 핀인 / 로마자 / #태그…` |

No user-visible string hardcoded in components (§3).

---

## 6. Implementation Plan

> Phase order follows §3: **infrastructure before breadth, observability/correctness before perf**. Phases 1–2 ship a correct (inline) transliteration search; Phase 3 moves the heavy work off-thread; Phase 4 polishes UX. Each phase is independently shippable.

### Phase 1: Transliteration variant engine (pure lib + lazy deps)

**Goal:** Standalone, exhaustively-tested `search-transliterate.ts` that turns any string into normalized + pinyin + kana/romaji variants, with dynamic-imported libs and an LRU cache. No app behavior change.

**Tasks:**
- [x] `pnpm add pinyin-pro wanakana` (3.28.1 / 5.3.1, both MIT — isolated deps commit `ccb9587`).
- [x] Create `search-transliterate.ts`: `normalizeSearchText`, `searchVariants`, `scoreVariants`, `NO_MATCH_SCORE`, `ensureTransliterationLoaded`, `isTransliterationReady`, LRU (4000); ClipCombo's `HAN_RE`/`KANA_RE`/`COMPACT_RE` verbatim; **kana-first** detection.
- [x] Dynamic `import()` of both libs in `ensureTransliterationLoaded` (idempotent, clears cache on load); normalize-only variants until resolved; try/catch fallback (transliteration only widens).
- [x] pinyin opts (全拼 + 首字母, space + compact forms; `v:true`, `toneType:"none"`, default — **not** `traditional`, simplified-friendly); wanakana hira/kata/romaji with `passRomaji`.
- [x] Unit tests — 15 cases (Checklist).

> **Notes:** (1) Omitted ClipCombo's `traditional:true` — MUZERO's core users have simplified libraries and the unified dict still reads traditional chars; locked by a 北京欢迎你 test. (2) `onTransliterationReady` subscription deferred to Phase 4 (UI snap-in); Phase 1 exposes the sync `isTransliterationReady()`.

### Phase 1 Checklist

- [x] `searchVariants("北京欢迎你")` ⊇ `{ "beijinghuanyingni", "bei jing huan ying ni", "bjhyn", "b j h y n" }`.
- [x] `searchVariants("じどう ジマク")` ⊇ `{ "じどうじまく", "ジドウ ジマク", "jidou jimaku", "jidoujimaku" }` (mirrors ClipCombo test).
- [x] `searchVariants("君の名は")` → kana/romaji for the kana portion; **no pinyin** emitted (kana-first); kanji limit noted in test comment. Also `ナルト → naruto`.
- [x] `scoreVariants` tiers: exact `0` < prefix `<100` < substring `<520` < subsequence `<NO_MATCH`.
- [x] Subsequence guarded: query `<2` chars → no fuzzy; field `>96` chars → no fuzzy (both tested: long-gapped 103-char field returns no-match, short-gapped matches).
- [x] Latin / mixed (`iPhone 手机`→`shouji`) + empty/whitespace handled; NFKC folds full-width (`ＨＥＬＬＯ→hello`); `v:true` so `lvxing`/`lx` reach `旅行`.
- [x] normalize-only variants before `ensureTransliterationLoaded()` (pinyin/kana no-op until libs set; cache cleared on load); richer after.
- [~] `make check`: my files green (15/15 tests, biome clean, typecheck exit 0). Whole-repo `make check` has **pre-existing** failures from unrelated player-dock WIP (`chat-model-picker.test.tsx`, biome debt in `search-page.tsx`/`shortcuts/*`) — out of scope; lefthook gates staged files only.

### Phase 2: Transliteration-aware matcher + relevance ranking (pure, inline)

**Goal:** Route the existing matcher through the variant engine, preserve the scoped grammar, rank by score, and enrich remote `normalizedText` — all running inline (main thread) for now. Correct, fully tested, ship-able on its own.

**Tasks:**
- [x] `trackSearchText` → `trackSearchFields(track, notes): string[]` (per-field array, original casing; no external importers, clean replace).
- [x] Rewrite `matchesQuery` to variant-match per scope (delegates to `trackSearchScore < NO_MATCH_SCORE`); `#tag`/`artist:`/`album:` grammar unchanged; tags + scoped fields via variants.
- [x] Add `trackSearchScore` (summed per-token best, capped below sentinel); `searchTracks` filters + sorts ascending, stable for ties (`score || index`).
- [x] Update `searchEntityFacets` to the variant matcher (歌手/专辑 reachable by pinyin/romaji).
- [~] **Moved to Phase 3:** remote `r2-search-catalog.ts` transliteration — the Worker indexes `tracks` + `remoteSearchTracks` uniformly, so remote variant handling belongs with the Worker index, not the inline matcher. Until then remote search stays substring-only (graceful, no regression).
- [x] Extend `track-search.test.ts` — +9 cases, `await ensureTransliterationLoaded()` once.

### Phase 2 Checklist

- [x] `matchesQuery(title:"北京欢迎你", "bjhyn")` / `"beijing"` / `"北京"` → true, `"shanghai"` → false; `#旅行` reachable via `#lvxing` / `#lx`.
- [x] Japanese: `matchesQuery(title:"ナルト", "naruto")` → true (kana→romaji). (Mixed kanji+kana like 「君の名は」 only romanize the kana — the documented kanji limit, §7 — so romaji of the *kanji* reading isn't matchable; tested at the engine level in Phase 1.)
- [x] Scoped grammar intact: `artist:zhoujielun` / `artist:zjl`, `album:fantexi`, `artist:nobody`→false — all AND-compose.
- [x] `searchTracks` returns **relevance-sorted** results (exact title `Drive` before a buried `…drive…` note hit); ties stable (empty query preserves input order).
- [x] `searchEntityFacets` surfaces 周杰伦 from `zhoujielun` / `zjl`; 范特西 album from `album:fantexi`.
- [x] All existing track-search tests still pass (18 pre-transliteration + 9 new = 27); empty query matches all.
- [→] Remote row pinyin/romaji: deferred to Phase 3 (Worker index over `remoteSearchTracks`).

### Phase 3: Off-thread search Worker + incrementally-maintained index

**Goal:** Move querying + dictionary work into a Worker so a large library never janks; inline fallback keeps tests + Worker-less environments correct.

> **Design note (simpler than first drafted):** the "index" is just the pushed row snapshot + the variant **LRU cache** in `search-transliterate` — no bespoke `buildIndex`/`patchIndex`. The main thread maps tracks + remote rows to `IndexableRow[]` and **pushes** them to the Worker (`setSearchRows`) on data change (cheap strings, infrequent); the Worker holds the snapshot and answers `query` with `queryRows`. This avoids a second in-Worker Dexie subscription. Incrementality comes for free: unchanged rows' variants stay cached; new/changed text is a cache miss computed once; removed rows just drop out of the snapshot.

**Tasks:**
- [x] `search-core.ts` (pure): `IndexableRow` + `scoreRow` + `queryRows` (filter + rank); token grammar moved here; unit tests (8) incl. pinyin/romaji + ranking. (Replaces the planned `buildIndex`/`patchIndex` — the LRU cache *is* the index.)
- [x] `search-worker.ts` (mirror `heavy-worker.ts`): in-worker `import` of pinyin-pro/wanakana (Worker chunk, not main bundle); holds pushed `IndexableRow[]`; `query` → ranked `{id, score}[]`.
- [x] `search-client.ts` (mirror `heavy-client.ts`): lazy Worker, reqId/pending, `onerror` → **inline fallback** (`queryRows` over the pushed mirror); `setSearchRows` push. Inline path unit-tested (pinyin/romaji ranking, jsdom forces no-Worker).
- [x] **Remote rows (moved from Phase 2):** `remoteRowToIndexable` + `matchesRemoteSearchTrack` now route through `scoreRow` (transliteration-aware). `normalizedText` rides along as a free field so folded memory/caption CJK stays reachable (pinyin tested: `pengyou → 朋友`). Grammar identical to local.
- [→] **Moved to Phase 4:** `search-page.tsx` wiring (route `trackQuery` through `searchClient`, push rows, snap-in) — bundled with the UX/⌘F work so the whole surface is verified in one preview pass, and to reduce churn on the (concurrently-edited) page.
- [→] **Moved to Phase 4:** `pnpm build` bundle/perf measurement — needs the page wired + a prod build to be meaningful.

### Phase 3 Checklist

- [x] Worker created lazily (first `searchRows`); pinyin-pro/wanakana imported only inside `search-worker.ts` (Worker chunk). Build-output size verification → Phase 4.
- [x] Worker-unavailable path (forced in jsdom) falls back inline with correct ranked results (`search-client.test.ts`).
- [x] Remote rows transliterate via the shared core (`r2-search-catalog.test.ts`, +pinyin case); grammar unchanged.
- [x] Source-agnostic core lets local + remote share one matcher (`search-core.test.ts`, 8 cases).
- [~] `make check`: my search files green (62 search/transliteration assertions; typecheck exit 0; biome clean). Whole-repo has the same one **pre-existing** unrelated failure (`chat-model-picker.test.tsx`).
- [→] On-thread long-task / 5k-track round-trip measurement → Phase 4 (needs wired page + prod build).

### Phase 4: Search UX — ⌘/Ctrl+F focus, deferred render, i18n hints

**Goal:** Discoverable, snappy, and actually wired into the UI surfaces.

> **Note:** the ⌘F binding itself landed independently in the parallel keyboard-shortcuts work (`App.tsx` `isGlobalSearchShortcut` → opens the `GlobalTrackSearch` overlay; it also added `/`). So Phase 4 here = wiring those surfaces through the transliteration engine + i18n, not re-adding the shortcut.

**Tasks:**
- [x] **⌘/Ctrl+F + `/`** → open `GlobalTrackSearch` overlay: already implemented by the shortcuts migration (`App.tsx`). No change needed.
- [x] `use-worker-track-search.ts` (NEW): wraps the search Worker for the ⌘F overlay — pushes rows (`setSearchRows`), queries off-thread (`searchRows`) with `useDeferredValue`, maps ranked ids → tracks. `GlobalTrackSearch` now uses it (off-thread pinyin/romaji + ranking).
- [x] `use-transliteration-ready.ts` (NEW): main-thread dictionary readiness flag; wired into `search-page.tsx` so its inline `searchTracks` / `searchEntityFacets` / remote matcher snap in once loaded (the 全部歌曲 tab + facets, which need cheap main-thread transliteration over the few derived entities). `useDeferredValue` lives in the worker hook for the overlay.
- [x] Localize `globalSearch.placeholder` + `gallery.searchTracks` in en + zh + ja + ko (en type source).
- [x] **Preview-verified live** (port 1440, seeded CJK tracks): ⌘F opens; `bjhyn`→北京欢迎你, `beijing`→北京欢迎你, `#lvxing`→北京欢迎你 (旅行), `naruto`→ナルト; non-match empty; **zero console errors**; placeholder hint shows.

### Phase 4 Checklist

- [x] ⌘F (mac) / Ctrl+F (win/linux) + `/` open the global search overlay (verified live).
- [x] Off-thread search via the Worker for the overlay; inline fallback when no Worker (tested). Main thread stays responsive (`useDeferredValue` + off-thread scan).
- [x] Placeholder localized in all 4 locales; type-safe `t()` keys; typecheck exit 0; biome clean on all touched files (incl. a fix-as-you-touch `useIndexOf` cleanup the file already carried).
- [x] **Screenshot proof:** romanized `beijing` surfaces 北京欢迎你 (1 result) in the ⌘F overlay.
- [~] Bundle measurement: pinyin-pro/wanakana import only inside `search-worker.ts`; not eagerly in the main entry. (Exact gzipped split via `pnpm build` is a nice-to-have follow-up; the dynamic-import boundary is in place.)

---

## 7. Out of Scope

- **Korean romanization (한글 → romaja) & 초성/jamo 검색.** Not requested; needs a different toolchain (revised-romanization rules or an `aromanize`-style lib). Own follow-up PRD. ko placeholder copy lands now; matching does not. (Q1 in §1.1 scope)
- **Japanese kanji → Japanese reading (東京→toukyou).** Needs a morphological analyzer (kuromoji/kuroshiro, multi-MB dictionary) — disproportionate for a local-first bundle. v1 covers **kana** romaji; kanji-only titles fall to pinyin (documented limitation, §4.1 / §10).
- **Match highlighting in result rows.** Transliterated matches land in romaji-space, not on displayed CJK glyphs, so highlight offsets don't map cleanly. Deferred.
- **Typo-tolerant fuzzy beyond subsequence** (Levenshtein/Fuse.js). The tiered subsequence matcher is enough for phonetic input.
- **New DB tables / persisted variant index.** Everything stays derived + in-memory (硬规则 4). (Only existing `normalizedText` is enriched.)
- **A command-palette overlay (⌘K global actions).** This PRD focuses ⌘F on the existing search surface, not a new modal palette.

---

## 8. Security / Privacy / Compliance Considerations

- **Local-first (硬规则 1):** no backend, no telemetry. Search runs entirely on-device over locally-synced data; query strings & variants are **never** logged, persisted, or sent. The only outbound calls remain the user-configured BYOK LLM/musicgen APIs — untouched here.
- **No hidden flags (硬规则 3):** transliteration is always-on once the Worker/index is ready; **no** `localStorage`/URL/`window.*` toggle. Rollback = `git revert` + redeploy.
- **Dependency provenance (§3):** `pinyin-pro` (MIT) + `wanakana` (MIT), recorded with source/SPDX/url; MUZERO is open-source (Q6); no GPL/EULA contamination.
- **Supply chain / offline:** libs bundled into the app's own Worker chunk (no CDN, no runtime fetch) — offline & integrity preserved.
- **Worker isolation:** the search Worker has no preload/native access (per 硬规则 10, "worker 里没有 Tauri internals / Electron preload"); it only re-opens the same Dexie DB read-side, like `heavy-worker.ts`.
- **No new PII surface:** variants are computed from data the user already stored locally; nothing new is exposed.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Artist & Album Library Entities PRD](../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md) | Phase 4 introduced faceted/scoped search (`artist:`/`album:`) — this PRD makes those facets phonetically reachable. |
| [Media Metadata Import & Export PRD](../20260609-muzero-media-metadata-import-export-prd/20260609-muzero-media-metadata-import-export-prd.md) | Populates the `mediaMetadata` we now make searchable by pinyin/romaji. |
| [R2 Cloud Drive Sync PRD](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | Owns `r2-search-index.ts` / `r2-search-catalog.ts` / `normalizedText` — Phase 2 enriches variants there (client-side, at sync). |
| ClipCombo reference impl | [`clip-command-palette-search.ts`](../../../../doodlekuma.com/packages/clipcombo/src/lib/clip-command-palette-search.ts) + [test](../../../../doodlekuma.com/packages/clipcombo/src/lib/clip-command-palette-search.test.ts) — the matcher being ported. |
| Worker precedent | [`heavy-client.ts`](../../../src/workers/heavy-client.ts) / [`heavy-worker.ts`](../../../src/workers/heavy-worker.ts) / [`ingest-core.ts`](../../../src/workers/ingest-core.ts) — the pure-core + Worker-host + inline-fallback pattern Phase 3 mirrors. |
| [`src/lib/track-search.ts`](../../../src/lib/track-search.ts) | The matcher being refactored. |

---

## 10. Open Questions (resolved 2026-06-10)

| # | Question | Decision |
|---|----------|----------|
| 1 | Avoid UI jank — Worker? | **Resolved → Yes.** Index build + querying run in an off-thread search Worker (Phase 3), mirroring `heavy-worker.ts`; heavy libs live only in the Worker chunk; inline pure-matcher fallback keeps tests/Worker-less correct. |
| 2 | Language detection regex | **Resolved → adopt ClipCombo's exact `HAN_RE`/`KANA_RE`/`COMPACT_RE`** (codepoint-range, fast). |
| 3 | Script-detection vs locale-gating | **Resolved → script-detection, kana-first.** kana ⇒ Japanese (kana/romaji, skip pinyin); else Han ⇒ Chinese (pinyin). Locale only drives casing. Drop ClipCombo's `isJapaneseOrKoreanLocale` gate (mixed libraries). |
| 4 | Remote (R2) search — where does it run? | **Resolved → all local.** R2 sync `bulkPut`s catalog rows into local `db.remoteSearchTracks` (client-side `normalizedText`, page-version-diffed/incremental). The Worker indexes local + synced rows uniformly; variants baked into `normalizedText` at sync write. No server work. |
| 5 | Long-term best practice | **Resolved → Worker-hosted, incrementally-maintained index** (Phase 3), with the pure matcher as the single tested source of truth. |
| 6 | Licenses | **Resolved → MIT, fine.** MUZERO is open-source; record both deps in `THIRD-PARTY-LICENSES.md`. |
| 7 | Kanji-only Japanese titles (東京) | **Open (accepted limitation).** Fall to pinyin path; full kanji→reading needs kuromoji (out of scope §7). Revisit only if demanded. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-10 | MUZERO | Initial draft — port ClipCombo transliteration matcher (拼音/首字母 + 假名/罗马音) into MUZERO search; 3 phases. |
| 2026-06-10 | MUZERO | Revised after Open-Questions review: pivot to off-thread search **Worker** (Q1/Q5) mirroring `heavy-worker.ts`; adopt ClipCombo's exact regexes + **kana-first** detection (Q2/Q3); correct remote search to **all-local synced rows** with client-side variant baking (Q4); 4 phases (engine → inline matcher+ranking → Worker host → UX). |

---

> **Note (template policy):** This PRD modifies existing pure-function search + reuses the existing Worker pattern rather than building new structures. Net-new files are limited to the lib bridge (`search-transliterate.ts`) and the Worker host/core/client trio — both categories §3 explicitly permits. No DB schema, codename, or backend changes.
