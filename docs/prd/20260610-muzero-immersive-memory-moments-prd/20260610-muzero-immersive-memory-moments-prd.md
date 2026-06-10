# PRD: Immersive Memory Moments — Timestamp-Anchored Memories + Full-Immersive Memory Overlay

**Status:** Draft
**Created:** 2026-06-10
**Author:** MUZERO (DoodleBear)
**Module:** Now-Playing / Memory（音乐承载回忆）— 沉浸式记忆浮现

---

> **一句话（PM 口径）**：让「记忆」可选地钉在歌曲的某一秒（如 1:38）。当用户进入「全沉浸」模式（只剩频谱 + 背景，前台 UI 全部隐去、连记忆轮播 rail 也消失）时，记忆改以**顶部 popover/tooltip 的氛围浮层**出现：到点的「钉秒记忆」按时浮现（同一秒多条则随机挑一条），没钉秒的记忆在空闲秒数里补位；每条按**内容长度动态决定停留时长**，一条放完才放下一条。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Timestamp foundation（`Memory.atSec` 数据层 + repo + 同步） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Capture & display the anchor（编辑器钉秒 + 列表/轮播徽标） | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Immersive memory overlay（沉浸浮层 + 调度引擎 + 设置开关） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 的核心价值之一是「**音乐承载回忆**」：每首歌可以挂多条 `Memory`（一对多：note + 可选照片 + 作者快照 + 时间）。今天这些记忆在 Now-Playing 右栏的 **memory carousel rail**（[`memory-timeline-rail.tsx`](src/components/player/memory-timeline-rail.tsx)）里轮播展示，时长已按内容长度动态计算（[`memoryTimelineCarouselIntervalMs`](src/lib/memory-timeline.ts) — base 5s + 80ms/字，封顶 14s）。

但 Now-Playing 支持**全沉浸模式**：当 `visualizerAsBackground` + `visualizerIdleOnly` 开启且用户进入 idle 时，`foregroundHidden` 把整个前台（封面、信息卡、**记忆 rail**）淡出，只留背景 + 频谱（[`App.tsx:124-134`](src/App.tsx)）。这正是用户最「沉进音乐」的时刻——却也恰恰看不到任何记忆了。记忆轮播在用户最该被回忆击中的时候消失了。

两个产品缺口：

1. **记忆没有「时间感」**：`Memory` 只有 `createdAt`（写下的时刻），无法表达「这句歌词、这一秒对我意味着什么」。记忆与歌曲的*时间轴*是脱钩的。
2. **全沉浸模式下记忆缺席**：rail 被 `foregroundHidden` 隐去后，桌面右栏 / 移动端都没有任何记忆呈现面。

本 PRD 同时补这两块：给 `Memory` 加**可选时间戳 `atSec`**，并新建一个**沉浸式记忆浮层**，在「只剩频谱 + 背景」的时刻把记忆以氛围化的方式带回来。

### 1.2 Target Users

| Role | Description | Key interaction |
|------|-------------|-----------------|
| **回忆型听众（主）** | 把歌当回忆容器：给某首歌的某一秒写下「这里副歌一进来就想起那年夏天」 | 播放时一键把记忆钉到当前秒；全沉浸时被记忆「击中」 |
| **沉浸聆听者** | 喜欢全沉浸（只看频谱 + 背景）发呆/工作的人 | 被动接收顶部氛围浮层，零操作；任意交互即退出沉浸 |
| **策展人 / 分享者** | 维护歌单、跨设备 R2 同步记忆 | 钉秒记忆通过 manifest 同步到其他设备/分享对象 |

### 1.3 Core Value

1. **记忆获得时间轴**：`atSec` 让记忆从「歌级注释」升级为「歌曲时间线上的标记」，为未来的歌词联动、波形标记、chat 工具（`add_memory(atSec)`）打地基。
2. **沉浸不等于失忆**：全沉浸模式下记忆以顶部 popover 浮层回归，用户在最投入的时刻被回忆触达——强化「音乐承载回忆」的情绪内核。
3. **复用既有节奏学**：动态时长直接复用已单测的 `memoryTimelineCarouselIntervalMs`，浮层是新表面但调度是同一套可测纯函数，不重复造轮子。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                     ┌─────────────────────────────────────────────┐
                     │  Memory（一对多挂在 Track 上）                 │
                     │  + atSec?: number  ← 本 PRD 新增（可选，非索引）│
                     └───────────────┬─────────────────────────────┘
                                     │ db.memories.where("trackId")  (useLiveQuery)
                                     ▼
   ┌─────────────────────┐   ┌───────────────────────────────────────────┐
   │ Memory editor        │   │  当前曲的 memories[]（含 atSec 与无 atSec）  │
   │ (composer)           │   └───────────────┬───────────────────────────┘
   │  + 「钉到当前秒」chip  │                   │
   │    captures          │        ┌──────────┴───────────┐
   │    positionSec       │        ▼                      ▼
   └─────────────────────┘  非沉浸：右栏 rail         全沉浸：ImmersiveMemoryOverlay（新）
                            （已有，不变）            顶部 popover，单槽位
                                                          │ tick(nowMs, positionSec)
                                                          ▼
                                          ┌───────────────────────────────────┐
                                          │ scheduleImmersiveMemory()（纯函数） │
                                          │  · anchored 优先：到秒触发(随机平手) │
                                          │  · floating 补位：空闲秒数轮播      │
                                          │  · 动态时长：memoryDisplayDuration  │
                                          │    Ms()（rail+浮层统一，Q5）        │
                                          │  · 双 lane：锚点抢占 floating / 同 │
                                          │    lane 顺序 / 放完才下一条          │
                                          └───────────────────────────────────┘
   触发条件：App.tsx 的 visualizerIdleOnly === true（前台+rail 已隐）
   positionSec 来源：usePlayerStore((s) => s.positionSec)（标量 selector）
```

### 2.2 Technology Stack

复用既有栈，**不引入任何新依赖**：

| Concern | Technology | Rationale |
|---------|------------|-----------|
| 持久化 | Dexie 4 / IndexedDB `muzero-db` | `atSec` 为**非索引可选字段 → 无需 version bump**（沿用 `Track.coverThumbhash` 先例，[`types.ts:78-84`](src/db/types.ts)） |
| 响应式读 | Dexie `useLiveQuery` | 当前曲 memories 已在 [`now-playing-panel.tsx:46`](src/components/player/now-playing-panel.tsx) 这样读，浮层同模式读取 |
| 播放位置 | Zustand `usePlayerStore((s) => s.positionSec)` | 最小标量 selector（硬规则 #6）；store 由 `MediaEngine` 的 `timeupdate` 回填，~4–10Hz，足够秒级锚定 |
| 调度 | 纯 TS 函数 + Vitest | 注入 `nowMs` / `positionSec` / `rng`，确定性单测（硬规则 #7 的纪律） |
| 动画 | `motion/react`（已用） | 复用 rail slide 的 blur/scale/fade；`MotionConfig reducedMotion="user"` 全局生效 |
| 同步 | 既有 R2 manifest（Zod schema） | `atSec` 加进 `r2MemorySchema`（可选，向后兼容） |

### 2.3 Project Structure（变更面）

```
src/
├── db/
│   ├── types.ts                         # ✏ Memory.atSec?; AppSettings.immersiveMemoryOverlay?
│   └── repositories.ts                  # ✏ addMemory(atSec); updateMemory(patch); 可选 setMemoryTimestamp
├── lib/
│   ├── memory-timeline.ts               # ✏ 抽出统一 memoryDisplayDurationMs（rail + 浮层共用，Q5）
│   └── immersive-memory-schedule.ts     # ✨ 新：纯调度状态机（双 lane 抢占，消费统一时长函数）
│   └── immersive-memory-schedule.test.ts# ✨ 新：穷举单测
├── components/
│   ├── player/
│   │   ├── immersive-memory-overlay.tsx # ✨ 新：顶部 popover 浮层（仅沉浸时挂载）
│   │   └── memory-timeline-rail.tsx     # ✏ 轮播 slide 显示 atSec 徽标
│   └── track/
│       ├── memory-note-composer.tsx     # ✏ 「钉到当前秒」chip + 可编辑 mm:ss + 清除
│       └── memory-notes-waterfall.tsx   # ✏ masonry 卡片显示 atSec 徽标
├── sync/
│   ├── r2-manifest-schema.ts            # ✏ r2MemorySchema += atSec
│   ├── r2-export-plan.ts                # ✏ toRemoteMemory 透传 atSec
│   └── r2-import-stream.ts              # ✏ import 映射透传 atSec
├── pages/now-playing-page.tsx           # ✏ 在 foreground-hidden 之外挂 ImmersiveMemoryOverlay
├── components/settings/…                # ✏ 「沉浸时浮现记忆」可见开关（硬规则 #3）
└── i18n/locales/{en,zh,ja,ko}/common.json # ✏ composer/徽标/设置/aria 文案
```

> **新文件理由（模板 Exception Policy）**：`immersive-memory-schedule.ts` 是一套全新的、与既有 rail 轮播不同的调度逻辑（锚定 + 补位 + 抢占/陈旧丢弃），必须可被穷举单测，故独立成纯 lib；`immersive-memory-overlay.tsx` 是一个**新的呈现表面**（顶部氛围浮层 ≠ 右栏 rail），placement / 动画 / 挂载条件都不同。二者共享 `memory-timeline.ts` 的时长数学，不复制。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
Track ──1:N──▶ Memory { id, trackId, note, photoBlobId?, author?, createdAt, atSec? }
                                                                          └─ 新增：可选锚点秒
                                                                             · 有值 = anchored（钉在 atSec）
                                                                             · 无值 = floating（空闲补位）
```

### 3.2 Database Schema

> ⚠️ 优先改既有结构，避免大重构。

- **Current Schema**：[`src/db/types.ts`](src/db/types.ts) `Memory`（114–127 行）；Dexie store 在 [`src/db/muzero-db.ts`](src/db/muzero-db.ts) `version(4)`：`memories: "id, trackId, createdAt, [trackId+createdAt]"`，当前最高 `version(19)`。

- **Required Changes**：给 `Memory` 增加一个可选字段：

  ```ts
  export interface Memory {
    id: string;
    trackId: string;
    note: string;
    photoBlobId?: string;
    remotePhotoUrl?: string;
    author?: MemoryAuthorRef;
    createdAt: number;
    /**
     * 可选锚点：这条记忆钉在歌曲的第几秒（用户在播放时「钉到当前秒」）。
     * 缺省 = 未钉秒（floating，空闲补位）。clamp 到 [0, track.durationSec]。
     * 非索引可选字段 → 加它不需要 Dexie version bump（同 coverThumbhash 先例）。
     */
    atSec?: number;
  }
  ```

- **Data Migration — 不需要**：`atSec` 是 **非索引可选属性**，IndexedDB 行天然向前兼容（旧记忆读出来 `atSec === undefined` = floating）。这和 [`Track.coverThumbhash`](src/db/types.ts) 的注释一致：「Non-indexed → additive, no schema bump」。**本期不 bump version、不写 upgrade。**

- **Indexing — 本期不加索引（有意）**：沉浸浮层只对**当前曲**的一小撮 memories（通常个位数）工作，已经通过 `useLiveQuery` 一次性载入内存，按秒匹配在 JS 里做即可，**无需** DB 端 `atSec` 范围查询。若未来要做「全库按时间点检索记忆」再开 `version(20)` 加 `atSec` 索引（届时 Dexie 稀疏索引正好只索引有值的记忆）。列入 [Out of Scope](#7-out-of-scope)。

- **Validation / Invariants**：写入前 `atSec` clamp 到 `[0, track.durationSec]`；UI 捕获以**整秒**为粒度（存 number，允许将来细化）。空字符串/NaN → 落为 `undefined`（floating）。

- **Privacy & Retention**：`atSec` 是非 PII 的数字；记忆 note/photo 的隐私边界不变（设备本地，仅经用户配置的 R2 出站）。见 [§8](#8-security--privacy-considerations)。

### 3.3 Sync（R2 manifest）— 必须显式透传

记忆在 manifest 里是**逐字段序列化**（不是整对象 spread），所以 `atSec` 要在 3 处显式带上，否则同步会丢：

| File | 位置 | 改动 |
|------|------|------|
| [`src/sync/r2-manifest-schema.ts`](src/sync/r2-manifest-schema.ts) | `r2MemorySchema`（94–96 行附近） | `+ atSec: z.number().optional()` |
| [`src/sync/r2-export-plan.ts`](src/sync/r2-export-plan.ts) | `toRemoteMemory`（312–323 行） | 返回对象 `+ atSec: memory.atSec` |
| [`src/sync/r2-import-stream.ts`](src/sync/r2-import-stream.ts) | memories 映射（100–108 行） | `+ atSec: memory.atSec` |

向后兼容：老 manifest 没有 `atSec` → Zod `.optional()` 解析为 `undefined`（floating），不报错。

### 3.4 Data Relationship Diagram

```
PlayQueue.currentIndex → Track(currentTrackId) ──1:N──▶ Memory[]
                              │                              ├─ anchored: atSec ∈ [0, durationSec]
   positionSec (player-store) ┘  对齐                        └─ floating: atSec == null
                              ▼
              scheduleImmersiveMemory(state, { nowMs, positionSec, memories, rng })
                              ▼
                  active memory id → ImmersiveMemoryOverlay 渲染单槽位
```

---

## 4. Engine & Repository API

> 本 App 无后端；此节描述等价的「内部 API」：repo 函数与调度纯函数契约。优先改既有 [`src/db/repositories.ts`](src/db/repositories.ts)，避免大改。

### 4.1 Repository changes（[`repositories.ts`](src/db/repositories.ts) memories 段，822–927 行）

```ts
// addMemory：input 增加可选 atSec，透传写入
export async function addMemory(
  input: {
    trackId: string;
    note: string;
    author?: MemoryAuthorRef;
    photo?: { blob: Blob; mime: string };
    createdAt?: number;
    atSec?: number;            // ← 新增；写入前由调用方 clamp 到 [0, durationSec]
  },
  db = defaultDb,
): Promise<Memory>             // memory.atSec = input.atSec

// 用一个通用 patch 取代/补充 updateMemoryNote，支持改 note 与 atSec
// （atSec === null 显式清除锚点 → floating；undefined = 不动）
export async function updateMemory(
  id: string,
  patch: { note?: string; atSec?: number | null },
  db = defaultDb,
): Promise<void>
```

- 保留既有 `updateMemoryNote(id, note)` 不破坏调用方，或让其内部转调 `updateMemory(id, { note })`。
- `deleteMemory` / `getMemoryPhoto` / `memoryNotesByTrack` / `listMemories` **不变**（`atSec` 对它们透明；DJ 上下文与搜索仍只吃 `note` 文本，不吃时间戳）。

### 4.2 Scheduler contract（新 [`src/lib/immersive-memory-schedule.ts`](src/lib/immersive-memory-schedule.ts)）

纯函数 + 状态机，由浮层组件每个 tick（rAF 或 ~250ms interval）驱动；`nowMs` / `positionSec` / `rng` 注入以便确定性单测。

```ts
export interface ImmersiveMemoryInput {
  id: string;
  note: string;
  hasPhoto: boolean;
  atSec?: number;            // 有值 = anchored
}

export interface ImmersiveMemoryState {
  showing: { id: string; startedAtMs: number; endsAtMs: number } | null;
  firedAnchorIds: string[];  // 本「正放」轮已触发的锚点（防重复触发）
  floatingCursor: number;    // floating 池轮播游标
  lastPositionSec: number;
}

export interface ImmersiveMemoryTick {
  nowMs: number;             // 注入（运行时 Date.now()）
  positionSec: number;       // usePlayerStore.getState().positionSec
  isPlaying: boolean;
  memories: ImmersiveMemoryInput[];
  rng?: () => number;        // 默认 Math.random；同秒多锚随机平手用
}

export interface ImmersiveMemoryResult {
  state: ImmersiveMemoryState;
  activeId: string | null;   // 当前该渲染的记忆（null = 顶部留白，只剩频谱）
}

export function scheduleImmersiveMemory(
  state: ImmersiveMemoryState,
  tick: ImmersiveMemoryTick,
): ImmersiveMemoryResult;
```

**算法（按 tick 求值，单槽位、严格顺序）：**

1. **Re-arm（回放/seek 倒带/loop）**：`positionSec < lastPositionSec - ε` → 清空 `firedAnchorIds`（锚点重新待命）。
2. **锚点跨越检测**：取所有 anchored 且 `atSec ∈ (lastPositionSec, positionSec]` 且不在 `firedAnchorIds` 的记忆 = 本 tick 新到点者。
   - **同秒多条 → `rng` 随机挑一条**作为待显示候选（req #2）；其余同秒锚点也标记 fired（避免它们随后逐条迟显）。
3. **当前是否放完**：`showing && nowMs >= showing.endsAtMs` → `showing = null`。
4. **优先级抢占（best practice，双 lane — Q1 定稿）**：
   - **anchored 抢占 floating**：有新到点锚点（未陈旧 `positionSec - atSec <= ANCHOR_STALE_SEC`，默认 ~6s）且当前 `showing` 是 floating → **抢占**，但先满足 `MIN_SHOW_MS`（~2s 最短展示防闪烁），以交叉淡出切到锚点。
   - **anchored 不抢占 anchored**：当前 `showing` 已是锚点 → 新锚点排队，待其满时长后再显（仍未陈旧才显，否则丢弃）。
   - **floating 永不抢占**：floating 只在槽位空闲时补位；floating↔floating 严格顺序。
5. **槽位空闲时填充**（同 lane：放完才下一条）：
   - a. 有未陈旧锚点候选 → 显示之；陈旧的丢弃（迟到太多不如不放）。
   - b. 否则 floating 池非空 → 显示 `floating[floatingCursor]`，游标 +1 循环（复用 [`nextIdleMemoryIndex`](src/lib/memory-timeline.ts) 思路）。
   - c. 否则 `activeId = null`（顶部留白，只剩频谱）。
   - 显示时 `endsAtMs = nowMs + memoryDisplayDurationMs(memory)`（统一时长，见 §4.3）。
6. **暂停**：`!isPlaying` → 冻结（不推进 floating、不到期 `showing`、不触发抢占；paused 时长顺延 `endsAtMs`）。记忆不会在暂停时凭空消失。
7. `lastPositionSec = positionSec`。

**设计取舍（best practice 定稿，Q1）**：两条优先级 lane——锚点是**时间敏感的「此刻」cue，应抢占 floating 填充物**（否则钉秒就失去意义），但用 `MIN_SHOW_MS` 最短展示 + 交叉淡出避免闪烁/突兀；**同 lane 严格顺序**（floating↔floating、anchored↔anchored 都「放完才下一条」，忠实 req #3）。`ANCHOR_STALE_SEC` 兜底：被另一锚点挡住而迟到过久的锚点直接丢弃，保证锚点「准点或不放」。常量（`MIN_SHOW_MS` / `ANCHOR_STALE_SEC` / 时长上下限）集中在 §4.3 统一时长方案里，纯常量微调、无 flag。

### 4.3 Unified display duration（Q5 — 抽一个，两处共用）

把 rail 现有的「按字数算时长」提升为**单一规范函数**，rail 与沉浸浮层都消费它，保证两个表面节奏一致：

```ts
// src/lib/memory-timeline.ts —— 由现有 memoryTimelineCarouselIntervalMs 提升而来
export function memoryDisplayDurationMs(
  m: { note: string; hasPhoto?: boolean },
  opts?: {
    baseMs?: number;        // 默认 5000
    msPerCharacter?: number;// 默认 80（超过 ~48 可读字后每字 +80ms）
    photoBonusMs?: number;  // 默认 ~2000（有图多停留，给眼睛看图）
    maxMs?: number;         // 默认 14000（有图可略放宽上限）
  },
): number;
```

- **来源**：直接吸收 [`memoryTimelineCarouselIntervalMs`](src/lib/memory-timeline.ts)（base 5s + 80ms/可读字、封顶 14s）的算法，新增 `photoBonusMs`。
- **统一消费**：[`memory-timeline-rail.tsx`](src/components/player/memory-timeline-rail.tsx) 改为调用它（行为等价，多了 photo 加成）；`immersive-memory-schedule.ts` 调用它算 `endsAtMs`。
- **去重**：`memoryTimelineCarouselIntervalMs` 保留为薄 alias 或就地替换并更新调用点——**只一处定义时长曲线**。
- **统一常量**：`MIN_SHOW_MS`（最短展示，防抢占闪烁）、`ANCHOR_STALE_SEC`（锚点陈旧丢弃阈值）与时长上下限并列导出于此，便于一处微调（纯常量，硬规则 #3：不藏 flag）。

### 4.4 Error / Edge handling

| 场景 | 行为 |
|------|------|
| 当前曲无记忆 / 无 anchored | 浮层不渲染任何卡片（顶部纯净，只剩频谱）；无开销 |
| 仅 anchored 无 floating | 空闲秒数留白，仅锚点到点时浮现 |
| 仅 floating 无 anchored | 退化为「顶部版轮播」：动态时长顺序轮播（行为同既有 rail，位置不同） |
| seek 大幅前跳，跨过多个锚点 | 这些锚点视为「错过」，不补放（避免一次性炸出一串）；仅标记 fired |
| loop / repeat-one 回到开头 | re-arm，锚点重新待命 |
| reduced-motion | 去掉 blur/scale，只做不透明度淡入淡出（或瞬切） |
| 退出沉浸（鼠标动） | 浮层随 `visualizerIdleOnly` 转 false 而卸载/淡出；状态保留以便回到沉浸续放 |

---

## 5. Frontend Design

### 5.1 Page Structure

```
NowPlayingPage（src/pages/now-playing-page.tsx）
├── <foreground wrapper>  ← foregroundHidden 时 opacity-0/pointer-events-none（既有，含右栏 rail）
│   ├── SwipeableMediaStage / TrackInfoCard / Transport / AnnotationEditor …
│   └── NowPlayingPanel → (collapsed) MemoryTimelineRail   ← 非沉浸时的记忆面（不变）
└── <ImmersiveMemoryOverlay/>  ✨ 在 foreground wrapper 之外，仅当 visualizerIdleOnly 时可见
```

App 层已算出 `visualizerIdleOnly` / `foregroundHidden`（[`App.tsx:129-134`](src/App.tsx)）。把触发信号透传给 `NowPlayingPage`（或直接在 App 里作为背景的 sibling 挂浮层，z 介于背景/频谱与 header/dock 之间）。**浮层绝不能放进会被淡出的 foreground 容器内**。

### 5.2 UI Components

**(a) `MemoryNoteComposer`（[`memory-note-composer.tsx`](src/components/track/memory-note-composer.tsx)）— 捕获锚点**
- 新增 props：`currentPositionSec?: number`（由父级从 player-store 传入）、`initialAtSec?: number`；`onSubmit(note, atSec?)`。
- UI：note 输入旁一个**「📍 钉到 mm:ss」chip**——点亮即把当前 `positionSec` 写入 `atSec`；再点取消（floating）。已钉时显示可编辑的 `mm:ss`（复用既有时间格式化，如进度条的 `formatTime`）+ 清除按钮。
- 组件保持「纯展示 + 回调」，不直接订阅 store（父级注入当前秒），符合既有形态。

**(b) `MemoryNotesWaterfall`（[`memory-notes-waterfall.tsx`](src/components/track/memory-notes-waterfall.tsx)）& 轮播 slide（[`memory-timeline-rail.tsx`](src/components/player/memory-timeline-rail.tsx)）— 显示锚点**
- 有 `atSec` 的卡片显示一个小**时间徽标「1:38」**（置于 `createdAt` 旁）。
- **点「时间徽标」seek 到该秒**（Q2 定稿）；**点卡片本身不跳转**（卡片点击仍归编辑/展开等既有行为）。徽标做成可点 chip（`cursor-pointer` + hover 态 + `stopPropagation`，避免冒泡到卡片），是唯一的 seek affordance。

**(c) `ImmersiveMemoryOverlay`（新）— 沉浸浮层**
- **形态**：顶部居中的 popover/tooltip 风格玻璃卡（req #2「顶部 popover tooltip 感觉」）。圆角、半透明 `bg-background/80 backdrop-blur`、细边、轻阴影；`max-w` 受限，**安全区顶 inset**（`pt-[env(safe-area-inset-top)]` / `--spacing-chrome-top`）；不挡中央频谱。
- **内容**：note（fit/clamp 防溢出，复用 [`resolveMemoryFitText`](src/lib/memory-fit-text.ts)）+ 可选小图 + 可选 `atSec` 徽标（此处**仅展示**，不可点——见下「被动」）。
- **动画**：复用 rail slide 的进/出（fade + 轻微 y/scale/blur，`motion/react`），`AnimatePresence` 单槽位切换；**锚点抢占 floating 时做交叉淡出（不硬切）**；reduced-motion 退化为纯淡入淡出。
- **被动**：`pointer-events-none`（纯氛围；任何指针/键盘活动都会先让 `idle` 转 false → 退出沉浸 → 浮层淡出，回到可交互的 rail）。故浮层内的徽标不承载 seek（seek 交给非沉浸的 rail/waterfall 徽标）。
- **挂载条件**：`visualizerIdleOnly && currentTrack && (settings.immersiveMemoryOverlay ?? true)`；不满足时整组件不挂载（零成本）。

**(d) Settings 可见开关（硬规则 #3）**
- 在「外观 / Now-Playing / 可视化」设置区加一项 **"Show memories in immersive mode"（沉浸时浮现记忆）**，绑 `AppSettings.immersiveMemoryOverlay`（默认 `true`）。回滚靠 `git revert`，不藏 flag。

### 5.3 State Management

- **位置来源**：浮层用 `usePlayerStore((s) => s.positionSec)` + `s.isPlaying` 两个标量 selector；`memories` 用 `useLiveQuery`（同 now-playing-panel）。
- **调度状态**：放在浮层组件局部 `useRef`（`ImmersiveMemoryState`）+ 一个 tick（rAF/interval）；**不进全局 store**（硬规则 #6：非响应式编排状态留模块/局部作用域，避免波及全树重渲染）。`activeId` 仅驱动浮层自身 `useState`。
- **tick 节流**：~200–300ms 或 rAF；浮层未挂载时无 tick。频谱的 rAF 不受影响（各自独立）。

---

## 6. Implementation Plan

### Phase 1: Timestamp foundation

**Goal:** 让 `Memory` 能可选地存秒，并端到端（含 R2 同步）保真，纯数据层先行、零 UI。

**Tasks:**
- [x] `Memory.atSec?: number` 加进 [`types.ts`](src/db/types.ts)（含注释：可选/非索引/clamp 规则）。
- [x] `addMemory` input 加 `atSec` 并透传（`sanitizeAtSec`：负/非有限 → undefined）；新增 `updateMemory(id, { note?, atSec? | null })`，`updateMemoryNote` 转调它。
- [x] R2 同步三处透传：`r2MemorySchema`（`+ atSec?`）/ `toRemoteMemory` / import 映射。
- [x] 确认**不需要** Dexie bump（types.ts 注释固化决定，引用 coverThumbhash 先例）。

### Phase 1 Checklist

- [x] `repositories.test.ts`：`addMemory({atSec})` 往返；`updateMemory` 改秒/清秒（`atSec: null` → undefined）；`updateMemoryNote` 保留 atSec。
- [x] `r2-export-plan.test.ts` / `r2-import-stream.test.ts` / `r2-manifest-schema.test.ts`：含 `atSec` 的记忆导出→导入→schema 解析保真；`.optional()` 让老 manifest（无字段）解析为 floating 不报错。
- [x] sanitize 行为（负值/NaN → undefined）有断言；上界 clamp 归调用方（repo 不知 durationSec）。
- [x] typecheck（full, green）+ biome（changed files, clean）+ 目标测试 64 passed。

### Phase 2: Capture & display the anchor

**Goal:** 用户能在播放时把记忆钉到当前秒，并在列表/轮播看到时间徽标。

**Tasks:**
- [x] `MemoryNoteComposer` 加「📍钉到当前秒」chip（`getCurrentPositionSec` getter / `initialAtSec` / `onSubmit(note, atSec?)`）+ 整秒捕获 + 清除。
- [x] `MemoryNotesWaterfall` + 轮播 slide（[`memory-timeline-rail.tsx`](src/components/player/memory-timeline-rail.tsx)）显示 `atSec` 徽标（mm:ss，`formatDuration`）。
- [x] waterfall 时间徽标可点 → `onSeekToMemory`（`stopPropagation`，卡片不跳转）；annotation-editor 仅在「该曲正在播」时启用 pin/seek（scalar selector 守卫）。
- [x] i18n：`pinMemoryToTime` / `clearMemoryTime` / `memoryPinnedAt` / `seekToMemoryTime` 四语言（en/zh/ja/ko）。

### Phase 2 Checklist

- [x] `memory-note-composer.test.tsx`：pin chip 捕获注入秒（98.7→98 整秒）→ `onSubmit("…", 98)`；`initialAtSec` 显示 + 清除 → `onSubmit("…", undefined)`；无 getter 时不显示 pin。
- [x] `memory-notes-waterfall.test.tsx`：有 `atSec` + `onSeekToMemory` → 可点徽标 seek；无 handler → 静态文本。
- [x] 点徽标触发 `onSeekToMemory`（断言调用）；卡片本身无 click。
- [x] sanitize/整秒：composer `Math.floor`+`Math.max(0,…)`；repo 已 sanitize 负/NaN（Phase 1）。
- [x] typecheck green；biome clean（8 files）；composer/waterfall/panel/annotation 测试 25 passed（1 个 `quick-create` T/N 失败为 **HEAD 既有**、与本期无关，stash 复现）。

### Phase 3: Immersive memory overlay

**Goal:** 全沉浸（频谱+背景）时，记忆以顶部 popover 浮现——锚点准点、空闲补位、动态时长、放完才下一条。

**Tasks:**
- [ ] **统一时长（基础设施先行）**：抽 `memoryDisplayDurationMs`（含 photo 加成）+ `MIN_SHOW_MS`/`ANCHOR_STALE_SEC` 常量于 [`memory-timeline.ts`](src/lib/memory-timeline.ts)；rail 改为共用（行为等价回归）。
- [ ] 新 `immersive-memory-schedule.ts`：`scheduleImmersiveMemory` **双 lane**状态机（re-arm / 跨越检测 / 随机平手 / **锚点抢占 floating + MIN_SHOW_MS** / 同 lane 顺序 / 陈旧丢弃 / floating 轮播 / 暂停冻结）。
- [ ] 新 `ImmersiveMemoryOverlay`：顶部 popover，tick 驱动，标量 selector，交叉淡出，reduced-motion，`pointer-events-none`，仅 `visualizerIdleOnly` 时挂载。
- [ ] `NowPlayingPage` / `App` 在 foreground 之外挂浮层。
- [ ] Settings 可见开关 `immersiveMemoryOverlay`（默认 on）。
- [ ] i18n：设置项 + aria-label。

### Phase 3 Checklist

- [ ] `memory-timeline.test.ts`：`memoryDisplayDurationMs` 短/长 note、有/无图；rail 时长曲线等价回归。
- [ ] `immersive-memory-schedule.test.ts`（注入 `nowMs`/`positionSec`/`rng`）：
  - [ ] 锚点跨越秒触发一次，不重复触发（防抖）。
  - [ ] 同秒多锚 → `rng` 决定唯一显示，其余不迟显。
  - [ ] floating 空闲轮播，时长正确（短/长 note、有图加成）。
  - [ ] 同 lane 顺序：floating↔floating / anchored↔anchored 都「放完才下一条」。
  - [ ] **锚点抢占 floating**：满足 `MIN_SHOW_MS` 后交叉淡出切锚点；未满则不闪切。
  - [ ] 陈旧锚点（迟到 > `ANCHOR_STALE_SEC`，或被另一锚点挡住过久）被丢弃。
  - [ ] seek 倒带/loop re-arm；大幅前跳不补放。
  - [ ] 暂停冻结、恢复续放（暂停时不触发抢占）。
- [ ] 浮层仅在 `visualizerIdleOnly` 挂载；退出沉浸正确卸载；不引发全树重渲染（最小 selector 验证）。
- [ ] 无记忆/仅锚点/仅 floating 三态 UI 正常；reduced-motion 退化。
- [ ] `make check` 通过；预览验证见 [§9 备注]。

---

## 7. Out of Scope

- **`atSec` 的 DB 索引 / 全库按时间点检索**：本期当前曲在内存匹配即可；需要时再开 `version(20)` 加稀疏索引。
- **锚点抢占锚点 / 多级优先队列**：锚点会抢占 floating（已在 scope，见 §4.2），但**不抢占另一个锚点**（排队 + 陈旧丢弃即可），不做深度优先队列。
- **歌词联动 / 波形标记 / 时间轴拖拽编辑**：`atSec` 为这些打地基，但本期不做歌词或波形 UI。
- **chat 工具 `add_memory(atSec)`**：属 [[chat-agent-panel-design]] 下一 phase；本期只把字段与编辑器备好。
- **多条记忆同屏 / 弹幕式叠放**：本期严格单槽位（req #3）。
- **非沉浸模式下用浮层替换右栏 rail**：rail 保留不动；浮层仅沉浸专属。
- **把 `atSec` 喂给 DJ**：DJ 仍只吃 `note` 文本（时间戳与音乐续写无关）。

---

## 8. Security & Privacy Considerations

- **本地优先不变**（硬规则 #1）：`atSec`、note、photo 全部存设备本地 IndexedDB；唯一出站是用户配置的 R2 同步（manifest 已含记忆 note/photo，`atSec` 同等隐私级，仅多一个数字）。无 MUZERO 后端、无遥测。
- **无 hidden flag**（硬规则 #3）：沉浸浮层开关是**可见 Settings 控件**；回滚 = `git revert` + 重发版。
- **codename 稳定**（硬规则 #4）：表名 `memories`、id 前缀 `mem_`、字段名（含新 `atSec`）跨品牌/壳不变。
- **无密钥牵涉**：本特性不碰 BYOK key。
- **PII**：`atSec` 非 PII；记忆文本/照片隐私边界与现状一致，不新增暴露面。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| `docs/prd/20260607-muzero-set-playqueue-memory-data-model-prd/` | Memory 表的来源（set/queue/memory 数据模型重构） |
| `docs/prd/20260610-muzero-synced-lyrics-lrclib-prd/` | 同期歌词同步；未来与 `atSec` 锚点可联动（时间轴共享） |
| [`src/lib/memory-timeline.ts`](src/lib/memory-timeline.ts) | 复用的动态时长数学（`memoryTimelineCarouselIntervalMs`） |
| [`src/components/player/memory-timeline-rail.tsx`](src/components/player/memory-timeline-rail.tsx) | 既有记忆轮播 rail（非沉浸面，动画/节奏参照） |
| `CLAUDE.md` 硬规则 #1/#3/#4/#6/#7 | 本地优先 / 无 flag / codename / selector 纪律 / 续歌单测纪律 |

> **预览验证备注**：沉浸浮层依赖 `idle` + rAF；Claude Preview 页处 hidden 态会冻结 rAF/idle（见记忆 [[preview-hidden-tab-gotcha]]）。验证 Phase 3 动效靠真实前台窗口（`make dev` / `make desktop`）或 resize+截图，浮层冻结非 bug。

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 锚点到点时若正显示 floating，是否**抢占**？ | ✅ Resolved | **抢占**（best practice）：锚点是时间敏感 cue，应抢占 floating 填充物，但满足 `MIN_SHOW_MS`(~2s) 后交叉淡出防闪烁；**不抢占另一锚点**（排队，过久则丢弃）；同 lane 严格顺序（忠实 req #3）。见 §4.2。 |
| 2 | 列表/轮播里点 `atSec` 徽标是否 **seek**？ | ✅ Resolved | **做，但仅徽标可点**：点时间徽标 seek，点卡片不跳转（`stopPropagation`）；沉浸浮层内徽标仅展示（`pointer-events-none`）。见 §5.2。 |
| 3 | floating 补位是否需要去重？ | ✅ Resolved | **无需特殊去重**：复用 rail 轮播游标顺序循环（天然不立刻重复）；仅一条 floating 时按时长重放属预期。 |
| 4 | 锚点捕获粒度：整秒 vs 0.1s？ | ✅ Resolved | **存 number，UI 捕获整秒**：贴合 mm:ss 心智、避免假精度；字段保留细粒度余地。 |
| 5 | 常量默认值 + 时长方案？ | ✅ Resolved | **统一抽象**（§4.3）：`memoryDisplayDurationMs`（base 5s + 80ms/字、photo +~2s、封顶 14s）rail+浮层共用；`MIN_SHOW_MS`~2s、`ANCHOR_STALE_SEC`~6s 同处导出，上线后纯常量微调（无 flag）。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-10 | MUZERO (DoodleBear) | Initial draft — `Memory.atSec` 数据/同步基础、编辑器钉秒、沉浸记忆浮层 + 调度引擎，三 phase（基础设施→编辑器→沉浸表面） |
| 2026-06-10 | MUZERO (DoodleBear) | 定稿 Q1–Q5：双 lane 抢占式调度（锚点抢占 floating + `MIN_SHOW_MS` 交叉淡出）、徽标专属 seek、统一时长抽象 `memoryDisplayDurationMs`（rail+浮层共用）、整秒捕获。Status 仍 Draft，待评审 |
| 2026-06-10 | MUZERO (DoodleBear) | ✅ Phase 1 落地（TDD）：`Memory.atSec` + `addMemory`/`updateMemory` + R2 manifest 三处透传；64 tests green，无 Dexie bump |
| 2026-06-10 | MUZERO (DoodleBear) | ✅ Phase 2 落地（TDD）：composer 钉秒 chip + waterfall/rail `atSec` 徽标 + 徽标专属 seek（仅当前曲）+ 4 语言 i18n |

---

> **Note:** 本 PRD 遵循「改既有、少新建」：仅 `immersive-memory-schedule.ts`（新调度纯函数，需穷举单测）与 `immersive-memory-overlay.tsx`（新呈现表面）为净新增，其余皆扩既有文件。`atSec` 走 `coverThumbhash` 同款「非索引可选字段、无 schema bump」路径，迁移成本接近零。
