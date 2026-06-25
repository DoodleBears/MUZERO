# PRD: 弹幕点歌「下一首」入队在 online / 各种歌单下的可靠性排查与修复

**Status:** Draft
**Created:** 2026-06-25
**Author:** DoodleBears / Claude
**Module:** Live Requests（弹幕点歌） × Play Queue（播放列表） — `src/live-requests/` + `src/stores/player-store.ts` + `src/player/`

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | 排查（Investigation，本文档） | ✅ Completed | [本节](#3-investigation-findings排查结论) |
| 1 | active-set 搜索域覆盖非-set 上下文（online / system / entity） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 三种「曲子来源」语义统一 + online 命中始终落「点歌歌单」 | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 空闲态起播（Q2，核心）+ 不可播提示；切换竞态/harness 延后 | ✅ Core done | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **决策已落（2026-06-25 用户拍板）**：单曲循环（repeat-one）吞点歌**不修** —— 单曲循环是「锁死循环这一首」的明确意图，点歌请求已被正确**排进队列**、待用户手动推进 / 退出单曲循环后即播，不算丢失。详见 [§3.2](#32-单曲循环repeat-one--by-design不修) 与 [Q1](#10-open-questions)。

---

## 1. Overview

### 1.1 Background

**用户反馈**：在 online 歌单（如网易云导入 / 在线歌单）或各种情况的歌单下，【弹幕点歌】**有时无法把点的歌正确地放到「下一首」播放**。期望是无论：

- 循环播放（repeat-all / repeat-one）
- 随机播放（shuffle）
- 播放过程中切换歌单（switching mid-play）

点歌都能稳定地「在下一首正确播放」。

本 PRD 是一次**端到端排查**：沿 `弹幕消息 → 归一化 → 搜索 → 路由 → 播放动作 → 播放列表插入` 全链路读代码，定位「会出现没办法」的真实缺口，并给出最小改动的修复计划。

**链路现状（已接线，verified 2026-06-25）**：
- App 启动 `startLiveRequestIntake()`（[`src/App.tsx:139`](../../../../src/App.tsx)）挂载控制器单例，订阅 transport `onMessage`。
- 控制器单例（[`live-request-controller.ts:258`](../../../../src/live-requests/live-request-controller.ts)）把 `playNow → playRequestNow`、`playNext → playRequestNext` 注入 runtime，**确实会真的搜库 + 入队 + 播放**（不再是只显示文字）。
- 播放列表插入已做过「store 光标相对插入」硬化（见 [[live-request-play-now-skip-bug]]），play-now / play-next 都按**当前真正在播的 store 光标**插入，不依赖滞后的持久化 DB 光标。

也就是说：**插入机制本身在大多数模式下是对的**——排查发现的问题集中在**几个特定模式 / 上下文组合**，而不是「整体没接线」。

### 1.2 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **主播 / 用户** | 桌面 Electron 跑全功能，开直播弹幕点歌 | 点的歌必须能在「下一首」稳定播出，不论当前在放什么歌单、什么循环/随机模式 |
| **观众** | 通过 SSN 等来源发点歌弹幕 | 点了就应当被排进队列，命中本地或回退在线 |

### 1.3 Core Value

1. **可预期**：任意「歌单 × 循环/随机 × 切换」组合下，点歌「下一首」语义一致、不静默丢失。
2. **就近复用**：点的歌若已在当前队列 / 其它本地歌单，优先复用本地 Track，不重复联网拉一份。
3. **来源清晰**：online 搜索命中的曲子，缓存归属（进哪个「在线」歌单）有唯一、可解释的裁决。

---

## 2. System Architecture

### 2.1 链路与关键决策点

```
SSN/HTTP 弹幕 body
  └─ controller.handlePayload         live-request-controller.ts
       └─ mapping + normalize
            └─ runtime.handle(req)     audience-request-runtime.ts
                 ├─(A) searchLocal ── tracksForScope(searchScope)   ← 决策点 A：搜索域
                 │        └─ pickAudienceRequestMatch (纯函数评分)
                 ├─(B) planAudienceRequestRoute                      ← 决策点 B：路由
                 │        match→playback / low→online/needs-approval / ai-dj
                 └─(C) executePlayback(action, track)                ← 决策点 C：播放动作
                          ├─ append-queue → playQueueAppend
                          ├─ play-next    → deps.playNext → playRequestNext
                          └─ play-now     → deps.playNow  → playRequestNow
                                              │
   player-store.ts ─────────────────────────┘
     playRequestNext → playQueueRequestNextAt(storeCursor, [id])  (FIFO 请求块)
     playRequestNow  → playQueueInsertAt(storeCursor+1, [id]) + playIndex(slot)
                                              │
   播放推进 ───────────────────────────────────┘
     next()    → manualNextIndex (shuffle 已物化进队列，线性步进)
     onEnded() → repeat==="one" 时 replay 当前曲；否则 next()   ← 决策点 D：自动推进
```

### 2.2 关键事实（排查用）

| 事实 | 位置 | 含义 |
|------|------|------|
| 默认 `searchScope = "all-library"`，`playbackAction = "play-next"`，`routeMode = "library-search"`，`onlineFallbackOnLowConfidence = true`，`requireApprovalForPlayNow = false` | [`db/types.ts:699`](../../../../src/db/types.ts) `DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS` | 默认配置大多数情况能搜到；问题集中在特定模式/非默认配置 |
| shuffle **物化进队列本身**（可见队列即播放顺序），导航全部线性 `manualNextIndex/prevIndex` | [`player-store.ts:668`](../../../../src/stores/player-store.ts) `materializeShuffle` + [`:1701`](../../../../src/stores/player-store.ts) `next` | 随机模式下「插在光标后即真正下一首」成立，无需再 re-pin |
| play-next 锚定 **store 光标**（不是滞后 DB 光标），FIFO 请求块 | [`player-store.ts:1582`](../../../../src/stores/player-store.ts) `playRequestNext` → [`repositories.ts:2701`](../../../../src/db/repositories.ts) `playQueueRequestNextAt` → [`play-queue.ts:84`](../../../../src/player/play-queue.ts) `insertRequestAt` | 切换/防抖期插入位置是对的 |
| play-now 去重：曲子已在队列则 move 而非复制 | [`player-store.ts:1545`](../../../../src/stores/player-store.ts) | 「点的歌已在歌单中」时不会重复一份 |

---

## 3. Investigation Findings（排查结论）

### 3.1 结论速览：插入机制 ≈ 对，洞在 4 个特定组合

把「弹幕点歌能否正确下一首播放」按 **播放动作 × 循环/随机模式** 列矩阵（默认 `all-library` 搜索域、命中本地曲）：

| 播放动作 | repeat=off | repeat=all（循环） | shuffle（随机） | 切换歌单中途 |
|---|---|---|---|---|
| **play-now（立即播放）** | ✅ 立刻跳到 | ✅ | ✅（物化无需 re-pin） | ✅ `waitForQueueSlot` 兜底 |
| **play-next（下一首）** | ✅ `next()` 推进到 | ✅ | ✅ 线性 next 命中 | ⚠️ 罕见竞态（§3.5） |
| **append（追加队列）** | ✅ | ✅ | ✅ | ✅ |
| **任意非-now，`repeat="one"`** | — | 🔒 不推进（**by design**，§3.2） | 🔒 | 🔒 |

**插入与推进在 repeat-off / repeat-all / shuffle / 切换中途都正确。** `repeat="one"` 下点歌不自动推进是**刻意设计**（§3.2，不修）。所以用户实际撞到的「online 歌单没办法」最可能来自**搜索域 / 来源 / 不可播**三条非播放-模式的洞（§3.3、§3.4、§3.7），而非循环/随机本身。

---

### 3.2 单曲循环（repeat-one）— by design，不修

**现象**：「单曲循环」时弹幕点「下一首 / 追加队列」，请求**已被正确插进队列**（`currentIndex+1`），但当前曲播完会无限重播当前曲，请求要等用户手动推进 / 退出单曲循环才轮到。

**裁决（2026-06-25 用户拍板）：这是对的设计，不修。** 单曲循环 = 用户明确「锁死循环这一首」的强意图；此时不应被弹幕点歌打断。请求**没有丢失**——它正确排在了队列里，用户一旦手动下一首 / 切回普通循环就会播到（`manualNextIndex` 已把手动 next 的 "one"→"all"，[`queue.ts:47`](../../../../src/player/queue.ts)）。

代码现状（保留不动）：
```ts
// src/stores/player-store.ts:1015  onEnded —— repeat-one 重播当前曲，符合「锁死这一首」语义
if (state.repeat === "one" && state.currentIndex >= 0) {
  state.seek(0);
  void state.playIndex(state.currentIndex);
  return;
}
void state.next();
```

> 唯一可选的轻量增强（不在本期）：当队列里出现 `requested` 块且处于单曲循环时，可在 UI 给一个被动提示「有 N 首点歌在排队，退出单曲循环即播」，避免主播以为没收到。属可观测，非行为变更。

---

### 3.3 GAP 2（HIGH）— `searchScope="active-set"` 在 online / 非-set 上下文里搜不到任何曲

**症状**：把搜索域设成「当前歌单（active-set）」后，在**在线歌单（online-playlist，如直接播放网易云在线歌单）/ 系统歌单 / 实体（歌手·专辑）/ 库视图**这些**非-set 上下文**下播放时，弹幕点歌**永远命中空集** → 要么回退联网重拉（浪费、可能拉到不同版本），要么直接 `needs-approval`/`ignored` =「没办法」。

**根因**：搜索域解析把 active-set 等同于「有 `contextSetId` 的 DjSession」，但非-set 上下文根本不写 `contextSetId`：

```ts
// runtime: tracksForScope("active-set") → resolveActiveSessionId() → getSession().trackIds
// src/live-requests/audience-request-runtime.ts:261
async function tracksForScope(scope) {
  if (scope === "all-library") return listAllTracks(db);
  const activeSessionId = await resolveActiveSessionId();   // ← online-playlist 时为 undefined
  if (!activeSessionId) return [];                           // ← 直接空集！
  ...
}
// resolveActiveSessionId(): 单例未注入 getActiveSessionId → 落到 getPlayQueue(db).contextSetId
```

```ts
// 非-set 上下文加载时不写 contextSetId：
// src/stores/player-store.ts:579 activateExplicitQueue（online-playlist/system/entity/library）
await playQueueSet(trackIds, { currentIndex: -1, queueSource: source, naturalOrderIds });
// ↑ 没有 contextSetId → pq.contextSetId === undefined
```

**重要边界**：
- **「网易云导入」成为真正的 DjSession（set）**（`importStreamedPlaylist`，[`player-store.ts:1642`](../../../../src/stores/player-store.ts)），有 `contextSetId` → active-set **能**搜到。
- **「直接播放在线歌单」是 online-playlist 上下文**（`playOnlinePlaylist`，[`player-store.ts:1617`](../../../../src/stores/player-store.ts)），**无** `contextSetId` → active-set **搜不到**。
- 默认 `all-library` 不受影响（在线曲也是 tracks 表里的 streamed Track 行，能搜到）。

**修复方向**：把 "active-set" 语义从「DjSession 的 trackIds」改为**「当前真正在放的 play queue 的曲目」**——非-set 上下文回退到 `getPlayQueue(db).entries` 的 trackIds（这是用户眼里的「当前歌单」）。给 runtime 注入 `getActiveSessionId` + 一个 `getActiveQueueTrackIds()`（来自 store/`getPlayQueue`），让 active-set 在两类上下文都成立。同一注入也修 §3.6 的「当前曲解析滞后」。

---

### 3.4 GAP 3（MEDIUM）— online 命中的曲子缓存归属错位 + 重复联网（用户问题 #1、#2）

用户明确问了三种「曲子来源」与缓存：

1. **点的歌已在当前播放列表 / 歌单中**
2. **点的歌来自其它本地已有歌单**
3. **全库都没有，曲子来自 online 搜索的匹配 —— 缓存怎么处理？加到「在线」歌单？**

**当前行为**：
- 情况 1、2：只要搜到本地 Track（默认 all-library 能搜到），`playRequestNow/Next` 直接把**该本地 Track**插进当前 live 队列，**不切歌单、不复制**（play-now 还有去重 move）。✅ 符合预期。
- 情况 3（online 回退）：`defaultOnlineFallback`（[`audience-request-runtime.ts:424`](../../../../src/live-requests/audience-request-runtime.ts)）`createStreamedTrack` + `prependTrackIds(targetSession)`，target 由 `resolveOnlineTargetSession` 裁决：`活动 session ?? settings.streamOnlineSetId ?? 新建「在线」set`（[`:447`](../../../../src/live-requests/audience-request-runtime.ts)）。然后 `executePlayback` 把新 Track 插进 live 队列播放。

**问题**：
- **(3a) 归属漂移**：online-playlist 上下文没有 `活动 session` → 落「在线」set；但有活动 set 时又落活动 set。归属随上下文漂移，不稳定、不可预期。
- **(3b) 因 GAP 2 触发的重复联网**：当 active-set 搜索域漏掉了「其实就在当前在线歌单里」的曲（§3.3），会错误地走 online 回退**重新拉一份** streamed Track（重复行、可能不同音质/版本），而不是复用眼前已有的那首。
- **(3c) 无离线缓存**：回退路径只建「懒解析 URL」的 streamed Track 行，没像 `playStreamedHit` 那样缓存封面/落盘（[`player-store.ts:1591`](../../../../src/stores/player-store.ts) 有，回退路径没有）。点歌命中的在线曲离线可用性弱。

**裁决（2026-06-25 用户拍板，Q3）：online 搜索命中的曲子，归属永远固定 —— 始终落到一个专用的「点歌歌单」（live-request set）**，不再随「当前是否有活动 set」漂移。这个 set 就是所有「靠 online 搜索补进来的点歌曲」的统一家（provenance + 离线缓存归宿），主播能在一个固定位置回看「观众都点了啥」。

**修复方向**：
- `resolveOnlineTargetSession` 改为**始终**返回这个专用「点歌歌单」（去掉「活动 session 优先」分支），唯一裁决继续收敛在此函数。实现上：可直接复用现有 `settings.streamOnlineSetId`（把它定位/命名为「点歌歌单」），或新增 `settings.liveRequestSetId` 专门承载点歌（与全局搜索 `playStreamedHit` 的「在线」set 区分开）——见 [Q3 实现子选项](#10-open-questions)。
- 先修 GAP 2，消灭「本地已有却重复联网」(3b)：本地（当前/其它歌单）命中的曲**仍复用本地 Track**，只有「全库都没有、靠 online 搜索补的」才进点歌歌单。
- 复用 `playStreamedHit` 的封面/落盘缓存（best-effort），保持点歌命中曲与手动播放在线曲缓存路径一致。
- 通知文案明示「已加入点歌歌单并播放」（i18n 四语）。

---

### 3.5 GAP 4（LOW）— 切换歌单中途的竞态 + 空闲态 play-next 静默

- **切换竞态**：`playRequestNext` 读 `get().currentIndex`（store 光标）后调 `playQueueRequestNextAt`，后者在 DB 事务里对**最新 DB entries** 用**传入的 store 光标**插入。正常二者同序，仅光标防抖滞后（已被设计兜住）。但**正在 `setActiveSession` 切歌单**（`playQueueSet` 刚替换 entries、store 光标尚未 `set()`）的极小窗口里，锚点可能指向旧位置。概率低，但建议把 live-request 处理**串行排在在途切换之后**，或在 mutation 内重读权威光标。
- **空闲态 play-next 静默**：`currentIndex<0`（没在放）时 play-next/append 只追加不自动起播（play-now 会 append+play）。**裁决（2026-06-25 用户拍板，Q2）：空闲态收到点歌应当起播比较好** —— 没有「当前曲」时，play-next（乃至 append）降级为「插入并开始播放」，让点的歌真的响起来，而不是静等用户手动点。实现：`playRequestNext`/runtime `executePlayback` 在 `currentIndex<0` 时走 play-now 起播路径（或插入后 `playIndex(landed)`）。

### 3.6 GAP 5（LOW）— 当前曲/避让解析用的是滞后的持久化 DB 光标

runtime 的 `currentTrackId()`（用于 `avoidCurrentTrackId`，避免把「正在放的这首」当成命中再点一遍）读 `getPlayQueue(db)` 的**防抖 DB 光标**（[`audience-request-runtime.ts:275`](../../../../src/live-requests/audience-request-runtime.ts)），切歌后会短暂指向上一首。后果只是**匹配避让**偶尔避错（避让上一首 / 没避让真正当前首），不影响入队，属匹配质量问题。**裁决（2026-06-25 用户拍板，Q4：按 best practice）：随 GAP 2 的注入一起，统一让 runtime 用真实 store 光标解析当前 trackId**（注入 `getCurrentTrackId` / 复用同一个 store 光标来源），不再读滞后 DB 光标。

### 3.7 附带观察 — 不可播在线曲被自动跳过（无提示）

在线歌单常含 VIP/加密/区域受限、播放时才解析失败的曲（见 [[qq-music-stream-source-state]] 红线 + [[live-request-play-now-skip-bug]] 提到的 5984 集 auto-skip）。若点歌命中的恰是这类曲，`nextStreamSkipIndex`（[`queue.ts:69`](../../../../src/player/queue.ts)）会**静默向后跳过**该请求 → 体感「点了但没播 / 播了别的」。建议：被跳过的若是 `requested` 条目，给一条「该点歌曲目暂不可播放」通知（与 `notifyAudienceRequestPlayed` 对称），不要静默。归入 Phase 4 可观测。

---

## 4. 数据 / 契约影响

- **无 Dexie schema 变更、无新表、无新 id 前缀**（遵守硬规则 #4 codename 稳定）。「点歌歌单」复用现有 DjSession（`ses_` 前缀），不新建表。
- 仅在 `AudienceRequestRuntimeDeps` 注入面上扩展（已有 `getActiveSessionId`/`getCurrentTrackId` 字段，本就预留）：补一个「当前 play queue 曲目」解析入口 + 启用 `getCurrentTrackId` 真实光标；纯依赖注入，单测可注 canned 值。
- Q3 若选「新增独立点歌歌单」，仅在 `AppSettings` 加一个 `liveRequestSetId?: string`（settings 行字段，**非** DB schema bump，沿用 `streamOnlineSetId` 同形）；若复用 `streamOnlineSetId` 则零字段新增。
- 回退归属裁决继续唯一收敛在 `resolveOnlineTargetSession`，不在 UI/store 散落 `if (online)`。

---

## 5. Out of Scope

- **单曲循环（repeat-one）吞点歌**：by design，不修（Q1，§3.2）。本期最多加一个被动 UI 提示（可观测，列在 Phase 3 可选项）。
- AI-DJ 路由（`routeMode: ai-dj/hybrid`）的生成式点歌质量调优 —— 本 PRD 只覆盖 `library-search` + online 回退的入队正确性。
- 审核看板 / `requireApprovalForPlayNow` 的产品策略（已在 [[live-chat-song-request-state]] Q4 拍板无审核）。
- 网页轻量端（SSN WebSocket relay）的 transport 生命周期 —— 本 PRD 的修复在 runtime/store 层，两端共享，但不动 web transport 接线。
- 解密 `.mflac/.mgg/.qmc` 等加密在线音轨（永久红线，见 [[qq-music-stream-source-state]]）。
- 大批量在线曲离线落盘的内存安全（见 [[bulk-video-download-oom-risk]]，另案）。

---

## 6. Implementation Plan

> **不在范围**：单曲循环吞点歌（by design，Q1 不修，见 §3.2）。

### Phase 1: active-set 搜索域覆盖非-set 上下文（GAP 2，HIGH）✅

**Goal:** 「当前歌单」搜索域在 online-playlist / system-playlist / entity / library 上下文也能搜到当前在播曲目；同时（Q4）让 runtime 用真实 store 光标解析当前 trackId。

**Tasks:**
- [x] runtime 注入 `getActiveQueueTrackIds()`（来自 `getPlayQueue(db).entries` 或 store），`tracksForScope("active-set")` 在无 `contextSetId` 时回退到 live 队列曲目（[`audience-request-runtime.ts`](../../../../src/live-requests/audience-request-runtime.ts) `tracksForScope` / `resolveActiveQueueTrackIds`）。
- [x] 同批注入 `getCurrentTrackId`（真实 store 光标），`avoidCurrentTrackId` 不再读滞后 DB 光标（Q4）。
- [x] 控制器单例补注入（[`live-request-controller.ts`](../../../../src/live-requests/live-request-controller.ts) `ensureSingleton`：`getActiveQueueTrackIds`/`getCurrentTrackId` 来自 store），保持单测不注时走 DB 回退。
- [x] 单测：online-playlist 上下文 active-set 命中队列内曲（DB 回退 + 注入路径）；set 上下文行为不变；controller 透传到默认 runtime。

### Phase 1 Checklist
- [x] online 歌单 + active-set 域：点队列内曲能命中本地（不再误走联网）
- [x] system-playlist / entity / library 上下文同样命中（同一非-set 回退路径）
- [x] 默认 all-library 路径无回归（16 runtime + 15 controller 测试绿）
- [x] 切歌后避让的是真正的「当前曲」（store 光标注入）
- [ ] 真实 Electron 端到端复测（并入 Phase 3 harness 矩阵）

### Phase 2: 三种来源语义统一 + online 命中始终落「点歌歌单」（GAP 3，Q3）✅

**Goal:** 本地（当前/其它歌单）命中复用本地 Track；online 搜索命中**始终**落到固定的「点歌歌单」。

**Tasks:**
- [x] 复用本地：加测确认情况 ①②（已在当前 / 其它本地歌单）始终复用本地 Track、不复制、不联网（"routes a confident match from another set by reusing its track id"）。
- [x] 抽出 `resolveLiveRequestOnlineSetId(db, settings)`（module-level export，[`audience-request-runtime.ts`](../../../../src/live-requests/audience-request-runtime.ts)）→ **始终**返回专用「点歌歌单」（去掉「活动 session 优先」分支），`defaultOnlineFallback` 调用它，唯一裁决收敛于此。
- [x] Q3b 承载 set：**复用 `streamOnlineSetId`** 定位为「点歌歌单」（最简，零新 schema 字段；存在即用、悬挂/缺失则建并持久化）。
- [x] 回退路径复用封面缓存（`cacheStreamTrackCover`，best-effort、fire-and-forget，镜像 `playStreamedHit`）。
- [x] 单测：①②复用本地无重复行；③ `resolveLiveRequestOnlineSetId` 恒落点歌歌单（忽略活动 set）+ 建/持久化 + 悬挂重建。
- [ ] （deferred·polish）通知文案区分「已加入点歌歌单」——需把「是否 online 回退」透传进 `notifyAudienceRequestPlayed` + i18n 四语；当前通知已 action-aware 确认播放，归入后续。

### Phase 2 Checklist
- [x] 点歌命中本地（当前/其它歌单）→ 复用、无重复行、不联网
- [x] online 命中 → 恒落「点歌歌单」（`streamOnlineSetId`），归属稳定可解释
- [x] 封面/缓存与手动播放在线曲一致（best-effort）
- [ ] 通知文案 i18n 四语（deferred·polish，非阻塞）

### Phase 3: 空闲态起播（Q2） + 不可播提示 + 切换竞态兜底与可观测 ✅（核心）

**Goal:** 没在放也能点歌起播；边角竞态/不可播不静默失败。

**Tasks:**
- [x] **空闲态起播（Q2）**：`currentIndex<0`（空队列/没在放）时 `playRequestNext` 降级为 `playRequestNow`（插入并 `playIndex` 起播），不再静默入队一个永不推进的队列（[`player-store.ts`](../../../../src/stores/player-store.ts) `playRequestNext`）。**注**：非空队列即使持久化 `currentIndex:-1` 也会被 watcher `clampIndex` 夹成 0，故真正的 `currentIndex<0` 仅在**空队列**成立——这正是「没在放」的语义。append 维持「加到末尾」语义不变。
- [x] 不可播命中曲已有提示（**非静默**）：streamed 解析失败的自动跳过级联（[`player-store.ts:4741`](../../../../src/stores/player-store.ts) `recordStreamSkipFailure`）**每个 skip-run 已发一次 toast**（`player.streamNeedsAccess` / `player.playbackError`），点歌命中的 VIP/下架曲被跳时用户即收到通知。§3.7「静默跳过」前提其实不成立。
- [ ] （deferred·polish）把上面的通用 toast 针对 `requested` 条目改成「该点歌曲目暂不可播放」专文案——需在 skip 路径读 play queue entry 的 `requested` 标记 + i18n 四语；价值边际，归后续。
- [ ] （deferred·very-low-prob）切换竞态：live-request 串行排在在途 `setActiveSession` 之后——属 `setActiveSession`(replace entries)与 store 光标 `set()` 的极小窗口，无法确定性单测，需真实 Electron 压测复现后再加守卫。
- [ ] （deferred·real-Electron）`scripts/live-request-drive.mjs` + 控制端点（[[perf-control-endpoint-harness]]）矩阵 {repeat off/all/one × shuffle × set/online-playlist × 切换中途}（repeat-one 断言「请求入队但不自动播」=预期，见 §3.2）。本环境无法起 Electron，留人工验证。

### Phase 3 Checklist
- [x] 空闲态点歌：真的起播，不静等（player-store 集成测试绿）
- [x] 不可播命中曲有提示，不静默跳（既有 skip-run toast 覆盖）
- [ ] 切换中途点歌不丢、不错位（deferred，需真实 Electron 复现）
- [ ] 端到端 harness 覆盖 online 歌单 × 各模式（deferred，需真实 Electron）

---

## 7. Security / 红线

- 仍**无后端、无遥测**：点歌只读本地库 + 用户配置的 BYOK 在线源出站；不上报点歌内容/请求者。
- 不解密加密音轨；online 回退音质封顶明文（沿用 [[qq-music-stream-source-state]]）。
- 回退/回滚 = `git revert` + 重发版，不藏 hidden flag（硬规则 #3）。

---

## 8. 验证策略（必须真实 Electron 端）

纯函数 + player-store 集成测试是第一道（硬规则 #7）。但**循环/随机/切换 × online 歌单**的真实链路必须在 Electron 端跑：

- `node scripts/live-request-drive.mjs` 经 dev 控制端点驱动真实渲染端，断言命中落在 current/upcoming/tail。
- 矩阵：`{repeat=off/all/one} × {shuffle on/off} × {set / online-playlist 上下文} × {切换中途注入}`。
- 注意 [[perf-control-endpoint-harness]]：跑 harness 关 throttling；启动需 unset `ELECTRON_RUN_AS_NODE`。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260616-muzero-live-chat-song-request-prd`](../../20260616-muzero-live-chat-song-request-prd/20260616-muzero-live-chat-song-request-prd.md) | 弹幕点歌主 PRD（多来源/映射/transport） |
| [`20260613-muzero-live-chat-request-intake-prd`](../../20260613-muzero-live-chat-request-intake-prd/20260613-muzero-live-chat-request-intake-prd.md) | 入口归一化/安全/搜索引擎 |
| [`20260618-muzero-live-request-settings-merge-regression-prd`](../../20260618-muzero-live-request-settings-merge-regression-prd/20260618-muzero-live-request-settings-merge-regression-prd.md) | settings 合并回归（嵌套默认回填） |
| [`20260621-muzero-playlist-playback-context-resolution-prd`](../20260621-muzero-playlist-playback-context-resolution-prd/20260621-muzero-playlist-playback-context-resolution-prd.md) | 播放上下文解析（set vs 非-set） |
| [`20260614-muzero-netease-online-recommendations-prd`](../../20260614-muzero-netease-online-recommendations-prd/20260614-muzero-netease-online-recommendations-prd.md) | 在线歌单/网易云来源 |
| 记忆 [[live-request-play-now-skip-bug]]、[[live-chat-song-request-state]]、[[qq-music-stream-source-state]]、[[perf-control-endpoint-harness]] | 历史排查 + harness |

---

## 10. Open Questions

| # | Question | Status | Decision（2026-06-25 用户拍板） |
|---|----------|--------|----------|
| 1 | repeat-one 吞点歌是否修 | ✅ Resolved | **不修** —— 单曲循环锁死循环这一首是对的设计；请求已正确排队，待手动推进即播（§3.2）。可选被动 UI 提示属可观测、非本期。 |
| 2 | 空闲态（无在播）收到 play-next：只入队 vs 起播 | ✅ Resolved | **起播比较好** —— 空闲态把 play-next/append 降级为「插入并起播」，让点的歌真的响起来（Phase 3）。 |
| 3 | online 命中曲落点：并入当前在线歌单 vs 始终落专用 set | ✅ Resolved | **始终落专用「点歌歌单」**（不随活动 set 漂移），唯一裁决收敛在 `resolveOnlineTargetSession`（Phase 2）。 |
| 3b | 「点歌歌单」承载 set 实现 | 🔲 Open（实现子选项） | 复用 `streamOnlineSetId`（最简，与全局搜索在线 set 共用） vs 新增 `liveRequestSetId`（点歌独立、更贴「点歌歌单」语义）——Phase 2 实现时定。 |
| 4 | 统一 active-set 时是否同时让 `avoidCurrentTrackId` 用真实 store 光标 | ✅ Resolved | **按 best practice：是** —— 随 Phase 1 注入一起，用真实 store 光标（§3.6）。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-25 | DoodleBears / Claude | 初稿：端到端排查弹幕点歌「下一首」在 online/各种歌单 × 循环/随机/切换下的入队可靠性，定位 repeat-one 吞点歌 + GAP2（active-set 漏非-set 上下文）+ GAP3（online 缓存归属/重复联网）+ GAP4/5（切换竞态、空闲态、滞后光标）+ §3.7（不可播静默跳） |
| 2026-06-25 | 用户拍板 | Q1 单曲循环吞点歌**不修**（by design）→ 撤掉对应 phase；Q2 空闲态点歌**起播**；Q3 online 命中**始终落「点歌歌单」**；Q4 按 best practice 统一真实 store 光标。修复计划收敛为 3 phase |

---

> **Note:** 本 PRD 强调改既有代码而非新建结构。所有定位均 2026-06-25 对照当前代码 verify；播放列表插入机制本身已硬化正确，修复集中在 4 个特定「模式/上下文」组合的语义补齐。
