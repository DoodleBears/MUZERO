# PRD: 歌单内拖拽排序（多选模式 · Notion 式分数序）

**Status:** Completed（Phase 1–4 全实现：分数序核心 + 仓库层 + R2 rank 同步 round-trip + @dnd-kit 多选拖拽 UI[整选区移动 / drop 指示线 / 手动序门控]；~60 测绿，交互实测待真机 — 审计 2026-06-11）
**Created:** 2026-06-11
**Author:** DoodleBear / Product
**Module:** Sets / Library — 歌单内 track 顺序（drag-to-reorder）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 纯排序核心 + 仓库层（分数序算法 + lazy 物化 + reorder repo） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | R2 Sync 对齐（manifest rank 字段 + export/import round-trip + 整 session LWW） | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 多选模式拖拽 UI（@dnd-kit + 整选区块移动 + drop indicator + 手动序门控） | ✅ Completed（代码+单测；交互实测待真机） | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 打磨（正统 sortable + 虚线框 drop placeholder + 键盘/触摸 + 拖拽互斥 + 长按进入多选） | ✅ Completed（代码+单测；交互实测待真机；虚拟化回退见下） | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

歌单（Set / `DjSession`）详情页已经实现「点击切换多选模式」（[`track-list-section.tsx`](../../../src/components/library/track-list-section.tsx) 的 `useTrackSelection` + `BatchActionBar`），目前多选只支持**批量删除 / 移出歌单**。产品希望在多选模式下进一步支持**拖拽调整歌曲顺序**。

当前歌曲顺序的唯一真相是 [`DjSession.trackIds: string[]`](../../../src/db/types.ts)（数组下标即顺序，新歌 prepend 到队首 = 封面）。要支持「频繁拖拽 + 跨设备 R2 同步」，**直接重写整个 `trackIds` 数组**有两个问题：

1. **每次拖拽都改一大坨**：一次移动重排整个数组，逻辑变更集很大。
2. **R2 同步会互相覆盖**：manifest 现在以「数组顺序」承载顺序，两台设备各自重排不同歌曲后推送，整数组 last-write-wins 会让其中一方的重排**整体丢失**。

本 PRD 落地 **Notion Block 式分数序（fractional ordering）best practice**：每首歌在「歌单内」持有一个浮点 `rank`，**一次拖拽只更新被移动歌曲的一个 rank 值**（取相邻两者中点 `(X+Y)/2`）；当中点间隙收缩到 `epsilon`（浮点无法再二分）时，**一次性批量 renormalize** 整个歌单的 rank，之后又能用很久。这把「顺序」从「数组位置」升级为「每首歌一个可独立同步的标量」，从而：单次拖拽是 O(1) 逻辑变更，且**两台设备重排不同歌曲能干净合并**（per-track rank LWW）。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地用户** | 在歌单详情页整理自己的歌单顺序（手动策展） | 进入多选模式 → 拖拽重排 → 本地 IndexedDB 持久化 |
| **多设备用户** | 启用 R2 Sync，在 A 设备重排后希望 B 设备拉到同样顺序 | 重排写入 mutation log → push 进 manifest → 另一端 pull 合并 |

> 无后端、无账号、无权限系统（硬规则 #1）。R2 是用户自配 BYOK 云盘，唯一的「权限」是用户是否启用了某个 drive 的 sync。

### 1.3 Core Value

1. **手动策展**：歌单从「只能删」升级为「可任意排序」，回应 YouTube-Music / Spotify 的基础预期。
2. **单值更新 + 久用不重算**：一次拖拽只动一个 `rank`，分数序让重排几乎永远不需要整组重算（仅在 epsilon 收缩时批量 renormalize 一次）。
3. **跨设备干净合并**：顺序变成 per-track 标量后，不同设备重排不同歌曲不再互相覆盖，与现有 R2 mutation/LWW 同步范式一致。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                       歌单详情页 (SetDetailView, search-page.tsx)
                                    │  进入多选模式 (useTrackSelection)
                                    ▼
        ┌──────────────────────────────────────────────────────────┐
        │  Reorder UI 层（仅「手动顺序」可拖拽）                       │
        │  @dnd-kit DndContext + SortableContext                     │
        │  · 整选区作为一块移动（block move）                          │
        │  · DragOverlay 显示「拖拽中 N 首」                           │
        │  · drop indicator（插入位置高亮线）                          │
        │  · 与 TanStack Virtual 协作（autoScroll 把离屏行带进视口）   │
        └───────────────────────────┬──────────────────────────────┘
                                    │ onDragEnd(blockIds, targetIndex)
                                    ▼
        ┌──────────────────────────────────────────────────────────┐
        │  纯排序核心  src/player/set-order.ts （无 DB / 无 DOM）     │
        │  rankBetween / rankBefore / rankAfter / ranksForBlock       │
        │  needsRebalance / rebalance / orderedSetTrackIds            │
        │  ↑ 穷举单测（硬规则 #7）                                     │
        └───────────────────────────┬──────────────────────────────┘
                                    │ 计算出 {trackId → newRank}[]
                                    ▼
        ┌──────────────────────────────────────────────────────────┐
        │  仓库层  repositories.ts                                    │
        │  reorderTracksInSession(setId, blockIds, beforeId, afterId) │
        │  · lazy 物化 ranks（首次拖拽把数组下标 → i*SPACING）          │
        │  · 写 DjSession.trackRanks（additive 非索引，零 Dexie 迁移） │
        │  · recordSyncMutation("track-reordered-in-set", {ranks})    │
        └───────────────┬───────────────────────────┬──────────────┘
                        │ useLiveQuery 反应式回流      │
                        ▼                             ▼
              UI 即时重排（orderedSetTrackIds）   R2 Sync（Phase 2）
                                                manifest.tracks[].rank
                                                push / pull / 合并
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **排序算法** | 自研纯函数 `set-order.ts`（float + epsilon rebalance） | 复用 [`play-queue.ts`](../../../src/player/play-queue.ts) / [`queue.ts`](../../../src/player/queue.ts) 的「纯函数 + 穷举单测」纪律；零依赖，符合 best practice 的用户指定算法 |
| **持久化** | Dexie `DjSession.trackRanks?: Record<string, number>`（additive 非索引） | 镜像 `streamPlaylistRef` / `coverThumbhash` 的「附加非索引、**零版本 bump**」模式（数据模型规则）|
| **拖拽交互** | **@dnd-kit**（`@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/modifiers`） | 业界 best-practice DnD：内置键盘可达性 / 碰撞检测 / DragOverlay / autoScroll，与 TanStack Virtual 可协作。**新增依赖**，见 §7 与 Open Question Q1 |
| **虚拟化** | 既有 `@tanstack/react-virtual`（[`virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx)） | 歌单可达数百首，必须只挂载可见行；DnD 必须与虚拟化协作 |
| **多选状态** | 既有 [`useTrackSelection`](../../../src/hooks/use-track-selection.ts)（ephemeral 本地态） | 复用现有多选基础设施，不进 Zustand（规则 #6）|
| **R2 同步** | 既有 mutation log + manifest（[`r2-manifest-schema.ts`](../../../src/sync/r2-manifest-schema.ts) / [`r2-export-plan.ts`](../../../src/sync/r2-export-plan.ts)）| 新增一种 mutation action + manifest 加 `rank` 字段，复用 fold/import/conflict 管线 |

### 2.3 Project Structure

```
src/
├── player/
│   ├── set-order.ts           # 🆕 纯分数序核心（rank 计算 + rebalance + 排序裁决）
│   └── set-order.test.ts      # 🆕 穷举单测（硬规则 #7）
├── db/
│   ├── types.ts               # ✏️ DjSession 加 trackRanks?；SyncMutation.action 加 "track-reordered-in-set"
│   └── repositories.ts        # ✏️ 加 reorderTracksInSession()；prependTrackIds/remove 维护 rank 不变量
├── sync/
│   ├── r2-manifest-schema.ts  # ✏️ r2SetTrackSchema 加 rank?: number
│   ├── r2-export-plan.ts      # ✏️ 导出 rank；applySetMutation 处理 "track-reordered-in-set"
│   ├── r2-import-stream.ts    # ✏️ 按 rank 排序重建 trackIds + trackRanks
│   └── r2-pull-diff.ts        # ✏️ reorder mutation 纳入 per-track 冲突判定
├── components/library/
│   ├── virtual-track-list.tsx # ✏️ 接 @dnd-kit；reorder 模式渲染拖拽手柄 + drop indicator
│   ├── track-list-section.tsx # ✏️ 多选模式下挂 DndContext；传 reorder 回调 + 手动顺序 gating
│   ├── track-row.tsx          # ✏️ reorder 模式渲染 drag handle（≥44px 触摸区）
│   └── batch-action-bar.tsx   # ✏️（可选）多选栏提示「拖拽可排序」
├── pages/
│   └── search-page.tsx        # ✏️ SetDetailView 用 orderedSetTrackIds 派生顺序；判定 isManualOrder
└── i18n/locales/{en,zh,ja,ko}/common.json  # ✏️ reorder 相关文案
```

> 仅 `set-order.ts`(+test) 是新增文件 —— 属「新算法核心」类别，符合「registry/adapter 只 append」的精神（PRD 模板 §3）。@dnd-kit 属新 runtime 依赖，见 §7 取舍说明。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
DjSession (歌单)
├── trackIds: string[]              ← 成员真相（WHO 在歌单里）。维持不变。
└── trackRanks?: Record<id, number> ← 🆕 顺序真相（歌单内每首歌的分数序 rank）
                                       不变量：要么整体缺席（legacy，顺序=数组），
                                              要么覆盖 trackIds 全集（已物化，顺序=rank 升序）

显示/播放顺序 = orderedSetTrackIds(trackIds, trackRanks)
              = trackRanks ? stableSortByRank(trackIds) : trackIds
```

**为何 rank 存在 session 侧而非 track 侧**：一首 `Track` 可同时是多个歌单的成员（多个 `session.trackIds` 引用同一 `trackId`，见 [`prependTrackIds`](../../../src/db/repositories.ts)）。因此「歌单内顺序」是 **(set, track) 边**的属性，只能挂在 session 上（`trackRanks` map），不能挂在 track 行上。

**为何用 sidecar map 而非 join 表**：PRD 模板要求「优先改现有结构、避免大重构」。把 `trackIds: string[]` 换成 `{trackId, rank}[]` join 表会触及 prepend/remove/搜索派生/R2 导入导出/迁移所有路径。`trackRanks` 是**附加字段**，membership 路径几乎不动。

### 3.2 Database Schema

⚠️ **零 Dexie 版本 bump。** `trackRanks` 是非索引附加字段，与 `streamPlaylistRef` / `coverThumbhash` 同路径 —— Dexie 对非索引字段 schemaless，直接 `put` 更胖的对象即可，**不需要** `version(21)` 也不需要 `.upgrade()` 回填。

- **Current Schema:** [`muzero-db.ts`](../../../src/db/muzero-db.ts) 当前 v20；`sessions` 索引串 `"id, status, updatedAt"` 保持不变。
- **Required Changes:**
  - [`types.ts`](../../../src/db/types.ts) `DjSession` 加：
    ```typescript
    /**
     * 歌单内每首歌的分数序 rank（Notion-block 式）。一次拖拽只更新被移动歌曲的
     * 一个值（取相邻中点）；间隙收缩到 epsilon 时批量 renormalize。Additive、
     * 非索引（镜像 streamPlaylistRef）→ 无 Dexie bump。
     * 不变量：undefined（legacy，顺序=trackIds 数组）或覆盖 trackIds 全集。
     */
    trackRanks?: Record<string, number>;
    ```
  - `SyncMutation.action` union 加 `"track-reordered-in-set"`（[`types.ts`](../../../src/db/types.ts) 约 L823–851）。
- **Data Migration（lazy backfill，无离线迁移）:**
  - **读**：`orderedSetTrackIds(session.trackIds, session.trackRanks)` —— `trackRanks` 缺席时**原样返回 `trackIds`**（legacy 歌单按当前顺序展示，零行为变化）。
  - **写（首次拖拽物化）**：用户在某歌单第一次拖拽时，`reorderTracksInSession` 先 `materializeRanks(trackIds) = { id_i: i * RANK_SPACING }` 一次性写入全集，再 apply 这次移动。避免对潜在数百首的歌单做一次性全库迁移（符合本仓库「附加非索引、零迁移」偏好）。
- **不变量维护（membership 路径）:**
  - [`prependTrackIds`](../../../src/db/repositories.ts)：若 `trackRanks` 已存在（歌单已物化），给新 id 赋 `rank = minRank - RANK_SPACING`（保持「新歌在队首 = 封面」语义）；未物化则不动 rank。
  - [`removeTracksFromSession`](../../../src/db/repositories.ts)：从 `trackRanks` 删除被移出歌曲的键，保持「map 覆盖 trackIds 全集」不变量。
- **Constraints & Indexing:** 不新增索引（`trackRanks` 非索引）。排序在内存里做（歌单 track 数 = 数十~数百，O(n log n) 可忽略）。
- **Rollback Plan:** `git revert` 注册即可；旧代码读到带 `trackRanks` 的 session 会**忽略**该未知字段（顺序回落到 `trackIds` 数组顺序），不崩溃、不丢成员。无 runtime flag（硬规则 #3）。

### 3.3 分数序算法（Notion best practice · float + epsilon rebalance）

纯模块 [`set-order.ts`](../../../src/player/set-order.ts)，无 DB / 无 DOM，穷举单测：

```typescript
export const RANK_SPACING = 1024;   // 初始 / rebalance 等距步长（整数，重算后整洁）

/**
 * 相邻两 rank 取中点。若浮点已无法再二分（中点落到端点）返回 null —— 这就是
 * 「epsilon 条件」的**精确形式**（≈1 ULP），与数值量级无关，比固定绝对 epsilon
 * 更稳（绝对 epsilon 在大量级下会失真，是常见实现 bug）。
 */
export function rankBetween(a: number, b: number): number | null {
  const mid = (a + b) / 2;
  return mid > a && mid < b ? mid : null; // null = 间隙耗尽 → 触发 rebalance
}

/** 落到队首 / 队尾：向外延伸，**永有余量，绝不触发 rebalance**。rank 可为负，刻意允许。*/
export function rankBefore(min: number): number { return min - RANK_SPACING; }
export function rankAfter(max: number): number  { return max + RANK_SPACING; }

/** 整选区 K 首落到 (a, b) 间：K 个保序、严格递增、与端点可区分的 rank。
 *  任一相邻对落到同一浮点 → 返回 null（间隙容不下 K 首）→ 调用方 rebalance 后重算。*/
export function ranksForBlock(a: number, b: number, k: number): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push(a + ((b - a) * (i + 1)) / (k + 1));
  let prev = a; // 校验严格递增且严格在 (a, b) 内（浮点可区分），否则 null
  for (const r of out) { if (!(r > prev && r < b)) return null; prev = r; }
  return out;
}

/** 队首 / 队尾的 K 首块（向外延伸，恒成功，绝不 rebalance）。*/
export function ranksAtTop(belowRank: number, k: number): number[] {
  return Array.from({ length: k }, (_, i) => belowRank - (k - i) * RANK_SPACING);
}
export function ranksAtBottom(aboveRank: number, k: number): number[] {
  return Array.from({ length: k }, (_, i) => aboveRank + (i + 1) * RANK_SPACING);
}

/** 首拖物化 / 全组重算：把有序 id 序列赋等距整数 rank_i = i * RANK_SPACING。批量、低频、无感。*/
export function rebalance(orderedIds: string[]): Record<string, number> { /* … */ }

/** 唯一顺序裁决：trackRanks 缺席→原样返回；否则按 rank 升序 stable-sort，并以
 *  trackIds 数组下标作 tiebreaker（防 NaN / 重复，永产出确定全序，绝不丢成员）。*/
export function orderedSetTrackIds(
  trackIds: string[], ranks?: Record<string, number>,
): string[] { /* … */ }
```

**一次拖拽 = 一个 rank 更新**：单首落到 X、Y 之间 → `rankBetween(rankX, rankY)`，只写它一个 rank（满足「每次拖拽只设计一个数值的更新」）。
**整选区块移动**：K 首一起落到 X、Y 之间 → `ranksForBlock(rankX, rankY, K)`，写 K 个 rank，保持选区相对序。
**rebalance 触发**：当 `rankBetween` / `ranksForBlock` 返回 null（中间插入间隙耗尽）→ `rebalance(最终有序序列)` 一次批量写回等距整数（**无需独立的 `needsRebalance` 探测**，null 本身就是信号）。重算后间隙重新拉大 → 「之后又能用很久」。落点的全部边界（队首 / 队尾 / 空邻居 / 首拖 / no-op）见 §3.4。

> **考虑过但不采用：** 字符串分数序（`fractional-indexing` / Figma base-95 key，永不需 rebalance）。用户明确指定「浮点 + epsilon + 批量重设」这条 best practice，且字符串方案要引第三方库或自研编码层；float + 低频 rebalance 对「单用户偶发拖拽」的负载完全够用，且零依赖。记为 Open Question Q2 备选。

### 3.4 落点 edge case 计算（队首 / 队尾 / 空邻居 / 首拖 / no-op）

> ⚠️ 这是分数序最容易写错的地方 —— 朴素实现常在「拖到第一个 / 最后一个」时崩（取不到邻居）或假设 rank ≥ 0。本节把每个落点的计算**精确钉死**，并在 Phase 1 穷举单测（硬规则 #7）。

**统一表达**：把落点表达为「**移除被拖块后**剩余有序列表里的插入位 `insertIdx`」，由此取上/下邻居 —— **不依赖虚拟化下易漂移的可见 index**。设被拖块 K 首（K ≥ 1，保持其当前相对序），`remaining = orderedSetTrackIds(...)` 去掉块，`above = remaining[insertIdx-1]`，`below = remaining[insertIdx]`：

| 落点 | above | below | newRanks | 说明 |
|---|---|---|---|---|
| **拖到最顶（位置 0）** | ∅ | 有 | `ranksAtTop(below.rank, K)` | 块全部 < 当前最小 rank；向下延伸，**绝不 rebalance**；新最小**可为负**（刻意允许）|
| **拖到最末** | 有 | ∅ | `ranksAtBottom(above.rank, K)` | 块全部 > 当前最大 rank；向上延伸，绝不 rebalance |
| **拖到中间** | 有 | 有 | `ranksForBlock(above.rank, below.rank, K)` | 等距中点；返回 null（间隙耗尽）→ 先 `rebalance(最终全序)` 一次批量写，再落块 |
| **空歌单 / 移动了全部** | ∅ | ∅ | `rebalance(blockIds)` = `i*SPACING` | remaining 为空，从零等距赋值 |
| **首次拖拽（未物化）** | — | — | 先 `rebalance(trackIds)` 物化全集，再按上面四行算 | lazy 物化后所有邻居都是真实数，边界照常 |
| **no-op（落回原位）** | — | — | 直接返回，不写 rank、不记 mutation | 块已连续且 `insertIdx` = 其现位 → 防无意义 churn / sync 噪声 |

**要点（务必照此实现）：**
- **队首 / 队尾永不触发 rebalance**：`rankBefore/After`、`ranksAtTop/Bottom` 向外恒有余量；rebalance **只可能**来自中间插入间隙耗尽。所以「拖到第一个 / 最后一个」这两条最常用路径是 O(1) 且永远成功。
- **rank 可为负**：反复拖到队首会让最小 rank 持续下探（`-SPACING, -2·SPACING, …`），这是**正常**的。**不要**假设 rank ≥ 0 或用无符号存储（典型 bug）。浮点向负方向有海量余量；真要触底（≈ `-Number.MAX_VALUE`，现实永不发生）也会被一次 rebalance 拉回 `0..n*SPACING`。
- **块多首落顶 / 落尾**：`ranksAtTop` 给 `belowRank-(K-i)·SPACING`（i=0..K-1）严格递增且全 < belowRank；落尾对称。中间插 K 首若 `ranksForBlock` 返回 null，fallback「对最终全序 rebalance」**恒成功**（rebalance 后相邻间隙 = SPACING，足够再容纳）。
- **anchor 用 id 不用 index**：UI 把落点解析成 `{ aboveId?, belowId? }`（@dnd-kit 的 `over` + drop indicator 指向的缝隙），仓库层据 id 取 rank。离屏行、过滤都不影响（且与「仅手动顺序可拖拽」一致 —— 拖拽时 `remaining` 就是完整策展序）。
- **被拖块自身先从 `remaining` 摘除**：算邻居前必须先把 K 首移走，否则「把 t₂ 拖到顶」会把 t₂ 自己当成 below 邻居，算出错误中点。这是 no-op / 相邻移动正确性的根。

---

## 4. API / 仓库层 Design

> 本项目无后端（硬规则 #1）。「API」= 仓库层函数 + R2 sync mutation/manifest 契约。

### 4.1 仓库层函数

| 函数 | 位置 | 说明 |
|------|------|------|
| `reorderTracksInSession(setId, blockIds, anchor)` | 🆕 [`repositories.ts`](../../../src/db/repositories.ts) | 把 `blockIds`（1 或多首，保持其当前相对序）移动到锚点处。内部：①若未物化则 `materializeRanks`；②算 rank（`ranksForBlock` / 队首尾），不足则先 `rebalance`；③`db.sessions.put` 更新 `trackRanks`；④`recordSyncMutation`。一个 rw 事务。 |
| `prependTrackIds(...)`（改） | [`repositories.ts:228`](../../../src/db/repositories.ts) | 已物化时给新 id 赋队首 rank（`minRank - SPACING`）。 |
| `removeTracksFromSession(...)`（改） | [`repositories.ts:384`](../../../src/db/repositories.ts) | 同步从 `trackRanks` 删键。 |

`anchor` 形如 `{ beforeId?: string; afterId?: string }`（落点的上/下邻居 id），由 UI 从拖拽目标位置解析；仓库层据此取邻居 rank。用 id 而非 index，避免虚拟化下的 index 漂移。

**幂等 / 边界**：blockIds 含全部成员（移动整组）→ rebalance 后等价 no-op；blockIds 为空 → 直接返回；锚点两侧都不存在（空歌单）→ 不可能（至少有被拖的行）。

### 4.2 R2 Sync 契约变更

> **实现状态：** manifest `rank` 字段 + export/import round-trip **已实现**（Phase 2，经全量 re-export + 整 session LWW 同步）。下方 `track-reordered-in-set` mutation + `applySetMutation` fold + §4.3 per-track 合并是 **forward-design（deferred）**—— 依赖「edit→mutation 路径接入」（当前 `recordSyncMutation` 全仓零调用点，所有 set 编辑都走整 session LWW）。

**manifest（[`r2-manifest-schema.ts`](../../../src/sync/r2-manifest-schema.ts) `r2SetTrackSchema`）加字段（✅ 已实现）：**
```typescript
// 歌单内分数序 rank。可选——legacy/未物化歌单省略，import 端回落到数组顺序。
rank: z.number().optional(),
```

**新 mutation action（[`types.ts`](../../../src/db/types.ts) `SyncMutation`，⏳ forward-design）：**
```typescript
| "track-reordered-in-set"
// payload: { ranks: Array<{ trackId: string; rank: number }> }
//   · 单首拖拽 → ranks.length === 1
//   · 整选区块 → ranks.length === K
//   · 批量 rebalance → ranks 覆盖全集（低频）
```

**Request/Response 示例（push 时 fold 进 set index）：**
```typescript
// applySetMutation() 新增分支（r2-export-plan.ts）
if (mutation.action === "track-reordered-in-set") {
  const { ranks } = payload as { ranks: { trackId: string; rank: number }[] };
  const byId = new Map(ranks.map((r) => [r.trackId, r.rank]));
  for (const t of index.tracks) if (byId.has(t.id)) t.rank = byId.get(t.id)!;
  index.tracks.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)); // 稳定
  return true;
}
```

**import（[`r2-import-stream.ts`](../../../src/sync/r2-import-stream.ts)）：** 远端 `tracks[]` 若带 `rank` → 重建 `session.trackRanks` 并按 rank 排序生成 `trackIds`；不带 → 维持现有「数组顺序」逻辑（[`mergeRemoteAndLocalOnlyTrackIds`](../../../src/sync/r2-import-stream.ts) 不变，legacy 兼容）。

### 4.3 冲突处理（per-track LWW，best practice 的同步收益）

> **⏳ forward-design（deferred）：** 本节描述 per-track 合并的目标态，依赖 §4.2 的 mutation 路径接入。**当前已实现**的是 **整 session LWW**（重排 bump `session.updatedAt`，pull 时较新者整体胜）—— 满足跨设备同步；细到「两端各重排不同歌都保留」需下方 per-track 路径。

- **不同设备重排不同歌曲** → 触碰不同 `trackId` 的 rank → **干净合并**，两边重排都保留（这正是分数序相对「整数组 LWW」的核心优势）。
- **同一首歌被两端重排** → 该 track 的 rank 按 `updatedAt` LWW（沿用既有 mutation base 时钟，[`r2-pull-diff.ts`](../../../src/sync/r2-pull-diff.ts) 的 `mutationChangedFromRemoteBase`）。
- **一端 rebalance vs 另一端单首重排** → rebalance 是覆盖全集的 mutation；按 per-track LWW 合并后，集合仍是**全序**（最坏某首落点次优，但不崩、最终一致）。rebalance 低频，碰撞概率小。
- **Error States:** rank 出现 NaN/重复（理论不应发生）→ `orderedSetTrackIds` 用 `trackIds` 数组下标作 stable-sort tiebreaker 兜底，永远产出确定顺序，绝不丢成员或崩溃。
- **Telemetry:** 无（硬规则 #1，本仓库无遥测）。

---

## 5. Frontend Design

### 5.1 页面结构

```
SetDetailView (search-page.tsx:1244)
└── TrackListSection (track-list-section.tsx)        ← 多选模式下挂 DndContext
    ├── useTrackSelection(trackIds)                  ← 既有多选态
    ├── DndContext / SortableContext (@dnd-kit)      ← 🆕 仅 reorder 可用时
    │   └── VirtualTrackList (虚拟化)
    │       └── TrackRow × N
    │           ├── drag handle（reorder 模式，≥44px 触摸区）  ← 🆕
    │           ├── Checkbox（多选）
    │           └── drop indicator（插入位置高亮线）           ← 🆕
    ├── DragOverlay：「拖拽中 N 首」浮层                       ← 🆕
    └── BatchActionBar（既有：移出/删除 + 拖拽提示）
```

### 5.2 UI Components

- **Current Implementation:** 多选由 [`track-list-section.tsx`](../../../src/components/library/track-list-section.tsx) 编排，渲染 [`virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx) → [`track-row.tsx`](../../../src/components/library/track-row.tsx)，多选栏 [`batch-action-bar.tsx`](../../../src/components/library/batch-action-bar.tsx)。
- **Required Changes:**
  - **进入条件**：拖拽**仅在多选模式 + 手动顺序**下可用。`isManualOrder = sort === null && !likedOnly && query === ""`（[`search-page.tsx:1314`](../../../src/pages/search-page.tsx) 的 `shownTracks` 派生条件）。非手动顺序时**拖拽手柄置灰**并给 tooltip 提示「清除排序/筛选后可拖拽」（用户已选定：仅手动顺序可拖拽，不自动清排序）。
  - **drag handle**：reorder 可用时每行渲染一个手柄（lucide `GripVertical`），桌面 `cursor-grab`、触摸 ≥44px tap 区（响应式规则 #9）。
  - **整选区块移动**：拖拽任一**已选中**行 → 所有选中行作为**连续块**一起移动到落点，保留其相对顺序（Notion/Finder 式，用户已选定）。拖拽**未选中**行 → 退化为单行移动（仅移动该行）。`DragOverlay` 显示「N 首」。
  - **drop indicator**：在落点上/下邻居之间渲染一条高亮插入线（满足需求 #3「拖拽时视觉上知道会拖到哪里」）。用 @dnd-kit `collisionDetection` + `over` 状态算插入位（虚拟化下用 `rowVirtualizer` 的测量偏移定位）。
  - **虚拟化协作**：`SortableContext` 传**全量 id**（不止可见行）；@dnd-kit `autoScroll` 在拖到列表上/下边缘时滚动，把离屏目标带进视口；`onDragEnd` 用 `over.id`（trackId）解析锚点，不依赖可见 index。
- **UI/Interaction:** 落定后调 `reorderTracksInSession`，`useLiveQuery` 反应式回流 → 列表即时重排；motion 做行位移过渡（既有 `motion` 依赖）。`prefers-reduced-motion` 关动画（规则 #9）。

### 5.3 State Management

- **多选态**：复用 [`useTrackSelection`](../../../src/hooks/use-track-selection.ts)（ephemeral 本地，不进 Zustand，规则 #6）。
- **拖拽态**：@dnd-kit 内部 + 组件 local（`activeId` / `overId`），不进全局 store。
- **顺序真相**：`DjSession.trackRanks`（Dexie），经 `orderedSetTrackIds` 派生为 UI 顺序 —— **唯一裁决点**（镜像 `resolveStageContent` 纪律，避免散落排序逻辑）。
- **与播放队列解耦**：重排歌单**不**追改正在播放的 `PlayQueue.entries`（[`play-queue.ts`](../../../src/player/play-queue.ts) 刻意解耦）。下次 `playSet` 时按新顺序灌入。这是既定数据模型纪律，本期不破例。

---

## 6. Implementation Plan

### Phase 1: 纯排序核心 + 仓库层

**Goal:** 落地分数序算法与持久化，**无 UI、无同步**，全靠单测验证。

**Tasks:**
- [x] 新建 [`set-order.ts`](../../../src/player/set-order.ts)：`RANK_SPACING`、`rankBetween/Before/After`、`ranksForBlock`、`ranksAtTop/Bottom`、`rebalance`、`orderedSetTrackIds`、`planReorder`（精度判定用浮点精确法 = 中点落到端点，**非**绝对 epsilon）。✅ 26 测绿
- [x] `types.ts`：`DjSession.trackRanks?`（additive 非索引，零 Dexie bump）。✅（`SyncMutation.action` 的 `"track-reordered-in-set"` 移到 Phase 2 —— 见下方 Phase 2 scope 说明）
- [x] `repositories.ts`：`reorderTracksInSession(setId, blockIds, insertBeforeId)`（lazy 物化 + rebalance-on-exhaustion + 写 `trackRanks`）；`prependTrackIds`（已物化集赋队首 rank）/`removeTracksFromSession`（删 rank 键）维护不变量。✅ 8 测绿
- [→] `search-page.tsx` `SetDetailView`：用 `orderedSetTrackIds` 派生 `tracks` —— **移到 Phase 3**（属 UI 读取，且该文件被并发 agent 占用；与 DnD UI 一起落更自然）。

#### Phase 1 Checklist
- [x] `set-order.test.ts` 穷举 §3.4 全部 edge case：拖到**位置 0** / **最末** / 中间、空歌单 / 移动全部、首次拖拽 lazy 物化、no-op 落回原位不写、被拖块先摘除再算邻居、整块 K 首保序、队首尾向外延伸**绝不 rebalance**、中间插入间隙耗尽 → rebalance 后全序正确、rebalance 幂等、**rank 可为负**（反复拖顶）、缺 rank 回落数组序、NaN / 重复 tiebreaker 兜底。✅
- [x] 压测：间隙耗尽（相邻 doubles）触发一次 rebalance，重算后间隙重新拉大、可继续二分（「久用不重算」验证）。**room 取决于 ULP 非绝对间隙**（1e-12 间隙仍可容 100 首）→ 印证浮点精确判定优于固定 epsilon。✅
- [x] repo 集成测（`fake-indexeddb`，`set-reorder-repo.test.ts`）：首次拖拽物化、移动到队首/队尾、整块移动、no-op 落回原位不写、prepend 已物化集赋队首 rank、prepend 未物化保持未物化、移除后 rank 键清理。✅ 8 测绿
- [x] legacy 歌单（无 `trackRanks`）展示顺序与改动前**逐一致**（`orderedSetTrackIds` ranks 缺席原样返回 + 163 个 db/player 既有测全绿）。✅
- [x] typecheck（0 error）+ biome（clean）+ 新增 34 测全绿（26 set-order + 8 repo）。✅

### Phase 2: R2 Sync 对齐

**Goal:** manifest 承载 rank，跨设备重排经 push/pull 传播。

> **Scope 校正（落地时发现）：** `recordSyncMutation` 当前**未接入任何 set 编辑**（[`sync-mutation-repo.ts`](../../../src/sync/sync-mutation-repo.ts) 全仓零调用点）—— 所有 set 编辑都靠**全量 re-export + 整 session LWW**(`updatedAt`)同步，不是增量 mutation 流。因此本期把 rank 落进这条**既有、一致**的路径：manifest 逐首带 `rank` + import 重建 `trackRanks`，重排经 `session.updatedAt` LWW 整体传播 —— **完全满足需求 #2**（manifest 含此信息、跨设备同步）。`track-reordered-in-set` mutation + per-track 干净合并是**更细粒度的增强**，依赖「edit→mutation 路径接入」这个独立未做工程（与 entity-cover 等一并 deferred），见 §4.2/§4.3 forward-design，不在本期关键路径。

**Tasks:**
- [x] `r2-manifest-schema.ts`：`r2SetTrackSchema` 加 `rank?: number`（additive optional，无 manifest 版本 bump）。✅
- [x] `r2-export-plan.ts`：`loadSessionTracks` 改用 `orderedSetTrackIds` 按 rank 排 → manifest `tracks[]` 即显示序；逐首 `rank = session.trackRanks?.[id]`。✅
- [x] `r2-import-stream.ts`：远端带 rank → `reconstructTrackRanks` 忠实还原 + 本地独有曲排在 max 之后（保「覆盖全集」不变量）；不带 → `trackRanks` 留 undefined（回落数组序）。✅
- [→] `applySetMutation` 处理 `"track-reordered-in-set"` + `r2-pull-diff` per-track 冲突 → **deferred**（随 edit→mutation 路径接入，forward-design）。

#### Phase 2 Checklist
- [x] export 单测：已物化集 `tracks[]` 按 rank 排序且逐首带 rank；未物化（legacy）集省略 rank、保持数组序。✅
- [x] import 单测：带 rank → 忠实重建 `trackRanks` 且按 rank 排；legacy（无 rank）→ 不物化、数组序；本地独有曲排在 remote max 之后（覆盖全集不变量）。✅
- [x] 既有 43 个 sync 测全绿（209 测）—— 未回归 export/import/manifest-schema/conflict。✅
- [x] round-trip 等价：导出端 `tracks[]` 即显示序 → 导入端 `orderedSetTrackIds` 还原一致（5 个新测覆盖）。✅

### Phase 3: 多选模式拖拽 UI

**Goal:** 在多选 + 手动顺序下可拖拽，整选区块移动，drop indicator 可见。

> **架构校正（落地时，因并发冲突）：** `virtual-track-list.tsx` / `track-row.tsx` 当时正被并发 agent 重写（行体 80 行未提交）。为不 clobber 其在飞工作，改为**新建独立 [`reorderable-track-list.tsx`](../../../src/components/library/reorderable-track-list.tsx)**（@dnd-kit sortable + 紧凑自绘行，复用 `CoverImage`/`trackSubtitle`/`useTrackCoverUrl`，**不**改那两个热文件），由 `track-list-section.tsx` 在 select+手动序时切换渲染。代价：reorder 列表**暂不虚拟化**（移到 Phase 4）。

**Tasks:**
- [x] 加依赖 `@dnd-kit/core@6.3.1` + `/sortable@10` + `/modifiers@9` + `/utilities@3`（pnpm）。✅
- [x] 新建 `reorderable-track-list.tsx`：`DndContext`/`SortableContext`（传全量 id）+ PointerSensor(距离6)/KeyboardSensor + `restrictToVerticalAxis`；`onDragEnd` → `resolveDropTarget` → `reorderTracksInSession`。✅
- [x] 纯 `reorder-drop.ts` 的 `resolveDropTarget`（@dnd-kit drag → `insertBeforeId` 锚点；整块/单行；穷举单测 7 个）。✅
- [x] `track-list-section.tsx`：新增 `canReorder` prop；`sel.mode && setId && canReorder` 时渲染 ReorderableTrackList，否则 VirtualTrackList（热文件零改动）。✅
- [x] `search-page.tsx` SetDetailView：`tracks` 改用 `orderedSetTrackIds` 派生；`isManualOrder = !sort && !likedOnly && query.trim()===""` → `canReorder`。✅（Phase 1 遗留的派生改动一并落此）
- [x] drag handle（`GripVertical`，≥44px touch 区，`touch-none`）；drop indicator = sortable 间隙开合 + 源行 40% 透明；`DragOverlay`「N 首」badge。✅
- [x] i18n：`reorder.dragHandle` / `reorder.movingCount` / `reorder.disabledHint` 四语（en 源 + zh/ja/ko，CJK 仅 `_other`）。✅

#### Phase 3 Checklist
- [x] `resolveDropTarget` 单测：单行上/下/末、整块保序、块跳过自身成员、drop-on-self、未知 id 兜底（7 测绿）。✅
- [x] 整块移动：拖任一已选行 → 整选区作为连续块落位（`blockFor` + planReorder，相对序保留）。✅（逻辑层 + repo 层已测）
- [x] 拖未选中行 → 仅单行移动（`blockFor` 返回 `[id]`）。✅
- [x] 手动序门控：`canReorder = isManualOrder`；有排序/筛选/搜索时不挂 DnD（仍走 VirtualTrackList）。✅
- [→] **交互实测**（多端拖拽、autoScroll、drop indicator 视觉、reduced-motion）：留待**真实 Electron 壳**手测 —— 预览沙箱 hidden-tab rAF 暂停（[[preview-hidden-tab-gotcha]]）+ 并发 agent 正改同屏热文件，此刻预览态不稳。
- [→] 虚拟化下拖到离屏位置（autoScroll）：reorder 列表当前**非虚拟化** → 移到 Phase 4。

### Phase 4: 打磨（可选）

**Goal:** 虚拟化 reorder + 键盘可达性 + 触摸体验 + 边界回归。

**Tasks:**
- [~] ~~**虚拟化 reorder 列表**：`useVirtualizer` 绝对定位 `translateY(start)`~~ —— **已回退**（实测 bug：绝对定位 + 丢弃 sortable transform 破坏了 @dnd-kit 的 rect 测量/碰撞，`over` 永远卡在首行 → 只能拖到最顶）。改回**非虚拟化正统 sortable**（每行 apply `CSS.Transform`，正常流），碰撞/落点恢复正确。大歌单虚拟化 reorder 需 dnd-kit+react-virtual 的定制碰撞器，移到独立后续（见 Out of Scope）。
- [x] **drop indicator = 虚线框 placeholder**（用户指定）：被拖行的槽位渲染为 `border-2 border-dashed border-primary/60` 空盒，靠 `verticalListSortingStrategy` 的 transform **自动 snap 到落点**（周围行让位开槽）；`DragOverlay` 浮层显示真实内容 +「N 首」badge。原「方向感知插入线」随虚拟化回退一并移除（虚线框更直观且不依赖手算 over 索引）。✅
- [x] 触摸 `TouchSensor`（`delay:200 + tolerance:8`，按压延迟避免与滚动冲突）；键盘 `KeyboardSensor` + `sortableKeyboardCoordinates` 已挂（grip 可聚焦操作）。✅
- [x] 拖拽中批量操作互斥：`onDragActiveChange` 上抛 → `track-list-section` 置 `dragActive` → `BatchActionBar` 新增 `disabled` prop（`pointer-events-none + opacity-60`，action 按钮 disabled）。✅（2 测）
- [x] **长按进入多选**（touch-friendly，像长按照片）：`TrackListSection` 根节点委托 `useLongPress`（既有 hook，500ms / 10px 容差），按行的 `data-track-index` 解析 → `sel.enter()` + `sel.toggle(id,{index})`；trailing click 经 `onClickCapture + consumeClick` 吞掉，仅在**非** select 模式挂。**零改 `TrackRow`/`VirtualTrackList`**（事件委托 + 既有 data 属性，避开并发热文件）。✅

#### Phase 4 Checklist
- [x] 组件单测（非虚拟化）：每首歌一行 + 每行有 drag handle + 点击行 body toggle 选择（`reorderable-track-list.test.tsx`，3 测）。✅
- [x] 拖拽进行中批量操作互斥：`BatchActionBar` `disabled` → action 按钮 disabled（`batch-action-bar.test.tsx`，2 测）。✅
- [x] 长按委托解析器单测：行内/后代命中、越界/非法 index 兜底、null 兜底（`track-row-target.test.ts`，4 测）。✅
- [→] 键盘端到端一次重排焦点不丢、移动端窄屏不误触滚动、虚线框 snap 视觉：**enabler 已实现（TouchSensor/KeyboardSensor + 正统 sortable）**，交互实测留真实 Electron 壳。
- [→] **大歌单虚拟化 reorder**：回退后非虚拟化（reorder 是 opt-in 编辑态，典型歌单可接受）；超大歌单需 dnd-kit 定制碰撞器，独立后续。

---

## 7. Out of Scope

- **跨歌单拖拽**（把歌从 A 歌单拖到 B 歌单）—— 本期只做「歌单内」重排；跨集移动属成员变更，另开 PRD。
- **重排正在播放的 `PlayQueue`** —— 队列已有 [`playQueueReorder`](../../../src/db/repositories.ts) + `moveEntry`；歌单重排与播放队列**刻意解耦**，不联动。队列内拖拽 UI 不在本期。
- **非多选模式直接拖拽** —— 产品指定「在多选模式」承载拖拽，本期不在普通模式暴露拖拽手柄。
- **字符串分数序 / 第三方 fractional-indexing 库** —— 用户指定 float + epsilon，本期不引入字符串编码方案（记为 Q2 备选）。
- **媒体字节随重排重传** —— 重排只动 rank 标量，R2 不重传任何 blob。
- **Tauri / web 壳的 DnD parity** —— 桌面优先（规则 #9）；@dnd-kit 是纯 DOM，三壳理论通用，但本期只在 Electron 实测。

---

## 8. Security Considerations

- **Authentication / Authorization:** 无后端、无账号（硬规则 #1）。唯一「权限」= 用户是否对某 R2 drive 启用 sync；rank 随既有 manifest 走同一 BYOK 通道，不新增凭据面。
- **Data Protection:** `trackRanks` 是顺序标量，无 PII；R2 凭据仍只在 `settings`（硬规则 #2），不入 rank/manifest/日志。
- **No hidden flags:** 拖拽功能不藏 `localStorage`/URL/`window.*` 开关；回退 = `git revert`（硬规则 #3）。需要 toggle 就建可见 Settings 控件（本期不需要）。
- **Audit Logging:** 无遥测（硬规则 #1）；`src/**` 日志走 [`logger.ts`](../../../src/lib/logger.ts)（规则 #8），rank 变更不记录用户内容。
- **Codename 稳定性:** 不改 db 名 / 表名 / id 前缀 / provider id（硬规则 #4）；`trackRanks` 仅是 `sessions` 行的附加字段。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260607-muzero-set-playqueue-memory-data-model-prd`](../20260607-muzero-set-playqueue-memory-data-model-prd/) | 歌单/播放列表/记忆数据模型拆分（本 PRD 在其 `DjSession.trackIds` / `PlayQueue` 解耦之上）|
| [`20260610-muzero-external-streaming-sources-prd`](../20260610-muzero-external-streaming-sources-prd/) | 外部流媒体源；「附加非索引、零 Dexie 迁移」模式的先例（`trackRanks` 沿用）|
| [`r2-manifest-schema.ts`](../../../src/sync/r2-manifest-schema.ts) / [`r2-export-plan.ts`](../../../src/sync/r2-export-plan.ts) | R2 同步 manifest + mutation fold 管线 |
| [`play-queue.ts`](../../../src/player/play-queue.ts) / [`queue.ts`](../../../src/player/queue.ts) | 纯函数 + 穷举单测纪律的先例；`moveEntry` 重排范式 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 引入 @dnd-kit（新 runtime 依赖）vs 自研 pointer-events | **Resolved** | 用户选 **@dnd-kit**（业界 best-practice，内置 a11y/碰撞/overlay）。上线前测 bundle 增量，按 PRD 模板 §3「<100KB gzip/cluster」预算评估是否子路径 import / dynamic import。 |
| 2 | float+epsilon vs 字符串分数序（永不 rebalance） | **Resolved** | 用户指定 **float + epsilon + 批量重设**。字符串方案记为未来备选；当前负载（单用户偶发拖拽）float + 低频 rebalance 足够。 |
| 3 | 多选拖拽移动单行 vs 整选区块 | **Resolved** | **整选区作为一块移动**（保留相对序）。拖未选中行退化为单行。 |
| 4 | 排序/筛选/搜索激活时拖拽行为 | **Resolved** | **仅手动顺序可拖拽**；非手动顺序置灰 + tooltip，不自动清排序。 |
| 5 | `RANK_SPACING` / 精度阈值取值 | **Resolved** | `SPACING = 1024`；精度阈值用**浮点精确判定**（`rankBetween` 中点落到端点即「epsilon 命中」），**不用**固定绝对 epsilon（随量级失真、是常见 bug）。Phase 1 压测确认同位连插 ~50 次（double 二分极限）才触发一次 rebalance。 |
| 6 | rebalance 是否需要 UI 提示 | **Resolved** | **无感**：一次批量写 + `useLiveQuery` 回流，用户无可见差异；rebalance 低频（仅中间插入间隙耗尽，队首/队尾永不触发）。若超大歌单偶发卡顿再评估 defer / 分帧（不改可见行为）。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-11 | DoodleBear / Product | Initial draft：Notion 式 float 分数序 + epsilon rebalance；`DjSession.trackRanks` 附加非索引零迁移；R2 manifest `rank` + `track-reordered-in-set` mutation per-track 合并；@dnd-kit 多选整块拖拽 + drop indicator + 手动顺序 gating。四 decision 已定（Q1–Q4）。 |
| 2026-06-11 | DoodleBear / Product | Q5/Q6 定档：精度判定改用**浮点精确法**（中点落端点）取代绝对 epsilon；rebalance **无感**。新增 §3.4 落点 edge case 计算（队首/队尾/空邻居/首拖/no-op 精确钉死，被拖块先摘除、anchor 用 id、rank 可为负），`ranksAtTop/Bottom` 入 `set-order.ts`，Phase 1 穷举单测同步扩充。 |
| 2026-06-11 | DoodleBear / Eng | **Phase 1-4 全实现**（TDD，commits 0ffda04→a76f0bf，~60 测）：分数序核心+repo、R2 manifest rank round-trip（整 session LWW，per-track mutation deferred）、@dnd-kit 独立 `reorderable-track-list`（避开并发热文件）虚拟化+方向感知 drop 线+整块移动+手动序门控+拖拽互斥。仅交互实测待真机。 |
| 2026-06-11 | DoodleBear / Eng | 追加**长按进入多选**：`TrackListSection` 根节点事件委托 `useLongPress` + `data-track-index` 解析（纯 `track-row-target.ts`，4 测），零改 `TrackRow`/`VirtualTrackList`。 |
| 2026-06-11 | DoodleBear / Eng | **Bugfix**：Phase 4 虚拟化（绝对定位 + 丢 sortable transform）破坏 dnd-kit 碰撞 → `over` 卡首行、只能拖到最顶。**回退为非虚拟化正统 sortable**（apply `CSS.Transform`）。drop indicator 按用户要求改为**虚线框 placeholder**（被拖行槽位 = 虚线盒，靠 strategy 自动 snap 到落点）。 |
| 2026-06-11 | DoodleBear / Eng | **Bugfix**：松手时 overlay 先弹回原位再跳到落点（rank 持久是 Dexie 异步，drop 动画时列表还是旧序）。加**乐观本地排序**：`onDragEnd` 同步 `applyBlockMove`（纯函数，5 测）更新本地 `order` → 落点即时正确，async rank 写入经 liveQuery 经 `useEffect` 回收。 |
| 2026-06-11 | DoodleBear / Eng | **多选拖拽视觉**：拖拽浮层补 grip 列（与列表对齐）；多选拖拽时浮层显示**层叠卡片堆**（block>1，配「N 首」badge）+ 其余选中行**变暗 lift out**，让「拖多个」一眼可辨（不再像拖一个）。 |
| 2026-06-11 | DoodleBear / Eng | **Bugfix(再续)**：退出仍跳顶 —— 从外部写 `VirtualTrackList` 的 scrollTop 总被 Lenis/虚拟器还原。改为**让 VTL 自还原**：新增 `initialScrollIndex` prop,挂载时经**自身虚拟器** `rowVirtualizer.scrollToIndex(align:start)`(走自带 Lenis-aware scrollToFn)；layout effect 先 elementScroll 让 Lenis 初始化即在位 + rAF 经 Lenis 复确认。hook 退化为只管 reorder 列表(裸 scrollTop)+ 暴露 anchorIndex 喂给 VTL。 |
| 2026-06-11 | DoodleBear / Eng | **Bugfix(续)**：退出选择模式仍跳顶 —— 回退到的 `VirtualTrackList` 是 **Lenis** 平滑滚动驱动,裸 `scrollTop` 写会被下一帧覆盖。新增 `lenisForElement`(按 `rootElement` 在 driver registry 查实例),restore 经 `lenis.scrollTo(immediate)` 走 Lenis(无则裸写);并加 rAF 重试(Lenis 在 layout effect 之后的 passive effect 才挂)。 |
| 2026-06-11 | DoodleBear / Eng | **Bugfix**：进入选择模式滚动跳回顶部（VirtualTrackList↔ReorderableTrackList 换容器，新容器 scrollTop=0）。`useListScrollPreservation`：capture-phase scroll 监听记顶部行 index（scroll 不冒泡）→ swap 后按 index 还原（`scrollHeight/count` 高度无关，两列表行高不同也准）。纯 `topRowIndex`/`scrollTopForRow`，5 测。 |
| 2026-06-11 | DoodleBear / Eng | **Bugfix**：选择模式下列表不能滚动 —— `ReorderableTrackList` 的 `<ul>` 有 `overflow-y-auto` 但缺 `h-full`(只有 `min-h-0`)→ 撑满内容而非成为有界滚动区。改 `h-full`(对齐 `VirtualTrackList` 的 `h-full overflow-y-auto` 同款)。 |
| 2026-06-11 | DoodleBear / Eng | **批量「添加到其他歌单」**：多选栏新增 `AddToSetMenu`（Popover+Command 选/建歌单，复用单曲选择器 UX，批量 `prependTrackIds`）。纯 `addToSetCandidates`（排除当前集 + 创建判定，5 测）；`BatchActionBar` 加 `extra` slot；`select.addedToSet` 四语。 |

---

> **Note:** 本 PRD 遵循「改现有结构优先」：唯一新增源文件 `set-order.ts`（新算法核心）+ @dnd-kit（新 DnD runtime，已取舍）。顺序裁决收敛到单一纯函数 `orderedSetTrackIds`，避免排序逻辑散落（镜像 `resolveStageContent` / provider registry 纪律）。
