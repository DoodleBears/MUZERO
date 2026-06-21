# PRD: 视频 track 切歌后前台 stage 不播视频、只显示封面（前/后台视频源错位）

**Status:** Draft
**Created:** 2026-06-21
**Author:** MUZERO / Player
**Module:** Now Playing 前台 stage 视频显示（`MediaStage` 共享 `<video>` ↔ Pixi 背景独立 `<video>` 错位）

> 关联：本期同目录的 [`20260621-muzero-tab-switch-state-reset-alignment-prd`](../20260621-muzero-tab-switch-state-reset-alignment-prd/)、[`20260621-muzero-now-playing-backlight-derivative-missing-prd`](../20260621-muzero-now-playing-backlight-derivative-missing-prd/) 都在动 Now Playing stage / 切歌路径；本 PRD 单独追「切歌后前台不播视频」这一条线，避免互相 rebase。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测先行：把「前台 content 判定 vs 实际播放」可见化 | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 修复：视频显示判定 + `<video>` 收养/续播跟 LIVE `current` | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 回归与单测：穷举切歌时序 + 前后台同源 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background（症状）

在播放**有视频的 track（`kind === "video"`）**时，通过以下方式切歌会出现前台「不播视频、只显示封面」：

- 拖拽 cover 区域（coverflow 拖拽切歌，`SwipeableCoverStage`）；
- 快捷键切歌（`next` / `skipPrev`，可在任意 tab 触发）。

具体表现：

1. 切歌**之后**，Now Playing **前台 stage**（封面区域）只显示**封面图**，视频不播放；
2. 但 **Pixi 流光/像素背景里的视频是正确播放的**（背景在动，前台是静止封面）；
3. 当前显示模式是「视频」（`displayMode: "video"`，全局默认），所以本应显示视频。

也就是说：**同一首视频 track，背景层在放视频、前台 stage 却退化成封面**——两层用了**不同的「当前 track」来源**，在切歌窗口内错位。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **桌面用户（主力）** | 在 Now Playing 看 MV / 视频单，用快捷键或拖封面切歌 | 使用方 |
| **维护者** | 负责 Now Playing stage / MediaEngine / 背景层 | 改 `MediaStage` / `media-engine` / 观测 |

### 1.3 Core Value

1. **前后台一致**：前台 stage 与 Pixi 背景对「这首是不是视频、播没播」永远一致，不再一个在放、一个退化封面。
2. **切歌不丢视频**：任意切歌方式（拖拽 / 快捷键 / 连点 burst）切到视频 track 后，前台立刻显示并播放视频。
3. **不牺牲切歌性能**：保留 burst-settle 对**封面/标题静帧**重渲染的合并（PRD Phase 31 的初衷），只把**视频判定**这条线拆回 LIVE。

---

## 2. System Architecture

### 2.1 关键事实：前台与背景是**两个独立的视频消费者**

```
                         播放驱动（音频）            视觉（视频画面）
                         ─────────────            ──────────────
  player-store  ──load──▶ MediaEngine.audioEl  ──"play"事件──▶ MediaEngine.videoEl
   (currentIndex)         (始终播，跨 tab 不停)                   （前台 stage 收养的那一个）
        │                                                              ▲
        │                                                  MediaStage.mount(container)
        │                                                  （只在挂载时收养一次）
        │
        └────────────────────────────────────────────▶ NowPlayingBackground
                                                          ├─ 自己 new 一个 <video>（PlainBackgroundVideo）
                                                          └─ 或 PixiPixelBackground 用 currentVideoUrl 当纹理
                                                          （与 MediaEngine.videoEl 无关，直接 store 同步播放）
```

- **前台 stage**：[`MediaStage`](../../../../src/components/player/media-stage.tsx) 收养**唯一的、常驻的** `MediaEngine.videoEl`（[`media-engine.ts`](../../../../src/player/media-engine.ts) 的 `mount()` / `unmount()`）。音轨由 `audioEl` 驱动，视频画面由 `audioEl` 的 `"play"`/`"pause"` 事件带动 `videoEl.play()/pause()`。
- **Pixi 背景**：[`NowPlayingBackground`](../../../../src/components/player/now-playing-background.tsx) **不**用共享的 `videoEl`，它用 `useTrackMediaUrl(current)` 拿到一个 URL，喂给 `PixiPixelBackground`（纹理）或 `PlainBackgroundVideo`（自己的 `<video>`，订阅 store 自行 play/seek）。

> 这就是「背景在放、前台不放」**物理上可能**的原因：两者根本不是同一个 video 元素 / 同一份判定。

### 2.2 根因：前台「是否显示视频」用了 **burst-settled `displayTrack`**，背景用 **LIVE `current`**

[`MediaStage`](../../../../src/components/player/media-stage.tsx) 里有一段**自相矛盾**的代码：

```tsx
// media-stage.tsx:52-56
// The cover/title visual follows a burst-settled track ...
// Video element logic stays on the live `current` so playback never lags.   ← 注释承诺
const displayTrack = useBurstSettledValue(current, STAGE_DISPLAY_SETTLE_MS); // 300ms

// media-stage.tsx:74-81
const content = resolveStageContent({
  track: displayTrack,                 // ← 实际用的是 burst-settled displayTrack
  displayMode,
  hasCover: trackHasCover(displayTrack),
});
const showVideo = content === "video"; // ← 于是「显示视频」跟着 displayTrack 走，违反注释
```

- 注释明确说 **video element logic 应该跟 LIVE `current`**，但 `content` / `showVideo` 全部从 **`displayTrack`（300ms burst-settle 后的快照）** 推导。
- `showVideo` 进而决定：
  - 视频元素 className 显隐（[media-stage.tsx:125-132](../../../../src/components/player/media-stage.tsx)，`showVideo && !videoError` 才给可见 class，否则 `h-0 w-0 opacity-0`）；
  - 是否渲染 `CanvasCover`（[media-stage.tsx:187](../../../../src/components/player/media-stage.tsx)，`content === "cover"` 时画封面）。

`resolveStageContent`（[`track-display.ts:13-25`](../../../../src/lib/track-display.ts)）的判定：

```ts
if (displayMode === "cover") return hasCover ? "cover" : "title";
// displayMode === "video"
if (track.kind === "video" && track.status === "ready") return "video";
if (hasCover) return "cover";
return "title";
```

而背景层（[now-playing-background.tsx:104-133](../../../../src/components/player/now-playing-background.tsx)）刻意改用 **LIVE `current`**（注释「Single source of truth: the ambient background reads the SAME live index as the stage cover + backlight」），并且 `resolvePixiBackgroundMedia`（[`background.ts:73-86`](../../../../src/lib/background.ts)）只看 `trackKind === "video" && trackStatus === "ready" && hasTrackMedia`，**完全不看 `displayMode`**。

**结论**：切歌瞬间，`current` 已是新视频 track（背景立刻按视频播放），但前台 `displayTrack` 还停在「上一首」或「尚未 settle 的快照」。在 burst 窗口（≥300ms，或 burst 不收敛时**更久/永久**）内：

- 前台 `showVideo === false` → 视频元素被打到 `h-0 w-0 opacity-0`，`CanvasCover` 把封面画出来；
- 背景 `current` 是视频 → Pixi/Plain 背景正常播视频。

= 用户看到的「前台只显示封面、背景视频在放」。

#### 为什么是「切歌后持续」而不是「300ms 自动恢复」？

`useBurstSettledValue`（[`use-burst-settled-value.ts`](../../../../src/hooks/use-burst-settled-value.ts)）是 leading-edge + trailing-debounce：burst 不结束（`value` 在 300ms 内持续变化）就**只停在 leading-edge 那个值**、trailing 一直被顺延。`value` 是 `current`（`Track` 对象引用）。以下会让 `current` 引用在切歌后短时间内反复变化、把 burst 拖住，从而 `displayTrack` 长时间停在错的（非视频 / 非 ready / 上一首）快照：

- 切歌后 `currentRowSub` 重新订阅新 track 行（[player-store.ts:991-1023](../../../../src/stores/player-store.ts)），首帧 emit 会用**新对象**回填 `queue[idx]` → `current` 换引用；
- 切歌后对该行的后台写入（封面 palette 回填、cover derivative、歌词 fetch 落库等）会让 `rowSig` 变化、再次 republish `queue` → `current` 再换引用；
- coverflow 提交 / 连点是天然的多次切歌（每次 `playIndex` 都动 `currentIndex`）。

只要这些发生在 300ms 节奏内，`displayTrack` 就可能**迟迟不 settle 到新视频 track**，表现为「切完一直是封面」。即便最终 settle，也有肉眼可见的退化窗口。

### 2.3 次要可疑点（需 Phase 1 观测确认，可能叠加）

共享 `videoEl` 的「**画面续播**」只有两个触发点：(a) `audioEl` 的 `"play"` 事件 → `videoEl.play()`（[media-engine.ts:83-90](../../../../src/player/media-engine.ts)）；(b) `MediaStage.mount()` 里「若音频在播则 resync + play」（[media-engine.ts:127-136](../../../../src/player/media-engine.ts)）。而 `MediaStage` 的收养是**挂载时一次性**（[media-stage.tsx:87-92](../../../../src/components/player/media-stage.tsx)，`useEffect(..., [])`）。

由此存在**第二条**可能让「前台视频不动」的路径（与 2.2 的「只显示封面」不同，表现更像**静止帧**）：

- Tab 用 `display:none` 常驻挂载（见 [`navigate-tab.ts`](../../../../src/lib/navigate-tab.ts)）。离开 Now Playing tab 时，`videoEl` 处于 `display:none` 子树，浏览器会暂停 `<video>` 画面（`audioEl` 继续）。
- 在别的 tab 用快捷键切歌后回到 Now Playing：`MediaStage` 不会重跑 mount（依赖 `[]`），`mount()` 的 resync-and-play 不触发；若此时 `audioEl` 已在播放、`ensureLoadedAndPlay` 在 `loadedTrackId === track.id` 分支不会再触发新的 `"play"` 事件，则 `videoEl` 可能停在暂停帧。

Phase 1 要用观测区分到底是 **2.2（content 退化成 cover）** 还是 **2.3（视频元素 paused/detached）**，还是两者叠加。**当前证据（用户明确说"只显示封面"而非静止帧）强烈指向 2.2 为主因**。

### 2.4 Technology Stack（涉及）

| Component | Technology | 作用 |
|-----------|------------|------|
| 前台 stage | React 19 + `MediaStage` + `useBurstSettledValue` | 收养共享 `<video>`、判定 video/cover/title |
| 媒体引擎 | `MediaEngine`（单 `<audio>` 驱动 + 单 `<video>` 视觉） | `mount/unmount/loadBlob/play` |
| 背景层 | `NowPlayingBackground` + Pixi（twgl）/ Plain `<video>` | 独立视频源，LIVE `current` |
| 状态 | Zustand `player-store` | `queue` / `currentIndex` / `displayMode` |

### 2.5 Project Structure（相关文件）

```
src/
├── components/player/
│   ├── media-stage.tsx              # ★ 根因所在：content/showVideo 用了 displayTrack
│   ├── now-playing-background.tsx   # 对照：背景用 LIVE current（且不看 displayMode）
│   ├── swipeable-cover-stage.tsx    # coverflow，承载唯一一个 <MediaStage>
│   └── swipeable-media-stage.tsx    # 旧实现（仅测试 mock 引用，未使用）
├── player/
│   └── media-engine.ts             # 共享 <video>：mount/unmount/play 续播触发点
├── hooks/
│   └── use-burst-settled-value.ts  # leading-edge + trailing-debounce（burst 不收敛会卡住）
├── lib/
│   ├── track-display.ts            # resolveStageContent（video/cover/title 裁决）
│   └── background.ts               # resolvePixiBackgroundMedia（只看 kind/status，不看 displayMode）
└── stores/
    └── player-store.ts             # queue/current/currentRowSub/ensureLoadedAndPlay
```

---

## 3. Data Model Design

无 schema 变更。纯前端渲染/状态时序问题。

- **Current Schema:** 不动。`Track.kind` / `Track.status` / `AppSettings.displayMode` 均为既有字段（[`db/types.ts`](../../../../src/db/types.ts)）。
- **Required Changes:** 无。
- **Rollback Plan:** `git revert` 对应改动即可（无迁移、无 runtime flag，符合 CLAUDE.md 规则 3）。

### 3.1 关键不变量（本 PRD 要建立的）

```
前台 stage 的「是否显示并播放视频」  ≡  背景层的「是否按视频渲染」
            （二者都以 LIVE current 的 kind/status 为唯一裁决）

封面/标题「静帧」的 burst 合并        =  仅作用于 cover/title 这条视觉线
            （displayTrack 只决定画哪张封面，不决定 video vs cover）
```

---

## 4. API Design

无网络 API。内部「契约」修正点：

### 4.1 受影响的内部接口/读法

| 位置 | 现状 | 目标 |
|------|------|------|
| `MediaStage` `content`/`showVideo` | 由 `displayTrack` 推导 | **video 判定由 LIVE `current` 推导**；`displayTrack` 仅留给封面静帧 |
| `MediaStage` `<video>` 收养/续播 | 仅 mount 时 `mount()` 一次 | 切歌 / 可见性变化时**重新 `mount()`（resync + play）** |
| 视频元素 className 显隐 | 跟 `showVideo`(displayTrack) | 跟 LIVE `current` 的 video 判定 |

### 4.2 Telemetry & Logging（Phase 1，遵循既有 `logger` + 诊断口径）

仅诊断字段，**不**含用户内容（对齐 CLAUDE.md 规则 8 + telemetry whitelist）：

```
nowplaying.stage.content  { liveTrackId, displayTrackId, liveKind, liveStatus,
                            displayKind, displayStatus, resolvedContent, showVideo,
                            videoPaused, videoInContainer, videoReadyState }
```

用于回答：切歌后某帧，`liveTrackId !== displayTrackId` 持续了多久？`resolvedContent` 是不是 `cover` 而 `liveKind === "video"`？`videoEl` 是否 paused / 是否还在 container 内。

---

## 5. Frontend Design

### 5.1 Page Structure（不新增页面）

`now-playing-page.tsx` → `SwipeableCoverStage`（唯一）→ `MediaStage`（唯一收养共享 `<video>`）。已确认全局只有一个活跃 `MediaStage`（`swipeable-media-stage.tsx` 仅测试 mock 引用），**不是多挂载抢元素**问题。

### 5.2 UI Components（改动点）

- **Current Implementation:** [`media-stage.tsx`](../../../../src/components/player/media-stage.tsx)。
- **Required Changes（描述「改什么」，不写死实现）：**
  1. **视频判定回到 LIVE。** `content`/`showVideo` 的「是否视频」由 LIVE `current`（`current.kind === "video" && current.status === "ready"`，与背景 [`background.ts`](../../../../src/lib/background.ts) 完全一致）决定，兑现 media-stage.tsx:55 注释的承诺。`displayTrack` 仅用于**封面/标题静帧**（`useTrackCoverUrl`、`CanvasCover`、`StageTitleFallback`、backlight）——这才是 burst-settle 的初衷（合并连点时的封面解码/子树重渲染）。
  2. **视频元素显隐跟 LIVE。** className 显隐（media-stage.tsx:125-132）以 LIVE 的 video 判定为准，避免「current 已是视频、video 元素却被打成 `h-0 w-0`」。
  3. **切歌/可见性重收养（针对 2.3）。** 让收养 effect 依赖「LIVE current.id + 是否可见（tab active / foregroundVisible）」而非 `[]`；每次切歌或回到前台时重跑 `engine.mount(container)`（其内部已含 `!audioEl.paused → videoEl.play()` 的 resync）。或在 `MediaEngine` 暴露一个幂等的「ensure video playing/synced」并由 `MediaStage` 在 LIVE current/可见性变化时调用。**最终方案由 Phase 1 观测拍板**（若 2.3 未复现则可只做 1+2）。
  4. **保持封面线不动。** `useTrackCoverUrl(displayTrack)` / `onCoverReady` / coverflow hand-off（`SwipeableCoverStage` 依赖 `onCoverReady` 报告 base 已画到提交封面）维持现状，避免回归 [`20260612-now-playing-cover-handoff-regression`](../../20260612-muzero-now-playing-cover-handoff-regression-prd/) / `20260618-*` coverflow 系列已修的闪烁。

### 5.3 State Management

- LIVE 来源：`usePlayerStore((s)=>s.queue)` + `currentIndex` → `current`（与背景同一读法，保证同源）。
- burst-settle：`displayTrack = useBurstSettledValue(current, 300)` 保留，但**降级为只服务封面/标题静帧**。
- 不把任何判定塞进隐藏 flag / localStorage（规则 3）。

---

## 6. Implementation Plan

### Phase 1: 观测先行（把症状变成无歧义信号）✅

**Goal:** 在改渲染路径前，先把「前台 content 判定 vs LIVE 实际」可见化，并抽出**唯一的** video 判定谓词，让前台 stage 与背景层以后只能依据同一个真值（防再次漂移）。

**Done:**
- [x] 抽出纯谓词 `trackIsPlayableVideo(track)`（[`track-display.ts`](../../../../src/lib/track-display.ts)）= `kind === "video" && status === "ready"`，并让 `resolveStageContent` 复用它（行为不变，测试覆盖）。前台/背景从此共用同一真值（OQ#4 落地）。
- [x] 单测 `trackIsPlayableVideo`（[`track-display.test.ts`](../../../../src/lib/track-display.test.ts)）：audio / 非 ready video / undefined 全 false；并断言它与 `resolveStageContent` 的 video 分支一致（single source of truth）。
- [x] 在 `MediaStage` 增加 `nowplaying.stage.content` 诊断（[media-stage.tsx](../../../../src/components/player/media-stage.tsx)）：每次切歌/状态变化打一行（非每帧），含 `liveTrackId` vs `displayTrackId`、`liveKind/Status`、`resolvedContent`、`showVideo`、`mismatch`，及 `videoPaused`/`videoInContainer`/`videoReadyState`，用于区分 **2.2（content 退化 cover）** 与 **2.3（video 元素 paused/detached）**。`mismatch` 为真时 `phase: "retry"` 便于检索。

### Phase 1 Checklist

- [x] `trackIsPlayableVideo` 谓词 + 单测落地，`resolveStageContent` 复用（前后台同源地基）。
- [x] `nowplaying.stage.content` 诊断接好，无用户内容（仅 id/kind/status + 元素布尔，符合规则 8）。
- [x] `mismatch` 字段在「LIVE 是视频但前台 showVideo=false」时为真——把症状变成无歧义信号。
- [N/A] 本环境无 live Electron 复现；2.2 vs 2.3 的最终确认改由 Phase 2/3 的单测编码（见 OQ#1，证据偏 2.2）。诊断已就位，可在真机直接读取 before/after。

### Phase 2: 修复（video 判定 + `<video>` 续播跟 LIVE）

**Goal:** 前台「是否视频」与背景完全同源（LIVE `current`）；封面静帧仍走 burst-settle。

**Tasks:**
- [ ] `MediaStage`：拆分「视频判定（LIVE current）」与「封面/标题静帧（displayTrack）」两条线（§5.2.1/5.2.2）。
- [ ] 视频元素 className 显隐改跟 LIVE 判定。
- [ ] （若 Phase 1 确认 2.3）收养 effect 跟 LIVE current.id + 可见性重跑 `mount()`，或新增幂等 `ensureVideoSynced()`。
- [ ] 复核 `videoError` / `videoAspect` 的 reset effect（media-stage.tsx:96-100/101-120）：现按 `displayTrack?.id` reset，需与新的 LIVE 视频判定对齐，避免错首 reset。

### Phase 2 Checklist

- [ ] 视频 track 经「快捷键 / coverflow 拖拽 / 连点 burst」切歌后，前台**立即**显示并播放视频，不退化封面。
- [ ] 前台 video 状态与 Pixi 背景视频状态一致（同播同停同源）。
- [ ] 封面 track ↔ 视频 track 互切正确；coverflow hand-off 无回归闪烁。
- [ ] 不引入隐藏 flag；回退 = `git revert`。

### Phase 3: 回归与单测

**Goal:** 锁死时序不变量，防回归。

**Tasks:**
- [ ] 纯函数/hook 测：`useBurstSettledValue` 在 `value` 持续换引用时**不**影响视频判定（因为视频判定不再读它）。
- [ ] `MediaStage` 渲染测：`current` 为 ready 视频、`displayTrack` 仍停在上一首封面 track 时，`showVideo === true`、不渲染 `CanvasCover`。
- [ ] 前后台同源测：同一 `current` 下，`resolveStageContent`(LIVE) 与 `resolvePixiBackgroundMedia`(LIVE) 对「是否视频」结论一致。
- [ ] `make check`（typecheck + lint + test）通过。

### Phase 3 Checklist

- [ ] 新增测试覆盖「切歌后 displayTrack 滞后/卡住但视频立即显示」。
- [ ] 覆盖 video→video / cover→video / video→cover 三类切换。
- [ ] 全量门禁绿。

---

## 7. Out of Scope

- coverflow 拖拽手势本身的 3D/handoff 视觉（已有 `20260617/20260618` 系列 PRD 覆盖）。
- 背景层渲染器（Pixi/Plain/blur）的取舍与性能；本 PRD 只把**前台**判定与之**对齐**，不改背景实现。
- `displayMode` 语义（已在本期变为全局设置，见 player-store 工作区改动）；本 PRD 不改其定义。
- mediabunny 音轨抽取 / `audioOnly` 真正抽轨（CLAUDE.md 标注为后续增强）。
- 移动端 now-playing-sheet（桌面优先；若复用 `MediaStage` 同样受益，但本期以桌面复现为准）。

---

## 8. Security Considerations

- **数据保护：** Phase 1 诊断只记 trackId / kind / status / 元素布尔状态，**不**记封面字节、媒体 URL、文件名、用户文本（对齐 CLAUDE.md 规则 2/8 与 telemetry whitelist）。
- **本地优先：** 不新增任何出站请求 / 后端 / flag。
- **回退：** 纯 `git revert` + 重新发版，无 runtime kill switch（规则 3）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260621-tab-switch-state-reset-alignment](../20260621-muzero-tab-switch-state-reset-alignment-prd/) | 同期 tab 切换状态/VT 对齐（`navigate-tab.ts`，与 2.3 的 display:none 续播相关） |
| [20260621-now-playing-backlight-derivative-missing](../20260621-muzero-now-playing-backlight-derivative-missing-prd/) | 同期 backlight 改 raw cover（media-stage 工作区改动来源） |
| [20260612-now-playing-cover-handoff-regression](../../20260612-muzero-now-playing-cover-handoff-regression-prd/) | 封面 hand-off 就绪判定，改动需避免回归 |
| [20260618-coverflow-backlight-shadow-drag](../../20260618-muzero-coverflow-backlight-shadow-drag-prd/) | coverflow base/overlay backlight hand-off，不可破坏 |
| `src/components/player/media-stage.tsx` | 根因文件 |
| `src/components/player/now-playing-background.tsx` | LIVE-current 对照实现 |
| `src/player/media-engine.ts` | 共享 `<video>` 续播触发点 |
| `src/lib/track-display.ts` · `src/lib/background.ts` | video/cover 裁决（两处需口径一致） |
| `src/hooks/use-burst-settled-value.ts` | burst-settle 行为 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 主因是 2.2（content 退化 cover）还是 2.3（video 元素 paused/detached），还是叠加？ | Open | Phase 1 观测拍板；当前证据（用户说"只显示封面"非静止帧）偏 2.2 |
| 2 | 视频判定回 LIVE 后，连点 burst 会不会让 `<video>` 在每首都 reload 造成卡顿？ | Open | 视频 reload 由 `ensureLoadedAndPlay`/`loadedTrackId` 去重，不随渲染；burst-settle 仍合并封面静帧，理论上不回退性能；Phase 1/3 复测 |
| 3 | 收养 effect 改为依赖 LIVE current.id 重跑 `mount()`，是否会与 coverflow base 隐藏（opacity:0）期叠加导致多次 append？ | Open | `mount()` 已对「parentElement 不同才 append」做幂等；需测 coverflow 提交窗口 |
| 4 | 是否顺手让 `now-playing-background` 与 `MediaStage` 共用一个「是否视频」纯函数，彻底防再次漂移？ | Resolved | 是。Phase 1 已抽 `trackIsPlayableVideo`，`resolveStageContent` + `MediaStage` 已复用；Phase 3 让 `background.ts` 也复用 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-21 | MUZERO/Player | 初稿：定位根因为「前台视频判定用 burst-settled `displayTrack`、背景用 LIVE `current`」的错位（违反 media-stage.tsx:55 注释承诺）；给出观测先行 + 视频判定回 LIVE + `<video>` 续播跟 LIVE 的修复计划 |
| 2026-06-21 | MUZERO/Player | Phase 1 完成：抽出 `trackIsPlayableVideo` 谓词（+单测）并让 `resolveStageContent` 复用；`MediaStage` 接入 `nowplaying.stage.content` 诊断（带 `mismatch` 信号）。OQ#4（共用谓词）落地。 |

---

> 备注：根因的最强证据是 [`media-stage.tsx:52-81`](../../../../src/components/player/media-stage.tsx) ——注释写「Video element logic stays on the live `current`」，但 `content`/`showVideo` 实际从 `displayTrack`（burst-settled）推导；而 [`now-playing-background.tsx:104-110`](../../../../src/components/player/now-playing-background.tsx) 刻意用 LIVE `current`。两层判定源不一致，切歌窗口内（burst 不收敛时更久）就出现「背景放视频、前台只显示封面」。
