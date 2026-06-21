# PRD: 歌单内行删除消歧（从歌单移除 vs 彻底删除）

**Status:** Final（Phase 1 已落地实现）
**Created:** 2026-06-21
**Author:** MUZERO Core / Library UX
**Module:** Library Track List — 歌单详情页里每行 hover 操作条的「删除」按钮（[`TrackListSection`](../../../../src/components/library/track-list-section.tsx)）：点击不再静默「从歌单移除」，而是弹出 modal 让用户明确选择「仅从此歌单移除」还是「彻底删除（从所有歌单移除 + 删除歌曲）」。

> **一句话**：歌单详情里一行的删除（垃圾桶）按钮，以前**一点就静默把这首歌移出当前歌单**（带 Undo），与「删除」二字给人的「彻底删掉」预期不符，也和已经提供两种选择的批量操作条不一致。本期让它**弹出 modal**，提供两个明确选项：**从歌单移除**（可撤销）/ **彻底删除**（从所有歌单移除并删除歌曲的音频、封面、记忆，不可撤销）。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 行删除弹出二选一 modal + i18n + 单测 | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

歌单详情页每行 hover 出现的右侧操作条（[`TrackRow`](../../../../src/components/library/track-row.tsx) 的 `data-muzero-row-actions`）里有一个垃圾桶「删除」按钮。**旧行为**（[`TrackListSection.onDeleteTrack`](../../../../src/components/library/track-list-section.tsx)）：

```
if (setId) removeFromSet([track.id]);   // 静默从当前歌单移除（带 Undo toast）
else       setPendingPermanent([id]);   // 全部歌曲：弹永久删除确认
```

**问题**：在歌单里点「删除」会**直接、静默地**把歌从这个歌单移除——没有 modal、没有让用户区分「我只想把它移出这个歌单」还是「我想彻底删掉这首歌（及其文件）」。这与「删除」按钮的语义预期不符，也和**同一页的批量操作条早已提供的两个选项**（[`batchActions`：removeFromSet + deletePermanently](../../../../src/components/library/track-list-section.tsx)）不一致——单行删除是这里唯一「没得选」的入口。

### 1.2 现状语义（排查确认）

| 操作 | 调用 | 作用范围 | 可逆性 |
|------|------|----------|--------|
| **从歌单移除** | [`removeTracksFromSession`](../../../../src/db/repositories.ts) | 仅当前歌单的 `trackIds`/`trackRanks`（写 removal 墓碑供同步） | **可撤销**（Undo → `prependTrackIds`） |
| **彻底删除** | [`deleteTracks`](../../../../src/db/repositories.ts) | 删 track 行 + `mediaBlobs`（音频/视频字节）+ 封面 derivatives + memories；**从每个歌单解绑** + 移出播放队列 | **不可逆** |

> ⚠️ **「删除歌曲文件」的准确含义**：`deleteTracks` 删除的是 **MUZERO 在 IndexedDB 里存的副本**（`mediaBlobs` 等）+ 库内所有引用。对**上传/生成**的曲目，存储的 blob 就是唯一副本 → 等于删掉这首歌；对**本地文件夹索引**（Electron）的曲目，磁盘上的原始文件**不会**被删（MUZERO 只动自己的 IndexedDB）。modal 文案据此措辞为「从所有歌单和音乐库中删除（含音频、封面、记忆）」，不夸大为「删除你硬盘上的原文件」。

### 1.3 Target Users

| Role | Description | 影响 |
|------|-------------|------|
| **普通听众** | 一首歌可在多个歌单（"music carries memories"） | 「从这个歌单拿掉」与「整库删掉」是两种完全不同的意图，必须可区分、且后者要可挡 |
| **直播主播** | 现场整理歌单 | 误把「移出歌单」当成「彻底删除」（或反之）代价高；明确二选一 + Undo 降低误操作 |

### 1.4 Core Value

1. **消歧 / 防误删**：用一个 modal 把「移出歌单（可撤销）」和「彻底删除（不可逆）」分成两个清晰、分别着色的选项，避免「点了删除结果只是移出歌单」或「想移出却删没了」。
2. **一致性**：单行删除与批量操作条提供**同一组**选项（remove-from-set / delete-permanently）。
3. **安全默认**：主操作（emphasis）是**可撤销**的「从歌单移除」；不可逆的「彻底删除」以 destructive 红色作为次操作呈现。

---

## 2. System Architecture

### 2.1 交互流（新）

```
歌单详情行 hover → 操作条「删除」(垃圾桶) onClick
        ▼  VirtualTrackList.onDeleteTrack(track) → TrackListSection.onDeleteTrack
   setId 存在？
   ├─ 是 → setPendingSetRowDelete(track) → 弹 ConfirmDialog（二选一）
   │         ├─ 主 (default 色)：从歌单移除  → removeFromSet([id])（含 Undo toast）
   │         └─ 次 (destructive 红)：彻底删除 → deleteTracks([id]) + "Deleted 1 song" toast
   └─ 否（全部歌曲）→ setPendingPermanent([id]) → 既有永久删除确认（不变）
```

### 2.2 复用既有基建（无新组件）

- [`ConfirmDialog`](../../../../src/components/ui/confirm-dialog.tsx) **本就支持 `secondary` 第二选项**——其文档注释给的范例正是「'delete set only' vs 'delete set + its songs'」。本期直接复用：`confirm`=主操作、`secondary`=次操作、Cancel 兜底。**无需新建 dialog 组件。**
- `removeFromSet` / `deleteTracks` / Undo（`prependTrackIds`）/ toast 全部既有，无需改 repository。
- 批量操作条 [`batchActions`](../../../../src/components/library/track-list-section.tsx) 的两个选项语义即本 modal 的两个按钮（一致）。

### 2.3 Technology Stack

| Component | Technology | 角色 |
|-----------|------------|------|
| 二选一弹窗 | [`ConfirmDialog`](../../../../src/components/ui/confirm-dialog.tsx)（基于 Base UI `Dialog`） | `confirm` + `secondary` + cancel |
| 从歌单移除 | [`removeTracksFromSession`](../../../../src/db/repositories.ts) + Undo（`prependTrackIds`） | 可撤销，写 removal 墓碑 |
| 彻底删除 | [`deleteTracks`](../../../../src/db/repositories.ts) | 删 blob/封面/记忆 + 全歌单解绑 + 出队列 |
| 文案 | i18n（en 类型源 + zh/ja/ko） | `track.removeOrDeleteTitle/Body` + 复用 `select.removeFromSet`/`select.deletePermanently` |

### 2.4 涉及文件

```
src/components/library/track-list-section.tsx        # onDeleteTrack 改为开 modal；新增 ConfirmDialog（二选一）+ deleteSetRowEverywhere
src/components/library/track-list-section.test.tsx    # 新增 2 个单测（set 行二选一 / 全部歌曲单永久确认）
src/i18n/locales/{en,zh,ja,ko}/common.json           # track.removeOrDeleteTitle / removeOrDeleteBody（4 语）
```

---

## 3. Data Model Design

**无任何数据/持久化变化。** 复用既有 `removeTracksFromSession` / `deleteTracks`，不改 Dexie schema、不 bump 版本、不动 codename 层（硬规则 4）。`pendingSetRowDelete` 是页面本地 ephemeral state（硬规则 6，不进 Zustand）。

- **Rollback Plan:** `git revert` 本 PR + 重新发版（硬规则 3：不藏 runtime flag）。

---

## 4. API Design（组件内）

### 4.1 改动点

| 符号 | 旧 | 新 |
|------|----|----|
| `onDeleteTrack(track)` | setId → `removeFromSet`（静默） | setId → `setPendingSetRowDelete(track)`（开 modal）；否则不变 |
| `pendingSetRowDelete` state | — | **新**：`Track \| null`，驱动二选一 modal |
| `deleteSetRowEverywhere(track)` | — | **新**：`await deleteTracks([id])` + toast（次操作回调） |
| 二选一 `ConfirmDialog` | — | **新**：`confirm`=`removeFromSet`（variant `default`）/ `secondary`=`deleteSetRowEverywhere`（variant `destructive`） |

### 4.2 行为契约

- **主操作「从歌单移除」**：`removeFromSet([id])` → `removeTracksFromSession` + 「Removed 1 song from set」toast，**带 Undo**（`prependTrackIds` 复原 + 顺序）。
- **次操作「彻底删除」**：`deleteTracks([id])` → 删 blob/封面/记忆 + 全歌单解绑 + 出队列 → 「Deleted 1 song」toast。modal 本身即确认，**不再叠第二个弹窗**（modal body 已明示不可逆）。
- **取消 / Esc / 点背景**：仅关闭，无副作用。
- 全部歌曲（无 setId）路径**不变**：仍走既有 `pendingPermanent` 永久删除确认（「Delete this song permanently?」）。

### 4.3 Telemetry & Logging

- 无新增遥测（硬规则 1）。沿用既有 toast；删除不打印用户内容（硬规则 8）。

---

## 5. Frontend Design

### 5.1 UI / Interaction

- **歌单详情行删除**：点垃圾桶 → 弹 modal。
  - 标题：`Remove “{{title}}”?`（带歌名）。
  - 正文：`Remove it from this set only — you can undo that. Or permanently delete it from every set and your library (its audio, cover, and memories); permanent deletion can’t be undone.`
  - 按钮：[Cancel] · **彻底删除**(红, destructive) · **从歌单移除**(主色, default, 最右/最强调)。
- **强调安全选项**：可撤销的「从歌单移除」作主操作（最右、品牌色）；不可逆的「彻底删除」红色次操作。
- **全部歌曲行删除**：维持单一永久删除确认（不变）。
- **批量删除**：不变（操作条已有两选项）。
- **i18n**：4 语全量（en/zh/ja/ko）；按钮复用既有 `select.removeFromSet` / `select.deletePermanently`（已 4 语）。

### 5.2 State Management

新增页面本地 `pendingSetRowDelete: Track | null`；其余沿用。`removeFromSet` 的 Undo、`deleteTracks` 的全库副作用均既有。

---

## 6. Implementation Plan

### Phase 1: 行删除弹出二选一 modal

**Goal:** 歌单详情里行删除从「静默移出歌单」改为「弹 modal 二选一（从歌单移除 / 彻底删除）」；全部歌曲与批量路径不变。

**Tasks:**
- [x] [`track-list-section.tsx`](../../../../src/components/library/track-list-section.tsx)：`onDeleteTrack` set 分支改为 `setPendingSetRowDelete`；新增二选一 `ConfirmDialog`（confirm=removeFromSet / secondary=deleteSetRowEverywhere）+ `deleteSetRowEverywhere`；更新组件 doc 注释。
- [x] i18n：`track.removeOrDeleteTitle` / `removeOrDeleteBody` 加到 en（类型源）+ zh/ja/ko；按钮复用既有 `select.*`。
- [x] [`track-list-section.test.tsx`](../../../../src/components/library/track-list-section.test.tsx)：新增单测覆盖二选一 + 全部歌曲单确认。

### Phase 1 Checklist

- [x] 单测：set 行删除 → 弹出带 `secondary` 的 modal；点主操作 → `removeTracksFromSession("ses_1",["trk_1"])`、未 `deleteTracks`；点次操作 → `deleteTracks(["trk_1"])`。
- [x] 单测：全部歌曲（无 setId）行删除 → 弹出的确认**无** `secondary`（仍是单永久确认）。
- [x] 回归：批量操作条两选项、Undo、全部歌曲永久确认均不变（既有测试 + 新测试 33/33 全绿）。
- [x] `pnpm typecheck`（exit 0）+ `pnpm biome check`（6 文件 clean）通过。

---

## 7. Out of Scope

- **不删用户磁盘上的原始文件**：`deleteTracks` 只动 IndexedDB（库内副本/引用）；本地文件夹索引的原文件不动（见 §1.2）。如需「同时删硬盘文件」是另一独立议题（涉及 desktop bridge 写权限）。
- **彻底删除不加第二道确认弹窗**：modal 本身即确认，body 已明示不可逆；避免双层 modal。若后续要更强防护，可在次操作加 hold-to-confirm 等（可见控件，不藏 flag）。
- **不改批量操作条 / 全部歌曲 / 专辑·歌手·系统歌单的删除路径**：专辑/歌手/系统歌单详情用 `TrackListSection` 但**不传 `setId`**（派生列表无「从中移除」语义）→ 仍走永久删除确认，符合预期。
- **不引入 hidden flag / runtime toggle**（硬规则 3）：回滚走 `git revert`。

---

## 8. Security / Privacy Considerations

- 纯本地 IndexedDB 行为，无网络出站、无遥测、无密钥路径（硬规则 1/2）。删除经 repository 事务，toast 经 [`notification-store`](../../../../src/stores/notification-store.ts)，不打印用户内容（硬规则 8）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260621-muzero-track-list-activation-model-prd](../20260621-muzero-track-list-activation-model-prd/20260621-muzero-track-list-activation-model-prd.md) | 同批列表交互排查的另一项：曲目行单击选中 / 双击播放 |
| [20260607-muzero-set-detail-page-prd](../../20260607-muzero-set-detail-page-prd/20260607-muzero-set-detail-page-prd.md) | 歌单详情页本体 |
| [20260611-muzero-set-track-drag-reorder-prd](../../20260611-muzero-set-track-drag-reorder-prd/20260611-muzero-set-track-drag-reorder-prd.md) | 集内删除 / removal 墓碑 / Undo 语义来源 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 行删除是否弹 modal？ | ✅ Resolved | **弹**：二选一（从歌单移除 / 彻底删除），对齐批量操作条 + 防误删。 |
| 2 | 哪个是主操作（emphasis）？ | ✅ Resolved | **从歌单移除**（可撤销、最常见）作主操作（品牌色、最右）；彻底删除为红色次操作。 |
| 3 | 「彻底删除」是否需要二次确认？ | ✅ Resolved | **不需要**：modal 即确认，body 明示不可逆；避免双层弹窗。 |
| 4 | 「删除歌曲文件」是否删硬盘原文件？ | ✅ Resolved | **否**：仅删 IndexedDB 副本 + 全库引用；文案据此措辞，不夸大。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-21 | MUZERO Core / Library UX | 初稿 + Phase 1 落地：歌单内行删除从静默移出改为二选一 modal（复用 `ConfirmDialog.secondary`）；4 语文案；新增 2 单测（33/33 通过、typecheck + biome 绿）。 |

---

> **Note:** 本 PRD 强调「复用既有结构」——二选一弹窗直接用 [`ConfirmDialog`](../../../../src/components/ui/confirm-dialog.tsx) 既有的 `secondary` 能力，删除走既有 `removeTracksFromSession` / `deleteTracks`，无新组件、无 schema 变更。与同日的 [曲目行激活模型 PRD](../20260621-muzero-track-list-activation-model-prd/20260621-muzero-track-list-activation-model-prd.md) 同属「歌单/库列表交互一致性」一批。
