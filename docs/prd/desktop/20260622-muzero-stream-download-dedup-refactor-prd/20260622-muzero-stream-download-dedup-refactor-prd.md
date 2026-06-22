# PRD: MUZERO 收藏夹同步下载路径去重重构（`downloadPlaylistVideos` 抽公共脊柱 + 入队循环收敛）

**Status:** Completed
**Created:** 2026-06-22
**Author:** DoodleBear
**Module:** [`download-action.ts`](../../../../src/streamsrc/download-action.ts)（收藏夹/playlist 解析→建 track→入队下载的编排层；本 PRD 主战场）· [`streamed-track-repo.ts`](../../../../src/streamsrc/streamed-track-repo.ts)（`addHitsToSet` 把 hits 1:1 写成 `Track` 行，`AddHitsResult.tracks` 已在 WIP 加好）· [`source-detect.ts`](../../../../src/streamsrc/source-detect.ts)（`isTrackCacheableToDevice` 唯一裁决「可缓存到本地」）· [`playlist-import-dialog.tsx`](../../../../src/components/stream/playlist-import-dialog.tsx)（`syncInto` re-sync 调用点，行为不变）· [`perf-control-bridge.ts`](../../../../src/dev/perf-control-bridge.ts)（dev-only 性能压测唯一调用 `downloadHitsAsVideo`）

> 承接 [`20260622-muzero-unified-background-progress-notification`](../20260622-muzero-unified-background-progress-notification-prd/20260622-muzero-unified-background-progress-notification-prd.md)（统一左下角后台进度指示器）与 [`20260621-muzero-download-queue-resume-autosync`](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md)（`db.downloadJobs` 持久化下载队列 + resume/autosync）。本 PRD 是「收藏夹 re-sync 走持久化队列」这个 WIP 改动**提交前**的结构性清理——功能行为正确且已有测试覆盖，唯一问题是实现把可避免的重复**烤进了代码**。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
| --- | --- | --- | --- |
| 1 | 抽 `resolvePlaylistHits` 头部 + `addAndQueuePlaylistVideos` 脊柱 + 删死守卫（Finding 1 + 3 + Q2 头部去重） | ✅ Completed | [§6 Phase 1](#phase-1抽-addandqueueplaylistvideos-公共脊柱--删死守卫finding-1--3) |
| 2 | 收敛入队循环 / 删除 `downloadHitsAsVideo`（Finding 2，dev-only） | ✅ Completed | [§6 Phase 2](#phase-2收敛入队循环--退役-downloadhitsasvideofinding-2dev-only) |

**Status Legend:** 🔲 Not Started · 🔄 In Progress · ✅ Completed · ⚠️ Blocked

> Phase 顺序（prd-create.md §0/§3「基础设施先于覆盖广度」）：先抽 canonical helper 把高价值、行为保持的去重落地（Phase 1），再处理 dev-only 的入队循环收敛（Phase 2）。两个 Phase 都是行为保持型重构——**全程现有测试必须保持绿**，回退 = `git revert`。

---

## 1. Overview

### 1.1 Background

正在评审的（**未提交、工作区**）改动把收藏夹/playlist re-sync 路径接进了持久化下载队列（`db.downloadJobs`）：re-sync 进**显式 set** 时，新增的 MV 会就地下载，并在统一的左下角指示器里显示进度（旧的 `addStreamedPlaylistToSet` 路径只把音频缓存进内存 blob、无进度）。**功能行为是正确的，且核心契约已被现有单测钉死**。问题不在功能，而在实现**把可避免的重复烤进了代码**——这正是提交前要清理掉的坏味道。

具体坏味道枚举（行号对齐当前工作区源码）：

- **重复路径（PRIMARY）**：[`downloadPlaylistVideos`](../../../../src/streamsrc/download-action.ts)（`download-action.ts:222-253`，签名 line 222）与 [`downloadPlaylistVideosToSet`](../../../../src/streamsrc/download-action.ts)（`download-action.ts:265-290`，签名 line 265）尾部约 80% 是同一段代码。两者**只在一个概念上不同**：目标 set 怎么解析。
  - `downloadPlaylistVideos`：find-or-create 一个 `streamPlaylistRef`-绑定的 set（`findSessionByStreamPlaylist` → 否则 `createSession`，并在**新建时**按 `opts?.coverUrl` 调 `cacheStreamPlaylistCover`，`download-action.ts:233-244`）。
  - `downloadPlaylistVideosToSet`：直接吃一个 `targetSetId`。
  - **尾部逐字节相同**：`addHitsToSet` → `cacheStreamPlaylistTrackCovers` → quality 解析 → **同一个 pending filter** → `enqueueHitsForDownload`。`downloadPlaylistVideos` 尾部（`download-action.ts:245-252`）与 `downloadPlaylistVideosToSet` 尾部（`download-action.ts:276-289`）只差 (a) 解构 `{ tracks }` vs `{ added, skipped, tracks }`、传 `set.id` vs `targetSetId` + `onProgress`，(b) `set.id`↔`targetSetId` 变量名。`enqueueHitsForDownload` 调用点分别在 `download-action.ts:251` 与 `download-action.ts:288`。
  - **头部也部分重复**：`getSettings` + `makeSource(sourceId, settings.streamSources?.[sourceId]?.cookie)` + `if (!source?.importPlaylist) return …` + `await source.importPlaylist(mediaId)` + 空长度守卫（`download-action.ts:227-231` vs `download-action.ts:271-275`）。但两者**空返回 shape 不同**、且 `downloadPlaylistVideos` 头部还带 find-or-create + 新建封面缓存——所以头部干净共享需要额外一层（见 §10 Q2），**不是 Phase 1 必做**。
- **第三份近重复的入队循环（Finding 2）**：本次改动新增的 [`enqueueHitsForDownload`](../../../../src/streamsrc/download-action.ts)（`download-action.ts:415-431`，签名 line 415）是旧 [`downloadHitsAsVideo`](../../../../src/streamsrc/download-action.ts)（`download-action.ts:201-215`，签名 line 201）的**严格超集**——同一个 per-item enqueue 循环，只多了 `opts.sessionId` 和一个可注入的 `enqueue` 形参。`downloadHitsAsVideo` 的**唯一调用方**是 dev-only 性能压测：[`perf-control-bridge.ts:772`](../../../../src/dev/perf-control-bridge.ts)（动态 `import`）+ line 776（调用，位于 `payload.importId && payload.downloadAll` 分支内）。无任何生产/运行时调用方。
- **休眠死代码（Finding 3）**：pending filter 写的是 `hits.filter((_, i) => tracks[i] && isTrackCacheableToDevice(tracks[i]))`（`download-action.ts:250` 与 `download-action.ts:287`）。`tracks[i] &&` 守卫掩盖了你**刚刚加进去**的 1:1 契约——`addHitsToSet`（`streamed-track-repo.ts:134-154`）在 `streamed-track-repo.ts:147-148` **无条件** `ids.push`/`tracks.push` 每个 hit 一行，所以对合法 `i`（`0 ≤ i < hits.length`），`tracks[i]` 永不为 `undefined`。守卫是死代码。

**矛盾点**：这个改动一边新增了诚实的 1:1 契约（`AddHitsResult.tracks`，`streamed-track-repo.ts:119-127`，字段文档在 124-126），一边又用 `tracks[i] &&` 守卫去防一个该契约保证不会发生的 `undefined`——自己造的契约自己又不信。同时它把「解析 set → 建 track → 入队」这条尾部脊柱抄了两份，把入队循环抄了三份。

**本 PRD 一句话目标**：在**不改变任何行为**的前提下，把 `download-action.ts` 里这条 re-sync 下载尾部脊柱收敛到**单一 canonical helper**（`addAndQueuePlaylistVideos`），删掉死守卫，并让三份入队循环收敛到 `enqueueHitsForDownload`——让去重在提交前落地，而不是把重复烤进 main。

> **决策已定（不再讨论）：**
> - 优先方案 = **抽私有脊柱 helper `addAndQueuePlaylistVideos`**，删掉重复尾部，**零新增间接层**。
> - **拒绝**「合成单函数 + 可选 `targetSetId` mode」的替代方案——它把诚实的重复换成了 nullable-mode 分支，是错误方向（违反「no nullable modes」纪律，详见 §10 Q1）。
> - 头部（settings→source→importPlaylist→空守卫）**也部分重复**——按 Q2 决策**一起重构（已实现）**：抽 `resolvePlaylistHits(sourceId, mediaId): Promise<{ hits, settings } | null>`，source 不能导入或空 playlist 返回 `null`，两调用点各自映射自己的空 shape（不合成单函数、不引入可选 `targetSetId` mode）。
> - 已识别的 NON-ISSUES（`playlist-import-dialog.tsx` 的四处 `defaultDownloadsVideo` 分支、`AddHitsResult.tracks` 的新增、可注入 enqueue 测试缝、pending filter「只入队未本地化」语义、`notification-stack.tsx` 既有 `rounded-md` 样式）**一律不动**——明确记录为 Out of Scope（§7），防止有人「顺手修」。

### 1.2 Target Users

| User | Need | 本 PRD 如何满足 |
| --- | --- | --- |
| MUZERO 维护者（DoodleBear，单人 owner + AI 协作） | 提交前把 WIP 的可避免重复清掉，使收藏夹下载尾部脊柱只有一个真相点，后续接新 stream source / 改 quality 策略时不必同步改两三处 | 抽 canonical helper + 删死代码，**行为完全不变**，现有测试即回归护栏 |

### 1.3 Core Value

1. **复用而非新造、行为完全不变**（prd-create.md §0「利用已有代码」+ 模板尾注「modification over creation」）：本 PRD **不新增任何功能、不新增任何文件**，只重排 `download-action.ts` 内部的去重逻辑——抽一个**私有** helper、删一段死守卫、把三份循环收敛成一份。输入/输出/队列顺序/建 track 行为逐项保持。
2. **向单一裁决点收敛**（CLAUDE.md 规则 5 外延）：CLAUDE.md 规则 5 反复强调「不要散落 `if (provider===…)` / `if (kind===…)` 分支，提炼 canonical helper、向单一裁决点收敛」。同一纪律适用于 download/streamed-track 路径——本重构正是消除「同一脊柱抄两份、同一循环抄三份」的重复分支。
3. **本地优先、无 hidden flag**（CLAUDE.md 规则 1 + 规则 3）：重构不引入任何出站请求、服务端、遥测；不引入任何 `localStorage`/URL/`window.*` 隐藏开关。回退 = `git revert`（§8）。

---

## 2. System Architecture

### 2.1 调用图：before → after（去重 / 收敛）

```
BEFORE（当前工作区 — 尾部脊柱抄两份、入队循环抄三份）
─────────────────────────────────────────────────────────────────────
 playlist-import-dialog.tsx
   ├─ createNewSet (video 分支, :83-90) ──▶ downloadPlaylistVideos(sourceId, mediaId, opts?)
   │                                          download-action.ts:222-253
   │                                          ├ getSettings / makeSource(.,cookie) / !importPlaylist 守卫 ┐
   │                                          ├ importPlaylist(mediaId) / 空守卫(→{queued:0,setId:null})  │ 头部
   │                                          ├ let set = findSessionByStreamPlaylist ?? createSession    │ ← 唯一真差异
   │                                          │     (新建时按 opts.coverUrl 调 cacheStreamPlaylistCover)  ┘   (find-or-create)
   │                                          ├ addHitsToSet(set.id, hits) → { tracks }                  ┐
   │                                          ├ cacheStreamPlaylistTrackCovers({ sessionId:set.id,hits })│
   │                                          ├ quality 解析                                              │ 尾部
   │                                          ├ pending = filter(tracks[i] && isCacheable) ◀死守卫        │ (逐字节重复)
   │                                          └ enqueueHitsForDownload(pending,{sessionId:set.id,quality})┘
   │                                              download-action.ts:415-431  ← per-item enqueue 循环 #1
   │
   └─ syncInto (defaultDownloadsVideo 分支, :104-110) ──▶ downloadPlaylistVideosToSet(sourceId, mediaId, targetSetId, opts?)
                                                          download-action.ts:265-290
                                                          ├ getSettings / makeSource(.,cookie) / !importPlaylist 守卫 ┐ 头部
                                                          ├ importPlaylist(mediaId) / 空守卫(→{added:0,skipped:0,queued:0})┘
                                                          ├ addHitsToSet(targetSetId,hits,_,onProgress) → {added,skipped,tracks}┐
                                                          ├ cacheStreamPlaylistTrackCovers({ sessionId:targetSetId,hits })      │
                                                          ├ quality 解析                                                        │ 尾部
                                                          ├ pending = filter(tracks[i] && isCacheable) ◀死守卫                  │ (逐字节
                                                          └ enqueueHitsForDownload(pending,{sessionId:targetSetId,quality})     ┘  =上面)

 perf-control-bridge.ts:772/776 (dev-only) ──▶ downloadHitsAsVideo(hits, { quality })
                                                download-action.ts:201-215  ← per-item enqueue 循环 #2
                                                (是 enqueueHitsForDownload 的子集：无 sessionId / 无注入缝)

 enqueuePartsForDownload (download-action.ts:393-407)  ← 映射 PARTS 不是 hits，真正不同，不动
─────────────────────────────────────────────────────────────────────

AFTER（尾部脊柱单一真相点 + 入队循环收敛 + 无死守卫）
─────────────────────────────────────────────────────────────────────
 playlist-import-dialog.tsx (调用点、行为均不变)
   ├─ downloadPlaylistVideos(sourceId, mediaId, opts?)        download-action.ts
   │     ├ <头部> + find-or-create(含新建封面缓存)            ← 各自保留(唯一真差异)
   │     ├ quality = opts?.quality ?? settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY
   │     └ const { queued } = await addAndQueuePlaylistVideos(set.id, hits, quality)
   │       return { queued, setId: set.id }
   │
   └─ downloadPlaylistVideosToSet(sourceId, mediaId, targetSetId, opts?)
         ├ <头部> + targetSetId(无 find-or-create)            ← 各自保留(唯一真差异)
         ├ quality = opts?.quality ?? settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY
         └ return addAndQueuePlaylistVideos(targetSetId, hits, quality, opts?.onProgress)

   ┌──────────────────────────────────────────────────────────────────────┐
   │  NEW (private) addAndQueuePlaylistVideos(setId, hits, quality, onProgress?)  │ ← canonical 尾部脊柱
   │    const { added, skipped, tracks } = await addHitsToSet(setId, hits, undefined, onProgress)
   │    void cacheStreamPlaylistTrackCovers({ sessionId: setId, hits })
   │    const pending = hits.filter((_, i) => isTrackCacheableToDevice(tracks[i]))  ← 无死守卫(i 索引 1:1 tracks)
   │    const queued  = await enqueueHitsForDownload(pending, { sessionId: setId, quality })
   │    return { added, skipped, queued }
   └──────────────────────────────────────────────────────────────────────┘

 perf-control-bridge.ts (dev-only) ──▶ enqueueHitsForDownload(hits, { quality })  ← 收敛到唯一循环
 downloadHitsAsVideo ─────────────────────────────────────────────────── 删除 / 一行委托
 enqueuePartsForDownload ───────────────────────────────────────────────── 不动（PARTS 语义不同）
─────────────────────────────────────────────────────────────────────
```

### 2.2 Technology Stack

| Component | Technology / Canonical Helper | Rationale |
| --- | --- | --- |
| re-sync 下载尾部脊柱 | **NEW private** `addAndQueuePlaylistVideos(setId, hits, quality, onProgress?)`（[`download-action.ts`](../../../../src/streamsrc/download-action.ts)） | 把两函数逐字节相同的尾部收敛到单一真相点，零新增间接层（CLAUDE.md 规则 5；prd-create.md「modification over creation」） |
| 「可缓存到本地」唯一裁决 | [`isTrackCacheableToDevice`](../../../../src/streamsrc/source-detect.ts)（`source-detect.ts:36-43`） | pending filter 已经只走它；重构不改其语义。`status==="ready" && !blobId && !sourcePath && (remoteMediaUrl \|\| isStreamedTrack)`——新解析的 streamed track 可缓存→入队，已下载的（有 `blobId`）跳过 |
| hits→`Track` 行 1:1 写入契约 | [`addHitsToSet`](../../../../src/streamsrc/streamed-track-repo.ts)（`streamed-track-repo.ts:134-154`）+ [`AddHitsResult.tracks`](../../../../src/streamsrc/streamed-track-repo.ts)（`119-127`） | `tracks` 与 hits 严格 1:1、hit 顺序（`147-148` 无条件 push）——这是 Finding 3 删守卫的依据，**契约本身不动** |
| 单一 per-item 入队循环 | [`enqueueHitsForDownload`](../../../../src/streamsrc/download-action.ts)（`download-action.ts:415-431`），`opts.sessionId` 设为可选 | 旧 `downloadHitsAsVideo` 的严格超集；`EnqueueInput.sessionId` 本就可选，收敛三循环为一（CLAUDE.md 规则 5） |
| 持久化下载队列 | `db.downloadJobs`（承接 20260621 PRD） | `enqueueDownload` 写队列行；codename 层 `DownloadJob` 字段名跨重构保持稳定（CLAUDE.md 规则 4） |
| 日志出口 | [`src/lib/logger.ts`](../../../../src/lib/logger.ts) | 去重后若需日志统一走 logger，不直连 `console.*`（CLAUDE.md 规则 8） |
| 回归护栏 | Vitest 4（[`download-action.test.ts`](../../../../src/streamsrc/download-action.test.ts) / [`streamed-track-repo.test.ts`](../../../../src/streamsrc/streamed-track-repo.test.ts)） | 行为保持型重构必须有 before/after 等价护栏（CLAUDE.md 规则 7） |

### 2.3 Project Structure（标注 改/新/删/不改）

```
src/
├── streamsrc/
│   ├── download-action.ts            # 【改】抽私有 addAndQueuePlaylistVideos；downloadPlaylistVideos/
│   │                                 #   ToSet 尾部收敛到它；删两处死守卫；enqueueHitsForDownload.opts.sessionId 改可选
│   │                                 #   【删】downloadHitsAsVideo（或一行委托 enqueueHitsForDownload）
│   │                                 #   ✅ 公共导出签名/返回 shape 全部不变；头部(含 find-or-create + 新建封面缓存)保留
│   ├── download-action.test.ts       # 【不改*】仅测 enqueuePartsForDownload(:28-58)/enqueueHitsForDownload(:60-93)；
│   │                                 #   两公共函数无直接测试 → 抽脊柱无需改测；*可选加 1:1 重构等价断言
│   ├── streamed-track-repo.ts        # 【不改】AddHitsResult.tracks 已在 WIP 加好；本 PRD 不动其形状
│   ├── streamed-track-repo.test.ts   # 【不改】addHitsToSet 测试(:112-144)钉死 added/skipped/tracks 1:1/进度，是护栏
│   └── source-detect.ts              # 【不改】isTrackCacheableToDevice 语义不动
├── components/
│   ├── stream/
│   │   └── playlist-import-dialog.tsx# 【不改】syncInto/createNewSet/downloadAsVideo 四处 defaultDownloadsVideo 分支
│   │                                 #   是连贯 mode flag，NON-ISSUE；调用点与 import(:12-13) 不变
│   └── shell/
│       └── notification-stack.tsx    # 【不改】rounded-md 是既有 cosmetic，明确 Out of Scope（无样式变更）
└── dev/
    └── perf-control-bridge.ts        # 【改, Phase 2】:772/776 把 downloadHitsAsVideo 重指向 enqueueHitsForDownload（dev-only）
```

---

## 3. Data Model Design

### 3.1 形状变更

**无 schema 变更。** 所有数据形状/表/`DownloadJob` 行均不变，本 PRD 只重排 [`download-action.ts`](../../../../src/streamsrc/download-action.ts) 的去重逻辑、收敛入队循环。唯一相关的「形状」变化是 `AddHitsResult` 多了 `tracks: Track[]`（[`streamed-track-repo.ts:119-127`](../../../../src/streamsrc/streamed-track-repo.ts)）——但那是**正在评审的 WIP 本身已加好**的诚实 1:1 契约（NON-ISSUE，good change），本 PRD 不动它，只是依赖它来删 Finding 3 的死守卫。codename 层（DB 名 `muzero-db`、表名、id 前缀 `trk_`/`ses_`/`blb_`、`DownloadJob` 字段名）跨重构保持稳定（CLAUDE.md 规则 4）。

### 3.2 DB Version

⚠️ **无 schema 变更，不 bump version。** 本 PRD 是行为保持型重构，不触碰 [`muzero-db.ts`](../../../../src/db/muzero-db.ts) 的 stores/upgrade。

---

## 4. API Design（模块接口）

> 本 PRD 无网络 API（CLAUDE.md 规则 1：无后端、无出站新增）。这里描述被抽出/收敛的**内部模块接口**的 before/after 签名与调用点迁移。

### 4.1 新增私有脊柱 helper

```ts
// download-action.ts —— 两个 NEW private helper（均不导出，零新增公共表面）

// Q2：共享头部——解析 hits + settings；source 不能导入或空 playlist → null（两调用点各自映射空 shape）
async function resolvePlaylistHits(
  sourceId: StreamSearchHit["source"],
  mediaId: string,
): Promise<{ hits: StreamSearchHit[]; settings: Awaited<ReturnType<typeof getSettings>> } | null> {
  const settings = await getSettings();
  const source = makeSource(sourceId, settings.streamSources?.[sourceId]?.cookie);
  if (!source?.importPlaylist) return null;
  const hits = await source.importPlaylist(mediaId);
  if (hits.length === 0) return null;
  return { hits, settings };
}

// Finding 1：共享尾部脊柱
async function addAndQueuePlaylistVideos(
  setId: string,
  hits: StreamSearchHit[],
  quality: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ added: number; skipped: number; queued: number }> {
  const { added, skipped, tracks } = await addHitsToSet(setId, hits, undefined, onProgress);
  void cacheStreamPlaylistTrackCovers({ sessionId: setId, hits });
  // Finding 3：tracks 与 hits 1:1（addHitsToSet 无条件 push），`i` 索引进 1:1 的 tracks，
  // 对合法 i 永不 undefined → 无需 `tracks[i] &&` 守卫。
  const pending = hits.filter((_, i) => isTrackCacheableToDevice(tracks[i]));
  const queued = await enqueueHitsForDownload(pending, { sessionId: setId, quality });
  return { added, skipped, queued };
}
```

### 4.2 公共导出 before / after（签名与返回 shape **不变**）

```ts
// BEFORE — downloadPlaylistVideos (download-action.ts:222-253)
export async function downloadPlaylistVideos(sourceId, mediaId, opts?): Promise<{ queued: number; setId: string | null }> {
  const settings = await getSettings();
  const source = makeSource(sourceId, settings.streamSources?.[sourceId]?.cookie);
  if (!source?.importPlaylist) return { queued: 0, setId: null };
  const hits = await source.importPlaylist(mediaId);
  if (hits.length === 0) return { queued: 0, setId: null };

  let set = await findSessionByStreamPlaylist(sourceId, mediaId);            // ┐ 头部：find-or-create
  if (!set) {                                                                // │ (唯一真差异 + 新建封面缓存)
    set = await createSession({                                             // │
      name: opts?.name ?? mediaId, seedPrompt: "", config: { autoExtend: false },
      displayMode: "video", streamPlaylistRef: { source: sourceId, id: mediaId },
    });                                                                      // │
    if (opts?.coverUrl) void cacheStreamPlaylistCover({ sessionId: set.id, coverUrl: opts.coverUrl }); // │
  }                                                                          // ┘
  const { tracks } = await addHitsToSet(set.id, hits);                                    // ┐
  void cacheStreamPlaylistTrackCovers({ sessionId: set.id, hits });                       // │ 重复尾部
  const quality = opts?.quality ?? settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY; // │
  const pending = hits.filter((_, i) => tracks[i] && isTrackCacheableToDevice(tracks[i]));// │ ◀ 死守卫
  const queued = await enqueueHitsForDownload(pending, { sessionId: set.id, quality });   // ┘
  return { queued, setId: set.id };
}

// AFTER — 头部经 resolvePlaylistHits 收敛；find-or-create + 新建封面缓存保留；尾部委托脊柱
export async function downloadPlaylistVideos(sourceId, mediaId, opts?): Promise<{ queued: number; setId: string | null }> {
  const resolved = await resolvePlaylistHits(sourceId, mediaId);
  if (!resolved) return { queued: 0, setId: null };
  const { hits, settings } = resolved;

  let set = await findSessionByStreamPlaylist(sourceId, mediaId);
  if (!set) {
    set = await createSession({
      name: opts?.name ?? mediaId, seedPrompt: "", config: { autoExtend: false },
      displayMode: "video", streamPlaylistRef: { source: sourceId, id: mediaId },
    });
    if (opts?.coverUrl) void cacheStreamPlaylistCover({ sessionId: set.id, coverUrl: opts.coverUrl });
  }
  const quality = opts?.quality ?? settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY;
  const { queued } = await addAndQueuePlaylistVideos(set.id, hits, quality);
  return { queued, setId: set.id };
}
```

```ts
// BEFORE — downloadPlaylistVideosToSet (download-action.ts:265-290)
export async function downloadPlaylistVideosToSet(sourceId, mediaId, targetSetId, opts?): Promise<{ added: number; skipped: number; queued: number }> {
  const settings = await getSettings();
  const source = makeSource(sourceId, settings.streamSources?.[sourceId]?.cookie);
  if (!source?.importPlaylist) return { added: 0, skipped: 0, queued: 0 };
  const hits = await source.importPlaylist(mediaId);
  if (hits.length === 0) return { added: 0, skipped: 0, queued: 0 };
  const { added, skipped, tracks } = await addHitsToSet(targetSetId, hits, undefined, opts?.onProgress);// ┐ 重复尾部
  void cacheStreamPlaylistTrackCovers({ sessionId: targetSetId, hits });                                 // │
  const quality = opts?.quality ?? settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY;                 // │
  const pending = hits.filter((_, i) => tracks[i] && isTrackCacheableToDevice(tracks[i]));                // │ ◀ 死守卫
  const queued = await enqueueHitsForDownload(pending, { sessionId: targetSetId, quality });              // ┘
  return { added, skipped, queued };
}

// AFTER — 头部经 resolvePlaylistHits 收敛（无 find-or-create）；尾部一行委托脊柱
export async function downloadPlaylistVideosToSet(sourceId, mediaId, targetSetId, opts?): Promise<{ added: number; skipped: number; queued: number }> {
  const resolved = await resolvePlaylistHits(sourceId, mediaId);
  if (!resolved) return { added: 0, skipped: 0, queued: 0 };
  const { hits, settings } = resolved;
  const quality = opts?.quality ?? settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY;
  return addAndQueuePlaylistVideos(targetSetId, hits, quality, opts?.onProgress);
}
```

> 关键不变量：两个公共导出的**签名与返回 shape 一字不改**（`downloadPlaylistVideos` 仍返回 `{ queued, setId }`；`downloadPlaylistVideosToSet` 仍返回 `{ added, skipped, queued }`）。新建集的封面缓存（`cacheStreamPlaylistCover`）留在 `downloadPlaylistVideos` 头部、**不进脊柱**——脊柱只管「建 track 行 + 每曲封面缓存 + pending 入队」。两个不同空返回 shape 正是「不要合成单函数 + 可选 `targetSetId` mode」的理由（§10 Q1）。

### 4.3 入队循环收敛（Finding 2，Phase 2）

```ts
// BEFORE — 两份近重复循环
export async function downloadHitsAsVideo(hits, opts?) { // :201-215，dev-only 唯一调用（无注入缝、无 sessionId）
  for (const hit of hits) {
    await enqueueDownload({ source: hit.source, externalId: hit.externalId, title: hit.title, coverUrl: hit.coverUrl, quality: opts?.quality });
  }
  return { queued: hits.length };
}
export async function enqueueHitsForDownload(hits, opts, enqueue = enqueueDownload) { // :415-431
  for (const hit of hits) {
    await enqueue({ source: hit.source, externalId: hit.externalId, title: hit.title, coverUrl: hit.coverUrl, sessionId: opts.sessionId, quality: opts.quality });
  }
  return hits.length;
}

// AFTER — opts.sessionId 改可选（EnqueueInput.sessionId 本就可选），downloadHitsAsVideo 删除/一行委托
export async function enqueueHitsForDownload(hits, opts: { sessionId?: string; quality?: string }, enqueue = enqueueDownload) { ... }
// perf-control-bridge.ts:772/776 改为 import + 调 enqueueHitsForDownload(hits, { quality })
```

> 注意：`downloadHitsAsVideo` 返回 `{ queued: number }` 而 `enqueueHitsForDownload` 返回 `number`——dev harness 调用点（`perf-control-bridge.ts:776`，`downloaded = await downloadHitsAsVideo(...)`）只把结果塞进诊断 payload，重指向后改取 `number` 即可（harness 行为等价，无生产影响）。
>
> `enqueuePartsForDownload`（`download-action.ts:393-407`）**不动**——它映射的是 PARTS 不是 hits，是真正不同的语义，不属于这次收敛。

---

## 5. Frontend Design

### 5.1 页面 / 5.2 组件

**N/A** —— 无新增页面/组件，无 UI 渲染变更。[`playlist-import-dialog.tsx`](../../../../src/components/stream/playlist-import-dialog.tsx) 的 `syncInto`（`:99-116`，video 分支 `:104-110`）、`createNewSet` video 分支（`:83-90`）、`downloadAsVideo`（`:118-125`）以及对 `downloadPlaylistVideos`/`downloadPlaylistVideosToSet` 的 import（`:12-13`）**全部行为不变**——公共导出签名/返回 shape 不变，调用点无需改动。`notification-stack.tsx` 既有的 `rounded-md` 样式是 cosmetic，与本 dedup 无关，明确 Out of Scope（§7）。

### 5.3 State Management 纪律

不引入任何 Zustand state（CLAUDE.md 规则 6）：`addAndQueuePlaylistVideos` 是 `download-action.ts` 内的非响应式编排，留在模块作用域、不进 store；下载进度仍由统一指示器经 `db.downloadJobs` 的 `useLiveQuery` 读出（承接 20260621/20260622 PRD），列表读不塞进 Zustand。本 PRD 不改这条订阅链。

---

## 6. Implementation Plan

### Phase 1：抽 `resolvePlaylistHits` 头部 + `addAndQueuePlaylistVideos` 脊柱 + 删死守卫（Finding 1 + 3 + Q2）

**Goal**：把 `downloadPlaylistVideos` 与 `downloadPlaylistVideosToSet` 逐字节相同的**尾部**收敛到单一私有脊柱 `addAndQueuePlaylistVideos`，把重复的**头部**（settings→source→importPlaylist→空守卫）收敛到 `resolvePlaylistHits`（Q2 已决，一起重构），顺手删掉 1:1 契约保证不会触发的 `tracks[i] &&` 死守卫。高价值、行为保持，公共签名不变。

**Tasks**
- [x] 在 [`download-action.ts`](../../../../src/streamsrc/download-action.ts) 新增**私有**（不导出）`resolvePlaylistHits(sourceId, mediaId)`，返回 `{ hits, settings } | null`（source 不能导入或空 playlist → `null`）——共享头部（Q2）。
- [x] 在 [`download-action.ts`](../../../../src/streamsrc/download-action.ts) 新增**私有**（不导出）`addAndQueuePlaylistVideos(setId, hits, quality, onProgress?)`，body = §4.1（`addHitsToSet` → `cacheStreamPlaylistTrackCovers` → pending filter → `enqueueHitsForDownload`，返回 `{ added, skipped, queued }`）。
- [x] `downloadPlaylistVideos`：保留 find-or-create 头部（含新建时的 `cacheStreamPlaylistCover`）+ quality 解析，尾部改为 `const { queued } = await addAndQueuePlaylistVideos(set.id, hits, quality); return { queued, setId: set.id };`。
- [x] `downloadPlaylistVideosToSet`：保留 `targetSetId` 头部（无 find-or-create）+ quality 解析，尾部改为 `return addAndQueuePlaylistVideos(targetSetId, hits, quality, opts?.onProgress);`。
- [x] **Finding 3**：脊柱内 pending filter 落地为 `hits.filter((_, i) => isTrackCacheableToDevice(tracks[i]))`——去掉 `tracks[i] &&` 死守卫（两处旧守卫 `download-action.ts:250`/`:287` 随尾部删除一并消失）。
- [x] 确认两个公共导出的签名与返回 shape **一字不改**（`{ queued, setId }` / `{ added, skipped, queued }`），且新建集封面缓存仍在头部触发。
- [ ]（可选）在 [`download-action.test.ts`](../../../../src/streamsrc/download-action.test.ts) 加一条 1:1 重构等价断言：对同一组 hits，脊柱产出的 `queued` 与 pending 过滤（已 ready + 无 blobId vs 已有 blobId）结果与重构前一致。

**Phase 1 Checklist** ✅
- [x] `addAndQueuePlaylistVideos` 抽出，两公共函数尾部去重，零新增公共导出（私有 helper）。
- [x] 死守卫 `tracks[i] &&` 已删，pending filter 只走 `isTrackCacheableToDevice`。
- [x] **无行为变化**：[`download-action.test.ts`](../../../../src/streamsrc/download-action.test.ts)（`enqueuePartsForDownload`/`enqueueHitsForDownload` 直接测试，:28-58/:60-93）与 [`streamed-track-repo.test.ts`](../../../../src/streamsrc/streamed-track-repo.test.ts)（`addHitsToSet` added/skipped/`tracks` 1:1/逐 hit 进度，:112-144）全部保持绿——两个公共函数无直接测试，抽脊柱不需改测，只要签名/返回 shape 不变。
- [x] `tsc --noEmit` 干净（全项目）+ biome 干净（改动文件）+ streamsrc 单测 24/24；全量 vitest 3313 通过、3 跳过——唯一 1 例失败是 `player-store.test.ts:2031` 的 `waitFor` 超时（与本改动无关、隔离重跑 52/52 全绿，flaky）。
- [x] `playlist-import-dialog.tsx` 调用点零改动（文件未改）、公共签名/返回 shape 不变 → UI 行为结构性不变（靠签名不变 + 单测保证；未手动驱动 UI）。

---

### Phase 2：收敛入队循环 / 退役 `downloadHitsAsVideo`（Finding 2，dev-only）

**Goal**：把第三份近重复的 per-item 入队循环收敛到 `enqueueHitsForDownload`（它是严格超集），退役 dev-only 的 `downloadHitsAsVideo`。优先级低（dev-only），但本次改动正在主动壮大这个 cluster，趁早收住。

**Tasks**
- [x] 把 [`enqueueHitsForDownload`](../../../../src/streamsrc/download-action.ts)（`:415-431`）的 `opts.sessionId` 改为可选（`EnqueueInput.sessionId` 本就可选，无运行时影响）。
- [x] 删除 [`downloadHitsAsVideo`](../../../../src/streamsrc/download-action.ts)（`:201-215`），或保留为一行委托 `enqueueHitsForDownload(hits, { quality: opts?.quality })`。
- [x] 把 dev harness 唯一调用点 [`perf-control-bridge.ts:772/776`](../../../../src/dev/perf-control-bridge.ts) 的动态 `import` 与调用重指向 `enqueueHitsForDownload(hits, { quality })`（可不传 `sessionId`）；返回值由 `{ queued }` 变 `number`，相应调整诊断 payload 取值。
- [x] **不动** `enqueuePartsForDownload`（`:393-407`，PARTS 语义不同）。

**Phase 2 Checklist** ✅
- [x] 全代码库只剩两种入队循环：`enqueueHitsForDownload`（hits）+ `enqueuePartsForDownload`（parts）；`downloadHitsAsVideo` 已删或一行委托。
- [x] dev harness（`payload.importId && payload.downloadAll` 分支）经 `enqueueHitsForDownload` 仍能压测 downloadAll，行为等价。
- [x] **无单测变更**：无任何测试引用 `downloadHitsAsVideo`；`enqueueHitsForDownload` 现有测试（:60-93）保持绿。
- [x] `tsc --noEmit` + biome 干净；`downloadHitsAsVideo` 已删、dev harness 重指向、全量 vitest 仅 1 例无关 flaky（同上）。
- [x] grep 确认 `downloadHitsAsVideo` 无残留 import（生产 + dev 均无）。

---

## 7. Out of Scope

**显式声明不改（防「顺手修」）：**

- **`playlist-import-dialog.tsx` 四处 `defaultDownloadsVideo` 分支**（`syncInto :104-110` / `createNewSet :83-90` / `downloadAsVideo :118-125` + import :12-13）：一个连贯的 mode flag、一致应用、镜像既有 `createNewSet` 模式——**NON-ISSUE，不是 spaghetti**，新 `syncInto` 分支本身正确，保持不动。
- **`AddHitsResult.tracks: Track[]` 的新增**（`streamed-track-repo.ts:119-127`）：干净、文档完整的 1:1 契约，是本次 WIP 的 good change，保留。
- **可注入 enqueue 测试缝**（`enqueueHitsForDownload`/`enqueuePartsForDownload` 的 `enqueue = enqueueDownload` 形参）：镜像既有约定，good，保留。
- **「只入队未本地化」pending filter 语义**（经 `isTrackCacheableToDevice`）：真正的行为改进（已下载的 track 不重复入队），保留——本 PRD 只删它外面的死守卫，不改它本身。
- **`notification-stack.tsx` 的既有 `rounded-md` 样式**：cosmetic，与本 dedup 无关，不在本 PRD 处理（确认文件已是 `rounded-md`，无样式变更）。
- **`enqueuePartsForDownload`**（`:393-407`）：映射 PARTS 不是 hits，语义本就不同，不并入收敛。
- **头部去重（已纳入 Phase 1，不再 Out of Scope）**：原列为可选；按 Q2 决策已一起重构——抽 `resolvePlaylistHits` 共享头部，两调用点各自映射空 shape。
- **不新增任何 hidden flag / Settings 控件 / DB 字段 / 网络出站**：纯结构性重构，无 runtime toggle。

---

## 8. Security Considerations

本 PRD 是行为保持型代码质量重构，**不引入任何新安全面**：

- **无密钥 / 无 PII**：不触碰 BYOK key 或 settings 行；不读写任何凭据（CLAUDE.md 规则 2）。
- **无后端 / 无遥测**：不引入出站请求或 MUZERO 服务端；唯一既有出站（用户配置的 stream source `importPlaylist`）路径与 quota 不变（CLAUDE.md 规则 1）。
- **无 hidden flag**：不引入 `localStorage`/URL/`window.*` 隐藏开关；无 runtime kill switch。**回退 = `git revert` + 重新发版**（CLAUDE.md 规则 3 + prd-create.md「运营回退=git revert，不藏 flag」）。
- **Console / 日志**：去重后任何日志一律走 [`src/lib/logger.ts`](../../../../src/lib/logger.ts)，不直连 `console.*`（CLAUDE.md 规则 8）。本重构不新增日志点。
- **codename 层稳定**：DB 名 `muzero-db`、表名、id 前缀（`trk_`/`ses_`/`blb_`）、`DownloadJob` 字段名跨重构保持不变（CLAUDE.md 规则 4）。

---

## 9. Related Documents

| Document | Relation |
| --- | --- |
| [`20260622-muzero-unified-background-progress-notification`](../20260622-muzero-unified-background-progress-notification-prd/20260622-muzero-unified-background-progress-notification-prd.md) | 统一左下角后台进度指示器——本次 WIP 让 re-sync 的进度能显示在它上面 |
| [`20260621-muzero-download-queue-resume-autosync`](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md) | `db.downloadJobs` 持久化下载队列 + resume/autosync——本 PRD 重构的入队路径就写进它 |
| [`docs/prd/prd-template.md`](../../prd-template.md) | PRD 章节骨架来源 |
| CLAUDE.md「硬规则」1/2/3/4/5/6/7/8 | 决策依据（本地优先 / BYOK / 无 hidden flag / codename 分层 / canonical helper 收敛 / selector 纪律 / Vitest 回归 / logger） |
| prd-create.md §0 / 尾注 | 「利用已有代码 / modification over creation / Exception Policy」 |

---

## 10. Open Questions

| # | Question | Status | Decision |
| --- | --- | --- | --- |
| 1 | 是否把两个公共函数合成一个、用可选 `targetSetId` 来切换 find-or-create vs 显式 set？ | ✅ Decided | **否决。** 这是把诚实的重复换成 nullable-mode 分支——两函数的不同空返回 shape（`{queued,setId}` vs `{added,skipped,queued}`）会被迫塞进一个 nullable mode，违反「no nullable modes」纪律。保留两个薄头部 + 一个共享尾部脊柱，是正确方向。 |
| 2 | 头部（settings→source→importPlaylist→空守卫）也部分重复，要不要也抽？ | ✅ Decided（也需要，一起重构） | **抽 `resolvePlaylistHits`（已实现）**：返回 `{ hits, settings } \| null`（source 不能导入或空 playlist → `null`），两调用点各自映射自己的空 shape。不合成单函数、不引入可选 `targetSetId` mode（见 Q1）。 |
| 3 | Phase 1 是否需要为 `downloadPlaylistVideos`/`downloadPlaylistVideosToSet` 新增直接单测？ | ✅ Decided | 不强制。两公共函数当前无直接测试，抽脊柱保持签名/返回 shape 即可，现有 `enqueueHitsForDownload`/`addHitsToSet` 测试是回归护栏。可选加一条 1:1 等价断言（Phase 1 最后一个 Task）。 |
| 4 | Phase 2 `downloadHitsAsVideo` 删除 vs 一行委托，选哪个？ | ✅ Decided（删除） | **已删除**。唯一调用方 `perf-control-bridge.ts:772/776` 已重指向 `enqueueHitsForDownload(hits, { quality })`（包成 `{ queued }` 保持诊断 payload shape）；grep 确认无残留引用。 |

---

## 11. Document Change Log

| Date | Author | Change |
| --- | --- | --- |
| 2026-06-22 | DoodleBear | 初稿（Draft）。捕获「收藏夹 re-sync 走持久化队列」WIP 的提交前去重重构：Finding 1（抽 `addAndQueuePlaylistVideos` 尾部脊柱）+ Finding 2（收敛入队循环 / 退役 `downloadHitsAsVideo`）+ Finding 3（删 1:1 契约下的死守卫）。明确记录 NON-ISSUES 与「拒绝可选 `targetSetId` mode」决策。行为保持型，无 schema 变更，回退=git revert。 |
| 2026-06-22 | DoodleBear | 解决 Open Q2（也需要，一起重构）+ Q4（删除）。**实现完成**：抽 `resolvePlaylistHits` 头部 helper（Q2）+ `addAndQueuePlaylistVideos` 脊柱（Finding 1），去重 `downloadPlaylistVideos`/`downloadPlaylistVideosToSet`；删死守卫（Finding 3）；删 `downloadHitsAsVideo`、`enqueueHitsForDownload.opts.sessionId` 改可选、dev harness（`perf-control-bridge.ts`）重指向（Finding 2 / Q4）。`tsc --noEmit` 干净、biome 干净、streamsrc 单测 24/24 绿。Status → Completed。 |
