# PRD: 播放队列模型重构（上下文解析 + 随机播放/点歌）

**Status:** Final（设计定稿可执行；10 项 Open Questions 已全部拍板，见 §10）
**Created:** 2026-06-21
**Author:** MUZERO Core / Playback
**Module:** Player Store / Play Queue / Library Set Detail — 「播放队列从哪来、是什么顺序」的统一模型：① 上下文解析（从哪个歌单播放）② 随机播放 × 点歌（可见队列即播放顺序）

> **本 PRD 覆盖两个同根问题**，都归结为「**可见的播放队列 = 真实播放顺序，且它来自用户当前所在的界面**」：
> - **Part A — 上下文解析**（§1.1–§1.4 / Phase 1–3）：同一首歌在多歌单时从 Y 点播却切到 X。
> - **Part B — 随机播放 × 点歌**（[§2.5](#25-part-b随机播放shuffle--点歌模型调研--方案) / Phase 4）：随机播放是一套与可见队列并行的「随机下一首索引」，导致可见队列 ≠ 播放顺序，且点歌「插到下一首」被 shuffle 跳过。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Set 上下文 + 顺序对齐（修复主 bug） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 派生实体 / 系统歌单 / 全部歌曲上下文统一 | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Online 歌单（发现 tab 第 5 项）上下文 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | **随机播放队列模型（materialized shuffle + Next-in-Queue 点歌）** | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | `sessionId` 语义收敛 + `playTrack` 清理 | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

**复现路径（用户报告）：**

1. 一首曲子 A 同时存在于歌单 X 和歌单 Y（A 先被加进 X，后又加进 Y）。
2. 打开歌单 Y 的详情页，点击 A 播放。
3. **现象**：播放列表被切换成了 **X**（A 第一次被添加/创建的那个歌单），而不是用户正在浏览的 **Y**。后续 next/prev、自动续歌、Now-Playing「来源」标签、跳到来源都跟着错成 X。

**这是数据模型层面的概念混淆，不是 UI 小 bug。** 当前 `Track.sessionId` 是**单值**字段，记录的是这首歌的「出生地 / 归属歌单」（创建时写入，之后**永不更新**）；而「一首歌属于哪些歌单」是**多对多**关系，由各个 [`DjSession.trackIds`](../../../../src/db/types.ts) 数组分别持有。播放入口 [`playTrack(track)`](../../../../src/stores/player-store.ts) 却**只看 `track.sessionId` 来决定播放上下文**，完全忽略了用户实际点击所在的歌单（`SetDetailView` 的 `setId`）。

### 1.2 问题严重性 / 次生症状

| 场景 | 当前行为 | 期望 |
|------|----------|------|
| **主 bug**：A ∈ {X(归属), Y}，在 Y 里点 A | 切到 X、从 X 的队列播放 | 留在 Y、从 Y 的队列播放 |
| **静默无声**：A 已从归属歌单 X 移除（`removeTracksFromSession` 不会重指 `sessionId`），但仍在 Y | 切到 X → 队列里**没有** A → `findIndex` 返回 -1 → **什么都不播**（且 UI 已被切到 X） | 在 Y 里正常播放 A |
| **归属歌单已删（未 purge）**：X 被删除但 A 共享给 Y 而保活 | `track.sessionId` 变成悬空指针 → `setActiveSession(X)` 读不到 session | 在 Y 里正常播放 A |
| **顺序不一致**：歌单被拖拽排序过（有 `trackRanks`） | 即使「播放全部」走对了 set，`setActiveSession` 用裸 `session.trackIds` 建队列，与详情页 `orderedSetTrackIds` 显示顺序**不一致** | 队列顺序 == 用户看到的顺序 |
| **Online 歌单（发现 tab 第 5 项）**：在 [`OnlinePlaylistDetail`](../../../../src/components/discover/online-playlist-detail.tsx) 里点歌 | 经 [`playStreamedHit`](../../../../src/stores/player-store.ts) 把这首歌灌进**唯一共享的「在线」收集集**（`streamOnlineSetId`），再 `setActiveSession(共享在线集)` → 队列变成「**历来所有在线播放过的歌**」的大杂烩，**不是**当前在线歌单的曲目；来源标签也显示成那个共享集 | 队列 == 当前在线歌单的曲目（有序），来源 == 这个在线歌单 |
| **随机播放 × 点歌**（Part B）：shuffle 开启时点歌「下一首」 | 点歌把曲目插到 `entries[cur+1]`，但 `next()` 走的是**另一套并行的随机索引** `shuffleOrder`；队列一变长 `shuffleOrder.length≠queue.length` → 整张**重新洗牌** → 刚插入的「下一首」被甩到随机位置、**被跳过** | 点歌的曲目**真的下一首播**（不被 shuffle 打乱） |
| **随机播放：可见队列 ≠ 播放顺序**（Part B） | [`QueuePanel`](../../../../src/components/player/queue-panel.tsx) 显示 `entries` 的**原始顺序**，但播放按 `shuffleOrder` 乱跳 → 「看到的下一首」和「真播的下一首」对不上 | 可见队列就是已洗好的播放顺序，next == 列表里的下一行 |

> 这些症状全部源于同一个根因：**播放上下文应当来自用户点击所在的界面（歌单/列表），而不是曲目自身存储的归属字段、或它被灌进的某个收集集。**
>
> Online 歌单是这个根因的**第二种形态**：streamed 曲目需要先物化成 DB 行才能进队列，当前实现把所有在线播放的曲目都物化进**同一个共享集**，于是「上下文」退化成那个共享集——和本地多对多场景同病同源。值得注意的是 [`QueueSource` 已声明 `{ kind: "online-playlist"; playlist }` 变体](../../../../src/stores/player-store.ts)，却**从未被赋值**（死代码）——说明从在线歌单播放时，歌单上下文从一开始就没被保留。

### 1.3 Target Users

| Role | Description | 影响 |
|------|-------------|------|
| **普通听众** | 把同一首歌收进多个歌单（"music carries memories"，一首歌可承载多段记忆/多个 tag 组合） | 跨歌单播放是核心使用方式，当前直接错乱 |
| **直播主播** | 在某个歌单里点歌播放，期望队列就是这个歌单 | 错误切单会打断现场播放编排 + 让 `autoExtend` 在错误的 DJ 集上触发 |

### 1.4 Core Value

1. **正确性**：从哪个歌单点的歌，就在哪个歌单的队列里播——所见即所播。
2. **一致性**：队列顺序 == 详情页显示顺序（含拖拽重排、排序、筛选）。
3. **健壮性**：消除「点了没反应」「跳到莫名其妙的歌单」两个让人困惑的硬伤；`Track.sessionId` 收敛为纯 provenance，不再是播放裁决依据。

---

## 2. System Architecture

### 2.1 当前播放上下文是怎么解析的（问题链路）

```
用户在「歌单 Y 详情页」点击曲目 A
        │   SetDetailView 渲染的是 Y：orderedSetTrackIds(Y.trackIds, Y.trackRanks)
        │   但 onPlay 只透传 track，不透传 setId(Y)
        ▼
onPlay={(track) => void playTrack(track)}     ← 上下文(Y)在这里丢失
        ▼
playTrack(track):
   if (activeSessionId !== track.sessionId)   ← track.sessionId == X(归属/出生地)
       setActiveSession(track.sessionId == X) ← 队列被装成 X.trackIds
   idx = queue.findIndex(t => t.id === A)      ← 在 X 的队列里找 A
   playIndex(idx)
        ▼
   播放列表 = X（错）；A 不在 X 时 idx=-1，静默无声
```

### 2.2 对照：已经「正确」的上下文链路（设计可复用）

- **「播放全部」**：[`onPlayAll → playSet(setId)`](../../../../src/pages/search-page.tsx) → `setActiveSession(setId)` + `play()`。显式传了 `setId`，所以装载的是正确歌单（但顺序仍走裸 `trackIds`，见 §1.2 顺序问题）。
- **系统歌单**：[`playSystemPlaylist(playlistId, tracks)`](../../../../src/stores/player-store.ts) —— 接收**显式的有序 tracks 数组** + 设置 `queueSource`，`contextSetId` 不设（系统歌单不是 `DjSession` 行），`djEnabled=false`。**这正是我们要推广到所有列表的模式。**
- **队列页 / VirtualTrackList 默认**：[`handlePlay = onPlay ?? ((_t, index) => playIndex(index))`](../../../../src/components/library/virtual-track-list.tsx) —— 不传 `onPlay` 时退化为「在当前已激活队列里按下标播放」，这是上下文正确的（因为它不切单）。

> 结论：仓库里**已经存在**「按显式有序列表 + QueueSource 播放」的正确范式（`playSystemPlaylist`）。重构 = 把这个范式抽成统一入口，让所有详情页都走它，而不是各自调 `playTrack(track)` 让 store 去猜上下文。

### 2.2.1 Online 歌单的特殊性（发现 tab 第 5 项）

发现（Discover / `mode === "online"`）是 tab 2 五个分段 [`GALLERY_MODES = ["sets","tracks","albums","artists","online"]`](../../../../src/pages/search-page.tsx) 的**第 5 个**（键盘数字 5 选中）。它与前 4 个本质不同：

- **曲目不是 DB 行，而是 `StreamSearchHit`**（远端解析）。要进播放队列必须先 [`createStreamedTrack`](../../../../src/streamsrc/streamed-track-repo.ts) 物化成 `Track`（`origin:"streamed"`）。
- **当前所有在线播放都被灌进同一个共享集** [`ensureOnlineSet()` → `streamOnlineSetId`](../../../../src/stores/player-store.ts)。于是 `createStreamedTrack(hitToStreamedInput(共享集, hit))` 让这首歌的 `sessionId` = 共享集，`prependTrackIds(共享集, …)`，再 `setActiveSession(共享集)`。
- **结果**：从某个在线歌单点歌，队列变成「共享在线集」（历来所有在线播放过的歌的池子），来源标签也是它——既不是当前在线歌单，顺序也不对。`playStreamedHits`（在线歌单「播放全部」）同理：把尾部灌进共享集、头部走 `playStreamedHit`，照样池化。

```
在线歌单详情(OnlinePlaylistDetail, hits[]) 点 hit
        ▼  onPlay={(hit) => playStreamedHit(hit)}
playStreamedHit(hit):
   setId = ensureOnlineSet()            ← 唯一共享「在线」集，与当前在线歌单无关
   track = createStreamedTrack(共享集)   ← track.sessionId = 共享集
   setActiveSession(共享集)              ← 队列 = 共享集全部历史在线歌；queueSource = {set, 共享集}
        ▼
   播放列表 = 共享在线池（错）；来源 ≠ 当前在线歌单；顺序 ≠ 歌单顺序
```

> 修复需要：从在线歌单播放时，把**这个歌单的 hits**（按显示顺序）物化为 streamed 队列，并设 `queueSource = { kind:"online-playlist", playlist }`（启用那个早已声明却没人赋值的变体）。物化策略（懒/急、是否仍落进共享集做缓存）见 §4.6 与 Open Questions Q6。

### 2.3 Technology Stack

| Component | Technology | 角色 |
|-----------|------------|------|
| **播放编排** | Zustand `usePlayerStore` | 持有 `queue` / `currentIndex` / `queueSource` / `activeSessionId`，是播放上下文的唯一裁决处 |
| **播放列表（持久）** | Dexie `playQueue`（singleton `main`） | `entries` + `currentIndex` + `contextSetId`，与歌单解耦 |
| **歌单（成员关系）** | Dexie `sessions`（`DjSession.trackIds` + `trackRanks`） | 多对多成员 + 分数序 |
| **顺序裁决** | [`orderedSetTrackIds`](../../../../src/player/set-order.ts) | 把 `trackIds`+`trackRanks` 折算成显示顺序（唯一裁决） |
| **来源标签 / 跳到来源** | [`resolvePlayingSource`](../../../../src/lib/playing-source.ts) + `QueueSource` | 「正在播放自」标签、jump-to-source |

### 2.4 涉及文件

```
src/
├── stores/player-store.ts          # 核心：playTrack / setActiveSession / playSystemPlaylist / QueueSource
├── db/types.ts                     # Track.sessionId(归属) / DjSession.trackIds(成员) / PlayQueue.contextSetId
├── db/repositories.ts              # prependTrackIds(只改 trackIds) / removeTracksFromSession / deleteSession / playQueueSet
├── player/set-order.ts             # orderedSetTrackIds（显示顺序唯一裁决）
├── lib/playing-source.ts           # resolvePlayingSource（来源标签 / jump-to-source）
├── pages/search-page.tsx           # SetDetailView（主 bug 现场）+ playSet + 库「全部歌曲」playLibraryTrack
└── components/library/
    ├── track-list-section.tsx      # onPlay 透传层
    ├── virtual-track-list.tsx      # handlePlay = onPlay ?? playIndex(index)
    ├── entity-detail.tsx           # 艺人/专辑详情 → playTrack(track)
    └── system-playlist-detail.tsx  # 红心/最多播放/最近播放 → playTrack(track)
```

### 2.5 Part B：随机播放（shuffle）× 点歌——模型调研 + 方案

#### 2.5.1 现状：shuffle 是「与可见队列并行的随机下一首索引」

- `playQueue.entries`（持久、有序）是**可见队列**；`QueuePanel` 按它原样渲染。
- [`shuffleOrder`](../../../../src/stores/player-store.ts) 是一个**模块作用域、非响应式、不持久化**的 `[0,length)` 索引排列（Fisher–Yates，当前曲钉在首位）。
- [`next()` / `skipPrev()`](../../../../src/stores/player-store.ts) 在 shuffle 时走 `shuffleOrder`（[`shuffleManualNext`/`shufflePrev`](../../../../src/player/queue.ts)），**不走** `entries` 顺序。
- 后果一（**可见 ≠ 实播**）：面板显示 `entries` 原序，播放却按 `shuffleOrder` 乱跳。
- 后果二（**点歌被跳过**）：点歌插到 `entries[cur+1]` 使 `queue.length` +1 → 下次 `shuffleNext` 发现 `order.length≠length` → [`buildShuffleOrder` 整张重洗](../../../../src/player/queue.ts) → 插入的「下一首」被甩走。
- 后果三（**重启丢失**）：`shuffleOrder` 不持久（[启动时 `buildShuffleOrder` 重建](../../../../src/stores/player-store.ts)）→ 重启后 shuffle 顺序丢失。
- 附带复杂度：cover-pager 的 `peekTrack`/`peekUpcomingTracks`/`peekWindowFrom`/`windowManualIndices` 全都得额外吃 `shuffleOrder` 才能和实播对齐——并行模型把复杂度摊到了整条预览链。

#### 2.5.2 调研：市面软件怎么做（best practice）

| 应用 | 模型 | shuffle 与「点歌/Play Next」的关系 |
|------|------|-------------------------------------|
| **Spotify** | **物化洗牌队列**：对 context（歌单/专辑）洗一次成真实顺序；手动加的进**独立「Next in Queue」FIFO**，**不参与洗牌**，优先于 context 播放，播完接回洗好的 context | 「Add to Queue / Play Next」永远按加入顺序优先播；shuffle 按钮不重排手动队列 |
| **Apple Music** | 同上「Up Next」物化队列；Play Next 插队首、Play Later 排队尾 | 意图同 Spotify（但其 shuffle×repeat 组合实现有口碑 bug，反证「并行随机 + repeat」是复杂度陷阱，要避开） |
| **YouTube Music** | **动态电台队列**：边听边即时生成下一批，skip 会重roll，「活的电台」 | 适合算法电台，**不适合**用户拥有歌单、要求「所见即所播」的本地播放器——点歌在这种模型里更不可预测 |

**结论**：MUZERO 是本地优先、用户拥有歌单、明确要「可见队列即播放顺序 + 点歌真的下一首」的播放器 → 应采用 **Spotify/Apple 的「物化洗牌队列 + 独立优先点歌 FIFO」**，而不是 YT 的动态电台、也不是现状的并行随机索引。这正是用户的判断：**「对一个歌单 shuffle 一次 → 变成 queue；切歌单/切 shuffle 时重洗一次」。**

> Sources：[Spotify Community — Next in Queue 不参与 shuffle / 优先播](https://community.spotify.com/t5/Your-Library/Queue-re-shuffles-when-adding-songs-to-playlist/td-p/7301880)、[Android Central — Spotify "Add to Queue" 行为](https://www.androidcentral.com/spotify-add-queue)、[Apple Support — Play Next / Play Last 队列](https://support.apple.com/en-lamr/109336)、[9to5Mac — 管理 Apple Music Up Next](https://9to5mac.com/2019/02/27/manage-apple-music-up-next/)、[Medium — Spotify vs YouTube Music 洗牌对比](https://medium.com/@shivachandra9490/the-shuffle-showdown-why-spotify-and-youtube-music-play-your-songs-the-way-they-do-9afaa67758f8)、[Hackaday — playlist shuffle 算法](https://hackaday.com/2023/02/19/a-better-playlist-shuffle-algorithm-is-possible/)、[music-assistant #2895 — 像 Spotify 那样把 Queue 与 Playlist 分开](https://github.com/orgs/music-assistant/discussions/2895)。

#### 2.5.3 推荐模型：物化洗牌队列 + Next-in-Queue 优先块

**两层队列（都落在已有的 `playQueue.entries` 里，靠 `requested` 标志区分层）：**

1. **Context 层**：当前 context（歌单/实体/系统/在线歌单）的曲目。
   - shuffle 开启时，**Fisher–Yates 物化洗牌一次**写进 `entries`（当前曲钉首位），可见队列即此顺序。
   - shuffle 关闭：从 context 的自然序（[`orderedSetTrackIds`](../../../../src/player/set-order.ts)）重载 `entries`，以当前曲为锚。**洗牌排列不丢弃**（按 context key 持久保存），再次打开 shuffle 时**复用**（见下「重洗时机」与 Q8）。
2. **Next-in-Queue 层（点歌/插队/直播请求）**：手动 `requested` 条目，紧跟当前曲、**FIFO、不参与洗牌**，优先于 context 剩余部分播完再接回。
   - **复用既有** [`PlayQueueEntry.requested`](../../../../src/db/types.ts) 标志 + [`playQueueRequestNextAt` FIFO 块](../../../../src/db/repositories.ts)（本是为直播请求建的）——把普通点歌（`playNextTrack`/`playQueuePlayNext`）统一进这套语义。

**步进彻底线性化**：next/prev 直接走可见 `entries`（线性 + repeat 环绕），**删除并行 `shuffleOrder` 整套机制**及其在 peek/window 链上的分支。可见 next == 列表下一行。

**重洗时机（Q8 已决：默认「每歌单洗一次、稳定复用」，对齐网易云）：**
- **生成新洗牌排列**仅在 **切换到另一个歌单/context** 时（默认）。生成的排列**按 context key 持久化**（Q3/Q8）→ 跨「toggle 关再开」「重启」**复用同一结果**。
- **同一歌单内**：toggle 随机开关、切换循环模式、来回切都**不改变** shuffle 结果（复用持久排列）。
- **repeat-all 跑完一轮**：默认**循环复用同一排列**（不静默重洗），保持 Q8 的「同歌单稳定」。
- **可选 Setting**（可见控件，硬规则 3）：「切换随机开关时重新洗牌」——**默认关**（= 复用）；打开后，有需求的用户可用 toggle 开关来重新随机。另可提供显式「重新洗牌」动作。
- 任何**真正发生的重洗**（切歌单 / Setting 开启时的 toggle / 显式重洗）都遵守 Q9 防接缝重复（新首曲 ≠ 当前曲）。
- 每次重洗/重载都是**一次** `playQueueSet` 写入（大队列也单次落库）。

**DJ 续歌（autoExtend）在 shuffle 下**：新曲追加进 context 的**未播剩余段**（在尚未播放的部分里洗入），不插进已播段、也不进 Next-in-Queue 优先块。

**持久化**：物化顺序天然存活于 `playQueue.entries`（已持久）→ 顺带修复「重启丢 shuffle 顺序」。

#### 2.5.4 这套模型如何同时修掉三个症状

- **点歌不再被跳过**：点歌是 `entries` 里一个真实的 `requested` 条目，线性步进自然下一首播；没有并行排列能覆盖它。
- **可见 == 实播**：队列面板显示的就是已洗好的 `entries`，next 就是下一行。
- **重启不丢**：洗好的顺序在 `entries` 里。

> Part B 只依赖 Phase 1 打好的「队列按显示顺序物化装载」底座（`playTrackInContext`/`playQueueSet`），与 Phase 2/3 正交，可在 Phase 1 后立即做。

---

## 3. Data Model Design

### 3.1 Core Concepts（现状 vs 目标）

```
现状（混淆）:
   Track.sessionId  ──(单值, 创建时写, 永不更新)──▶  "出生地/归属歌单"
        ▲                                                 │
        └── playTrack 误把它当成 "播放上下文" ────────────┘   ← 根因

   DjSession.trackIds[]  ──(多对多)──▶  成员关系（一首歌可在多个歌单）

目标（分离关注点）:
   Track.sessionId        = 纯 provenance（出生地），播放永不读它
   播放上下文(QueueSource) = 来自用户点击所在的界面（歌单/系统歌单/实体/全部歌曲）
   队列顺序                = orderedSetTrackIds(显示顺序)，与详情页一致
```

### 3.2 Database Schema

⚠️ **无 Dexie 版本 bump。** Part A 是纯「读取/解析逻辑」修正，不改数据形状。Part B（随机/续播）按用户决策（Q3 续播 / Q8 稳定洗牌）需要**少量 additive、非索引**的新持久字段——遵循仓库既有约定（如 `coverThumbhash`/`trackRanks`：additive 非索引字段无需 version bump / 无需 upgrade 回填，legacy 行缺省即可）。遵守硬规则 4（codename 层稳定）：`Track.sessionId`、`DjSession.trackIds`、`PlayQueue.contextSetId`、id 前缀全部保持不变。

- **Current Schema**:
  - [`Track.sessionId: string`](../../../../src/db/types.ts) —— **保留**。重新文档化其语义为「origin / home set（provenance only）」，并加注释明确「播放上下文绝不从此字段解析」。
  - [`DjSession.trackIds: string[]` + `trackRanks?`](../../../../src/db/types.ts) —— 成员关系 + 顺序，不变。
  - [`PlayQueue.contextSetId?: string`](../../../../src/db/types.ts) —— 「正在从哪个歌单播放」，驱动 autoExtend + UI，不变；非 set 上下文（系统歌单/实体/全部歌曲）保持不设（与现状 `playSystemPlaylist` 一致）。
  - **(Part B)** [`PlayQueueEntry.requested?: boolean`](../../../../src/db/types.ts) —— **保留并复用**：从「直播请求标记」泛化为「手动点歌/插队的优先 FIFO 标记」。物化洗牌写进 `entries` 的顺序也复用现有持久化，无新增字段。`shuffleOrder` 是模块作用域变量、本就不持久 → 删除它不涉及 schema。
- **Required Changes**:
  - `QueueSource`（[player-store 内的 union](../../../../src/stores/player-store.ts)）**additive 扩展**两个变体（见 §3.2.1）。这是 store 内的 TS 类型，非持久化，扩展无迁移成本。
  - **(Q3 续播)** 持久化「正在播放的上下文 + 光标」以便**下次打开继续播放**：`PlayQueue.entries`/`currentIndex` 已持久；补持久化 **`queueSource`**（非 set 来源，如 system/entity/library/online-playlist 重启后能恢复「playing from」与续播）。落在 `PlayQueue` 行上 additive 存一个可序列化的 `queueSource` 快照（online-playlist 存 playlist 元信息快照；其曲目 metadata 已随 `entries` 物化持久，见 §4.6）。
  - **(Q8 稳定洗牌)** 持久化**按 context key 的洗牌排列快照**（`PlayQueue` 行上 additive，如 `{ contextKey, orderedTrackIds }` 或种子）：toggle 关再开 / 重启 → 复用；切歌单 → 重新生成。
  - **(Q8 Setting)** `AppSettings` additive 新增可见开关 **`shuffleReshuffleOnToggle?: boolean`**（默认 `false` = 复用；`true` = 切随机开关即重洗）。镜像现有 `playerShuffle`/`playerRepeatMode` 的持久化方式。
- **Data Migration**: 无。`Track.sessionId` 的历史悬空值（曾从归属歌单移除/归属歌单已删）在新逻辑下**自动变无害**——播放不再读它。新增 additive 字段缺省即合理默认（无洗牌快照 → 首次洗；无 `queueSource` 快照 → 回退默认），无需回填。
- **Rollback Plan**: `git revert` 整个 PR + 重新发版（硬规则 3：不藏 runtime flag）。无 schema 变更 → revert 无数据风险。
- **Constraints & Invariants**:
  - 不变量 1：从某 `QueueSource` 播放时，`queue` 的顺序 == 该来源的显示顺序（set → `orderedSetTrackIds`；系统歌单/实体/全部歌曲 → 调用方传入的有序数组）。
  - 不变量 2：`contextSetId` 仅在 `QueueSource.kind === "set"` 时被设置；其它来源不设（避免在非 DJ 集上误触发 `autoExtend`）。

#### 3.2.1 `QueueSource` 扩展（additive）

```typescript
// src/stores/player-store.ts —— 现有 3 个变体之上 additive 增加 entity / library
export type QueueSource =
  | { kind: "set"; setId: string }
  | { kind: "system-playlist"; id: SystemPlaylistId }
  | { kind: "online-playlist"; playlist: StreamPlaylist }
  | { kind: "entity"; entityKind: "artist" | "album"; entityKey: string; label: string } // 新
  | { kind: "library" };                                                                  // 新（全部歌曲）
```

> `resolvePlayingSource` / 来源标签 / jump-to-source 需要对新变体补 case（Phase 2）。按 Q3，`queueSource` 快照**持久化**用于重启续播（不再只是内存态）；序列化时只存可重建来源所需的最小信息（set→setId、entity→key、online-playlist→playlist 元信息快照）。
>
> `{ kind: "online-playlist"; playlist }` **已声明但从未赋值**（死代码，见 §1.2 / §2.2.1）。Phase 3 真正启用它，使「从在线歌单播放」时 `queueSource` 指向该在线歌单本身。`entity` / `library` 为本期 additive 新增；`online-playlist` 是激活既有变体。

### 3.3 Data Relationship Diagram

```
                       ┌──────────────┐
                       │   DjSession  │  trackIds[] (多对多成员) + trackRanks(顺序)
   ┌───────────────────┤   X / Y / …  │
   │                   └──────┬───────┘
   │ 成员                      │ orderedSetTrackIds()
   │                          ▼
┌──┴────┐  sessionId(归属,provenance)   ┌──────────────────┐
│ Track │ ───────────────────────────▶ │ (出生地, 播放不读) │
│   A   │                              └──────────────────┘
└───────┘
   ▲  播放上下文不来自 Track，而来自用户点击的界面：
   │
   └── PlaybackContext { source: QueueSource; tracks: Track[](有序) } ──▶ playTrackInContext
```

---

## 4. API Design（Store 动作层）

### 4.1 新增 / 修改的 Store 动作

⚠️ **优先复用 `playSystemPlaylist` 的现成基建**（显式有序 tracks + queueSource + 同步 seed `queue`），避免新造重复的装载路径。

| 动作 | 签名 | 说明 |
|------|------|------|
| `playTrackInContext` | `(track: Track, ctx: { source: QueueSource; tracks: Track[] }) => Promise<void>` | **新增。统一播放入口。** 上下文由调用方（详情页）显式提供。见 §4.2 |
| `playTrack` | `(track: Track) => Promise<void>` | **过渡薄壳**（Phase 1–4 期间）：内部构造 `{ source:{kind:"set",setId:track.sessionId}, tracks: <home set ordered> }`。**Phase 5 删除**（Q4，best practice：不保留隐式「猜上下文」入口）|
| `setActiveSession` | 现签名不变 | **修正内部顺序**：用 `orderedSetTrackIds(session.trackIds, session.trackRanks)` 建队列（对齐显示顺序），见 §4.3 |

### 4.2 `playTrackInContext` 行为契约

```typescript
async function playTrackInContext(track, ctx) {
  const ids = ctx.tracks.map((t) => t.id);
  const idx = ctx.tracks.findIndex((t) => t.id === track.id);
  if (idx < 0) return; // 防御：曲目不在给定上下文里

  if (ctx.source.kind === "set") {
    const setId = ctx.source.setId;
    const already =
      get().queueSource?.kind === "set" &&
      get().queueSource.setId === setId &&
      sameEntries(get().queue, ids); // 已在该集且队列一致 → 不重装
    if (already) { await get().playIndex(idx); return; }
    // 否则：按显示顺序装载该集（顺序 = ctx.tracks），contextSetId=setId 驱动 autoExtend/来源
    await playQueueSet(ids, { contextSetId: setId, currentIndex: idx });
    // 同步 seed store.queue（沿用 setActiveSession 的乐观 seed，避免 race liveQuery）
    // queueSource = {kind:"set", setId}; djEnabled = session.config.autoExtend
    await get().playIndex(idx);
    return;
  }

  // 非 set 上下文（system-playlist / entity / library）：镜像 playSystemPlaylist——
  // 显式有序 tracks，contextSetId 不设，djEnabled=false，queueSource = ctx.source
  await loadExplicitQueue(ctx.tracks, ctx.source, idx);
  await get().playIndex(idx);
}
```

**关键点：**
- 队列**永远**按 `ctx.tracks`（= 调用方看到的显示顺序）装载 → 同时修复「跨集错乱」与「顺序不一致」。
- `track.sessionId` 在此路径中**完全不被读取**。
- set 上下文设 `contextSetId`（autoExtend / 来源标签 / 重启恢复正常工作）；非 set 不设（避免误触发续歌）。
- 「已在该集」短路保留点击响应的廉价路径（不每次全量重装队列）。

### 4.3 `setActiveSession` 顺序对齐

```typescript
// 现状（顺序可能与详情页不一致）:
const trackIds = session?.trackIds ?? [];
// 修正:
const trackIds = orderedSetTrackIds(session?.trackIds ?? [], session?.trackRanks);
```

> 「播放全部」(`playSet`) 与 boot resume 都经由 `setActiveSession`；对齐后它们与 `SetDetailView` 的显示顺序一致。

### 4.4 Error States & Edge Cases

- **曲目不在上下文里**（理论上不会发生，UI 的 tracks 即来源）：`idx<0` 直接 return，不切单、不报错。
- **重复 trackId**：歌单成员 `trackIds` 是去重的（`prependTrackIds` 幂等），同一集内 A 只出现一次；但播放队列可因「play next/插队」含重复条目。`playTrackInContext` 用的是**显示数组的下标**，天然对应用户点的那一行。
- **空上下文**：`ctx.tracks` 为空 → `idx<0` → no-op。
- **从「全部歌曲」/实体播放**：装载该视图当前的有序 tracks（可能很大）。沿用 `playSystemPlaylist` **已验证**的大数组装载路径——一次 `playQueueSet` 单写，无性能问题（Q2 已决）。

### 4.5 Telemetry & Logging

- 复用现有 [`describeTrackSwitch` / playback trace](../../../../src/stores/player-store.ts)。新增/调整 `playTrack*` 的 debug 日志，带上 `source.kind` 与 `contextSetId`，便于回归定位。
- 不新增任何遥测上报（硬规则 1）。日志一律走 [`logger.ts`](../../../../src/lib/logger.ts)（硬规则 8）。

### 4.6 Online 歌单：`playStreamedHit` / `playStreamedHits` 的上下文化（Phase 3）

目标：从在线歌单点歌时，**队列 = 当前在线歌单的曲目（有序）**，`queueSource = { kind:"online-playlist", playlist }`，而不是退化成共享在线集。

**约束**：streamed 曲目必须先物化成 `Track` 行才能进队列；远端 hit→track 的「重」部分（实际可播 URL 解析 / 封面落地）是有成本的。

**已定方案（Q6 已决）：metadata 先进队列，stream 懒解析。**
- 选择在线歌单播放后，**先把整张歌单曲目的 metadata（标题/艺人/时长/封面 url + `streamSourceId`/`streamExternalId`）按显示顺序批量物化为 streamed `Track` 行 → 一次性进 `entries`**。于是队列**立刻完整可见、有序、可持久（Q3）、可恢复续播**。
- **实际媒体 URL 仍懒解析**：沿用现有「每次播放前 `resolveStreamedTrackMedia` 解析直链（直链会过期）」——点击项最先解析立即播，其余在播放推进时按需解析（不预解析整张，避免无谓网络与直链过期）。
- 即「整张 metadata 急切、stream/重解析懒」的混合：兼顾「可见即播放顺序 + 可续播」与「大歌单首播延迟低、不浪费网络」。
- `queueSource = { kind:"online-playlist", playlist }`，`contextSetId` 不设（在线歌单不是本地 DJ 集，`djEnabled=false`）。
- **共享在线集（`streamOnlineSetId`）角色降级**：从「播放上下文」降为纯「离线缓存/收藏落地」容器（streamed 曲目仍可缓存其中），但**不再**作为播放队列上下文。`track.sessionId` 指向它属于 provenance，不影响播放（与 §3.1 一致）。
- `playStreamedHits`（在线歌单「播放全部」）走同一路径，确保「播放全部」与「点单曲」上下文一致。
- 复用 nav-store 已有的 [`openOnlinePlaylist(playlist, anchorTrackId)`](../../../../src/stores/nav-store.ts) anchor 基建做定位。

> 这是本 PRD 中工程量最大的一块（涉及 streamed 物化），故单列 Phase 3。Phase 1/2 不依赖它，可先行交付。

---

## 5. Frontend Design

### 5.1 各详情页迁移到上下文感知入口

| 界面 | 现状 onPlay | 迁移后 source |
|------|-------------|---------------|
| [`SetDetailView`](../../../../src/pages/search-page.tsx)（歌单详情，**主 bug**） | `playTrack(track)` | `{ kind:"set", setId }`，tracks = `shownTracks`（用户当前看到的有序/筛选后列表）⚠️ 见 §5.2 |
| [`SystemPlaylistDetail`](../../../../src/components/library/system-playlist-detail.tsx)（红心/最多/最近） | `playTrack(track)` | `{ kind:"system-playlist", id }`，tracks = `localTracks` |
| [`EntityDetailView`](../../../../src/components/library/entity-detail.tsx)（艺人/专辑） | `playTrack(track)` | `{ kind:"entity", … }`，tracks = 实体的有序 tracks |
| [库「全部歌曲」`playLibraryTrack`](../../../../src/pages/search-page.tsx) | `playTrack(track)` | `{ kind:"library" }`，tracks = 当前库视图有序列表 |
| [`global-track-search`](../../../../src/components/search/global-track-search.tsx) | `playTrack(fullTrack)` | 单曲全局搜索：可保留 `playTrack`（无列表上下文）或 `{kind:"library"}` 单元素 |
| [`OnlinePlaylistDetail`](../../../../src/components/discover/online-playlist-detail.tsx)（发现 tab 第 5 项，**Phase 3**） | `playStreamedHit(hit)` / `playStreamedHits(hits)` | 上下文化为 `{ kind:"online-playlist", playlist }`，队列 = 该在线歌单的 hits（有序、物化为 streamed tracks）。见 §4.6 |

### 5.2 「显示顺序」vs「true 列表」的取舍（需决策，见 Open Questions Q1）

`SetDetailView` 有筛选（红心）、排序（chips）、集内搜索三种会改变 `shownTracks` 的状态。点击一行播放时，队列应当装：

- **方案 A（已决，Q1）**：装 `shownTracks`（用户**所见即所播**）——筛选/排序后点歌，队列就是筛选/排序后的列表。最符合直觉。
- ~~方案 B：装 set 的 true 顺序全集~~（否决：「红心筛选下点歌却把没红心的也排进队列」会让人意外）。

> **Q1 已决 = 方案 A（所见即所得）。** 同时「播放全部」按钮（`onPlayAll`）也装当前 `shownTracks`（与点击单曲一致），而不是无视筛选装全集。

### 5.3 State Management

- `queueSource` 多两个 union 变体；按 Q3 其快照**持久化**到 `PlayQueue` 行用于续播（不再纯内存态）。
- `track-list-section.tsx` / `virtual-track-list.tsx` 的 `onPlay` 签名已是 `(track, index) => void`——调用方在闭包里已能拿到 `setId` / source / 有序 tracks，**无需改这两层的 props 形状**，只改各详情页传入的 `onPlay` 闭包。

---

## 6. Implementation Plan

### Phase 1: Set 上下文 + 顺序对齐（修复主 bug）

**Goal:** 在歌单 Y 点 A 就在 Y 播；队列顺序对齐显示顺序；A 不在归属集时不再静默无声。

**Tasks:**
- [x] 新增 `playTrackInContext`（[player-store.ts](../../../../src/stores/player-store.ts)）：`kind:"set"` 分支走 `setActiveSession(setId,{tracks})`；非 set 分支**已完整落地**（不是 stub）经新内部 `activateExplicitQueue`，`playSystemPlaylist` 也收敛到它。新增 `PlaybackContext` 类型。
- [x] `setActiveSession` 内队列改用 `orderedSetTrackIds` + 可选 `opts.tracks`（显式显示顺序）。
- [x] `SetDetailView`（[search-page.tsx](../../../../src/pages/search-page.tsx)）：`onPlay` → `playTrackInContext(track,{source:{set,setId},tracks:shownTracks})`；「播放全部」改为本地 handler 用 `shownTracks`（去掉 `onPlayAll` prop，§5.2 方案 A）。
- [x] 「已在该集 + 显示顺序一致」短路（§4.2）保留廉价点击路径。
- [x] 集成测试（5 个，见下 Checklist，硬规则 7）。

### Phase 1 Checklist

- [x] 单测：A ∈ {X(home), Y}，`playTrackInContext(A, set:Y)` → `queueSource={set,Y}`、`contextSetId=Y`、queue==Y 的有序列表、currentIndex 指向 A。
- [x] 单测（次生症状）：A 已从 home 集 X 移除但仍在 Y → 在 Y 播放成功 + `mediaEngine.play` 被调用（旧代码此处静默 no-op）。
- [x] 单测（顺序）：Y 拖拽重排（有 `trackRanks`）→ `setActiveSession` 队列顺序 == `orderedSetTrackIds(Y)`；「播放全部」走 `shownTracks` 与「点单曲」同序（UI 层，已对齐）。
- [x] 单测（autoExtend）：DJ 集（`autoExtend=true`）→ `djEnabled=true`；上传集 → `djEnabled=false`。
- [x] 回归：在「当前已激活的集」内点歌停留在该集、播放点击项（行为测试）；全量 `player-store.test`（37）+ `queue.test`（48）通过。
- [x] `make check` 等价：tsc `--noEmit` 通过、biome 通过、vitest 通过。

### Phase 2: 派生实体 / 系统歌单 / 全部歌曲上下文统一

**Goal:** 同类 bug 在艺人/专辑、红心/最多/最近、全部歌曲一并消除；来源标签/跳到来源正确。

**Tasks:**
- [x] `QueueSource` additive 增加 `entity` / `library` 变体（[player-store.ts](../../../../src/stores/player-store.ts)）。
- [x] `playTrackInContext` 非 set 分支**已在 Phase 1 落地**（`activateExplicitQueue`：显式 tracks、不设 `contextSetId`、`djEnabled=false`）。
- [x] `SystemPlaylistDetail` / `EntityDetailView` / 库「全部歌曲」(`playLibraryTrack`) 迁移 onPlay → `playTrackInContext`（各传自己的 source + 显示 tracks；实体无 key 的伪桶回退 `library`）。
- [x] `resolvePlayingSource` 对 entity/library 返回 null（jump-to-source 合理回退=禁用）；[queue-panel](../../../../src/components/player/queue-panel.tsx) 来源标签覆盖 entity(label)/online-playlist(name)/library(`globalSearch.songs`)。

### Phase 2 Checklist

- [x] 单测：从系统歌单（红心）点 A → `queueSource={system-playlist,liked}`、队列==该列表、`activeSessionId=null`、`contextSetId` 未设、`djEnabled=false`。
- [x] 单测：从专辑实体点 A → `queueSource={entity,album,key,label}`、队列==实体有序列表；另含 library 上下文单测。
- [x] 来源标签：queue-panel 对 4 种非 set 来源显示正确；jump-to-source entity/library 禁用（合理回退）。`playing-source` + `queue-panel` + `track-identity-row` 测试通过。
- [x] `make check` 等价：tsc 通过；affected 套件 367 passed（含 component 测试用 `pnpm exec vitest` 跑齐 jest-dom setup）。

### Phase 3: Online 歌单（发现 tab 第 5 项）上下文

**Goal:** 从在线歌单点歌/播放全部，队列 == 该在线歌单的曲目（有序），来源 == 这个在线歌单；不再退化成共享在线池。

**Tasks:**
- [ ] 启用 `QueueSource` 的 `online-playlist` 变体（既有声明，§3.2.1）。
- [ ] `playStreamedHit` / `playStreamedHits` 上下文化（§4.6）：携整张 hits + playlist，物化为 streamed 队列，设 `queueSource = online-playlist`、`djEnabled=false`、`contextSetId` 不设。
- [ ] 选定并实现物化策略（Open Questions Q6：急切 vs 懒 + 后台补齐）。
- [ ] 共享在线集 `streamOnlineSetId` 角色降级为缓存容器，不再作播放上下文。
- [ ] `OnlinePlaylistDetail` 的 `onPlay` / 「播放全部」走新路径；复用 `openOnlinePlaylist` anchor。
- [ ] `resolvePlayingSource` / 来源标签 / jump-to-source 对 `online-playlist` 补 case。

### Phase 3 Checklist

- [ ] 单测/集成：从在线歌单点第 N 首 → 队列 == 该歌单 hits 物化后的有序列表、currentIndex 指向第 N 首、`queueSource={online-playlist,playlist}`、`contextSetId` 未设、`djEnabled=false`。
- [ ] 单测：在线歌单「播放全部」与「点单曲」上下文一致（同一 queueSource + 同序队列）。
- [ ] 大歌单（如数百首）首播延迟可接受（按选定的物化策略，用 perf HUD 实测）。
- [ ] 来源标签显示为该在线歌单名；jump-to-source 行为合理（或合理回退）。
- [ ] `make check` 通过。

### Phase 4: 随机播放队列模型（materialized shuffle + Next-in-Queue 点歌）

**Goal:** 随机播放 = 对 context 物化洗牌一次进 `entries`、**每歌单稳定复用**（Q8）；点歌进不洗牌的优先 FIFO；可见队列 == 播放顺序；删除并行 `shuffleOrder`；队列 + 来源 + 洗牌排列持久化以**续播**（Q3）。详见 §2.5。

**Tasks:**
- [ ] `setShuffle(on)`：on → 若当前 context 已有持久洗牌快照（且未开「toggle 重洗」Setting）→ **复用**；否则 Fisher–Yates 洗一次（钉当前曲首位）并按 context key 持久化。off → 从 `orderedSetTrackIds` 自然序重载、以当前曲为锚，**保留**洗牌快照备复用。
- [ ] `next()`/`skipPrev()`/`prev()` 改为线性走 `entries`（+ repeat 环绕），**删除** `shuffleOrder` 及其在 `peek*`/`window*`/`queue.ts` 里的所有分支。
- [ ] 点歌统一：`playNextTrack`/`playQueuePlayNext` 走 `requested` 优先 FIFO（复用 `playQueueRequestNextAt` 语义），紧跟当前曲、不洗牌、优先播。
- [ ] **重洗时机（Q8）**：仅「切换歌单/context」默认生成新洗牌；同歌单内 toggle 随机/切循环模式**不重洗**；repeat-all 轮尾**复用同排列循环**（不静默重洗）。
- [ ] **Setting（Q8）**：`AppSettings.shuffleReshuffleOnToggle`（默认关）+ Settings 可见控件（i18n 四语）。开启后 toggle 随机开关即重洗。
- [ ] **防接缝重复（Q9）**：任何真正重洗时，新首曲 ≠ 当前/刚播曲（与 `buildShuffleOrder` 钉首位统一）。
- [ ] **续播持久化（Q3）**：`queueSource` 快照 + 洗牌排列快照随 `PlayQueue` 行持久；启动恢复「playing from」+ 光标 + 顺序，可继续播放。移除非持久 `shuffleOrder` 的启动重建。
- [ ] DJ autoExtend 追加进未播剩余段（在未播部分洗入），不进已播段 / 不进点歌 FIFO。
- [ ] **队列面板「接下来播放」分区（Q10）**：用 `requested` 标志在 [`QueuePanel`](../../../../src/components/player/queue-panel.tsx) 渲染轻量分区（点歌块 vs context 块），对齐 Spotify「Next in Queue」。
- [ ] 大队列性能：洗牌 + 落库为单次 `playQueueSet`，用 perf HUD 在大歌单实测。

### Phase 4 Checklist

- [ ] 单测（核心修复）：shuffle 开启时点歌 → 该曲下一首播、不被重洗甩走；`requested` FIFO 多次点歌按加入顺序播。
- [ ] 单测（可见==实播）：shuffle 下 `peekTrack("next")` / 队列面板下一行 / 实际 `next()` 落点三者一致。
- [ ] 单测（Q8 稳定）：同歌单内 toggle 随机关再开 / 切循环模式 → shuffle 结果不变；切到另一歌单 → 生成新结果。
- [ ] 单测（Q8 Setting）：`shuffleReshuffleOnToggle=true` 时 toggle 随机即重洗；默认 false 时复用。
- [ ] 单测（Q9）：重洗后首曲 ≠ 刚播曲。
- [ ] 单测（shuffle off 还原）：关闭 shuffle 后 `entries` == `orderedSetTrackIds` 自然序、以当前曲为锚；再开复用原洗牌排列。
- [ ] 集成（rule 7）：draft→materialize→shuffle→点歌→next 连续流，队列顺序/点歌优先/续歌落点不被破坏。
- [ ] 回归：cover-pager 窗口（`peekWindowFrom`）在线性模型下行为正确（删 `shuffleOrder` 后仍对齐）。
- [ ] 续播（Q3）：重启后 shuffle 顺序 + 光标 + 来源标签保留，可继续播放。
- [ ] `make check` 通过。

### Phase 5: `sessionId` 语义收敛 + `playTrack` 清理

**Goal:** 把 `Track.sessionId` 正式收敛为「provenance only」（Q5：彻底内部化，UI 不再暴露「归属/出生地」），移除最后的「从 sessionId 猜上下文」代码（Q4：按 best practice 删除歧义入口）。

**Tasks:**
- [ ] 审计 `track.sessionId` 的所有读取点（`grep`），确认除 provenance/删除级联/sourcePath 外无人再用它做播放/上下文裁决。
- [ ] 给 `Track.sessionId` 补注释（「origin/home set；播放上下文绝不从此解析」）；UI 不暴露该概念（Q5）。
- [ ] **删除** `playTrack(track)` 薄壳（Q4：所有调用方已迁移到 `playTrackInContext`）；如个别遗留确需「在归属集播放」语义，显式改写为 `playTrackInContext(track, {source:{kind:"set",setId:track.sessionId}, …})`，不保留隐式入口。

### Phase 5 Checklist

- [ ] 审计结果记录在 PR 描述：列出 `sessionId` 剩余消费者及其用途。
- [ ] 文档/注释更新（types.ts + 本 PRD「导航口径」对齐 CLAUDE.md 如需）。
- [ ] `make check` 通过。

---

## 7. Out of Scope

- **不改持久化 schema / 不 bump Dexie 版本**：本期纯逻辑修正。
- **不引入 hidden flag / runtime kill switch**（硬规则 3）：回滚走 `git revert`。
- **不重写 `playQueue` 与歌单的解耦模型**：解耦是对的，本期只修「上下文从哪来」。
- **不动 DJ 续歌算法 / `shouldAutoExtend` 数学**：只保证它在**正确的** `contextSetId` 上运行。
- **不做「记住每首歌最后从哪个集播放」之类的新记忆功能**：上下文来自当前界面，不持久化 per-track。
- **不重指 `sessionId`**（删除/移除时不改写归属）：新逻辑下悬空值已无害，重指反而增加风险。
- **(Part B) 不采用 YouTube Music 式「动态电台队列」**（边听边即时生成 / skip 重 roll）：那是算法电台模型，与「用户拥有歌单、所见即所播」相悖。本期是 Spotify/Apple 式**物化洗牌**。
- **(Part B) 不引入加权/智能洗牌**（按听歌习惯/避免同艺人相邻等）：本期只做均匀 Fisher–Yates；智能洗牌是后续独立增强。

---

## 8. Security / Privacy Considerations

- 纯本地 IndexedDB 行为修正，无网络出站变化（硬规则 1：本地优先）。
- 无新增遥测、无密钥相关路径（硬规则 2）。
- 日志走 `logger.ts`，不打印用户内容（硬规则 8）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260607-muzero-set-detail-page-prd](../../20260607-muzero-set-detail-page-prd/20260607-muzero-set-detail-page-prd.md) | 歌单详情页本体（主 bug 现场） |
| [20260607-muzero-set-playqueue-memory-data-model-prd](../../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md) | 歌单 / 播放列表解耦的数据模型起源 |
| [20260613-muzero-system-playlists-prd](../../20260613-muzero-system-playlists-prd/20260613-muzero-system-playlists-prd.md) | 系统歌单（`playSystemPlaylist` 范式来源） |
| [20260611-muzero-set-track-drag-reorder-prd](../../20260611-muzero-set-track-drag-reorder-prd/20260611-muzero-set-track-drag-reorder-prd.md) | `trackRanks` / `orderedSetTrackIds`（顺序对齐依据） |
| [20260617-muzero-now-playing-jump-to-source-prd](../../20260617-muzero-now-playing-jump-to-source-prd/20260617-muzero-now-playing-jump-to-source-prd.md) | `QueueSource` / `resolvePlayingSource`（来源标签，Phase 2 需对齐） |
| [20260617-muzero-scalable-track-list-reactivity-prd](../../20260617-muzero-scalable-track-list-reactivity-prd/20260617-muzero-scalable-track-list-reactivity-prd.md) | queue 装载 / `lastQueueSig` 的性能纪律（短路设计参考） |

---

## 10. Open Questions

> **全部 10 项已于 2026-06-21 由 owner 拍板（Resolved）。** 设计已据此更新到对应章节。

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | `SetDetailView` 点单曲时队列装 `shownTracks`（方案 A）还是 set true 顺序（方案 B）？ | ✅ Resolved | **方案 A（所见即所得）**：装当前 `shownTracks`（筛选/排序后），「播放全部」同样对齐 `shownTracks`。见 §5.2 |
| 2 | 从「全部歌曲」（数千首）点歌把整库装进队列有性能顾虑吗？ | ✅ Resolved | **无**：复用 `playSystemPlaylist` 已验证的单写装载路径，不需窗口化/上限。见 §4.4 |
| 3 | `entity`/`library`/online 等非 set `QueueSource` 重启后如何处理？ | ✅ Resolved | **持久化以续播**：`queueSource` 快照随 `PlayQueue` 行持久，下次打开恢复「playing from」+ 光标 + 顺序，可继续播放。见 §3.2 |
| 4 | 保留还是删除 `playTrack(track)` 薄壳？ | ✅ Resolved | **删除**（best practice）：Phase 1–4 过渡保留，Phase 5 删；不保留隐式「猜上下文」入口。见 §4.1 / Phase 5 |
| 5 | 是否在 UI 暴露「归属/出生地」概念？ | ✅ Resolved | **彻底内部化**为 provenance，UI 不暴露；一首歌平等属于多个歌单。见 §3.1 / Phase 5 |
| 6 | Online 歌单物化策略 (a) 急切整张 vs (b) 懒？ | ✅ Resolved | **(b) 取向 + 细化**：选播在线歌单后，**整张曲目 metadata 先进 `entries`**（队列即刻完整、有序、可续播）；**媒体 URL 懒解析**（点击项先解析，其余按播放推进解析）。见 §4.6 |
| 7 | 共享在线集降级后，全局在线搜索单曲播放的上下文？ | ✅ Resolved | 单曲入口用 `{kind:"library"}` / 专门「在线搜索结果」轻上下文，不污染歌单上下文。见 §4.6 |
| 8 | shuffle 何时重洗 / 是否记住？ | ✅ Resolved | **每歌单洗一次、稳定复用**（对齐网易云）：默认仅「切歌单」生成新洗牌并**持久化**；同歌单内 toggle 随机/切循环模式不变结果；重启复用。**Setting**「切随机开关时重新洗牌」（默认关）给想用 toggle 重随机的用户。见 §2.5.3 / §3.2 |
| 9 | repeat-all 重洗时是否防接缝重复？ | ✅ Resolved | **是**（best practice）：任何真正重洗时新首曲 ≠ 当前/刚播曲；默认 repeat-all 轮尾复用同排列循环（不静默重洗，符合 Q8 稳定）。见 §2.5.3 |
| 10 | 队列面板是否做「接下来播放」分区？ | ✅ Resolved | **做**：用 `requested` 标志在 `QueuePanel` 渲染轻量分区（点歌块 vs context 块），对齐 Spotify「Next in Queue」。见 Phase 4 |

### 10.1 新增的待决子问题（实现期细化，非阻塞）

| # | Question | Status | Note |
|---|----------|--------|------|
| 11 | 洗牌快照的「context key」如何定义（setId / 系统歌单 id / 实体 key / online playlist id）以稳定命中复用？ | Open | 实现期定；与 `QueueSource` 序列化 key 复用同一套 |
| 12 | online 歌单整张 metadata 物化为 streamed `Track` 行：是否复用共享在线集做去重/缓存落地，还是物化为「不挂任何集」的临时行？ | Open | 倾向复用现有 `createStreamedTrack` + 共享集仅作缓存容器（不作上下文），实现期确认 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-21 | MUZERO Core / Playback | Initial draft：根因定位（`Track.sessionId` 被误用为播放上下文）+ 上下文感知播放入口重构方案 |
| 2026-06-21 | MUZERO Core / Playback | 补充 Online 歌单（发现 tab 第 5 项）同源场景：池化进共享在线集导致上下文/顺序丢失，`online-playlist` QueueSource 变体为死代码；新增 Phase 3 + §2.2.1 / §4.6 + Open Questions Q6/Q7 |
| 2026-06-21 | MUZERO Core / Playback | 新增 **Part B 随机播放 × 点歌**（调研 Spotify/Apple/YT + 推荐 materialized shuffle + Next-in-Queue 优先 FIFO，删并行 `shuffleOrder`）：PRD 改名为「播放队列模型重构」，新增 §2.5 + Phase 4 + Open Questions Q8–Q10；复用 `PlayQueueEntry.requested` |
| 2026-06-21 | owner 拍板 | **10 项 Open Questions 全部 Resolved** → Status: Final。要点：Q1 所见即所得；Q3 持久化队列+来源以**续播**；Q6 online 歌单 metadata 先进队列 / stream 懒解析；Q8 **每歌单洗一次稳定复用**（对齐网易云）+ Setting `shuffleReshuffleOnToggle`（默认关）；Q9 防接缝重复；Q10 队列面板「接下来播放」分区；Q4/Q5 删 `playTrack`、`sessionId` 内部化。新增少量 additive 非索引持久字段（无 Dexie bump）；新增子问题 Q11/Q12（实现期细化） |

---

> **Note:** 本 PRD 强调「修正既有解析逻辑」而非新建结构——复用 `playSystemPlaylist` 已有的「显式有序列表 + QueueSource」装载范式。Part A 不改持久化形状；Part B 按 Q3/Q8 仅新增**少量 additive、非索引**的持久字段（续播用的 `queueSource` 快照、每歌单洗牌排列快照、`shuffleReshuffleOnToggle` 设置），遵循 `coverThumbhash`/`trackRanks` 同款约定 → **无 Dexie 版本 bump、无回填**。回滚走 `git revert`；`Track.sessionId` 等 codename 层字段保持不变（硬规则 4）。
