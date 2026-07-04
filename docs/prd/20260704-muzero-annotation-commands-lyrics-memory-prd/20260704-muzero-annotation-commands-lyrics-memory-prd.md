# PRD: 弹幕命令路由（点歌搜索 / AI DJ / 评论 / 评分，各自可配关键词）+ 常驻众评评分 chip + 歌词记忆浮层

**Status:** Draft
**Created:** 2026-07-04
**Author:** MUZERO (DoodleBear)
**Module:** live-requests（观众意图/命令引擎）· db/Track·Memory（音乐承载回忆）· player/歌词表面 —— 把「点歌」通道从「单一 routeMode」升级成**可配置的关键词→意图路由表**（`点歌`=库内搜索快路径、`AI点歌`=AI DJ、`评论`=写记忆、`评分`=更新众评分），并新增**常驻众评评分 chip** 与**歌词模式记忆轮播**

---

> **一句话（PM 口径）**：把「记忆」和「点歌」延伸 + 结合，并把「点歌」这条弹幕通道**按关键词分流**——
> ① **区分点歌【搜索】与 AI DJ**：`点歌 歌名` 走轻量库内搜索（**不强制过 AI DJ**，AI 太重、简单点歌效率低）；另配关键词（如 `AI点歌`/`DJ`）才走 AI DJ。
> ② **评论**：`评论 这段绝了` → 给当前曲写一条署名记忆（默认 floating 轮播；因直播延迟**不**自动锚秒，仅当观众显式写 `评论 3:14 …` 才钉到该秒）。
> ③ **评分**：顶部**常驻一个 1~5 评分 chip**；观众发 `评分 5` 或主播点 chip 都更新这首曲子的**众评均分（每人一票、去重）**。
> ④ 打开歌词时若有记忆，像沉浸模式那样**顶部轮播记忆**。
> ⑤ 以上每个功能**各自可配触发关键词**。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 命令路由地基：`matchIntakeCommand` 纯函数 + `IntakeCommand[]` 可配注册表 + `点歌`=search / `AI点歌`=ai-dj 分流 + legacy 迁移 + 设置 UI | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 评分聚合：`Track.ratingsByRater`（众评去重，**设备本地不同步**）+ `setTrackRating`/`resolveTrackRating` + rating 意图接线 + **常驻评分 chip** | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 评论意图：`applyAnnotationCommand` → 当前曲一条 `Memory`（署名+锚秒）+ 注释限流 + 落地 toast | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 歌词记忆浮层：抽 `useScheduledMemory` + `LyricsMemoryStrip` + `lyricsMemoryOverlay` 开关 + i18n 四语 + 版本 bump | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 有两块已落地的能力，本 PRD 把它们**延伸并结合**，并顺手修掉「点歌」通道的一处效率缺口：

1. **「音乐承载回忆」= 一对多 `Memory` 表**（[`types.ts` `Memory`](../../../src/db/types.ts#L217)）：每首歌可挂多条记忆（`note` + 可选照片 + 可选作者 `author` + `createdAt` + 可选锚点 `atSec`）。记忆进搜索、喂 DJ 上下文（[`dj-engine.ts:74`](../../../src/dj/dj-engine.ts#L74) 把当前曲 memory notes 拼进 DJ prompt）、在右栏 **memory rail** 轮播、在**全沉浸模式**顶部 popover 浮现（[`immersive-memory-overlay.tsx`](../../../src/components/player/immersive-memory-overlay.tsx) + 纯函数 [`immersive-memory-schedule.ts`](../../../src/lib/immersive-memory-schedule.ts)）。

2. **「点歌」= 观众请求（live-requests）命令前缀通道**（[`20260616-muzero-live-chat-song-request-prd`](../20260616-muzero-live-chat-song-request-prd/20260616-muzero-live-chat-song-request-prd.md)，Final）：任意 JSON 来源（SSN 弹幕 / bot / OBS）进来，[`live-request-controller.ts` `handlePayload`](../../../src/live-requests/live-request-controller.ts#L155) 归一化 → 命令前缀识别 → 路由。runtime 已注入 `getCurrentTrackId`（[controller:284](../../../src/live-requests/live-request-controller.ts#L284)）——**知道现在正在播哪首歌**。

**三个产品缺口 / 动因：**

1. **点歌被「一个 routeMode 一刀切」**：今天一条弹幕点歌走 `library-search` 还是 `ai-dj` 由**来源级/全局的单一 `routeMode`** 决定（[`audience-request-runtime.ts:159`](../../../src/live-requests/audience-request-runtime.ts#L159) 的 `handle`）。一旦开了 AI，主播若想让点歌走 AI DJ，就**所有点歌都过 AI**——AI DJ 太重（搜/生成/curate 一整套 LLM tool loop），简单「点一首库里已有的歌」也被拖慢。**没有办法「简单点歌走快路径、复杂需求才走 AI」**。
2. **观众无法「留评/打分」，只能「点歌」**：弹幕说「这首好听」「给 5 分」不会留下任何东西。观众最鲜活的反应（评论/评分）——最好的「回忆材料」——被丢弃。
3. **看歌词时看不到记忆**：桌面右栏是 lyrics **或** memory rail 的**二选一 toggle**（[`now-playing-panel.tsx:80`](../../../src/components/player/now-playing-panel.tsx#L80)）；沉浸模式已经解决了「频谱时看不到记忆」，但**歌词模式**还没有对应的记忆浮层。

**核心洞察**：「点歌」通道本质是一个「**弹幕消息 → 关键词 → 意图**」的分发器，今天只有一种意图（song request）且只有一个 routeMode。本 PRD 把它升级成**可配置的关键词→意图路由表**：`点歌`→库内搜索、`AI点歌`→AI DJ、`评论`→写记忆、`评分`→更新众评分——**每个功能各自可配关键词**（PM 明确要求）。两块地基（记忆表 + 前缀分发 + `getCurrentTrackId` + runtime 已支持每调用 `routeMode` 覆盖）都在，本 PRD 是**把分发器泛化 + 两个新意图 + 一个评分聚合 + 一个歌词呈现表面**。

### 1.2 为什么不用「in-app DJ chat 的工具」

仓库里其实有**两条**「用户发消息」的通道，本 PRD 只动其中一条：

| 通道 | 形态 | 是否落点 |
|------|------|---------|
| **live-requests 命令前缀（点歌）** | **确定性前缀匹配**、无 LLM、零成本、面向**观众/弹幕**，量大并发高 | ✅ **是**。PM 说的「用户发送关键词，各功能各自可配」正是这种**前缀指令 + 路由表**心智；「点歌功能」就是这条通道 |
| **in-app DJ chat（[`dj-chat-entry.tsx`](../../../src/components/chat/dj-chat-entry.tsx)）** | **LLM 语义驱动**，已有 `add_memory`/`memory_search` 工具、`library_search`/`dj_generate_tracks` 等（[`dj-chat-tools.ts`](../../../src/chat/dj-chat-tools.ts)），面向本机用户、花 token | ❌ 否。它已经能语义地写记忆/搜库/生成；确定性关键词只落弹幕通道，不重复叠加。列 [Out of Scope](#7-out-of-scope) |

**结论**：命令路由（点歌搜索 / AI DJ / 评论 / 评分）全部落在 **live-requests 命令前缀通道**——与「点歌」同源、同一条弹幕、同一个 `handlePayload`。这才是「延伸和结合」。

### 1.3 Target Users

| Role | Description | Key interaction |
|------|-------------|-----------------|
| **观众 / 弹幕（主）** | 直播里对主播正在放的歌有反应，或想点歌 | `点歌 稻香`（快搜库内） / `AI点歌 来点citypop`（走 AI DJ） / `评论 副歌绝了`（留署名记忆） / `评分 5`（投一票众评） |
| **主播 / 策展人** | 想让「简单点歌」快、「复杂需求」才用 AI；把观众反应沉淀 | 配各功能关键词 + routeMode；顶部常驻 chip 一眼看众评均分、可自己点分；评论汇入记忆时间线 + 歌词轮播；跨设备 R2 同步 |
| **回放型听众** | 之后再听这首歌 | 歌词模式顶部轮播当时观众评论（锚秒的在对应歌词浮现）；chip 显示这首歌的众评分 |

### 1.4 Core Value

1. **点歌分流，简单快、复杂才 AI**：`点歌`→库内搜索快路径（不过 AI DJ），另配 `AI点歌`→AI DJ 生成。开了 AI 也不用「所有点歌都过 AI」，效率不再被拖。
2. **观众反应变成「回忆」与「分数」**：评论沉淀为 `Memory`（复用搜索/DJ/轮播/沉浸/同步全套），评分汇成**众评均分**（每人一票、去重）常驻 chip——一个新分发意图、一个聚合字段，零新管线。
3. **评论 × 歌词 × 时间线三合一**：评论默认 floating 轮播；观众可显式写 `评论 3:14 …` 把它钉到那一秒（`atSec`），歌词模式在对应歌词处浮现（直播延迟下**不**按到达时间自动锚秒，见 [Q10](#10-open-questions)）。
4. **一切可配 + 最大化复用**：关键词→意图路由表可配；命令分发、`getCurrentTrackId`、runtime `routeMode` 覆盖、`addMemory(author)`、`scheduleImmersiveMemory` 调度、memory 卡片样式全部已存在。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                      ┌────────────────────────────────────────────────────────┐
  弹幕/JSON 请求  ───▶ │ live-request-controller.ts  handlePayload()              │
  (SSN / bot / OBS)   │   1. findSource / 脱敏 / applyMapping                     │
                      │   2. normalizeAudienceRequest → request (rawMessage=完整) │
                      │   ─────────── 本 PRD：关键词→意图路由 ───────────         │
                      │   3. matchIntakeCommand(rawMessage, intake.commands)      │  ← 纯函数(新)
                      │        → { command:{intent,routeMode?}, body, score? }     │
                      │   4. dispatch by command.intent:                          │
                      │      ┌ "request" ─▶ runtime.handle(request, {              │
                      │      │                 routeMode: command.routeMode ??…,   │ ← 每命令 override
                      │      │                 playbackAction })  ← 点歌(既有,不动) │
                      │      │     · 点歌   → routeMode "library-search"(快路径)     │
                      │      │     · AI点歌 → routeMode "ai-dj"                      │
                      │      ├ "comment" ─▶ applyAnnotationCommand(...)            │  ← 写 Memory(新)
                      │      │                 addMemory({trackId,note,author,atSec})│
                      │      └ "rating"  ─▶ applyRatingCommand(...)                │  ← 更新聚合(新)
                      │                        setTrackRating(trackId,raterKey,score)│
                      │      (comment/rating 前接注释限流；无命令且 requireCommand → 丢)│
                      └────────────────────────────────────────────────────────┘
              addMemory │                                  │ setTrackRating
                        ▼                                  ▼
        db.memories (1:N Track) ──┐        Track.ratingsByRater (每 rater 一票, 去重)
                                  │                        │ useLiveQuery
   ┌──────────────────────────────┼──────────────┐        ▼
   │ 记忆呈现（复用调度）           │              │   TrackRatingChip（常驻顶部, 1~5）
   │  useScheduledMemory(trackId)  │              │     resolveTrackRating(track) → 均分+票数
   │   ├ ImmersiveMemoryOverlay(既) │              │     主播点 chip → ratingsByRater.self
   │   └ LyricsMemoryStrip(新)──────┘              │
   │       挂进 SyncedLyricsView 顶部                        
   └──────────────────────────────────────────────┘
```

### 2.2 Technology Stack（复用既有栈，**不引入任何新依赖**）

| Concern | Technology | Rationale |
|---------|------------|-----------|
| 关键词→意图路由 | 纯 TS `matchIntakeCommand` + Vitest | 注入命令表，确定性穷举单测（硬规则 #7；对齐既有 `matchAudienceRequestPrefix`） |
| 每命令路由覆盖 | 既有 [`runtime.handle(request, {routeMode, playbackAction})`](../../../src/live-requests/audience-request-runtime.ts#L135) | runtime **已支持每调用 override**（`AudienceRequestHandleOverride`），命令直接传 routeMode——**runtime 零改动** |
| 众评评分 | `Track.ratingsByRater?: Record<rater, score>` + 纯 `resolveTrackRating` | 追加**非索引可选**字段（镜像既有 [`DjSession.trackRanks`](../../../src/db/types.ts#L493) 的 `Record` 先例）→ **无 Dexie bump**；每 rater 一 key = 天然去重 |
| 写记忆 | 既有 [`addMemory`](../../../src/db/repositories.ts#L2318) | 已支持 `author`/`atSec`/photo；评论直接用，**无新 repo** |
| 当前曲 / 时长 | controller 注入 `getCurrentTrackId`（既有）/ 新 `getTrackDurationSec`（评论显式 mm:ss 的 clamp） | 评论**不**自动锚当前秒（直播延迟，[Q10](#10-open-questions)）；仅显式 `mm:ss` 才锚 |
| 记忆调度 | 既有 [`scheduleImmersiveMemory`](../../../src/lib/immersive-memory-schedule.ts) | 双 lane（锚点抢占 + 动态时长），已穷举单测；歌词浮层复用**同一份** |
| 响应式读 | Dexie `useLiveQuery` | Track（chip）/ memories（strip）都响应式 |
| 动画 | `motion/react`（已用） | 复用 overlay 的 fade/blur/`AnimatePresence`；`MotionConfig reducedMotion="user"` 兜底 |
| 设置持久化 | Dexie `settings` 行 | 全部追加可选字段 + `commands[]`，**无 Dexie bump**（浅合并；对齐两份前置 PRD） |
| 同步 | 既有 R2 manifest（Zod） | 评分**不**同步（设备本地，[Q6](#10-open-questions)）；评论走既有 `Memory` 同步，无新增 |

### 2.3 Project Structure（变更面）

```
src/
├── live-requests/
│   ├── intake-command.ts                  # ✨ 新：IntakeCommand 类型 + DEFAULT_INTAKE_COMMANDS + matchIntakeCommand + score 抽取（纯）
│   ├── intake-command.test.ts             # ✨ 新：穷举单测
│   ├── live-request-annotation.ts         # ✨ 新：applyAnnotationCommand(comment→addMemory) + applyRatingCommand(rating→setTrackRating)（注入 deps）
│   ├── live-request-annotation.test.ts    # ✨ 新
│   ├── live-request-controller.ts         # ✏ handlePayload 改 match+dispatch；注入 getTrackDurationSec + onAnnotated/onRated
│   ├── live-request-notification.ts       # ✏ notifyAnnotationAdded / notifyRatingAdded（toast）
│   └── audience-request-sources.ts        # ✏ 迁移：legacy commandPrefixes/routeMode → 默认命令表（向后兼容）
├── db/
│   ├── types.ts                           # ✏ Track.ratingsByRater?; AppSettings.lyricsMemoryOverlay?;
│   │                                       #   AudienceRequestIntakeSettings.commands?: IntakeCommand[]
│   └── repositories.ts                    # ✏ setTrackRating(dedup+cap+clamp); addMemory 不变
├── lib/
│   └── track-rating.ts                    # ✨ 新：resolveTrackRating(track) → {average,count}|null（纯，穷举单测）
├── hooks/
│   └── use-scheduled-memory.ts            # ✨ 新：抽自 ImmersiveMemoryOverlay 的 useLiveQuery+tick 调度（两表面共用）
├── components/
│   ├── player/
│   │   ├── track-rating-chip.tsx          # ✨ 新：常驻 1~5 评分 chip（均分+票数；主播点击投 self 票）
│   │   ├── immersive-memory-overlay.tsx   # ✏ 改用 useScheduledMemory（行为不变，去重）
│   │   ├── lyrics-memory-strip.tsx        # ✨ 新：歌词模式顶部轮播条（tap seek 到 atSec）
│   │   ├── synced-lyrics-view.tsx         # ✏ 顶部挂 LyricsMemoryStrip（showMemoryStrip? + lyricsMemoryOverlay 开关）
│   │   └── track-info-card.tsx / now-playing-page.tsx  # ✏ 顶部挂 TrackRatingChip
│   └── settings/
│       ├── live-request-settings.tsx      # ✏ 命令表编辑器（每意图可配关键词 + request 命令的 route）
│       └── visualizer-settings.tsx        # ✏ 「歌词时浮现记忆」可见开关（紧邻 immersiveMemoryOverlay）
├── sync/                                  # （无需改：评分设备本地不进 R2；评论走既有 Memory 同步）
└── i18n/locales/{en,zh,ja,ko}/common.json # ✏ 命令表/评分 chip/toast/strip/设置 文案（4 语）
```

> **新文件理由（模板 Exception Policy）**：`intake-command.ts`（新路由纯逻辑，需穷举单测）、`live-request-annotation.ts`（新注入式 handler，确定性单测）、`track-rating.ts`（新纯聚合函数，穷举单测）、`track-rating-chip.tsx` + `lyrics-memory-strip.tsx`（**新呈现表面**）、`use-scheduled-memory.ts`（把沉浸 overlay 内联调度**抽出共用**去重）。其余全部扩既有文件；**runtime / router / 搜库 / 安全 不动**。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
一条弹幕 rawMessage ──matchIntakeCommand──▶ 命中 IntakeCommand{ intent, routeMode?, prefixes }
  ├─ intent "request" · 点歌   → runtime.handle(routeMode="library-search")  库内搜索快路径
  ├─ intent "request" · AI点歌 → runtime.handle(routeMode="ai-dj")           AI DJ 生成
  ├─ intent "comment"  · 评论  → 一条 Memory 挂当前曲 { note, author, atSec?(仅显式 mm:ss) }
  └─ intent "rating"   · 评分  → Track.ratingsByRater[raterKey] = score(1..5)  （众评去重）
```

**三条统一原则：**
- **评论 = 一条 `Memory`**（rich：卡片 + 轮播 + 喂 DJ + 同步）；
- **评分 = Track 级众评聚合**（light：一个 chip；每 rater 一票、去重、显均分）——**评分不是 Memory**（不刷屏记忆时间线）；
- **点歌/AI点歌 = 同一 `request` 意图、不同 `routeMode`**（复用既有 runtime，零改动）。

### 3.2 Database Schema

> ⚠️ 优先改既有；全部追加**可选、非索引**字段 → **无 Dexie version bump、无 upgrade**（沿用 `Track.coverThumbhash` / `Memory.atSec` / `DjSession.trackRanks` 先例）。

**(a) `AudienceRequestIntakeSettings` 加命令注册表**（[`types.ts:684`](../../../src/db/types.ts#L684)）：

```ts
export type IntakeCommandIntent = "request" | "comment" | "rating";

export interface IntakeCommand {
  /** codename 稳定 id（禁改已发布 id，硬规则 #4）。 */
  id: string;                               // "song-search" | "ai-dj" | "comment" | "rating" | 自定义
  intent: IntakeCommandIntent;
  /** 用户可配的触发关键词（大小写不敏感，首个匹配胜出；最长前缀优先）。 */
  prefixes: string[];
  /** intent==="request" 专用：该命令强制的路由，覆盖 source/global routeMode。 */
  routeMode?: AudienceRequestRouteMode;     // "library-search" | "ai-dj" | "hybrid"
  /** 可选：该命令的播放动作覆盖（append/next/now）。 */
  playbackAction?: AudienceRequestPlaybackAction;
  enabled?: boolean;                        // 默认 true
}

// AudienceRequestIntakeSettings 追加：
commands?: IntakeCommand[];                 // 关键词→意图路由表（缺省回填 DEFAULT_INTAKE_COMMANDS）
```

```ts
export const DEFAULT_INTAKE_COMMANDS: IntakeCommand[] = [
  { id: "song-search", intent: "request", prefixes: ["点歌", "!sr", "song:"], routeMode: "library-search" },
  { id: "ai-dj",       intent: "request", prefixes: ["AI点歌", "DJ", "生成", "ai:"], routeMode: "ai-dj" },
  { id: "comment",     intent: "comment", prefixes: ["评论", "comment:", "留言"] },
  { id: "rating",      intent: "rating",  prefixes: ["评分", "rate:", "打分"] },
];
```

- **点歌快路径**：`song-search` 命令 `routeMode: "library-search"` → 只搜库（保留低置信度联网兜底，见 [Q3](#10-open-questions)），**绝不触发 AI DJ 生成**。
- **AI DJ 显式触发**：只有 `ai-dj` 命令的关键词才走 `routeMode: "ai-dj"`。这直接修掉「开了 AI 就全部点歌过 AI」的效率问题。
- **前缀不重叠校验**：设置面板对四类关键词做冲突提示（同一前缀不得属两命令）。

**(b) `Track` 加众评聚合**（[`types.ts` `Track`](../../../src/db/types.ts#L108)）：

```ts
export interface Track {
  // …既有…
  /**
   * 众评评分：raterKey → 分数(1–5)。每人一票、去重（同一 rater 再投覆盖旧值）。
   * raterKey：主播本机="self"；观众=其 requesterKey（如 "bilibili:123"）或 "audience:<platform>:<name>"。
   * chip 显示 = mean(values)（四舍五入实心星）+ count = keys 数（见 `resolveTrackRating`）。
   * 追加、非索引、`Record` 值（镜像 `DjSession.trackRanks` 先例）→ 无 Dexie bump。**设备本地、不进 R2 同步**（Q6）。
   * 容量上限：超过 `RATING_RATER_CAP`(默认 500) 时按插入序淘汰最旧 key（镜像 `removedTracks` 封顶）。
   */
  ratingsByRater?: Record<string, number>;
}
```

- **不加聚合到单标量**（如只存 `rating`/`ratingCount`）：那样无法「同一人再投覆盖旧票」去重；`Record` 天然去重、可重算、可显票数。
- **不做 `Track` 级评论列表**：评论仍是 `Memory`（一对多），只有评分聚合落 Track。

**(c) `AppSettings` 加歌词浮层开关**（[`types.ts` `AppSettings`](../../../src/db/types.ts#L749)）：

```ts
lyricsMemoryOverlay?: boolean;   // 歌词模式顶部轮播记忆。默认 true（读用 ?? true）。硬规则 #3 可见开关
```

**Data Migration — 不需要**：`settings` 行启动浅合并；`commands`/`lyricsMemoryOverlay`/`ratingsByRater` 全为**非索引可选** → IndexedDB 天然向前兼容。**本期不 bump、不写 upgrade。**

**Legacy 兼容（[`audience-request-sources.ts`](../../../src/live-requests/audience-request-sources.ts)）**：`commands` 缺省时由既有字段合成——`{ id:"song-search", intent:"request", prefixes: intake.commandPrefixes, routeMode: intake.routeMode ?? "library-search" }`，再补 `ai-dj`/`comment`/`rating` 默认命令。既有 `commandPrefixes`/`routeMode`/`requireCommandPrefix` 保留（R2 manifest 契约稳定 + 无命令匹配时的回退），`commands[]` 为新的事实来源。

### 3.3 Sync（R2 manifest）—— 评分**不**跨设备

- **评分 `ratingsByRater` 设备本地、不进 R2 manifest**（[Q6](#10-open-questions) 定稿：评分不跨设备）。众评均分是「这台设备/这场直播收到的票」，不随歌曲跨设备同步——省掉多设备票合并的复杂度，也避免把 A 设备的票被 B 设备整体覆盖。R2 Track schema/export/import **不加** `ratingsByRater`（sync/ 三文件无需改）。
- **评论走 `Memory`，照常同步**：`Memory`（含 `author`、可选 `atSec`）已在 manifest，跨设备同步不变，无新增字段。

### 3.4 Data Relationship Diagram

```
弹幕 rawMessage ─matchIntakeCommand─▶ { command:{intent,routeMode?}, body, score?, atSec? }
                                              │
        ┌──────────── request ───────────────┼──────── comment ────────┬──── rating ────┐
        ▼                                     ▼                          ▼                ▼
 runtime.handle(routeMode)          addMemory({trackId,note,        setTrackRating(trackId,
 (点歌 library-search /               author,atSec})                  raterKey, score∈1..5)
  AI点歌 ai-dj)                       ▲            ▲                    ▲
                       getCurrentTrackId()  atSec=显式mm:ss(可选)   raterKey=requesterKey|"self"
                                              ▼                          ▼
                          db.memories ─useLiveQuery→ 歌词/沉浸/rail   Track.ratingsByRater ─useLiveQuery→ 评分 chip
                                                                       resolveTrackRating → {average,count}
```

---

## 4. Engine & Repository API

> 本 App 无后端；此节是「内部 API」：纯路由/聚合函数 + 注入式 handler + repo 透传。优先改既有，避免大改。

### 4.1 `matchIntakeCommand`（新 [`intake-command.ts`](../../../src/live-requests/intake-command.ts)）—— 纯函数

```ts
export interface IntakeCommandMatch {
  command: IntakeCommand;
  /** 剥掉前缀（rating 再剥分数 / comment 再剥前导 mm:ss）后剩下的自由文本；可为空串。 */
  body: string;
  /** rating only：解析出的分数，clamp 到 1..5；无法解析 → undefined。 */
  score?: number;
  /** comment only：观众显式写在开头的 `mm:ss`（如 `评论 3:14 …`）→ 秒；未写 → undefined（floating）。 */
  atSec?: number;
  matchedPrefix: string;
}

/**
 * 遍历 enabled 命令的所有 prefixes，大小写不敏感 + **最长前缀优先**（避免短前缀抢先），
 * 首个命中胜出。未命中任何命令 → null（交回既有 requireCommandPrefix / 回退路径）。
 * rating 命令额外做分数抽取。
 */
export function matchIntakeCommand(
  message: string,
  commands: readonly IntakeCommand[],
): IntakeCommandMatch | null;
```

**分数抽取（rating）规则**（穷举单测）：
- `评分 5` → `score 5, body ""`；`评分 5 好听` → `score 5, body "好听"`；
- 星标 `评分 ★★★★` → `score 4`；
- clamp 到 `[1,5]`、`Math.round`；缺失/NaN/越界 → `undefined`（无分数的 `评分` 视为一次「无效评分」，安全丢弃，见 §4.6）；
- 10 分制归一（`评分 9/10`）默认**不归一、直接 clamp 到 5**（[Q7](#10-open-questions) 已定 1–5 刻度）。

**时间抽取（comment）规则**（穷举单测）：
- 仅识别**前导** `mm:ss` / `m:ss`（可选 `h:mm:ss`）：`评论 3:14 这句绝了` → `atSec 194, body "这句绝了"`；
- 无前导时间 → `atSec undefined`（**floating，轮播**）——**不**用弹幕到达时间/当前播放秒自动锚（直播延迟不准，[Q10](#10-open-questions)）；
- 解析出的秒在 `applyAnnotationCommand` 里 clamp 到当前曲 `[0, durationSec]`。

### 4.2 `applyAnnotationCommand` / `applyRatingCommand`（新 [`live-request-annotation.ts`](../../../src/live-requests/live-request-annotation.ts)）

```ts
export interface AnnotationApplyDeps {
  addMemory: typeof import("@/db/repositories").addMemory;
  setTrackRating: typeof import("@/db/repositories").setTrackRating;
  getCurrentTrackId: () => string | undefined | Promise<string | undefined>;
  /** 把评论显式 `mm:ss` clamp 到 [0, durationSec]。 */
  getTrackDurationSec?: (trackId: string) => number | undefined | Promise<number | undefined>;
  now?: () => number;
  onAnnotated?: (i: { trackId: string; memory: Memory }) => void;
  onRated?: (i: { trackId: string; average: number; count: number }) => void;
}

/** comment → 当前曲一条 Memory（note=body，author=发送者，atSec=显式 mm:ss 或 undefined）。空 body / 无当前曲 → ignored。 */
export async function applyAnnotationCommand(
  match: IntakeCommandMatch, request: NormalizedAudienceRequest, deps: AnnotationApplyDeps,
): Promise<{ status: "written" | "ignored"; reason?: string; memoryId?: string }>;

/** rating → setTrackRating(currentTrack, raterKey, score)。无分数 / 无当前曲 → ignored。 */
export async function applyRatingCommand(
  match: IntakeCommandMatch, request: NormalizedAudienceRequest, deps: AnnotationApplyDeps,
): Promise<{ status: "written" | "ignored"; reason?: string }>;
```

- **`raterKey`**：`request.requesterKey ?? "audience:" + (platform ?? "anon") + ":" + (displayName ?? externalId ?? "anon")`。主播本机路径（chip 点击）用 `"self"`。
- **`author`（comment）**：`{ devicePublicId: "audience:" + raterKey, displayName: request.requesterDisplayName }`（`MemoryAuthorRef` 形状见 [`types.ts:1657`](../../../src/db/types.ts#L1657)）。
- **`atSec`（comment）**：仅取 `match.atSec`（观众显式 `mm:ss`），clamp 到 `[0, getTrackDurationSec?.()]`；未写 → **floating（轮播）**。**不**按弹幕到达时间/当前播放秒自动锚（直播延迟不准，[Q10](#10-open-questions)）。

### 4.3 Controller wiring（改 [`handlePayload`](../../../src/live-requests/live-request-controller.ts#L155)）

在 `normalizeAudienceRequest` **之后**、既有 `requireCommandPrefix` 丢弃 **之前**改为 match + dispatch：

```ts
request = normalizeAudienceRequest(mapped, { commandPrefixes });        // 既有

const match = matchIntakeCommand(request.rawMessage, resolveCommands(intake));   // 新
if (match) {
  if (match.command.intent === "comment") { await applyAnnotationCommand(match, request, deps); return; }
  if (match.command.intent === "rating")  { await applyRatingCommand(match, request, deps);      return; }
  // intent === "request"：把每命令 routeMode 作为既有 runtime override 传入
  await runtime.handle(request, {
    routeMode: match.command.routeMode ?? source.routeMode ?? intake.routeMode,
    playbackAction: match.command.playbackAction ?? source.playbackAction ?? intake.playbackAction,
  });
  return;
}
// 无命令匹配：既有 requireCommandPrefix 丢弃 + 回退（不变）
if ((intake.requireCommandPrefix ?? true) && hasAnyPrefix(intake)) return;
await runtime.handle(request, { routeMode: source.routeMode ?? intake.routeMode, playbackAction: … });
```

- **runtime 零改动**：`runtime.handle` 已接受 `AudienceRequestHandleOverride`（[audience-request-runtime.ts:159](../../../src/live-requests/audience-request-runtime.ts#L159)）；request 命令只是把 routeMode 换成命令自己的。搜库/路由/安全/AI-DJ 全不动。
- `deps` 在 `ensureSingleton()`（[controller:264](../../../src/live-requests/live-request-controller.ts#L264)）注入：既有 `getCurrentTrackId` + 新 `getTrackDurationSec`（读当前曲时长供评论显式秒 clamp）、`setTrackRating`、`onAnnotated/onRated → notify*`。**不注入** `getCurrentPositionSec`（评论不自动锚当前秒，Q10）。
- **testing 来源不触发**（既有 early-return 在 match 之前保持）。
- **注释/评分限流**：comment/rating 走 controller 层、**不经** runtime 的 dedupe/cooldown/rate-limit，故在 `applyAnnotation/Rating` 前接一层轻量限流（复用 [`audience-request-security.ts`](../../../src/live-requests/audience-request-security.ts) 纯函数思路，独立计数器，默认沿用 intake 的 `requesterCooldownSec`/`maxRequestsPerMinute`）。

### 4.4 Repository / 纯聚合

**`setTrackRating`（新，[`repositories.ts`](../../../src/db/repositories.ts)）**：

```ts
export async function setTrackRating(
  trackId: string, raterKey: string, score: number, db = defaultDb,
): Promise<void>
// score = Math.round + clamp[1,5]；track.ratingsByRater[raterKey] = score（去重覆盖）；
// 超 RATING_RATER_CAP 按插入序淘汰最旧 key；bump track.updatedAt。
```

**`resolveTrackRating`（新纯函数，[`lib/track-rating.ts`](../../../src/lib/track-rating.ts)）**：

```ts
export function resolveTrackRating(
  track: Pick<Track, "ratingsByRater">,
): { average: number; count: number } | null;
// count = keys 数；average = mean(values)（保留一位小数供 tooltip，四舍五入供实心星）；空 → null
```

- `addMemory` / `updateMemory` / `deleteMemory` / `memoryNotesByTrack` **不变**（评论走既有 `addMemory`；评分不碰 Memory）。

### 4.5 记忆调度 hook（新 [`use-scheduled-memory.ts`](../../../src/hooks/use-scheduled-memory.ts)）

把 [`ImmersiveMemoryOverlay`](../../../src/components/player/immersive-memory-overlay.tsx#L28) 内联的「useLiveQuery 当前曲 memories + 250ms tick 驱动 `scheduleImmersiveMemory` + activeId + photo url」抽成复用 hook：

```ts
export function useScheduledMemory(trackId: string | undefined): {
  active: Memory | undefined; photoUrl: string | undefined;
};
```

- immersive overlay 改用它后**动画/调度不变**（同一份纯函数、同一 tick、非响应式 getState，硬规则 #6）；`LyricsMemoryStrip` 复用同 hook → 两表面共享节奏，不复制。

### 4.6 Error / Edge handling

| 场景 | 行为 |
|------|------|
| `点歌`（library-search）无命中 | 既有低置信度联网兜底（保留）；仍无 → ignored（状态日志） |
| 当前无正在播（弹幕在空档评论/评分） | comment/rating → `ignored: no-current-track`；可选 toast「当前没有在播放的歌」 |
| 评论 body 为空（只发 `评论`） | `ignored: empty`，不落记忆 |
| 评分无有效分数（`评分 好听`） | `ignored: no-score`（不污染均分） |
| 同一人狂刷评论/评分 | 注释限流丢弃；评分即便通过，`ratingsByRater` 天然去重（同 rater 覆盖），刷不高票数 |
| 关键词跨命令冲突 | 设置面板校验提示；运行时最长前缀优先 + 首个命中 |
| 歌词浮层/评分 chip：当前曲无记忆/无评分 | strip 不渲染卡片；chip 显示「未评分」空态（或隐藏，见 [Q8](#10-open-questions)） |
| seek 倒带 / loop | 复用 `scheduleImmersiveMemory` re-arm |
| reduced-motion | 复用全局 `MotionConfig`（去 blur/scale，仅淡入淡出） |

---

## 5. Frontend Design

### 5.1 命令表编辑器（[`live-request-settings.tsx`](../../../src/components/settings/live-request-settings.tsx)）—— 每功能可配关键词

在全局默认区把单一「点歌前缀」升级为**命令表编辑**：四行（点歌搜索 / AI点歌 / 评论 / 评分），每行一个「关键词（逗号分隔）」输入；`request` 两行额外一个 route `Select`（library-search / ai-dj / hybrid）+ 可选 playbackAction。附：前缀冲突校验提示、一行示例（「观众发 `点歌 稻香` 走库内搜索；`AI点歌 citypop` 走 AI DJ；`评论 好听` 留记忆；`评分 5` 投一票」）。用既有 `@/components/ui/{select,input,card}`（对齐 flow-settings 风格）。per-source 覆盖留 [Out of Scope](#7-out-of-scope)。

### 5.2 常驻评分 chip（新 [`track-rating-chip.tsx`](../../../src/components/player/track-rating-chip.tsx)）

- **形态**：小圆角 chip，显示 `★×round(average)` + 淡色 `average · count票`（无票 → 空态五个空心星 / 或「未评分」，[Q8](#10-open-questions)）。`useLiveQuery` 读当前曲 Track（响应式），`resolveTrackRating` 派生。
- **交互**：主播 hover/点击展开 1–5 星选择 → `setTrackRating(trackId, "self", n)`（投/改 self 票，均分实时变）。点击态用既有 `usePlayerStore` scalar selector 取 `currentTrackId`（硬规则 #6）。
- **常驻位置**：Now-Playing **顶部**——放进 [`TrackInfoCard`](../../../src/components/player/track-info-card.tsx)（标题/艺人旁）或 stage 顶（[`now-playing-page.tsx:201`](../../../src/pages/now-playing-page.tsx#L201)）。「顶部常驻」= 只要有正在播的曲就显示。移动/桌面同一组件，响应式尺寸。（是否也在 PlayerDock 出一个 mini 版：[Q9](#10-open-questions)，v1 先 Now-Playing。）

### 5.3 LyricsMemoryStrip（新 [`lyrics-memory-strip.tsx`](../../../src/components/player/lyrics-memory-strip.tsx)）—— 歌词模式顶部轮播评论

复刻沉浸 overlay 的顶部单槽轮播，**内嵌歌词容器顶部**且**可交互**：

- **形态**：歌词滚动区顶部一条紧凑玻璃卡（`rounded-2xl bg-background/70 backdrop-blur-md border`），`AnimatePresence mode="wait"` 单槽切换（复用 overlay 的 fade+y+blur）。歌词顶部加渐隐 mask（对齐既有 `EDGE_FADE`）从卡片下方淡出。
- **内容**：`active.note`（fit/clamp）+ 可选小图 + 可选 `atSec` 徽标 + 作者名（`author.displayName` → 「—— 阿强」）。
- **交互（与沉浸 overlay 关键差异）**：卡片 `pointer-events-auto`；点 `atSec` 徽标 → `seek(atSec)`（对齐歌词点行 seek，[Q8](#10-open-questions) 定 YES）。
- **数据**：`const { active, photoUrl } = useScheduledMemory(currentTrackId)`（§4.5）。
- **挂载**：`(settings.lyricsMemoryOverlay ?? true) && 当前曲有 ≥1 memory` 才挂（零成本）。放进 [`SyncedLyricsView`](../../../src/components/player/synced-lyrics-view.tsx#L223) 根返回 `content` 之上（`relative` + strip `absolute top-0 z-10`）→ **所有渲染 `SyncedLyricsView` 的表面自动获得**：桌面右栏（[panel:112](../../../src/components/player/now-playing-panel.tsx#L112)）、移动窄屏（[page:229](../../../src/pages/now-playing-page.tsx#L229)）、沉浸 lyrics（[overlay:52](../../../src/components/player/immersive-lyrics-overlay.tsx#L52)）。
- **避免与 `ImmersiveMemoryOverlay` 重叠**：`SyncedLyricsView` 接 `showMemoryStrip?: boolean`（默认 true）；`ImmersiveLyricsOverlay` 传 `false`（全沉浸态的记忆仍由 App 根既有 overlay 单一来源呈现，[App.tsx:487](../../../src/App.tsx#L487)）。

### 5.4 Settings 可见开关 + 落地 toast

- 「歌词时浮现记忆」开关 `lyricsMemoryOverlay`（默认 on），嵌 [`visualizer-settings.tsx`](../../../src/components/settings/visualizer-settings.tsx) 紧邻 `immersiveMemoryOverlay`。硬规则 #3：可见控件，回滚 = `git revert`。
- `notifyAnnotationAdded` / `notifyRatingAdded`（[`live-request-notification.ts`](../../../src/live-requests/live-request-notification.ts)）：沿用点歌 toast 位，如「阿强评论了《稻香》」「阿强给《稻香》打了 5★（均分 4.3 · 12票）」。**无遥测**（硬规则 #1）。

### 5.5 State Management（硬规则 #6）

- chip / strip 用 `usePlayerStore((s) => currentTrackId)` 标量 selector + `useLiveQuery`（Track / memories 响应式）；调度状态在 hook 局部 `useRef`（不进全局 store）。
- controller 限流计数器、注入 deps：模块作用域单例，非响应式。
- 设置：`useSettings()` 读、`saveSettings()` 写。

---

## 6. Implementation Plan

> Phase 顺序「基础设施先于覆盖广度」：命令路由地基（Phase 1，顺带交付点歌/AI DJ 分流）→ 评分聚合（Phase 2）→ 评论意图（Phase 3）→ 歌词呈现（Phase 4）。前三 phase 无 UI 也能单测 + curl 验证。

### Phase 1: 命令路由地基（交付「点歌搜索 vs AI DJ 分流」）

**Goal:** 弹幕按关键词分流；`点歌`→library-search 快路径、`AI点歌`→ai-dj；关键词可配；legacy 平滑迁移。

**Tasks:**
- [x] 新 [`intake-command.ts`](../../../src/live-requests/intake-command.ts)：`matchIntakeCommand`（最长前缀优先 + rating score / comment 前导 mm:ss 抽取）+ `resolveCommands`。纯函数。
- [x] `types.ts`：`IntakeCommandIntent` / `IntakeCommand` / `DEFAULT_INTAKE_COMMANDS` + `AudienceRequestIntakeSettings.commands?`（非索引可选、无 bump）。
- [x] `resolveCommands(intake)`（放在 `intake-command.ts`，比 sources 更内聚）——`commands` 缺省时由 legacy `commandPrefixes`/`routeMode` 合成 song-search + 补默认 ai-dj/comment/rating。
- [x] `live-request-controller.ts`：`handlePayload` 改 match + dispatch（本 phase 只接 `request` 意图，comment/rating 分支留桩 → Phase 2/3）。request 命令 `routeMode` override 传给 runtime（并用 `command.body` 覆盖 `normalizedQuery`，剥掉新前缀）。
- [x] Settings：命令表编辑器 [`command-table-editor.tsx`](../../../src/components/settings/live-request/command-table-editor.tsx)（每命令关键词 ChipInput + request 命令 route Select）；写 `commands` 时把 legacy `commandPrefixes` 同步到 song-search 行。
- [x] i18n（4 语）：命令表 label（`settings.liveRequestsCommands*` / `liveRequestsCommand.<id>`）。

#### Phase 1 Checklist
- [x] `intake-command.test.ts`（16 例）：最长前缀优先；大小写不敏感；命中返回 command+body(+score/atSec)；未命中 null；disabled 跳过；rating 星标/数字/`9/10`/clamp；comment `mm:ss`/`hh:mm:ss`/无时间；`resolveCommands` legacy 迁移。
- [x] `live-request-controller.test.ts`（+4 router 例）：`点歌 x` → routeMode="library-search"（keyword 覆盖 source ai-dj）；`AI点歌 x` → "ai-dj"；`评论`/`评分` 不进 runtime；no-command fallback 仍走 source override。既有 19 例全绿。
- [ ] 桌面真链路（需 Electron，本环境未起）：`点歌 <库内歌>` 快命中入队、**不**触发 AI 生成；`AI点歌 <vibe>` 进 AI DJ。**留手动验证**。
- [x] controller 不进 store state（grep 仅既有 `getState()` deps）。typecheck exit 0 + biome clean（11 files）+ live-requests/default-settings 116 tests green。

### Phase 2: 评分聚合（交付「常驻评分 chip」）

**Goal:** `评分 5` / 主播点 chip 更新这首曲子的**众评均分（每人一票、去重）**；顶部常驻 chip 实时显示。

**Tasks:**
- [ ] `types.ts`：`Track.ratingsByRater?`（注释：去重/非索引/无 bump/封顶）。
- [ ] `repositories.ts`：`setTrackRating(trackId, raterKey, score)`（clamp[1,5] + 去重覆盖 + 封顶淘汰 + bump updatedAt）。
- [ ] 新 `lib/track-rating.ts`：`resolveTrackRating`（average+count，纯）。
- [ ] `live-request-annotation.ts`：`applyRatingCommand`（raterKey 合成 + setTrackRating + onRated）；controller rating 分支接上 + 注释限流。
- [ ] 新 `track-rating-chip.tsx`：常驻 chip（均分实心星 + 票数；主播点击投 self 票）；挂进 Now-Playing 顶部。
- [ ] R2：**不透传** `ratingsByRater`（评分设备本地，Q6）——确认 R2 Track schema 不含该字段。
- [ ] i18n（4 语）：chip aria / 空态 / rating toast。

#### Phase 2 Checklist
- [ ] `track-rating.test.ts`：空→null；单票；多票均分+count；同 rater 覆盖不加 count；封顶淘汰。
- [ ] `repositories.test.ts`：`setTrackRating` clamp / 去重 / 封顶 / updatedAt bump。
- [ ] `live-request-annotation.test.ts`：`评分 5` 写当前曲 self/观众票；无分数/无当前曲 → ignored；限流。
- [ ] R2 快照断言 `ratingsByRater` **不出现**在 Track manifest（设备本地，Q6）。
- [ ] 真链路：观众 `评分 5` + 主播点 chip → 均分/票数实时变；跨设备同步。typecheck + biome + 测试通过。

### Phase 3: 评论意图（写记忆）

**Goal:** `评论 …` 给当前曲落一条署名、锚秒的 `Memory`；toast 确认；不搜库不播歌。

**Tasks:**
- [ ] `intake-command.ts`：comment 前导 `mm:ss` 时间抽取（→ `match.atSec`）。
- [ ] `live-request-annotation.ts`：`applyAnnotationCommand`（addMemory：note=body、author=发送者、atSec=显式 mm:ss｜否则 floating，clamp 到 [0,durationSec]）；controller comment 分支接上。
- [ ] `ensureSingleton` 注入 `getTrackDurationSec` + `setTrackRating` + `onAnnotated/onRated`。
- [ ] `live-request-notification.ts`：`notifyAnnotationAdded`。
- [ ] i18n（4 语）：comment toast。

#### Phase 3 Checklist
- [ ] `intake-command.test.ts`：comment 前导 `3:14` → atSec 194 + body 剥离；无时间 → atSec undefined（floating）。
- [ ] `live-request-annotation.test.ts`（fake db + canned request）：comment 写 note+author；有显式 mm:ss → 锚秒（clamp）；无 → floating；空 body / 无当前曲 → ignored；限流丢弃。
- [ ] `live-request-controller.test.ts`：`评论 x` 分叉写记忆、**不** runtime.handle；`点歌 x` 仍走 runtime；testing 来源不触发。
- [ ] 真链路：播放中 `评论 …` → 该曲 memory 时间线 + toast。typecheck + biome + 测试通过。

### Phase 4: 歌词记忆浮层 + 收尾

**Goal:** 打开歌词且当前曲有记忆时，顶部像沉浸模式一样轮播评论（锚秒的在对应歌词浮现），可点秒 seek。

**Tasks:**
- [ ] 新 `use-scheduled-memory.ts`：抽自 `ImmersiveMemoryOverlay`；overlay 改用（行为不变，去重）。
- [ ] 新 `lyrics-memory-strip.tsx`：顶部单槽轮播卡（note/atSec/author/photo）；`atSec` 徽标 tap → seek；`pointer-events-auto` 仅卡片。
- [ ] `synced-lyrics-view.tsx`：根顶部挂 strip（`showMemoryStrip?` 默认 true，受 `lyricsMemoryOverlay`）；`ImmersiveLyricsOverlay` 传 `false`；歌词顶部 mask/padding 兜底。
- [ ] Settings：`lyricsMemoryOverlay` 可见开关（visualizer 区）。
- [ ] i18n（4 语）全量补齐；版本 bump + changelog（4 语）。

#### Phase 4 Checklist
- [ ] `use-scheduled-memory` 复用后 immersive overlay 既有测试/动效不回归。
- [ ] `lyrics-memory-strip.test.tsx`：有记忆渲染卡；无记忆不渲染；`atSec` 徽标点击 seek；`showMemoryStrip={false}` 不渲染；三表面挂载正确、沉浸不双卡。
- [ ] `lyricsMemoryOverlay=false` → strip 全表面不出现。
- [ ] i18n 四语全量、无 pending。
- [ ] 真窗预览（`make dev`/`make desktop`）：歌词顶部轮播、锚秒浮现、tap-seek、reduced-motion。（Claude Preview hidden-tab 冻结 rAF/idle，见 [[preview-hidden-tab-gotcha]]，以真前台为准。）
- [ ] typecheck + biome + 全测试通过 + 版本 bump。

---

## 7. Out of Scope

- **in-app DJ chat 里拦截前缀 fast-path**：chat 已有 LLM 工具；确定性关键词只落 live-requests 通道。
- **per-source 命令表覆盖**：v1 命令表全局；per-source（`AudienceRequestSource`）覆盖留 v2。
- **评分跨设备同步 / 多设备票合并 / 加权 / 时间衰减 / 直方图**：v1 `ratingsByRater` 均分 + 票数，**设备本地、不进 R2**（[Q6](#10-open-questions)）；跨设备票聚合留 v2。
- **评论审核 / 敏感词过滤 / 拉黑**：靠限流 + 署名可见；审核看板不做（与点歌 Q4 一致）。
- **每曲观众记忆上限 / 自动清理旧评论**：靠 dedupe/cooldown/rate-limit 控量；per-track 上限留 follow-up。
- **`atSec` 的 DB 索引 / 全库时间点检索**：沿用 immersive PRD 结论，内存匹配即可。
- **PlayerDock mini 评分 chip**：v1 只 Now-Playing 顶部（[Q9](#10-open-questions)）。
- **富媒体评论（图/sticker）**：弹幕通道 v1 纯文本；`addMemory` 虽支持 photo，本期不接收。
- **非沉浸右栏「lyrics + memory rail 同屏」重排**：右栏仍 toggle；本 PRD 只在歌词内加顶部 strip。

---

## 8. Security & Privacy Considerations

- **本地优先不变**（硬规则 #1）：评论/评分/署名/命令表全存设备本地 IndexedDB；唯一出站是用户配置的 R2（记忆已在 manifest，`ratingsByRater` 同等隐私级——一组数字）。无 MUZERO 后端、无遥测。
- **观众文本 untrusted**：与点歌 query 同款——React 转义防注入；喂 DJ 上下文按不可信处理（沿用 [`audience-request-ai-dj.ts`](../../../src/live-requests/audience-request-ai-dj.ts) 声明）。`applyAnnotation/Rating` 只写数据、不执行。
- **署名隐私**：`author.displayName`/`raterKey` 用弹幕昵称/合成 `audience:<key>`，**不落**真实身份/IP/token（脱敏 `stripSensitiveFields` 已剥 key/token）。
- **无 hidden flag**（硬规则 #3）：命令表、评分 chip、歌词浮层开关都是可见 Settings；回滚 = `git revert`。
- **codename 稳定**（硬规则 #4）：表名/id 前缀/字段名（`ratingsByRater`）/命令 `id` 跨品牌/壳不变；已发布命令 id 禁改。
- **滥用防护**：注释/评分限流（复用 security 纯函数）；评分 `ratingsByRater` 天然去重防刷票；空/无当前曲静默丢弃；点歌沿用既有去重/冷却/限流。
- **无密钥牵涉**（硬规则 #2）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260616-muzero-live-chat-song-request-prd`](../20260616-muzero-live-chat-song-request-prd/20260616-muzero-live-chat-song-request-prd.md) | 「点歌」通用 intake（命令前缀 / 多来源 / testing→active / SSN / runtime routeMode override）——本 PRD 泛化其 routing |
| [`20260610-muzero-immersive-memory-moments-prd`](../20260610-muzero-immersive-memory-moments-prd/20260610-muzero-immersive-memory-moments-prd.md) | `Memory.atSec` + 沉浸顶部记忆浮层 + `scheduleImmersiveMemory`——本 PRD 复用调度 + 抽 `useScheduledMemory` |
| [`live-request-controller.ts`](../../../src/live-requests/live-request-controller.ts) / [`audience-request-runtime.ts`](../../../src/live-requests/audience-request-runtime.ts) | match+dispatch 插入点 + 每调用 routeMode override |
| [`immersive-memory-overlay.tsx`](../../../src/components/player/immersive-memory-overlay.tsx) / [`synced-lyrics-view.tsx`](../../../src/components/player/synced-lyrics-view.tsx) | 复用样式/调度 + strip 挂载点 |
| [`DjSession.trackRanks`](../../../src/db/types.ts#L493) | `Record` 型附加字段先例（`ratingsByRater` 参照，无 bump） |
| `CLAUDE.md` 硬规则 #1/#2/#3/#4/#6/#7 | 本地优先 / BYOK / 无 flag / codename / selector / 续歌单测纪律 |

---

## 10. Open Questions

| # | Question | Status | Recommended Decision |
|---|----------|--------|----------------------|
| 1 | 意图路由落哪条通道？ | ✅ Resolved | **live-requests 命令前缀通道**（= 点歌），与「用户发关键词、各功能可配」心智一致；in-app chat 已有 LLM 工具，不重复（§1.2）。 |
| 2 | 点歌 vs AI DJ 怎么区分？ | ✅ Resolved（PM） | **不同关键词 → 不同 `routeMode`**：`点歌`→library-search（快路径，不过 AI），`AI点歌`/`DJ`/`生成`→ai-dj。用可配命令表（§3.2），复用 runtime 每调用 override（零改动）。 |
| 3 | `点歌`（library-search）还保留联网兜底吗？ | ✅ Recommended | **保留**：库内搜不到时低置信度联网兜底（既有 `onlineFallbackOnLowConfidence`，轻量），但**不触发 AI DJ 生成**。AI 生成只由 `ai-dj` 命令走。 |
| 4 | 评分数据模型？ | ✅ Resolved（PM） | **众评均分（去重）**：`Track.ratingsByRater`（raterKey→score），每人一票、同人再投覆盖；chip 显均分实心星 + 票数。主播点击=`self` 票。追加非索引字段、无 bump。 |
| 5 | 评论 vs 评分是否都是 Memory？ | ✅ Resolved | **分开**：评论=Memory（卡片/轮播/DJ/同步）；评分=Track 级聚合（chip，不刷屏记忆时间线）。 |
| 6 | 评分是否跨设备同步？ | ✅ Resolved（PM） | **不跨设备**：`ratingsByRater` 设备本地、**不进 R2 manifest**。省掉多设备票合并；评论（Memory）照常同步。 |
| 7 | 评分刻度 + 10 分制？ | ✅ Resolved（PM） | **1–5 星**；解析器兼容星标；`评分 9/10` **不归一、直接 clamp 到 5**；`Math.round`。 |
| 8 | chip 空态 & 歌词 strip 交互？ | ✅ Recommended | chip 无票 → 显五空心星（可点投第一票）；strip 的 `atSec` 徽标**可点 seek**（歌词表面本可交互），沉浸内 strip 关闭交给既有 overlay。 |
| 9 | 评分 chip 是否也进 PlayerDock？ | ✅ Resolved（PM） | **不进 Dock**：只在 Now-Playing 顶部（`TrackInfoCard`/stage 顶）常驻。 |
| 10 | comment 是否锚到当下秒（`atSec`）？ | ✅ Resolved（PM） | **默认不锚（floating 轮播）**：直播有延迟，按弹幕到达时间/当前播放秒锚不准。**仅当观众显式写 `mm:ss`**（如 `评论 3:14 …`）才锚到该秒（clamp 到 [0,durationSec]），在歌词对应处浮现。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-04 | MUZERO (DoodleBear) | Initial draft —— 弹幕注释指令（评分/评论）延伸「点歌」命令前缀通道；歌词模式顶部记忆轮播复用沉浸调度。 |
| 2026-07-04 | MUZERO (DoodleBear) | **大改（PM 反馈）**：把「点歌」通道泛化为**可配置关键词→意图路由表**（`点歌`=library-search 快路径 / `AI点歌`=ai-dj / `评论`=记忆 / `评分`=评分，各自可配关键词），修掉「开 AI 后点歌全过 AI」效率问题（复用 runtime 每调用 routeMode override，零改动）。评分从「Memory.rating」改为 **Track 级众评均分（`ratingsByRater`，每人一票去重）+ 顶部常驻评分 chip**（Q4 定稿）；评论仍为 Memory。四 phase 重排（命令路由 → 评分 → 评论 → 歌词浮层）。Q2/Q4/Q7 由 PM 定稿，Q6/Q9 待确认。 |
| 2026-07-05 | MUZERO (DoodleBear) | 定稿 Q6/Q9/Q10（PM）：评分**不跨设备**（`ratingsByRater` 设备本地、不进 R2）；评分 chip **不进 Dock**（只 Now-Playing 顶部）；评论**默认 floating 轮播**、因直播延迟不自动按到达秒锚，**仅观众显式 `mm:ss`（如 `评论 3:14`）才锚**——`matchIntakeCommand` 加 comment 前导时间抽取、去掉 `getCurrentPositionSec` 注入。 |

---

> **Note:** 本 PRD 遵循「改既有、少新建」：净新增仅 `intake-command.ts`（新路由纯逻辑）、`live-request-annotation.ts`（新注入式 handler）、`track-rating.ts`（新纯聚合）、`track-rating-chip.tsx` + `lyrics-memory-strip.tsx`（新呈现表面）、`use-scheduled-memory.ts`（抽出共用去重）。**runtime / 路由器 / 搜库 / 安全全不动**——点歌/AI DJ 分流只靠既有「每调用 routeMode override」。`ratingsByRater`（设备本地、不进 R2）/ 命令表 / `lyricsMemoryOverlay` 全走「非索引可选、无 schema bump」路径（`trackRanks`/`atSec` 同款），迁移成本≈零；四类意图同一条弹幕、同一个 `handlePayload`，是真正的延伸与结合。
