# PRD: 全局搜索（⌘/Ctrl+F）大库性能 — 开窗卡顿 + 输入延迟

**Status:** Draft
**Created:** 2026-06-15
**Author:** MUZERO Team
**Module:** Global Search Overlay（`src/components/search/global-track-search.tsx` + `src/workers/search-*` + `src/lib/search-*`）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测先行：补齐开窗 / 查询 / longtask 指标 | 🔄 代码完成（基线待用户实测） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 消除开窗同步突发（pre-warm + defer） | 🔄 代码完成（开窗帧待用户实测） | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 预存变体 `IndexedRow` + 线性扫描 + 增量维护（★核心） | 🔄 代码完成（latency 待用户实测） | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 倒排收窄 / 超大库调优 / 持久化（仅 20k+ 实测不达标才做） | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

用户在 **6000+ 首歌曲** 的本地库上使用全局搜索（⌘/Ctrl+F overlay，[`GlobalTrackSearch`](../../../src/components/search/global-track-search.tsx)）时报告两个性能症状：

1. **触发 modal 时「顿一下」**：按下 ⌘/Ctrl+F 打开 overlay 的那一帧主线程停顿。
2. **输入响应慢（≈3 秒）**：键入查询后要等数秒才出结果。

这两个症状是**两条不同的路径**，根因不同，需要分别处理。下面是基于代码的根因分析（不是凭感觉）。

#### 症状 1 根因：开窗瞬间的同步派生突发

overlay 常驻挂载，但内部 `if (!open) return null`（[line 348](../../../src/components/search/global-track-search.tsx#L348)）。当 `open` 翻成 `true`，**在同一次 commit 内**同步跑完一串重派生：

- `artistIndex = open ? buildArtistIndex(allTracks) : []`（[line 176](../../../src/components/search/global-track-search.tsx#L176)）
- `albumIndex = open ? buildAlbumIndex(allTracks) : []`（[line 177](../../../src/components/search/global-track-search.tsx#L177)）
- `searchRows`：对 6000+ playable track 逐个 `trackToRow(...)` 构造 free/artist/album/tags 字段数组，再叠加 lyric rows（[line 195-220](../../../src/components/search/global-track-search.tsx#L195-L220)）
- 紧接着 effect `setSearchRows(snapshotRows)` → 把全部 rows **structured-clone postMessage** 给 worker（[use-worker-track-search.ts:21-24](../../../src/hooks/use-worker-track-search.ts#L21-L24)）
- 外加把原本 `null` 的整个 modal 子树一次性 mount

这些都 gate 在 `open` 上 → 按键即触发 → 一帧内 O(N) 突发 → 「顿一下」。

此外 `lyricFieldsByTrackId`（[line 166-173](../../../src/components/search/global-track-search.tsx#L166-L173)）对**每首** track 调 `lyricsSearchFields` → `parseLyrics` 解析 LRC，**未 gate 在 `open`**，只要 `allTracks` 变就在主线程重算 —— 是一项常驻主线程成本，开窗时若恰逢重算会叠加卡顿。

#### 症状 2 根因：每次按键全量线性扫描 + 转写缓存抖动

查询路径：`useWorkerRowSearch(searchRows, searchText)` → worker `queryRows(rows, query)`（[search-worker.ts:35](../../../src/workers/search-worker.ts#L35)）。

`queryRows` 是**全表线性扫描**：每行 `scoreRow` → 每个 scope `scopeScore` → 每个 token `bestTokenScore` → **每个 field 调 `searchVariants(field)`**（[search-core.ts:65-75](../../../src/lib/search-core.ts#L65-L75)）。

致命点在 [search-transliterate.ts:29](../../../src/lib/search-transliterate.ts#L29)：

```ts
const MAX_VARIANT_CACHE_SIZE = 4_000;
```

6000 首歌，每首 `trackToRow` 产出 ~10–20 个 field 字符串（title / metadata / caption / note / tags / provider / memory notes…），全库 **~60k–100k 个去重 field**。缓存上限只有 **4000** → **缓存抖动（thrashing）**：绝大多数 field 每次查询都 cache miss → 重新跑 `pinyin-pro`（~130KB 词典）/ `wanakana` 转写。

> 量级估算：每键 ≈ 6000 行 × ~10 field ≈ 6 万次 `searchVariants`，其中 ~95% miss → ~5.6 万次转写。pinyin-pro 单次即便 ~50µs，也 ≈ **2.8 秒**。与「等 3 秒」吻合。lyric rows 还会把扫描行数近乎翻倍。

转写发生在 worker 里（不卡主线程），所以表现为**结果延迟**而非主线程冻结 —— 但用户体验就是「输入后干等」。

**关键结论**：当前没有真正的「索引」。每次按键都在重做本应只做一次的 field 转写。修复方向 = **把转写在索引时做一次并随 row 存好（`IndexedRow`），查询时线性扫预存 key + 只做 query-side 变体；增删改增量维护，绝不全表重建**，并消除开窗的同步突发。

#### 联网调研修正（2026-06-15，见 §9 来源）

对「这几个场景搜索算法 best practice」做了多源对抗验证调研，**一条高置信结论改变了方案分层**：

> **在 6k–20k 量级，「线性扫描 + 预计算 key」就足够 sub-100ms，未必需要倒排索引。** 索引创建对 10k 项 ~28ms；无索引线性扫描器（uFuzzy 式）在 16.2 万项上单轮全搜也仅数百 ms。([uFuzzy](https://github.com/leeoniya/uFuzzy) / [Fuse perf](https://www.fusejs.io/performance.html))

含义：我们 3s 的根因**从来不是「缺倒排」**，而是「每键对每 field 重跑转写」。**只要把变体预计算一次、线性扫预存 key，就几乎肯定从 3s 降到 <100ms** —— 倒排是 20k+ 才赚回成本的优化，不该是 6k 量级的核心。**故 Phase 3 核心降为「预存变体 + 线性扫描」，倒排降到 Phase 4 按需。**

其余调研结论均**验证**已有决策：
- **索引时展开变体**是成熟系统共识（ES pinyin 插件索引时同吐全拼 `[liu,de,hua]`+首字母 `ldh`+连写 `liudehua`，[medcl/pinyin](https://github.com/medcl/elasticsearch-analysis-pinyin)）→ 不要查询时转写。
- **日文用字典形态分词**（kuromoji/MeCab，非 n-gram，[ES kuromoji](https://www.elastic.co/guide/en/elasticsearch/plugins/master/analysis-kuromoji-analyzer.html)）→ 我们的 wanakana kana↔romaji 同思路。
- **歌词长文多字段排序**标准是 **BM25F**（[Robertson/Zaragoza](https://arxiv.org/pdf/0911.5046)）→ 短字段用现有分级 tier 够；歌词排序若变差再引（§10 Open Q）。
- **第三方库均不原生支持拼音/假名转写**（Orama/MiniSearch/FlexSearch tokenizer 都不认）→ **转写层无论如何要自研**，引库净收益为负（Lunr v2 索引还不可变、改一文档全量重建，[#284](https://github.com/olivernn/lunr.js/issues/284)）→ **维持自研**。

#### 设计决策（已与 owner 确认 + 调研修正）

| 决策 | 选择 | 理由 |
|------|------|------|
| **核心算法** | **预存变体 `IndexedRow` + 线性扫描**（Phase 3）；倒排收窄留到 Phase 4 仅 20k+ 不达标才做 | 调研证实 6k–20k 线性扫预存 key 即 sub-100ms；最小改动、最低风险先验证 |
| **匹配语义** | **全保留** exact/prefix/substring/subsequence 分级 tier | 不丢任何现有搜索能力（词中间子串、模糊跳字照常） |
| **NLP 覆盖** | 变体**索引时展开**：中文→拼音全拼+首字母、日文→假名+罗马音、歌词逐行 | 输入拼音命中汉字、罗马音命中假名、搜歌词命中行；与成熟系统一致 |
| **索引维护** | **增量**：删歌移除行、加歌只算新行、改 tag/note/封面只更新该行；未变行复用 | 避免每次库变更全库重转写；线性扫描方案下增量极简（数组增删一行） |
| **持久化** | **内存态 + 启动时分块重建**（不动 DB schema）；持久化仅作冷建过慢的 Phase 4 fallback | 不 bump DB version、不维护索引↔tracks 一致性；冷建在 Worker 内分块，主线程零阻塞 |
| **冷建不卡 UI** | 全部在 **Worker** 内，分块 + yield，warm 期间先给 substring 兜底、建完升级全 NLP | Worker 是独立线程，几秒级冷建也不触碰主线程帧循环 |
| **引第三方搜索库** | **不引**，维持自研 | 无库原生支持拼音/假名；转写层必自研，引库只增 bundle + 胶水 |

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **大库本地用户** | 导入 6000+ 本地音视频 / 生成歌曲，频繁用 ⌘F 跳转、点歌 | 本地 IndexedDB，无账号 |
| **混合库用户** | 本地 + 在线源（网易云/Bilibili/YouTube）+ 歌词搜索并用 | 同上 |

### 1.3 Core Value

1. **开窗即时**：⌘/Ctrl+F 打开无可感知停顿（无掉帧）。
2. **输入即时**：键入到出结果的延迟回到「打字即出」级别（p95 ≤ 数十 ms 量级），即便 6000–20000 首库。
3. **可验证**：先有 before/after 指标（开窗耗时 / 查询耗时 / longtask），优化不靠手感。

---

## 2. System Architecture

### 2.1 Architecture Overview（现状 → 目标）

```
现状（每键重算）
  open=true ──▶ [同步突发] buildArtist/AlbumIndex + 6000×trackToRow + postMessage(全量 rows)
                                                              │
  keystroke ──▶ worker.queryRows ──▶ 每行 每field searchVariants() ── cache(4000) 抖动
                                          └─ 每键重跑 pinyin/wanakana ×数万 → ~3s

目标（Phase 3 核心：索引时转写一次，查询时线性扫预存 key、零转写）
  library change ──(throttled, 后台,不依赖 open)──▶ worker set-rows
        │
        ▼  按 id diff（增删改只动变更行，未变行复用）
  worker 索引（分块构建 + yield，全程不出 worker）：
     每 row 预计算 field 变体并存 IndexedRow（pinyin 全拼/首字母 · kana/romaji · 歌词逐行）
        │
  keystroke ──▶ 线性扫 IndexedRow：仅算 query 变体（少量）× 预存 field 变体 scoreVariants
                ├─ tier 全保留：exact < prefix < substring < subsequence
                ├─ 增量收窄：扩展查询只在上次候选集里扫
                └─ 结果缓存：相同 query 直接命中
        │
        ▼
  open=true ──▶ modal 直接 paint（索引已后台 warm，无同步突发；重派生 defer）

  ⚠ 冷建/大批导入：在 worker 内分块,warm 期间先给 substring 兜底结果,
     建完自动升级全 NLP（复用「词典未载完前降级」的成熟模式）→ 主线程零阻塞

  Phase 4（仅 20k+ 实测不达标才做）：在 IndexedRow 上叠倒排 token→Set<rowId> 先收窄候选，
     线性扫只跑候选集 / 增量收窄；调研证实 6k–20k 通常不需要这一层。
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **索引核心** | **自研** `src/workers/search-index.ts`（`IndexedRow`：每 row 预存 field 变体；Phase 4 才叠倒排） | 转写在索引时一次；查询线性扫预存 key、零转写。6k–20k 调研证实够快 |
| **搜索 worker** | 现有 `src/workers/search-worker.ts` + `search-client.ts` | 已有 off-thread 架构,索引构建/增量/查询全在此,主线程零阻塞 |
| **转写** | 现有 `pinyin-pro` / `wanakana`（worker chunk 内） | 不变；调用从「每键每 field」挪到「索引时每行一次」 |
| **比分核心** | 现有 `src/lib/search-core.ts` + `search-transliterate.ts` | 复用 `scoreVariants` / tier；新增「按预存变体比分」入口 |
| **观测** | `PerformanceObserver(longtask)` + `performance.now()` + [`src/lib/logger.ts`](../../../src/lib/logger.ts) | 与项目「性能 PRD 观测先行」一致，prod build 采数 |

> **硬约束**：索引**自研**,不引第三方搜索库（FlexSearch/Lunr/MiniSearch/orama 等）。调研结论:无库原生支持拼音/假名转写,转写层必自研,引库只增 bundle + 胶水,且 Lunr v2 索引不可变;本地优先 + bundle 预算亦是刻意选择。若自研在 20k+ 库仍不达标,再另开 dependency manifest review PRD。见 §7 Out of Scope。

### 2.3 Project Structure（仅改动既有文件，尽量不新增）

```
src/
├── components/search/
│   └── global-track-search.tsx     # 去掉开窗同步突发：派生不 gate 在 open / defer / pre-warm
├── workers/
│   ├── search-worker.ts            # set-rows 时预计算并存 row 的 field 变体；query 走预存变体
│   ├── search-client.ts            # 后台 pre-warm 推送（不依赖 overlay open）
│   └── search-index.ts             # (新增允许) IndexedRow 预存变体 + 构建/增量/查询纯函数（Phase 4 才叠倒排）
├── lib/
│   ├── search-core.ts              # 新增「IndexedRow（含预存变体）」比分入口；queryRows 复用
│   └── search-transliterate.ts     # 提升/移除 MAX_VARIANT_CACHE_SIZE 的抖动；暴露「整行变体化」helper
└── hooks/
    └── use-worker-track-search.ts  # warm 时机：首次后保持，开窗不再触发首建
```

> 新增 `search-index.ts` 属「新数据结构 / 索引核心」，符合模板 Exception Policy 的合理新增（带纯函数单测）。其余只改既有文件。

---

## 3. Data Model Design

> 本 PRD **不改 IndexedDB schema、不 bump DB version**。索引是内存态（worker 内），由 `tracks`/`lyrics`/memory liveQuery 派生，随库变更重建。codename 层（`muzero-db` / id 前缀 / provider id）不动。

### 3.1 Core Concepts

```
Track / 远程 catalog row / lyric row
        │  trackToRow / lyricsSearchFields（现有）
        ▼
IndexableRow { id, free[], artist[], album[], tags[] }     ← 现状到此为止
        │  (新增) 索引时一次：对每个 field 调 searchVariants → 存下
        ▼
IndexedRow {                       ← Phase 3 核心：每 row 预存变体（打分 + 全 tier 匹配）
  id,
  freeVariants:   string[][]       // 每个 free field 的预存变体集
  artistVariants: string[][]
  albumVariants:  string[][]
  tagVariants:    string[][]
}
        │  query：线性扫 IndexedRow，仅算 query 变体 × 预存 field 变体 scoreVariants
        ▼
QueryHit { id, score }（不变）  +  resultCache: Map<queryKey, QueryHit[]>

  ── Phase 4（仅 20k+ 不达标才加）──
InvertedIndex {                    ← 在 IndexedRow 之上叠：token→候选 先收窄，再线性扫候选集
  postings: Map<token, Set<rowId>>     // token 来自变体 → 拼音/罗马音/歌词都进表
  rowToTokens: Map<rowId, Set<token>>  // 增量删除时反查要摘哪些 posting
}
```

### 3.2 内存索引（非 DB，全在 worker）

- **当前实现**：worker 持 `rows: IndexableRow[]`，每 query 全扫 + 每 field 现算变体（缓存抖动 → 3s）。
- **目标改动（Phase 3 核心）**：worker 在 `set-rows` 时把 `IndexableRow[]` 升级成 `IndexedRow[]`（每 field 变体只算一次），后续 query **线性扫预存变体**，不再触碰转写词典（除 query-side 少量 token）。调研证实 6k–20k 线性扫预存 key 即 sub-100ms。
- **匹配两段（语义全保留，线性扫即可）**：query 变体 × 预存 field 变体跑 `scoreVariants`，分级 tier（exact/prefix/substring/subsequence）原样保留 —— **不丢任何现有搜索能力**。
- **构建成本搬迁**：转写总量从「每键 O(rows×fields)」降到「每次库变更 O(变更行×fields)」。库变更已被 `useThrottledValue(…, LIBRARY_QUERY_COALESCE_MS=250)` 合并（[use-throttled-value.ts:40](../../../src/hooks/use-throttled-value.ts#L40)），是低频后台成本。
- **增量维护（核心：绝不全表重建）**：`set-rows` 收到新快照按 `id` diff —
  - **新增歌**：只对新行算变体 → 加进 `IndexedRow[]`。
  - **删除歌**：从 `IndexedRow[]` 移除该行（线性扫方案下就是数组/Map 删一项）。
  - **改注释/封面/tag**：只对该行重算变体并替换。
  - 未变行 100% 复用,零重转写。（Phase 4 引倒排后，增删改同步维护 `postings`/`rowToTokens`。）
- **缓存上限**：`MAX_VARIANT_CACHE_SIZE=4000` 抖动根因在「预存变体」下消失（field 变体随 `IndexedRow` 持有,不再走每键 LRU）。query-side 保留小缓存。
- **结果缓存**：`resultCache` 按 `queryKey`(归一化 query + 索引版本号)缓存 `QueryHit[]`；索引增量更新时 bump 版本号使旧结果失效。配合**增量收窄**(扩展查询在上次候选集内扫)压低连续按键延迟。
- **内存预算**：预存变体粗估 6000 行 → 数 MB~十几 MB 量级；歌词逐行最占。Phase 1 实测 worker heap 增量并写进验收。

### 3.3 Data Relationship

```
liveQuery(tracks/lyrics/memory) ─throttle250ms─▶ rows snapshot ─postMessage─▶ worker
                                                                                  │
                                              ┌──── diff by id ──────────┐       │
                       新增行: 算变体 → 加进 IndexedRow[]                 │       │
                       删除行: 从 IndexedRow[] 移除该行 ◀────────────────┴───────┘
                       变更行: 重算该行变体并替换
                       未变行: 复用 IndexedRow（零重算）
                                                                                  ▼
                          worker 内 { IndexedRow[], resultCache }（warm，随时可查；Phase 4 才加 postings）
```

> **冷建/大批导入**：首次（或一次性导入几千首）需要把这些行的变体全算一遍 —— 在 worker 内**分块 + `await` yield**,warm 期间查询先走「降级 substring」路径给结果,建完自动升级全 NLP。主线程帧循环全程不受影响（Worker 独立线程）。冷建耗时按规模 Phase 1 实测：不含歌词 ~0.3–1s;含全量歌词逐行转写可能数秒,故歌词变体可作为**第二趟**懒补（metadata/tags 先 ready,歌词后到）。

---

## 4. 测量方法学（Measurement Methodology — 先于优化）

> 遵循 [`prd-create.md` §4「性能 / 播放卡顿 / realtime preview 类 PRD 附加要求」](../../../.cursor/commands/prd-create.md)：先把能看见症状的指标补齐，再动优化路径，让每个 phase 有 before/after ground truth。

### 4.1 必测指标（区分「派生耗时」与「呈现/响应延迟」）

| 指标 | 定义 | 采集点 | 目标 |
|------|------|--------|------|
| `open→paint` | 按下 ⌘F 到 overlay 首帧可见 | overlay 首个 rAF vs 触发时刻 | 无可感知停顿；longtask 不因开窗产生 ≥50ms 任务 |
| `longtask max` | 开窗前后 1s 内最长主线程任务 | `PerformanceObserver({entryTypes:["longtask"]})` | 开窗不产生新的 ≥50ms longtask |
| `query latency` | keystroke 到结果回填的端到端耗时 | 主线程发 query → 收 result 时间戳 | p50 ≤ 30ms，p95 ≤ 80ms（6k 库） |
| `worker queryDuration` | worker 内 `queryRows` 纯耗时 | worker 内 `performance.now()` 包裹 | p95 ≤ 20ms（warm 索引后） |
| `cold build`（全量） | 冷启动/大批导入建全索引耗时（变体+倒排） | worker 内计时 + `log` | 在 worker 内,**主线程零阻塞**；metadata/tags 趟 ≤ ~1s（6k），歌词趟可后到 |
| `incremental build` | 单首增删改的索引更新耗时 | worker 内计时 | ≤ 数 ms（绝不触发全表重建） |
| `worker heap` | 索引内存增量（变体 + 倒排） | prod 下两轮采样 | 给出实测 MB，纳入验收 |
| `main-thread block during build`（关键） | 冷建期间主线程最长任务 | 主线程 `longtask` | **建索引期间主线程 0 个新 longtask**（验证「在 worker、不卡 UI」） |
| `variant cache miss`（基线用） | 旧路径每键 miss 次数 | 临时计数器，仅 Phase 1 | 量化抖动，证伪/坐实根因 |

### 4.2 复测规则

- **prod build 复测，dev 不作数**：用 `make build` 产物 / `make desktop-build` 跑，避免 React StrictMode + HMR + sourcemap 污染（与 §4 规则一致）。
- **固定库规模**：用 6000+ 真实库（或合成 6k/12k/20k 数据集）复现，记录规模。
- **第二轮采样**：首次开窗含词典 warm，属预期；按内存规则取第二轮稳定值。
- **区分两症状**：开窗指标（`open→paint`/`longtask`）与查询指标（`query latency`/`queryDuration`）分别 before/after，不混为一谈。

### 4.3 先证伪「显而易见的嫌疑」

- 确认 3s 延迟在 **worker**（结果延迟）而非主线程冻结：看 `longtask` 在键入时是否为空 → 若空，确属 worker 计算，坐实 §1 症状 2 根因。
- 确认开窗卡顿来自派生突发而非词典首载：第二次开窗（词典已 warm）若仍卡 → 确属 `buildArtist/AlbumIndex`/`searchRows` 同步突发。

---

## 5. Frontend Design

### 5.1 行为与交互（不变用户可见行为，只改性能）

- ⌘/Ctrl+F 打开/关闭、`@` scope 菜单、键盘上下选择、Enter 播放 / Shift+Enter 下一首、在线源 chips —— **行为全部不变**。
- 结果排序 tier（exact < prefix < substring < subsequence）、transliteration（pinyin 全拼+首字母 / kana↔romaji）语义 **不变**，仅把计算时机从「每键」前移到「索引时」。
- 空查询、`@set`/`@artist`/`@album`/`@lyrics`/`@source` scope 结果 **不变**。

### 5.2 UI Components

- **Current Implementation**：[`GlobalTrackSearch`](../../../src/components/search/global-track-search.tsx)（overlay）+ [`useWorkerRowSearch`](../../../src/hooks/use-worker-track-search.ts) + worker。
- **Required Changes**：
  - 派生（`artistIndex`/`albumIndex`/`searchRows`/`lyricFieldsByTrackId`）**不再 gate 在 `open`**，或用 `useDeferredValue`/`startTransition` 让开窗那帧先 paint；索引在后台 warm。
  - `setSearchRows` 的推送时机解耦 overlay open：首次进库即后台 warm，开窗不触发首建。
  - worker `set-rows` 改为构建/增量更新 `IndexedRow[]`；`query` 走预存变体。

### 5.3 State Management

- 不进 Zustand。worker 索引是 worker 内单例（符合「非响应式单例放模块作用域」纪律）。
- 主线程仅持 `QueryHit[]` 结果 state（现状不变）。

---

## 6. Implementation Plan

### Phase 1: 观测先行 — 补齐指标 + 坐实根因

**Goal:** 在不改优化路径的前提下，补齐 §4 指标，prod 下取得两症状 before 基线，证伪/坐实根因。低风险、可独立先 ship。

**Tasks:**
- [x] 纯 `PerfSampler`（bounded ring + p50/p95/max/mean）+ `percentile` + `observeLongTasks` helper → [`src/lib/search-perf.ts`](../../../src/lib/search-perf.ts)（单测 [`search-perf.test.ts`](../../../src/lib/search-perf.test.ts)，12 例）。
- [x] worker 内对 `queryRows` 加 `performance.now()` 计时，`durationMs` 随 result 回传（避免在 worker 引 main-thread logger）→ [`search-worker.ts`](../../../src/workers/search-worker.ts)。
- [x] 主线程量 `query latency`（发→收）+ 收集 worker `durationMs`，bounded 聚合，每 25 次 `log.debug("search.perf")`（prod 静默）；`getSearchPerfSnapshot()` 供验证 → [`search-client.ts`](../../../src/workers/search-client.ts)（单测覆盖 inline 路径）。
- [x] `observeLongTasks(cb)` 已就绪（overlay 在 Phase 2 挂载量 `open→paint`/`longtask`）。
- [ ] **（待用户实测）** 用 6k/12k 库 **prod build** 复测，记录 before 数值（`query latency` p95 / `longtask max`）进 §11 变更日志。— 本环境无真实 6k 库 + 无法跑 prod，数值须用户侧采集。

> **说明**：`variant cache miss` 计数（量化抖动）未单独加 —— Phase 3 会直接移除 `MAX_VARIANT_CACHE_SIZE` 抖动路径；`query latency` p95 的 before/after 已足以证明根因与修复。

#### Phase 1 Checklist
- [x] `PerfSampler` / `percentile` / `observeLongTasks` 纯函数单测通过（12 例）
- [x] worker queryDuration + 主线程 latency 接入，`getSearchPerfSnapshot()` 可读
- [x] 指标代码 prod 静默（`log.debug`）、无行为副作用（搜索结果不变，client 单测通过）
- [ ] **（待用户实测）** 6k 库 `query latency` before p95 已记录（确认 ≈3s 量级）
- [ ] **（待用户实测）** 确认键入时主线程无 longtask（坐实「worker 计算」根因）
- [ ] **（待用户实测）** 确认二次开窗仍卡（坐实「同步突发」根因，排除词典首载）

### Phase 2: 消除开窗同步突发（pre-warm + defer）

**Goal:** ⌘F 开窗无掉帧。把重派生移出「开窗那一帧」。

**实现**：用「sticky `hasOpened` latch + `useDeferredValue`」把重派生移出开窗帧（[`global-track-search.tsx`](../../../src/components/search/global-track-search.tsx)）。`const indexWarm = useDeferredValue(hasOpened)`：首次 ⌘F 时 `hasOpened` 同步翻 true → modal 当帧 paint；`indexWarm` 在下一 tick 以 transition 优先级翻 true → 索引/worker 快照在开窗帧之后才建；其后每次开窗已 warm。结果展示 memo 仍 gate 在 `open`（关闭态不渲染、不查询）。

**Tasks:**
- [x] 后台 warm：`searchRows` 改 gate 在 `indexWarm`（非 `open`）→ 首开后 worker 快照常驻、不再每次开窗触发首建；`useWorkerRowSearch` 内已 throttle 推送。
- [x] `artistIndex`/`albumIndex`/`searchRows` 由 `open` gate 改为 `indexWarm`（deferred latch），保证开窗帧先 paint。
- [x] `lyricFieldsByTrackId`（主线程解析全库歌词）gate 到 `indexWarm`，不在开窗帧跑。
- [x] 查询仍 gate 在 `open && searchText`（warm-but-closed 不扫描）；typecheck + 6 个搜索测试套件 66 例全绿，搜索行为无回归。
- [ ] **（待用户实测）** 复测 `open→paint` / `longtask max`（用 Phase 1 的 `observeLongTasks` + `getSearchPerfSnapshot`），对比 before 基线。

#### Phase 2 Checklist
- [x] 重派生（facet 索引 / 歌词解析 / worker 快照）不再 gate 在 `open`，改 deferred warm latch
- [x] 行为无回归（结果、scope、键盘导航：搜索测试套件全绿；查询门控不变）
- [ ] **（待用户实测）** 二次开窗无新增 ≥50ms longtask
- [ ] **（待用户实测）** 6k 库开窗主观无「顿一下」
- [ ] **（待用户实测）** warm 的内存/CPU 后台成本可接受（给出数值；对应 §10 Open Q6 warm 时机最终定夺）

### Phase 3: 预存变体 `IndexedRow` + 线性扫描 + 增量维护 ★核心

**Goal:** 把转写从「每键 O(rows×fields)」搬到「库变更增量一次」并随 row 存好（`IndexedRow`），查询线性扫预存变体、零转写；增删改增量维护,绝不全表重建。语义逐位不变。调研证实 6k–20k 此方案即 sub-100ms，**不引倒排**。

**实现**：[`src/workers/search-index.ts`](../../../src/workers/search-index.ts)（纯函数 + 增量索引）+ worker 接入（[`search-worker.ts`](../../../src/workers/search-worker.ts)）；单测 [`search-index.test.ts`](../../../src/workers/search-index.test.ts)。

**Tasks:**
- [x] 新增 `src/workers/search-index.ts`：
  - `IndexedRow`（free/artist/album/tags 各 field 的预存变体数组）+ 纯构建 `buildIndexedRow(IndexableRow)`（用现有 `searchVariants`）。
  - 增量接口 `addRow` / `removeRow` / `updateRow` + `setRows`（diff by id，返回 `{added,updated,removed,reused}`；线性扫方案：`Map<id,{source,indexed}>` 增删一项，未变行 shallow-compare 复用）。
  - 查询 `queryIndexedRows` / `scoreIndexedRow`：线性扫，query 变体 × 预存 field 变体跑 `scoreVariants`，分级 tier 排序 —— **逐位 mirror** `scoreRow`/`queryRows`，仅 field 变体来源不同。
- [x] worker `set-rows`：`await dictionariesReady` 后 `index.setRows`（按 id diff，未变行 100% 复用）→ 转写搬到 set-rows 时；并回传 `index-stats`（`buildMs`/delta/size）供 client `log.debug`（cold/incremental build 指标）。
- [x] worker `query`：走 `index.query`，零 field 转写（仅 query token）。
- [x] 纯函数单测：**parity** —— 12 条查询（pinyin 全拼/首字母、kana/romaji、`artist:`/`album:`/`#tag` scope、空查询、substring 词中间 `light`、subsequence 跳字、无匹配）`index.query` 与 `queryRows` **逐位一致**；**增量 ≡ 全量** —— add/remove/update 序列与 `setRows(全量)` 结果等价；`setRows` reuse 计数验证「不全表重建」；`removeRow` 生效。（71 例全绿，tsc 0 错）
- [ ] **（本期未做，移至 Phase 3.1 / Phase 4）** worker 内分块 + yield 冷建；歌词变体第二趟懒补；`resultCache` + 增量收窄。当前冷建在 worker 内一次性构建（已离主线程，主线程不卡）；6k 体量下足够，分块留待 20k+ 或实测冷建过长时加。
- [ ] **（待用户实测）** 6k/12k prod 复测 `query latency`（应从 ≈3s → sub-100ms）/ `cold build` / `worker heap`。

> **`MAX_VARIANT_CACHE_SIZE=4000` 抖动**：根因已消失 —— 查询不再对 field 调 `searchVariants`（用 `IndexedRow` 预存变体），缓存仅在冷建（每 field 一次）+ query token（极少）用到，4000 上限不再抖动。故 `search-transliterate.ts` 不改（保留无害），降低改动面与风险。
> **inline fallback**（无 Worker / 测试）保留 `queryRows`（与 dict 加载时序无关、始终正确），与索引路径已由 parity 单测证等价。

#### Phase 3 Checklist
- [x] **parity**：`index.query` 与 `queryRows` 12 查询逐位一致（拼音/首字母、假名/罗马音、`#tag`、`artist:`/`album:`、空查询、**substring 词中间、subsequence 跳字** 全保留，无功能回退）
- [x] 增删改走增量接口，**不触发全表重建**（`setRows` reuse 计数单测 + 增量 ≡ 全量单测证明）
- [x] 转写搬到 set-rows（`await dictionariesReady` 保证全变体，非降级）；查询零 field 转写
- [x] tsc 0 错；71 搜索测试全绿；改动面仅 4 文件（+1 新 + 1 测试）
- [ ] **（待用户实测）** 6k 库 `query latency` p95 ≤ 80ms（从 ≈3s 降下来）
- [ ] **（待用户实测）** 冷建期间主线程 0 个新 longtask（worker 内构建，理论零阻塞，待 prod 确认）
- [ ] **（待用户实测）** `worker heap` 增量在预算内；12k/20k 退化曲线（不达标 → 触发 Phase 4）

### Phase 4: 倒排收窄 / 超大库调优 / 持久化（仅 20k+ 实测不达标才做）

**Goal:** **仅当 Phase 3 实测在 20k+ 不达标时启用。** 在 `IndexedRow` 之上叠倒排先收窄候选，再线性扫候选集；并保证冷查询不长任务化、必要时持久化。

**Tasks:**
- [ ] 倒排 `postings: Map<token, Set<rowId>>` + `rowToTokens`（token 取自变体）；查询先取候选交集再线性扫候选集；增删改同步维护 postings。
- [ ] 增量收窄：扩展查询只在上次候选集里扫。
- [ ] 冷查询 / 超大库：查询路径分批 + `await` 让步，避免 worker 内单次超长任务（worker 内，主线程本就不受影响）。
- [ ] 若 `cold build` 实测过长：评估把 `IndexedRow`/`postings` 持久化到 IndexedDB（需 bump DB version + upgrade + 索引↔tracks 一致性维护）—— 仅当内存态重建确实痛时才做。
- [ ] `log` 任何 cap / 采样 / 截断（不可静默截断，与 §4 规则一致）。

#### Phase 4 Checklist
- [ ] 20k 库 latency 达标（倒排收窄后）且冷查询不产生不可中断超长任务
- [ ] 倒排增量维护与全量重建等价（单测）
- [ ] 若做持久化：重启免重建,且索引与 tracks 一致性有单测覆盖
- [ ] 任何结果上限/截断都有 `log` 且在 UI 可解释

---

## 7. Out of Scope

- **引入第三方搜索引擎库**（FlexSearch / Lunr / MiniSearch / orama 等）：倒排**自研**。第三方 tokenizer 不认我们的拼音/假名变体体系,接进来 = 两套事实来源。若 Phase 3/4 后仍不达标，另开 dependency manifest review PRD 评估。
- **改 IndexedDB schema / bump DB version**：默认纯内存索引,不动持久层。索引持久化仅作 Phase 4 的 fallback（冷建实测过长才考虑）。
- **改搜索语义 / 排序 tier / transliteration 规则**：只搬计算时机，结果须逐位一致。
- **在线源（网易云/Bilibili/YouTube）搜索性能**：在线是网络 IO 路径（`useOnlineSourceSearch`），与本地索引无关，不在此 PRD。
- **页面内搜索框（`SearchPage` 的 `trackQuery` 等）**：本 PRD 聚焦 ⌘F overlay；若同源问题（同一 worker / 同一 `searchVariants`），Phase 3 的索引升级会顺带受益，但验收以 overlay 为准。
- **hidden flag / runtime kill switch**：回退 = `git revert` + 重新发版，不藏 `localStorage`/URL/`window.*` 开关（沿用 `feedback_no_hidden_backend_flags`）。

---

## 8. Security / Privacy Considerations

- **本地优先不变**：索引全在设备本地（worker 内存），无任何出站请求、无遥测上报。
- **不上报内容**：性能 `log` 只走 `logger.debug`（prod 静默），只含规模/耗时数字（row 数、ms、heap MB），**永不**含 track 标题 / 歌词 / note / 文件名 / 查询词。
- **BYOK / 密钥纪律**：本 PRD 不触碰任何 key / endpoint。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260610 多语言转写搜索 PRD](../20260610-muzero-multilingual-transliteration-search-prd/20260610-muzero-multilingual-transliteration-search-prd.md) | 当前转写 tier / worker 搜索的来源；本 PRD 在其上做索引化 |
| [prd-create.md §4 性能/卡顿 PRD 附加要求](../../../.cursor/commands/prd-create.md) | 「观测先行、区分耗时与呈现延迟、prod 复测」方法学 |
| `src/components/search/global-track-search.tsx` | ⌘F overlay 主体（症状 1 派生突发所在） |
| `src/workers/search-worker.ts` / `search-client.ts` | off-thread 查询（症状 2 全扫所在） |
| `src/lib/search-core.ts` / `search-transliterate.ts` | 比分核心 + 转写 + `MAX_VARIANT_CACHE_SIZE`（抖动根因） |

### 9.1 联网调研来源（2026-06-15，deep-research 多源对抗验证）

| Source | Quality | 用于支撑 |
|--------|---------|----------|
| [uFuzzy（leeoniya）](https://github.com/leeoniya/uFuzzy) + [compare bench](https://leeoniya.github.io/uFuzzy/demos/compare.html) | primary | 「6k–20k 线性扫预存 key 即 sub-100ms，未必需倒排」 |
| [Fuse.js performance](https://www.fusejs.io/performance.html) | primary | Bitap 线性扫，10k 项索引创建 ~28ms（近即时） |
| [ES pinyin 插件](https://github.com/medcl/elasticsearch-analysis-pinyin) | primary | 索引时展开全拼+首字母+连写（变体索引时展开是共识） |
| [ES kuromoji analyzer](https://www.elastic.co/guide/en/elasticsearch/plugins/master/analysis-kuromoji-analyzer.html) | primary | 日文字典形态分词（非 n-gram） |
| [Meilisearch tokenization](https://www.meilisearch.com/docs/learn/indexing/tokenization) | primary | CJK 自动分词（零配置≠最优质量的 caveat） |
| [Robertson/Zaragoza BM25/BM25F](https://arxiv.org/pdf/0911.5046) | primary | 歌词长文多字段排序标准 = BM25F |
| [MiniSearch docs](https://lucaong.github.io/minisearch/classes/MiniSearch.MiniSearch.html) | primary | tombstone + 延迟 vacuum 增量模式 |
| [Lunr #284](https://github.com/olivernn/lunr.js/issues/284) + [upgrade guide](https://lunrjs.com/guides/upgrading.html) | primary | Lunr v2 索引不可变 → 改一文档全量重建（淘汰） |
| [Orama insert/remove/update](https://docs.orama.com/open-source/usage/insert/) | primary | 库支持增量,但无原生拼音/假名 |
| [Solr/Lucene segment merging](https://solr.apache.org/guide/solr/latest/configuration-guide/index-segments-merging.html) | primary | 生产级增量 = 不可变段 + tombstone（Phase 4 倒排可借鉴） |

> ⚠️ caveat：uFuzzy 对比是作者自家 benchmark（有立场）且语料 16.2 万（比目标大 8–27×），绝对延迟不可直接套用 —— 但「线性扫在我们量级够快」的排序结论稳。CJK 自动分词「零配置」≠ 相关性最优。

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 匹配语义：substring/subsequence 怎么办？ | **Resolved** | **全保留**：现有分级 tier（exact/prefix/substring/subsequence）原样保留，预存变体线性扫即可覆盖 |
| 2 | 6k–20k 是否需要倒排索引？ | **Resolved（调研）** | **Phase 3 不引倒排**：线性扫预存 key 即 sub-100ms；倒排降为 Phase 4 仅 20k+ 不达标才做 |
| 3 | 引第三方搜索库（FlexSearch/Orama/MiniSearch）? | **Resolved（调研）** | **不引**：无库原生支持拼音/假名,转写层必自研,引库净收益为负;Lunr v2 索引还不可变 |
| 4 | 索引持久化到 IndexedDB? | **Resolved（默认）** | 默认**内存态 + worker 内分块重建**,不动 DB；冷建实测过长才在 Phase 4 评估持久化 fallback |
| 5 | 歌词长文排序是否引 BM25/BM25F？ | Open | 短字段现有 tier 够；若歌词正文匹配排序变差,再按 BM25F（field 加权）调,不在 Phase 3 范围 |
| 6 | warm 时机：进库即 warm vs 首次开窗后保持 warm？ | Open | 倾向「进库后台 warm」让 ⌘F 即时；Phase 2 用实测内存定夺 |
| 7 | 歌词变体懒补「第二趟」延迟多大可接受？ | Open | Phase 1 实测歌词趟冷建耗时后定;metadata 趟必须先 ready |
| 8 | 内存/latency 阈值多少触发 Phase 4？ | Open | Phase 1 基线 + Phase 3 的 12k/20k 实测后在 PR 给阈值 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-15 | MUZERO Team | Initial draft — 根因分析（开窗同步突发 + 变体缓存抖动）+ 4 phase 计划 |
| 2026-06-15 | MUZERO Team | owner 决策落地：混合倒排 + 预存变体 + 增量增删改；持久化默认内存态、worker 内分块重建 |
| 2026-06-15 | MUZERO Team | **联网调研修正**：Phase 3 核心降为「预存变体 `IndexedRow` + 线性扫描」(调研证实 6k–20k 即 sub-100ms,倒排非必需)；倒排降到 Phase 4 仅 20k+ 不达标才做；确认不引第三方库(无库原生支持拼音/假名)；补 BM25F 为歌词排序 open question；补 §9.1 调研来源 |

---

> **Note:** 本 PRD 优先改既有文件，唯一新增 `search-index.ts`（`IndexedRow` 预存变体 + 纯函数，带单测）。核心修复 Phase 3：转写在索引时一次并随 row 存好,查询线性扫预存变体(零转写)、增删改增量维护,根除 `MAX_VARIANT_CACHE_SIZE=4000` 在大库下的缓存抖动。联网调研证实 6k–20k 线性扫预存 key 即 sub-100ms,倒排留到 Phase 4 仅 20k+ 不达标才做。冷建全程在 Worker 内分块,主线程零阻塞。
