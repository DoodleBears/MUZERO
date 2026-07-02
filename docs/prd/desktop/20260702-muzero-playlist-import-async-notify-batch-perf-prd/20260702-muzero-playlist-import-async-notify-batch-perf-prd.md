# PRD: MUZERO 歌单导入异步化（关 modal + 左上角 Notification 进度）+ 批量导入 O(n²)→O(n) 性能修复

**Status:** Draft
**Created:** 2026-07-02
**Author:** DoodleBear
**Module:** `src/components/stream/`（导入 modal）· `src/streamsrc/streamed-track-repo.ts`（批量写核心 `addHitsToSet`）· `src/stores/`（player-store 导入动作 + 新 import 通知 bridge）· `src/stores/notification-store.ts`（已支持进度通知）

> **两个 PM 反馈，同一功能面（在线歌单导入）**：
> 1. **导入不是异步的**——从网易云 / bilibili 同步歌单时，import modal 会一直 `await` 到整单写完才关闭；应「触发即关 modal」，进度改用**左上角 Notification** 显示。
> 2. **批量导入慢，且越往后越慢**——1000+ 条网易云歌单「前面快、后面越来越慢」，是典型的 O(n²) / 状态管理放大。经排查根因在写库循环的**逐条全量去重扫描**。
>
> 本 PRD 把这两块一起落地：先修性能根因（batch），再把导入从 modal 剥离为后台任务 + 通知进度。两阶段独立可发。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | PRD + 根因确认 + 可度量红测（观测先行） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 批量导入 O(n²)→O(n)：单次预载去重 + `bulkPut` 单事务 | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 异步导入：触发即关 modal + 左上角 Notification 进度（复用 indicator 模式） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **Phase 顺序（`prd-create.md` §4「观测先行，再优化」）**：Phase 1 先补「能证伪 O(n²) 的度量红测」，Phase 2 才动写入路径（有 before/after ground truth）。Phase 2 先于 Phase 3——性能修复让导入变快、缩短通知需要覆盖的时长；但两者解耦，可分别 ship。

---

## 1. Overview

### 1.1 Background

在线歌单导入（网易云 / bilibili / QQ 等 stream source）当前唯一入口是 [`PlaylistImportDialog`](../../../../src/components/stream/playlist-import-dialog.tsx)。用户在 modal 里选「新建集」或「同步进已有集」，modal 内的 [`run()`](../../../../src/components/stream/playlist-import-dialog.tsx#L59) 会：

```ts
async function run(action) {
  setBusy(true); setProgress(null);
  try { await action(); onClose(); }   // ← 整单写完才 onClose()
  catch { notify.error(...); }
  finally { setBusy(false); setProgress(null); }
}
```

即：**整个导入被 modal 同步 `await`**，期间 modal 保持打开且禁用（`onOpenChange` 门控 `!busy`、取消按钮 disabled），进度条内嵌在 modal 里（[dialog L236–260](../../../../src/components/stream/playlist-import-dialog.tsx#L236)）。1000+ 条歌单又叠加了下面的 O(n²) 写入，用户被按在一个转圈的 modal 上几十秒——这就是 PM 说的「不是异步的」。

同时，写库核心 [`addHitsToSet`](../../../../src/streamsrc/streamed-track-repo.ts#L134) 逐条调用 [`createStreamedTrack`](../../../../src/streamsrc/streamed-track-repo.ts#L77) → [`findStreamedTrack`](../../../../src/streamsrc/streamed-track-repo.ts#L55)，后者对**当前集内已有的每一条 track** 做一次内存全量扫描去重。集合边导入边变大，第 k 条要扫 k−1 条 → 总量 ≈ n²/2。1000 条 ≈ 50 万次行反序列化+比较，完美复现「前面快、越往后越慢」。

**好消息**：解决方案几乎不需要新造轮子——
- **左上角通知本就存在**：[`NotificationStack`](../../../../src/components/shell/notification-stack.tsx#L57) 定位 `fixed left-4 top-[calc(env(safe-area-inset-top)+4.5rem)] z-50`，正是 PM 说的「左上角」。
- **进度通知能力本就存在**：[`notify.loading()`](../../../../src/stores/notification-store.ts#L191) 建持久 loading toast → [`notify.update(id, { progress, detail, type })`](../../../../src/stores/notification-store.ts#L121) 原地更新，`progress?: number`（0..1）渲染细进度条（[notification-store L48](../../../../src/stores/notification-store.ts#L48)）。
- **「后台任务 → 单条持久进度通知 → 终态 toast」的桥接模式本就有三例**：[`sync-indicator`](../../../../src/stores/sync-indicator.ts)（文件夹导入 + R2 云同步）、[`download-indicator`](../../../../src/stores/download-indicator.ts)（下载队列聚合）、[`playback-indicator`](../../../../src/stores/playback-indicator.ts)（慢加载）。**在线歌单导入是唯一没走这套模式、反而阻塞 modal 的异类**。

所以本 PRD 本质是：(a) 把 O(n²) 写入改成 O(n)；(b) 把导入编排从 modal 搬进 store，复用既有通知/indicator 模式，让 modal 触发即关。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地高级用户（owner）** | 从网易云 / bilibili 等导入大歌单（默认收藏夹 500~2000+ 条），期望「点一下就能继续用 App」，进度在角落可见。 | 全功能；BYO 登录态；导入是本地写库，无后端 |
| **订阅式用户** | 绑定收藏夹自动增量同步（[download-queue-resume-autosync PRD](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md) Phase 3 已落地）——大集重复 re-sync 时同样吃 O(n²)。 | 后台自动同步，进度经 indicator 通知 |

### 1.3 Core Value

1. **导入不再卡人**：触发导入后 modal 立即关闭，用户可继续浏览/播放；进度落在左上角通知，不打断主流程。
2. **1000+ 条秒级写库**：去掉逐条全量扫描去重（O(n²)→O(n)）+ 逐条 `put` 改 `bulkPut` 单事务，写入从「随规模指数劣化」变成「线性、可预期」。
3. **一致的进度语言**：导入进度与文件夹导入 / R2 同步 / 下载队列共用一套 indicator + 通知模式，交互统一、可维护。
4. **本地优先不破**：全部改动在本地写库编排 + 通知层，无后端、无遥测、无 schema 迁移（见 §5）。

---

## 2. Best Practice Grounding

### 2.1 Sources Checked

| Source | Relevant Guidance | MUZERO Decision |
|--------|-------------------|-----------------|
| Dexie `bulkPut()` 文档 https://dexie.org/docs/Table/Table.bulkPut() | 批量写显著快于逐行 `put` 循环（少事务开销 / 少 IDB 往返）。 | `addHitsToSet` 累积新 track 行后一次 `bulkPut`，不再循环里逐条 `put`。 |
| Dexie Best Practices https://dexie.org/docs/Tutorial/Best-Practices | 不要在事务里 await 无关异步；批量变更用批量 API。 | 远端 `fetchPlaylistHits` 在写库前一次性完成；写库循环只做纯 CPU 去重 + 一次 `bulkPut` + 一次 `prependTrackIds`（都在事务内）。 |
| Dexie 索引 / `where().equals().filter()` 语义 | `.filter()` 是**内存扫描**（游标逐行反序列化后 JS 过滤），非索引查询——集合越大越慢。 | 去重不再逐条 `findStreamedTrack`（每条一次全集扫描）；改为**导入前一次性预载**集内已有 `(source,externalId)→track` 到内存 `Map`，循环里 O(1) 命中。 |
| 仓库自身 [`muzero-db.ts` v29/v30 注释](../../../../src/db/muzero-db.ts#L429) | 作者刻意删掉 `*tags`/`status`/`createdAt`/`kind` 索引——「索引在**每条导入行**上都要额外维护，大批量 `bulkAdd` 尤其贵」，去重靠 `sessionId` 索引 + 内存过滤。 | **不新增** `[sessionId+streamSourceId+streamExternalId]` 复合索引（会给每条 track 写入加索引成本、正违背 v30 决策）。用**零迁移的内存预载去重**达到同样 O(1)。复合索引作为 Alternative 记录在 §12。 |
| 仓库既有 indicator 模式 [`sync-indicator.ts`](../../../../src/stores/sync-indicator.ts) / [`download-indicator.ts`](../../../../src/stores/download-indicator.ts) | 「后台操作进度 store → 纯 reconcile → 单条持久 loading 通知（原地 update 进度）→ 终态 success/error toast」。 | 导入进度桥接直接镜像此模式，不发明新通知形态。 |
| [Progressive Bulk Import Playback PRD](../../20260612-muzero-progressive-bulk-import-playback-prd/20260612-muzero-progressive-bulk-import-playback-prd.md) | 大库导入用「bounded progressive publishing」，小批 flush 让 track 尽快可见，避免 per-track liveQuery churn。 | 复用其结论：membership（`prependTrackIds`）一次性 flush 已是 O(n)；本 PRD 不改可见性策略，只修 track 写入放大。 |

### 2.2 Design Principles

1. **单次读、内存去重、批量写**：把「每条一次 DB 扫描」压成「整集一次 DB 读 + 循环内 O(1) 内存命中 + 一次批量写」。
2. **导入是后台任务，不是 modal 的一部分**：编排（进度 / 终态 / 错误）归 store + 通知层，UI 只负责触发与立即关闭。
3. **复用既有模式，不新增基建**：通知能力、indicator 桥接、membership flush 都已存在——本 PRD 主要是「接线」而非造新。
4. **零 schema 迁移、零 hidden flag**：不 bump DB version、不加索引；回退 = `git revert`（规则 3）。

---

## 3. System Architecture

### 3.1 现状（Before）

```
用户点「新建集 / 同步进集」
      │  (modal.run: await 整单)
      ▼
importStreamedPlaylist / addStreamedPlaylistToSet   (player-store)
      │  fetchPlaylistHits(source, id)  → 全部 hits（远端已分批返回）
      ▼
addHitsToSet(sessionId, hits, onProgress)           (streamed-track-repo)
      │
      └─ for each hit:                               ← O(n) 次循环
             createStreamedTrack
                └─ findStreamedTrack:  db.tracks.where(sessionId).equals().filter().first()
                                        ↑ 每条扫「当前集全部 track」 = O(集合大小)  →  合计 O(n²)  ❌
                └─ db.tracks.put(track)              ← 每条一次写微事务（1000+ 次）  ❌
             onProgress(k, n)
      ▼
prependTrackIds(sessionId, ids)                      ← 结尾一次（O(n)，OK）
      ▼
modal 一直转圈 …… 整单完成才 onClose()               ← 阻塞 UI，无通知  ❌
```

### 3.2 目标（After）

```
用户点「新建集 / 同步进集」
      │  (modal: 触发 startStreamedPlaylistImport(...)  →  立即 onClose())   ✅ 不 await
      ▼
startStreamedPlaylistImport(...)                     (player-store, fire-and-forget)
      │  id = notify.loading("正在导入《歌单名》…")     ← 左上角持久通知
      │  fetchPlaylistHits(...)
      ▼
addHitsToSet(sessionId, hits, onProgress)            (streamed-track-repo, 重写)
      │  existing = db.tracks.where(sessionId).equals().toArray()   ← 整集一次读  ✅
      │  byKey = Map<`${source}:${externalId}`, Track>              ← 一次建索引
      │  for each hit:  byKey.get(key)  ?  复用 : 建新行 push newTracks   ← O(1) 命中  ✅
      │                 onProgress(k, n) → notify.update(id, {progress, detail})
      │  db.tracks.bulkPut(newTracks)                               ← 一次批量写单事务  ✅
      │  prependTrackIds(sessionId, ids)                            ← 一次
      ▼
成功: notify.update(id, {type:"success", message:"已导入 N 首", progress:1})  ← 自动消失
失败: notify.error / notify.update(id, {type:"error", ...})
```

### 3.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| 批量去重 | 内存 `Map<string, Track>` 预载（`${source}:${externalId}` 键） | O(1) 命中，零迁移；契合 v30「靠 sessionId 索引 + 内存过滤」的既有决策 |
| 批量写 | Dexie `bulkPut` + 单 `transaction("rw", tracks)` | 少事务/少 IDB 往返（Dexie 官方推荐） |
| 进度通知 | 既有 [`notify.loading` / `notify.update`](../../../../src/stores/notification-store.ts)（`progress` 细条 + `detail` 计数） | 已支持原地更新 + 终态翻转（loading→success 自动重排消失） |
| 导入编排 | player-store 内 fire-and-forget thunk（镜像 indicator reconcile 生命周期） | 与 `sync-indicator`/`download-indicator` 同纪律：非响应式编排放模块/store 层，不塞 UI |
| 测试 | Vitest + fake-indexeddb（注入 db + 计数 spy） | 既有 [`streamed-track-repo.test.ts`](../../../../src/streamsrc/streamed-track-repo.test.ts) 已覆盖 add/dedupe，扩展即可 |

### 3.3 Project Structure（改动面）

```
src/
├── streamsrc/
│   ├── streamed-track-repo.ts        # 改：addHitsToSet / materializeHitsToTracks 重写为预载去重 + bulkPut
│   └── streamed-track-repo.test.ts   # 改：加去重正确性 + 顺序 + 「DB 读次数不随 n 增长」红测
├── stores/
│   ├── player-store.ts               # 改：新增 startStreamedPlaylistImport（fire-and-forget + 通知生命周期）
│   ├── playlist-auto-sync.ts         # 改（小）：消除 syncBoundPlaylistSet 里对全集的第二次冗余读
│   └── notification-store.ts         # 不改（能力已具备）
├── components/stream/
│   └── playlist-import-dialog.tsx    # 改：run() 不再 await；触发后立即 onClose()；移除内嵌进度条与 busy 阻塞
└── i18n/locales/{en,zh,ja,ko}/common.json  # 加：导入中/已导入/导入失败 通知文案（en 为源）
```

---

## 4. 根因分析（Root Cause）

> 这是本 PRD 的核心。以下均为**代码实证**（file:line + 引用）。

### 4.1 主因：逐条「全集扫描」去重 → O(n²)

[`src/streamsrc/streamed-track-repo.ts:134`](../../../../src/streamsrc/streamed-track-repo.ts#L134) `addHitsToSet` 每条 hit 调 `createStreamedTrack`，后者每条调 `findStreamedTrack`：

```ts
// L55–71：非索引扫描——where(sessionId) 取全集，再 JS filter，first()
export async function findStreamedTrack(sessionId, sourceId, externalId, db) {
  return db.tracks
    .where("sessionId").equals(sessionId)   // 索引取「该集所有 track」
    .filter((t) => t.origin === "streamed"
      && t.streamSourceId === sourceId
      && t.streamExternalId === externalId)  // 内存逐行反序列化 + JS 比较
    .first();
}
```

- 导入边写边扫：第 k 条要扫已写入的 ~k 条 → 合计 Σk ≈ **n²/2**。1000 条 ≈ 50 万次行处理；这就是「越往后越慢」。
- 而且**新导入时绝大多数 hit 是「不存在」的**——`first()` 无法命中，只能扫到该集末尾才返回 undefined，即**每条都吃满全集扫描**（最坏情况）。

**放大器：无复合索引**（[`muzero-db.ts:442`](../../../../src/db/muzero-db.ts#L442)，当前 v30）：

```ts
this.version(30).stores({ tracks: "id, sessionId, sourcePath" });
```

无 `(sessionId, streamSourceId, streamExternalId)` 复合索引，故只能 `sessionId` 索引 + 内存过滤。**注意**：v30 注释明确说这是**刻意的**——「索引在每条导入行上都要额外维护，大批量 bulkAdd 尤其贵」。所以修法不是加索引（见 §5.2），而是去掉「逐条查」。

### 4.2 次因：逐条 `put`，无批量、无单事务

[`createStreamedTrack` L115](../../../../src/streamsrc/streamed-track-repo.ts#L115) 每条 `await db.tracks.put(track)`——1000+ 次独立写微事务，各自提交。不是 O(n²) 但有 1000+ 次 IDB 往返，叠加主因一起拖慢。应累积后 `bulkPut` 一次（单事务）。

### 4.3 同源问题：`materializeHitsToTracks` 一样 O(n²)

[`materializeHitsToTracks` L163–173](../../../../src/streamsrc/streamed-track-repo.ts#L163) 同样 `for hit → createStreamedTrack → findStreamedTrack`。它服务「在线歌单播放上下文」（[player-store playTrackInContext / online-playlist](../../../../src/stores/player-store.ts#L1642)）——**播放一个 1000 条在线歌单**同样吃 O(n²)。修 `addHitsToSet` 时应抽出共享的「批量去重 materialize」helper，两处都受益。

### 4.4 非瓶颈（已排除）

- **远端抓取** `fetchPlaylistHits`：在写库循环**之前**一次性返回全部 hits；其内部分批（如网易云 song/detail 分批）与本 PRD 的写入放大无关，不是「越往后越慢」的成因。
- **`prependTrackIds`**（[repositories.ts:711](../../../../src/db/repositories.ts#L711)）：`addHitsToSet` 结尾**仅调一次**，内部用 `Set` 去重 + 一次数组 prepend + 一次 `sessions.put`，是 O(n) 单次，不是 O(n²)。**不需要改**。
- **`onProgress`**：每条触发一次 `setProgress`（现状）纯内存，便宜；改造后由 store 侧 `notify.update` 承接，仍 O(1)/条。

### 4.5 顺带：`syncBoundPlaylistSet` 的第二次全集读（小优化，非 bug）

[`playlist-auto-sync.ts:68`](../../../../src/stores/playlist-auto-sync.ts#L68) 自动同步里先 `getTracksByIds(session.trackIds)` 建 `existingExternal`，用于 L86 筛「哪些是新条目要下载」——**这是被用到的，不是死代码**。但它与 `addHitsToSet` 内部的去重是**同一份全集的两次读**。可让 `addHitsToSet` 返回「本次新增的 track（区分 added / existing）」，调用方复用即可，省掉第二次读。列为 Phase 2 的可选清理。

---

## 5. Data Model Design

### 5.1 Schema 变更：无

- **不 bump DB version、不加索引、不改 `Track`/`DjSession` 形状**。`Track` 已有 `streamSourceId` / `streamExternalId` / `origin`，内存去重直接用现有字段。
- 契合规则 4（codename 稳定：`muzero-db` / 表名 / id 前缀 / 字段名不变）与规则 1（本地优先，无后端）。

### 5.2 为何不加 `[sessionId+streamSourceId+streamExternalId]` 复合索引

复合索引能让 `findStreamedTrack` O(log n)，但会给**每一条 track 写入**（含本地文件夹 6000+ 批量 `bulkAdd`）加索引维护成本——这正是 [v29/v30](../../../../src/db/muzero-db.ts#L429) 刻意删索引要避免的。内存预载去重达到相同的 O(1) 去重、且**零写入成本、零迁移**，是更贴合本仓库既有决策的解。复合索引作为 Alternative 记录在 [§12 Open Questions](#12-open-questions)。

### 5.3 Privacy & Retention

- 导入只写本地 IndexedDB（track 元数据 + membership）；音频字节仍走 on-demand resolve / 可选缓存，不进 `tracks` 行（规则 5）。
- 通知文案含歌单名（本地展示），不上报；无遥测（规则 8）。

---

## 6. API / Module Design

### 6.1 `addHitsToSet` 重写（Phase 2）

签名**不变**（`sessionId, hits, db?, onProgress?` → `{ added, skipped, tracks }`），内部改为预载去重 + 批量写：

```ts
export async function addHitsToSet(sessionId, hits, db = defaultDb, onProgress?) {
  const session = await db.sessions.get(sessionId);
  const before = new Set(session?.trackIds ?? []);

  // ① 整集一次读，建 (source:externalId) → 已存在 track 的内存索引
  const existingRows = await db.tracks.where("sessionId").equals(sessionId).toArray();
  const byKey = new Map<string, Track>();
  for (const t of existingRows) {
    if (t.origin === "streamed" && t.streamSourceId && t.streamExternalId) {
      byKey.set(`${t.streamSourceId}:${t.streamExternalId}`, t);
    }
  }

  const ids: string[] = [];
  const tracks: Track[] = [];
  const newTracks: Track[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const key = `${hit.source}:${hit.externalId}`;
    let track = byKey.get(key);          // ② O(1) 命中，去掉每条 DB 扫描
    if (!track) {
      track = buildStreamedTrack(hitToStreamedInput(sessionId, hit)); // 纯构造，不落库
      byKey.set(key, track);             // 防同批内重复 hit
      newTracks.push(track);
    }
    ids.push(track.id);
    tracks.push(track);
    onProgress?.(i + 1, hits.length);
  }

  // ③ 一次批量写单事务，替代逐条 put
  if (newTracks.length) await db.tracks.bulkPut(newTracks);
  await prependTrackIds(sessionId, ids, db);   // 结尾一次（不变）

  const addedIds = new Set(ids.filter((id) => !before.has(id)));
  return { added: addedIds.size, skipped: hits.length - addedIds.size, tracks };
}
```

- 抽出纯构造 `buildStreamedTrack(input): Track`（原 `createStreamedTrack` 里 L84–114 的建行逻辑），供 `addHitsToSet` / `materializeHitsToTracks` 共用；`createStreamedTrack`（单条 add 场景，如搜索页「加入集」）保留，内部改为 `buildStreamedTrack` + 单条 `put`。
- `materializeHitsToTracks` 同样改为「预载 + O(1) 命中 + bulkPut」（§4.3）。
- 复杂度：**O(n) 读 + O(n) 内存去重 + O(1) 批量写**。1000 条从「50 万次行处理」降到「1 次全集读 + 1 次 bulkPut」。

### 6.2 `startStreamedPlaylistImport`（Phase 3，player-store fire-and-forget）

```ts
// 触发即返回；进度/终态由通知承接，modal 不 await
startStreamedPlaylistImport(input: {
  mode: "new-set" | "add-to-set";
  source: StreamSourceId; playlistId: string;
  targetSetId?: string; name: string; coverUrl?: string; download?: boolean;
}): void {
  const label = /* i18n: 正在导入《name》… */;
  const notifId = notify.loading(label);
  void (async () => {
    try {
      const onProgress = (done, total) =>
        notify.update(notifId, { detail: `${done}/${total}`, progress: total ? done/total : undefined });
      const result = input.mode === "new-set"
        ? await this.importStreamedPlaylist(input.source, input.playlistId, input.name, { coverUrl, download, onProgress })
        : await this.addStreamedPlaylistToSet(input.source, input.playlistId, input.targetSetId!, { download, onProgress });
      notify.update(notifId, { type: "success", message: /* i18n: 已导入/已同步 … */, detail: undefined, progress: 1 });
    } catch (error) {
      notify.dismiss(notifId);
      notify.error(t("streamSources.importError"), { error });
    }
  })();
}
```

- 复用既有 `importStreamedPlaylist` / `addStreamedPlaylistToSet`（不重写），只是**不再由 modal await**，而是包在通知生命周期里。
- **视频源路径**（`downloadPlaylistVideos*`）本就 enqueue 到持久下载队列、由 [`download-indicator`](../../../../src/stores/download-indicator.ts) 聚合通知——这条已是「异步 + 通知」，Phase 3 只需让 modal 同样触发即关，不必新增通知。
- 可选（§12 Q3）：把这段编排做成独立 `streamed-import-indicator`，与 sync/download indicator 并列，进一步解耦 store。v1 先内联进 player-store thunk（最小改动）。

### 6.3 Error Handling

- 导入失败：`notify.error`（持久、带 copy 调试信息，走既有 error-details）；loading 通知 dismiss，不残留。
- 部分失败（个别 hit 建行异常）：沿用「失败隔离、不中断整批」；结尾计入 `skipped` 并可在终态 detail 标注。
- 并发导入：每次 `startStreamedPlaylistImport` 各自 `notify.loading` id；通知 store 已 cap 持久项 ≤20（[L112](../../../../src/stores/notification-store.ts#L112)），不会无限增长。同歌单重复触发的去重守卫列为 §12 Q2。

---

## 7. Frontend Design

### 7.1 `PlaylistImportDialog` 改造（Phase 3）

- `run(action)` 改为：**触发后台任务 → 立即 `onClose()`**，不再 `await` 业务、不再 `setBusy(true)` 长时间阻塞：

  ```ts
  function run(fire: () => void) { fire(); onClose(); }   // 关闭前不落 toast，终态由通知负责
  ```

- 移除 modal 内嵌进度条（[L236–260](../../../../src/components/stream/playlist-import-dialog.tsx#L236)）与 `busy`/`progress` 局部状态、`onOpenChange` 的 `!busy` 门控（关闭不再被导入卡住）。
- 三个动作（`createNewSet` / `syncInto` / `downloadAsVideo`）改为调 `startStreamedPlaylistImport(...)`（或视频路径的 enqueue），都是 fire-and-close。
- **交互**：点按钮 → modal 关 → 左上角出现「正在导入《歌单名》… 34/1200」持久通知（细进度条）→ 完成翻成「已导入 1200 首到《X》」success（3s 自动消失）/ 失败 error（持久可 copy）。

### 7.2 通知（复用，不新建组件）

- 定位、样式、进度条、终态翻转、动画全由既有 [`NotificationStack`](../../../../src/components/shell/notification-stack.tsx) 提供——**左上角**（`left-4 top-…4.5rem`）正是 PM 要求。
- 与文件夹导入 / R2 同步 / 下载队列的通知**视觉与行为一致**（同一 store、同一 reconcile 语义）。

### 7.3 State Management

- 导入编排移出组件、进 store thunk（非响应式，符合规则 6：编排不塞 UI 组件 state）。
- 集内 track 列表仍由 Dexie `useLiveQuery` 响应式读；`prependTrackIds` 一次 flush 触发一次 liveQuery（沿用 progressive-import 的结论，避免 per-track churn）。

### 7.4 i18n（4 locale）

新增键（en 为源，补 zh/ja/ko）：`playlistImport.importing`（正在导入《{{name}}》）、`playlistImport.importedNotify`（已导入 {{count}} 首到《{{name}}》）、`playlistImport.syncedNotify`（已同步：新增 {{added}}、跳过 {{skipped}}）。复用既有 `streamSources.importError`。所有 UI 文案走 `t()`，不内联。

---

## 8. Implementation Plan

### Phase 1: PRD + 根因确认 + 可度量红测（观测先行）

**Goal:** 落 PRD；补「能证伪 O(n²)」的测试，作为 Phase 2 的 before/after ground truth。

**Tasks:**
- [x] 本 PRD（根因 + best-practice + 分阶段）。
- [x] 在 [`streamed-track-repo.test.ts`](../../../../src/streamsrc/streamed-track-repo.test.ts) 加**规模不变量红测**（`describe("addHitsToSet — batch write is O(n), not O(n²)")`，3 例）：spy `db.tracks.where`/`put`/`bulkPut`，导入 200 / re-sync 250 hits，断言：
  - `where("sessionId")` 全集扫描 **≤ 1 次**（现状 = N → 红）；
  - `tracks.put` **不被调用** + `bulkPut` **恰 1 次**（现状 put = N、bulkPut = 0 → 红）。
- [x] 断言 dedupe / 顺序 / added-skipped 计数现有行为作为回归基线（沿用既有 20 例）。

**Phase 1 Checklist**
- [x] PRD 定稿可执行（分阶段 + 验收明确）。
- [x] 红测在现状下 fail：实测 `put` 调用 200 次（期望 0）、per-session 扫描 250 次（期望 ≤1）；不依赖计时/网络。
- [x] 未提交任何实现于 PRD 之前（PRD 单独 commit `65449583`）。

### Phase 2: 批量导入 O(n²)→O(n)

**Goal:** 单次预载去重 + `bulkPut` 单事务；`addHitsToSet` / `materializeHitsToTracks` / `createStreamedTrack` 共享纯构造 helper。

**Tasks:**
- [x] 抽 `buildStreamedTrack(input): Track`（纯构造，不落库；`createStreamedTrack` 单条路径改用它 + 单条 `put`）。
- [x] 新增共享 `resolveHitsToTracks`：整集一次读 → `Map<source:externalId, Track>` 去重 → 累积 newTracks → `bulkPut` → 返回 hit 顺序；`onProgress` 保持每条触发。
- [x] 重写 `addHitsToSet` / `materializeHitsToTracks` 均走 `resolveHitsToTracks`（后者不动 membership）。
- [ ] （可选，deferred）让 `addHitsToSet` 返回可区分 added/existing 的结果，消除 [`syncBoundPlaylistSet`](../../../../src/stores/playlist-auto-sync.ts#L68) 的第二次全集读——非关键（`addHitsToSet` 本身已 O(n)），留作后续清理。
- [x] 绿化 Phase 1 红测；覆盖：同批内重复 hit 去重、跨批 re-sync 幂等（added 50 / skipped 200）、顺序 = hit 顺序、bulkPut 单次。

**Phase 2 Checklist**
- [x] 批量导入：`where("sessionId")` 全集扫描 ≤1 次（非 O(N)），新行写为 1 次 `bulkPut`（`put` 0 次）——规模不变量红测转绿。
- [x] dedupe / 顺序 / added-skipped 计数与旧行为一致（streamed-track-repo 23 例 + 相关 476 例回归绿）。
- [x] 无 schema 变更、无新索引（DB 仍 v31）。
- [x] 大集重复 re-sync（200 全命中 + 50 新）也只 1 次预载扫描 + 1 次 bulkPut。
- [x] typecheck 绿（`tsc --noEmit`）。

### Phase 3: 异步导入 + 左上角 Notification 进度

**Goal:** modal 触发即关；进度/终态走既有左上角通知；modal 不再阻塞。

**Tasks:**
- [ ] player-store 新增 `startStreamedPlaylistImport`（fire-and-forget + `notify.loading/update/error` 生命周期）。
- [ ] `PlaylistImportDialog.run` 改 fire-and-close；移除内嵌进度条 + `busy` 阻塞 + `!busy` 门控；三动作接新 thunk / 视频 enqueue。
- [ ] i18n 4 locale 新键。
- [ ] 测试：thunk 建 loading→update 进度→success 终态 / 失败翻 error + dismiss loading；modal 触发后同步关闭（不再等待）。

**Phase 3 Checklist**
- [ ] 点导入 → modal 立即关 → 左上角出现带进度条的「正在导入…」通知 → 完成翻 success 自动消失 / 失败 error 持久可 copy。
- [ ] 视频源路径同样 fire-and-close（进度经 download-indicator）。
- [ ] 并发导入各自独立通知，不串。
- [ ] Electron 手测：1000+ 条网易云歌单，关 modal 后可继续操作 App，通知进度平滑推进。

---

## 9. Out of Scope

- **Progressive 可见性**（边导入边让 track 出现在列表）——已由 [Progressive Bulk Import PRD](../../20260612-muzero-progressive-bulk-import-playback-prd/20260612-muzero-progressive-bulk-import-playback-prd.md) 覆盖本地上传路径；在线导入的分批可见性是后续增强，本 PRD 只修写入放大 + 异步通知。
- **复合索引 / DB 迁移**——见 §5.2，本 PRD 刻意不做。
- **取消进行中的导入**——v1 通知不带取消（远端 fetch 一次性完成、写库瞬时）；如需可后加（镜像 sync-indicator 的 cancel action）。
- **下载队列 / 断点续传 / 自动同步调度**——已在 [download-queue-resume-autosync PRD](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md)。
- **`.ncm` 本地解码内存优化** / **Spotify 导入**——各有独立 PRD。
- 移动端专属打磨、hidden flag / runtime toggle（规则 3）。

---

## 10. Security Considerations

- **Authentication / Authorization:** 本地单机；BYO 登录态仅存 settings（规则 2），导入不新增出站主体。
- **Data Protection:** 导入只写本地 IndexedDB；无遥测、无后端（规则 1）。通知文案含歌单名仅本地展示。
- **Audit Logging:** 仅走 [`logger`](../../../../src/lib/logger.ts)（规则 8），不打印 cookie / 直链 / externalId。
- **Rollback:** `git revert` + 重发版；无 schema 迁移故无需 down-migration（规则 3）。

---

## 11. Related Documents

| Document | Description |
|----------|-------------|
| [Progressive Bulk Import Playback PRD](../../20260612-muzero-progressive-bulk-import-playback-prd/20260612-muzero-progressive-bulk-import-playback-prd.md) | 大库导入的 bounded progressive publishing（membership flush 已 O(n)）；本 PRD 复用其 flush 结论 |
| [NCM Import Memory Optimization PRD](../../20260613-muzero-ncm-import-memory-optimization-prd/20260613-muzero-ncm-import-memory-optimization-prd.md) | 本地 `.ncm` 导入内存/存储优化（不同路径，参照其度量方法学） |
| [Download Queue + Resume + Autosync PRD](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md) | 持久下载队列 + 自动同步；`syncBoundPlaylistSet` 与 download-indicator 通知来源 |
| [`streamed-track-repo.ts`](../../../../src/streamsrc/streamed-track-repo.ts) | 批量写核心 `addHitsToSet` / `materializeHitsToTracks`（Phase 2 主战场） |
| [`playlist-import-dialog.tsx`](../../../../src/components/stream/playlist-import-dialog.tsx) | 导入 modal（Phase 3 fire-and-close） |
| [`notification-store.ts`](../../../../src/stores/notification-store.ts) / [`notification-stack.tsx`](../../../../src/components/shell/notification-stack.tsx) | 左上角通知 + 进度能力（复用，不改） |
| [`sync-indicator.ts`](../../../../src/stores/sync-indicator.ts) / [`download-indicator.ts`](../../../../src/stores/download-indicator.ts) | 「后台任务→单条持久进度通知→终态 toast」范式蓝本 |

---

## 12. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 去重用「内存预载」还是「复合索引」？ | Resolved | 内存预载（零迁移、零写入成本，契合 v30 删索引决策）。复合索引作为 Alternative——仅当单条 add 场景在超大集下也成瓶颈时再评估（当前非热路径）。 |
| 2 | 同一歌单重复触发导入是否去重（防并发双写）？ | Open（倾向加轻量守卫） | Phase 3 可加「同 `source:playlistId` 进行中则聚焦已有通知、不重开」；`addHitsToSet` 本身幂等去重，双写不会脏数据，仅浪费。 |
| 3 | 导入编排放 player-store thunk 还是独立 `streamed-import-indicator`？ | Open（v1 内联 thunk） | 先内联最小改动；若后续要支持取消/多任务聚合，再抽独立 indicator 与 sync/download 并列。 |
| 4 | `bulkPut` vs `bulkAdd`？ | Resolved | `bulkPut`——去重后 newTracks 均为新 id，但 `bulkPut` 对「同批意外重复」更稳健，语义与原 `put`（upsert）一致。 |
| 5 | 需要「边导入边可见」（progressive）吗？ | Open | 本 PRD 先不做（写入已瞬时）；若远端 fetch 慢的大歌单体验仍有感，再引入分批 fetch + 分批 flush（参 Progressive PRD）。 |

---

## 13. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-02 | DoodleBear | Initial draft：定位两问题根因——(1) `addHitsToSet`/`materializeHitsToTracks` 逐条 `findStreamedTrack` 全集扫描 → O(n²) + 逐条 `put`；(2) 导入被 modal 同步 await 阻塞。方案：Phase 2 内存预载去重 + `bulkPut` 单事务（零迁移）；Phase 3 fire-and-close + 复用左上角通知/indicator 模式。 |
| 2026-07-02 | DoodleBear | Phase 1 完成：加规模不变量红测（spy `where`/`put`/`bulkPut`），实测现状 put=200 次、per-session 扫描=250 次 → 红，证伪 O(n²) + 逐条 put。 |
| 2026-07-02 | DoodleBear | Phase 2 完成：抽纯 `buildStreamedTrack` + 共享 `resolveHitsToTracks`（单次预载 `Map` 去重 + 一次 `bulkPut`），`addHitsToSet`/`materializeHitsToTracks` 改走它。红测转绿（where ≤1、put 0、bulkPut 1）；streamed-track-repo 23 例 + streamsrc/playlist-auto-sync/player-store 共 476 例回归绿；`tsc --noEmit` 绿。零 schema 迁移（DB 仍 v31）。 |

---

> **Note:** 本 PRD 的杠杆在「复用」：左上角通知、进度条、indicator 桥接、membership flush 全已存在——在线歌单导入是唯一没走这套、反而阻塞 modal 且写入 O(n²) 的异类。改动集中在 `addHitsToSet` 写入路径 + 一个 fire-and-forget thunk + modal 拆 await，不新增基建、不动 schema。
