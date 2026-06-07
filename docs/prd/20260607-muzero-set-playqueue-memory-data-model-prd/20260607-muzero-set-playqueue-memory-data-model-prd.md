# PRD: MUZERO — 数据模型重构：歌单 / 歌曲 / 播放列表 / 记忆（Set / Track / Play Queue / Memory）

**Status:** Draft
**Created:** 2026-06-07
**Author:** MUZERO
**Module:** 核心数据模型 —— 拆分「歌单(策展集合)」与「播放列表(播放顺序)」，引入一对多「歌曲记忆」

> **为什么现在做**：AI DJ chat 助手（[chat agent PRD](../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md)）的工具（建歌单 / 加入播放列表 / play-next / 加记忆）需要一套清晰的底层概念。现状 `DjSession.trackIds` 一身兼二职（既是策展集合、又是播放顺序），且 `Track.note` 只能记一条——都拦住了产品想要的「Spotify 式歌单 vs 播放队列」「一首歌多条回忆」。本 PRD 把地基重构好，chat 工具与 musicgen provenance 再挂上去。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 播放列表 Play Queue 地基（表 + repo + player-store 改消费它 + 迁移现有播放） | ✅ Completed | §6 |
| 2 | autoExtend / refill 迁到 Play Queue（续歌喂队列） | ✅ Completed | §6 |
| 3 | 歌曲记忆 Memory（表 + 迁移 `Track.note` + 多记忆编辑 + 搜索/DJ 上下文接 memory） | 🔲 Pending | §6 |
| 4 | UI 打磨（歌单管理、播放列表 play-next/add/reorder、记忆相册、封面取自记忆） | 🔲 Pending | §6 |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

现状两个痛点：
1. **歌单 = 播放顺序**：`DjSession.trackIds` 既是「这个集合有哪些歌」又是「播放器按什么顺序播」（[`player-store.ts`](../../../src/stores/player-store.ts) 的 `setActiveSession` 直接把 `session.trackIds` 流进 `queue`）。所以没法做「把一个歌单加进当前播放队列」「续在下一手」「队列里临时塞一首/移走一首」这些播放器基操。
2. **一首歌只能记一条 note**：`Track.note?: string` 单值。但「音乐承载回忆」——同一首歌在不同时刻/场景会有**多条**回忆（各带笔记 + 照片）。

### 1.2 四个核心概念

| 概念 | 是什么 | 代码 |
|---|---|---|
| **歌单 Set** | 策展的命名集合（成员 + seed + autoExtend 配置）。是「源」，不是播放顺序。 | `DjSession`（表 `sessions`，**codename 不变**，硬规则 #4）|
| **播放列表 Play Queue** | 实际播放顺序。可塞入/移出/重排、循环。player **消费它**。 | **新** `PlayQueue`（表 `playQueue` 单例）|
| **歌曲 Track** | 一首歌（生成或上传）。曲级 `tags[]` 可搜。 | `Track`（表 `tracks`）|
| **歌曲记忆 Memory** | 一首歌的一条回忆（笔记 + 可选照片 + 时间）。**一对多**：一首歌可加复数条。 | **新** `Memory`（表 `memories`）|

### 1.3 Core Value

1. **歌单与播放队列解耦**（Spotify/Apple Music 模型）：歌单是策展，播放列表是「现在按这个顺序播」；可「播放歌单」「加入队列」「下一首播」「队列里增删改」。
2. **一首歌多条回忆**：记录不同时刻的笔记 + 照片，真正「音乐承载回忆」。
3. **给 AI DJ 助手清晰的工具落点**：chat 工具 `set_*` / `queue_*` / `add_memory` 一一对应这套概念，不再在「集合 vs 顺序」上含糊。

---

## 2. System Architecture

### 2.1 概念关系

```
  歌单 Set (DjSession)            播放列表 Play Queue (单例)
  ┌─────────────────┐           ┌──────────────────────────────┐
  │ trackIds[]（成员）│  loadSet  │ entries: [{id, trackId}]      │ ◀── player 消费这个
  │ seedPrompt        │ ───────▶ │ currentIndex                  │     (next/prev/playIndex)
  │ config.autoExtend │  (灌入)   │ repeat: off|all|one           │
  │ displayMode       │           │ contextSetId?（在播哪个歌单）  │
  └────────┬──────────┘           └──────────────┬───────────────┘
           │ DJ autoExtend 生成新曲                │ play-next / add / remove / reorder
           └──▶ ① 写进歌单 trackIds  ② append 进播放列表 ◀──┘
                                    │
                         歌曲 Track ─┴─ 一对多 ─▶ 歌曲记忆 Memory[]（note + photo + time）
```

### 2.2 架构原则

1. **player 只认播放列表**：[`player-store.ts`](../../../src/stores/player-store.ts) 的 `queue` 改为由 **`playQueue` 派生**（不再直接读 `session.trackIds`）。「播放某歌单」= 把它灌进 `playQueue`。
2. **歌单是源，autoExtend 喂队列**：续歌的 `refillThreshold` 看的是**播放列表 upcoming**（真正要播的）；DJ 生成新曲 → 写进当前歌单 `trackIds` + append 进播放列表。`contextSetId` 标记「在播哪个歌单」，决定续给谁。
3. **codename 稳定（硬规则 #4）**：歌单仍是 `DjSession`/表 `sessions`/前缀 `ses_`（**不改名**，UI 文案叫「歌单」）。新增前缀 `mem_`（记忆）；`playQueue` 单例。
4. **音频字节永不进行 row**：记忆照片进 `mediaBlobs`（新 `role: "memory"`），`Memory.photoBlobId` 外键引用（与 cover/media 一致，硬规则 #5）。
5. **Dexie 迁移加 upgrade（硬规则 #7）**：bump version + `.upgrade()` 回填（`Track.note` → 一条 Memory；按 resume 点 seed 播放列表）。
6. **player-store 单例纪律（硬规则 #6）**：播放列表的 live 读用 `useLiveQuery`；transport/index 等运行态在 store；不把可由 DB 派生的塞进 Zustand。

### 2.3 Technology Stack

复用现有：Dexie 4 + `useLiveQuery`、Zustand player-store、`src/player/queue.ts` 纯队列数学（`shouldAutoExtend` 迁到看播放列表）、repos `(input, db=defaultDb)` 约定。无新依赖。

---

## 3. Data Model（`muzero-db` v2 → v3）

### 3.1 歌单 Set —— `DjSession`（[`types.ts`](../../../src/db/types.ts)，**几乎不变**）

- 保持 `id(ses_)/name/seedPrompt/trackIds[]/status/config/displayMode/createdAt/updatedAt`。
- 语义收窄：`trackIds[]` 现在是**策展成员**（这个歌单有哪些歌），**不再是播放顺序**。
- 表 stores 不变（codename 稳定）。

### 3.2 播放列表 Play Queue —— **新** `PlayQueue`（单例）

```ts
export interface PlayQueueEntry {
  id: string;            // newId("pqe") —— 稳定 key，允许同一 track 重复入队
  trackId: string;
}
export interface PlayQueue {
  id: "main";            // 单例
  entries: PlayQueueEntry[];   // 实际播放顺序
  currentIndex: number;        // 当前播放位
  repeat: "off" | "all" | "one";
  /** 「在播哪个歌单」——驱动 autoExtend 续歌 + UI「正在播放自 X」。ad-hoc 队列为 undefined。 */
  contextSetId?: string;
  updatedAt: number;
}
```
- Dexie：`playQueue: "id"`（单例，JSON 数组直接存 row，参 chat session 快照思路；track id 短、量小，OK）。
- **player 消费它**：`queue: Track[]` = `playQueue.entries` 映射到 `tracks`（`useLiveQuery` join）。`currentIndex` 持久（resume）。

### 3.3 歌曲 Track —— `Track`（[`types.ts`](../../../src/db/types.ts) 调整）

- **`tags: string[]` 留在 Track**（曲级、可搜，索引 `*tags` 不变）。
- **`note?` 废弃**：迁移到 Memory（见 §3.4 + §7 迁移）。迁移后 UI 不再读 `Track.note`（字段可暂留 nullable 防御，标 deprecated）。
- **`coverBlobId?` 保留**：Now-Playing stage 的展示封面；可「设为封面」从某条记忆照片取（也可独立）。
- 追加 `providerPreset?: string`（musicgen [Q5](../20260607-muzero-cloud-musicgen-provider-selection-prd/20260607-muzero-cloud-musicgen-provider-selection-prd.md)：哪个 vendor/model 生成，缺省安全）。

### 3.4 歌曲记忆 Memory —— **新** `Memory`（一对多）

```ts
export interface Memory {
  id: string;            // newId("mem")
  trackId: string;       // 属于哪首歌（一对多）
  note: string;          // 这条回忆的文字
  photoBlobId?: string;  // 可选照片，外键 → mediaBlobs(role:"memory")
  createdAt: number;     // 时间（按时间线展示）
}
```
- Dexie：`memories: "id, trackId, createdAt, [trackId+createdAt]"`（按曲查 + 时间排序）。
- 照片进 `mediaBlobs`，**新增 `role: "memory"`**（现有 role `media|cover|background|gallery` 追加，硬规则 #5；新 role 加法、不需 bump 既有 blob）。
- 「音乐承载回忆」：一首歌 N 条记忆，各带笔记 + 照片 + 时间。

### 3.5 Migration（v2 → v3，[`muzero-db.ts`](../../../src/db/muzero-db.ts)）

```
this.version(3).stores({
  playQueue: "id",                                   // 新单例
  memories:  "id, trackId, createdAt, [trackId+createdAt]",   // 新表
  // tracks/sessions/settings/mediaBlobs stores 不变（除非要给 memory role 改索引——role 已在索引里，无需改）
}).upgrade(async (tx) => {
  // 1) Track.note → 一条 Memory（保留回忆）
  const tracks = await tx.table("tracks").toArray();
  for (const t of tracks) {
    if (t.note && t.note.trim()) {
      await tx.table("memories").add({ id: newId("mem"), trackId: t.id, note: t.note, createdAt: t.createdAt });
    }
  }
  // 2) seed 播放列表：按 resume 点（settings.lastSessionId/lastTrackIndex）把那个歌单灌进 playQueue，
  //    currentIndex = lastTrackIndex，让升级后播放无缝恢复。无 resume 则空队列。
  // （详见 §7 迁移与回退）
});
```
> ⚠️ 实现时确认当前 live 版本号（并行工作可能已 bump 过 v2+）；按「下一可用版本」落，不要原地改既有 stores（硬规则 #7）。

---

## 4. 行为 / 关键流程

| 动作 | 行为（best practice，Spotify/Apple Music 口径）|
|---|---|
| **播放歌单** | `playSet(setId, mode)`：`replace`=清空播放列表→灌入该歌单 trackIds→从 0 播；`append`=接到队尾。设 `contextSetId=setId`。 |
| **下一首播 / 加入队列** | `playNext(trackId)`=插在 `currentIndex+1`；`addToQueue(trackId)`=append 队尾。 |
| **DJ 生成一首** | ① 写进当前歌单 `trackIds` ② `playNext` 续在当前下一手（或 append，按调用）。物化仍由 store `pump` 统一。 |
| **队列编辑** | `removeFromQueue(entryId)` / `reorderQueue(from,to)` / `clearQueue`。 |
| **循环** | `repeat: off|all|one`；`all` 到底回 0，`one` 单曲循环。 |
| **autoExtend 续歌** | 当 `contextSetId` = 活跃 DJ 歌单且**播放列表 upcoming ≤ refillThreshold** → DJ draft → 新曲写歌单 + append 播放列表。`shouldAutoExtend`（[`queue.ts`](../../../src/player/queue.ts)）改看播放列表 upcoming。 |
| **加记忆** | `addMemory(trackId, {note, photo?})`：新增一条 Memory（+ 照片进 mediaBlobs）。Now-Playing「这首」= `playQueue.currentIndex` 对应 track。 |
| **设封面** | 从某条记忆照片「设为封面」→ 写 `Track.coverBlobId`（或独立上传）。 |

> **关键**：`playSet` 是「把歌单灌进播放列表」，不是「让 player 直接读歌单」。这一步是整套拆分的枢纽。

---

## 5. Frontend / 受影响代码

| 区域 | 现状 | 改动 |
|---|---|---|
| [`player-store.ts`](../../../src/stores/player-store.ts) | `setActiveSession` liveQuery 把 `session.trackIds` → `queue`；`pump`/`maybeRefill` 看 session upcoming | **核心改**：`queue` 改 liveQuery 自 `playQueue`；新增 `playSet/playNext/addToQueue/removeFromQueue/reorderQueue/clearQueue/setRepeat`；`maybeRefill` 看播放列表 upcoming + `contextSetId` |
| [`queue.ts`](../../../src/player/queue.ts) | `shouldAutoExtend(session)` | 改看播放列表 upcoming（纯函数，穷举单测）|
| [`repositories.ts`](../../../src/db/repositories.ts) | session/track repos | 新增 `playQueue` repo（load/insert/remove/reorder/setRepeat）+ `memories` repo（add/list/update/delete）；沿用 `(input, db=defaultDb)` |
| [`annotation-editor.tsx`](../../../src/components/track/annotation-editor.tsx) | tags + 单 note + cover | **改**：tags 不变；note 区改成**记忆列表**（加/编辑/删/按时间，每条 note+照片）；「设为封面」从记忆取 |
| [`track-search.ts`](../../../src/lib/track-search.ts) | `matchesQuery` 搜 tags + `track.note` | **改**：搜 tags（曲）+ **该曲所有 memory.note**（join memories）；`#tag` 不变 |
| [`dj-prompt.ts`](../../../src/dj/dj-prompt.ts) `RecentTrack` | `note?` 喂 DJ | 改喂该曲 memory.note 串联 |
| queue-page / now-playing / track-row | 读 session.trackIds / track.note | 读 playQueue / memories；队列页支持 play-next/add/remove/reorder UI |
| Dock / 导航 | 「歌单」入口 | 歌单管理（CRUD + 播放/加入队列）；播放列表视图 |

---

## 6. Implementation Plan

> **基础设施先于广度**：先把播放列表跑通（player 消费它）→ 再迁 autoExtend → 再上记忆 → 最后 UI 打磨。每 phase 原子 commit + 更新本 PRD。

### Phase 1: 播放列表地基 ✅
**Tasks:**
- [x] **1a** 纯函数 `play-queue.ts`（appendEntries/insertNext/removeEntry/moveEntry/replaceEntries，currentIndex 跟随）+ 12 单测。
- [x] **1b** `PlayQueue`/`PlayQueueEntry` 类型；`muzero-db` v3 加 `playQueue` 表 + `.upgrade()` 按 resume 点 seed；`playQueue` repo（getPlayQueue/set/append/playNext/remove/reorder/setIndex/setRepeat/setContext）+ 8 测（含 v2→v3 升级 seed 路径）。
- [x] **1c** `player-store` `queue` 改 liveQuery 自 `playQueue`（init 一次）；`setActiveSession` → `playQueueSet`(载入歌单) + **high-water 追加**（`setSub` 监听歌单，新增曲追加进队列，不复活已移除的）；行为与旧版一致（队列==歌单，暂无用户编辑）。
- [~] `playSet/playNext/addToQueue/removeFromQueue/reorderQueue` **用户级 store actions 延后到 DM-4**（配队列编辑 UI）；repo 层已就绪+测。

**Phase 1 Checklist:**
- [x] 升级后旧 session 无缝续播（**浏览器实测**：v3 迁移从 resume seed playQueue，dbVersion 30，player 消费它、点播放 video `paused:false` 在走，零 console 报错）；`session.trackIds` 不再被 player 直接消费。
- [x] `play-queue.ts` 纯函数穷举单测；repo 含 v2→v3 升级测；全套件 148 绿；typecheck/biome 清。
- [~] play-next/remove/reorder 的端到端 = DM-4（UI）；autoExtend→queue 的确定性集成测 = DM-2。

### Phase 2: autoExtend 迁到播放列表 ✅
**Tasks:**
- [x] 续歌「喂队列」= DM-1c 的 **high-water 追加**（DJ draft 写歌单 trackIds → `setSub` 追加进播放列表）。
- [x] `refillIfNeeded(sessionId, queueLength, currentIndex)` —— 阈值改测**播放列表 upcoming**（而非歌单成员数），编辑队列后仍准；`player-store.maybeRefill` 传 `queue.length`。`shouldAutoExtend` 纯函数复用。
- [x] 生成→单一 `pump` 物化→入队顺序沿用不变。

**Phase 2 Checklist:**
- [x] dj-engine 9 测更新为 `(queueLength, currentIndex)` 口径全绿；全套件 148 绿；typecheck/biome 清。
- [~] DJ 集自动续→新曲进播放列表的端到端 = DM-1c high-water 已实现并浏览器验证迁移+播放；完整 fake-indexeddb 驱动 player-store 的端到端测（含 MediaEngine）成本高，留 DM-4 配队列 UI 一起补。

### Phase 3: 歌曲记忆 Memory
**Tasks:**
- [ ] `Memory` 类型；v3 加 `memories` 表 + `mediaBlobs` `role:"memory"`；`memories` repo。
- [ ] 迁移 `Track.note` → 一条 Memory；`annotation-editor` 改记忆列表（加/编辑/删/照片/时间）。
- [ ] `track-search.matchesQuery` 搜 memory.note；`RecentTrack` 喂 memory 给 DJ；providerPreset 落 Track + 生成时自动加一条 Memory（musicgen Q5）。

**Phase 3 Checklist:**
- [ ] 一首歌可加多条记忆（含照片）；搜索命中记忆文字；升级后旧 note 变首条记忆。
- [ ] DJ 上下文带记忆；生成的曲自动带 provenance Note。

### Phase 4: UI 打磨
**Tasks:**
- [ ] 歌单管理（CRUD + 播放/加入队列/切换）；播放列表视图（play-next/add/remove/reorder/loop 控件）；记忆相册；封面取自记忆。
- [ ] i18n 4 语全量（歌单/播放列表/记忆 文案）。

**Phase 4 Checklist:**
- [ ] 浏览器 preview 实测：建歌单→播放→队列编辑→加记忆→搜索；暗色 + 响应式；零 console 报错。
- [ ] 四语种齐全。

---

## 7. Out of Scope / 迁移与回退

- **迁移**：v2→v3 一次性 `.upgrade()`——`Track.note`→首条 Memory；按 resume 点 seed 播放列表。新表（playQueue/memories）无需回填。**幂等**：升级只跑一次（Dexie 版本机制保证）。
- **回退**：`git revert` + 重新发版（硬规则 #3，不藏 flag）。注意 v3 升级**不可逆**（IndexedDB 已建新表/迁数据）——回退代码后旧版读不到新表是预期；发版前在测试库验。
- **不做**：shuffle 随机播放（v2 再说，repeat 先上）；跨设备同步（无后端，硬规则 #1）；记忆的协作/分享；播放列表多条命名保存（v1 单一 main 播放列表，命名集合用「歌单」承载）。
- **不重命名 codename**：`DjSession`/`sessions`/`ses_`/`trk_`/`blb_` 不动（硬规则 #4）。

## 8. Security / Privacy

- 本地优先不变（硬规则 #1）：歌单/播放列表/记忆/照片全在 IndexedDB `muzero-db`，无后端、无遥测。
- 记忆照片是用户隐私 → 进 `mediaBlobs`（与音频同级本地存），日志绝不打印 note 文本 / 照片 bytes（硬规则 #8）。

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Chat agent PRD](../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md) | 依赖本模型：`set_*`/`queue_*`/`add_memory` 工具落在这套概念上 |
| [musicgen provider PRD](../20260607-muzero-cloud-musicgen-provider-selection-prd/20260607-muzero-cloud-musicgen-provider-selection-prd.md) | Q5 `Track.providerPreset` + 生成自动 Memory |
| [Foundation PRD](../20260606-muzero-ai-dj-foundation-prd/20260606-muzero-ai-dj-foundation-prd.md) | 原始 v1/v2 数据模型（本 PRD 演进它）|
| 受影响代码 | [`player-store.ts`](../../../src/stores/player-store.ts) · [`queue.ts`](../../../src/player/queue.ts) · [`muzero-db.ts`](../../../src/db/muzero-db.ts) · [`types.ts`](../../../src/db/types.ts) · [`repositories.ts`](../../../src/db/repositories.ts) · [`annotation-editor.tsx`](../../../src/components/track/annotation-editor.tsx) · [`track-search.ts`](../../../src/lib/track-search.ts) · [`dj-prompt.ts`](../../../src/dj/dj-prompt.ts) |

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 播放列表单一 main 还是可多条命名保存？ | Resolved | **单一 main**；命名集合的需求由「歌单」承载（歌单可无限多，播放列表是当前播放顺序）|
| 2 | `queue.entries` 用 `{id,trackId}` 还是裸 `trackId[]`？ | Resolved | `{id,trackId}`——允许同曲重复入队 + reorder 稳定 key |
| 3 | shuffle 要不要 v1？ | Open | 倾向 v2（先上 repeat）；如要 v1，加 `shuffle:boolean` + 洗牌保序原 entries |
| 4 | `Track.note` 字段升级后删除还是保留 nullable？ | Open | 倾向保留 nullable 标 deprecated（防御），UI 只读 memories；Phase 3 定 |
| 5 | autoExtend 看「播放列表 upcoming」还是「歌单未播余量」？ | Resolved | 看**播放列表 upcoming**（真正要播的）；`contextSetId` 决定续给哪个歌单 |
| 6 | 封面：独立 `coverBlobId` vs 取首条记忆照片？ | Open | 倾向保留独立 `coverBlobId`（可「设为封面」从记忆取），Phase 4 定 |

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft —— 应 chat agent 工具设计讨论，拆分「歌单(策展集合 DjSession) vs 播放列表(播放顺序 PlayQueue 单例)」、引入一对多「歌曲记忆 Memory」(note+照片+时间)、Track.note 迁移、player-store 改消费 playQueue、autoExtend 喂队列。4-phase，基础设施先行 |
| 2026-06-07 | MUZERO | **Phase 1 完成**（TDD，3 原子 commit）：1a 纯函数 play-queue（12 测）；1b Dexie v3 playQueue 表+repo+v2→v3 seed 迁移（8 测含升级路径）；1c player-store 改消费 playQueue + high-water 追加（DJ/上传新曲流进队列）。浏览器实测迁移 seed+播放正常、零报错；全套件 148 绿。用户级队列编辑 actions 延后 DM-4 |
| 2026-06-07 | MUZERO | **Phase 2 完成**：`refillIfNeeded` 阈值改测播放列表 upcoming（`(sessionId,queueLength,currentIndex)`），编辑队列后续歌仍准；`maybeRefill` 传 `queue.length`。续歌喂队列由 DM-1c high-water 承担。dj-engine 9 测更新、全套件 148 绿 |

---

> **Note**：本 PRD 是 chat agent 工具的**前置地基**。建议落地顺序：**先这份（数据模型）→ 再 chat agent**，否则 chat 工具会建在含糊的「集合即顺序」旧模型上反复返工。codename 层（`DjSession`/`sessions`/id 前缀）保持稳定，只演进语义 + 加新表。
