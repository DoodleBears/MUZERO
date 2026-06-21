# PRD: Now Playing 静置态封面 backlight（背光）不显示 —— 派生图既不预热也不按需生成

**Status:** Final（已实现，采纳 Phase 3 方案 C）
**Created:** 2026-06-21
**Author:** DoodleBears / Claude
**Module:** Now Playing 封面 backlight（`MediaStage` 静置态辉光 + backlight 派生图生成链）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测/复现：静置态 `coverBacklightUrl` 恒为 null 的根因定位 | ✅ Completed（源码 + git 定位 c8d93ccc） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 修复 A/B：恢复 warmup + 按需兜底 | ⛔ Superseded（被 C 取代，未实现） | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 加固 C：静置 backlight 改用原图 CSS 模糊，去派生图依赖 | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending | ⛔ Superseded

> **实现说明（2026-06-21，方案 C）**
> 直接采纳 Phase 3 的方案 C（而非 A/B 的「恢复派生图生成」），因为它一并消除了 bug 的**根**（静置背光对预生成派生图的依赖），且对性能目标**更优**（彻底去掉切歌帧上的 backlight worker 渲染，正是 c8d93ccc 想消除的成本）。
> - [`media-stage.tsx`](../../../../src/components/player/media-stage.tsx)：静置 `NowPlayingCoverBacklight` 的 `url` 从 `coverBacklightUrl`（192px backlight 派生 blob）改为 `coverUrl`（stage 正在显示的**原始封面**），由组件内既有的 CSS `blur()`/`saturate()` 出辉光——与拖拽 overlay 卡片（[`cover-pager-strip.tsx`](../../../../src/components/player/cover-pager-strip.tsx)）**完全同一套取色/模糊路径**。删除 `useCoverDerivativeUrl(..., "backlight")` 调用、`COVER_BACKLIGHT_MISS_DELAY_MS` 常量、`shouldRequestCoverBacklightDerivative` 引用。`showCoverBacklight` 改 gate 在 `!!coverUrl`。
> - **未恢复** `use-playback-warmup` 的 `warmBacklight`：静置背光不再读派生图后已无现存消费者，恢复只会生成无人用的派生 blob（浪费）。backlight 派生生成链保持 c8d93ccc 后的状态（仅视频封面帧 worker + Settings 手动修复仍会产出，供其它潜在消费者）。
> - **副作用（正向）**：hand-off crossfade 现在 base 与 overlay 卡片用**同一张原图**出辉光，颜色过渡更一致；静置背光「随封面就绪即显示」，不再有派生图生成延迟。
> - **验证**：`tsc` exit 0；`vitest` player + use-media + album-cover-appearance + playback-preload 共 33 文件 234 例全绿；Biome 干净。**仍需** prod-bundle（`make electron-profile` / `make desktop-build`）手测：静置态背光可见、切歌后持续、shadow/off 模式无背光。

---

## 1. Overview

### 1.1 Background

Tab 1（Now Playing）封面有两种可选效果（`AppSettings.nowPlayingCoverEffectMode`）：**backlight**（封面模糊辉光）和 **shadow**（投影）。用户开启 backlight 后报告：

1. **静置态（不拖拽）完全没有背光**。
2. **拖拽封面（drag start）后才出现背光**——背光随拖拽中的卡片移动。
3. **松手回到原曲，或拖到下一首 commit 之后，下一首又没有背光了**。

即：**只有拖拽过程中能看到背光，静置/提交后的「正常态」背光全程缺席。**

这与 [`20260618-muzero-coverflow-backlight-shadow-drag-prd`](../../20260618-muzero-coverflow-backlight-shadow-drag-prd/20260618-muzero-coverflow-backlight-shadow-drag-prd.md) 描述的旧 bug **方向相反**：旧 bug 是「拖拽期背光消失、静置正常」，本次是「拖拽期背光正常、静置期消失」。属于一次**新的回归**，根因不同（旧 bug 在门控/hand-off 状态机；本次在派生图生成链）。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **听歌用户（桌面 Electron）** | 在 Now Playing 听歌，Settings 里把封面效果设为 backlight | 纯本地 |

### 1.3 Core Value

1. **静置态背光恢复**：不拖拽时也能看到封面辉光（这才是 backlight 效果的主用途）。
2. **切歌后背光持续**：每次切歌（手动 / 自动续歌 / 拖拽 commit）落定后，新歌的背光都能 fade in。
3. **不回退性能**：修复不能把 c8d93ccc 想消除的「切歌帧上跑 worker 渲染」卡顿带回来。

---

## 2. 现状机制（根因定位）

### 2.1 两条 backlight 渲染路径

| 路径 | 文件 | 取色来源 | 是否依赖派生图 |
|------|------|---------|----------------|
| **静置态 base 背光** | [`media-stage.tsx`](../../../../src/components/player/media-stage.tsx) `NowPlayingCoverBacklight` | **backlight 派生 blob**（`cvd_…`，192px 预模糊） | **是** |
| **拖拽期 overlay 卡片背光** | [`cover-pager-strip.tsx`](../../../../src/components/player/cover-pager-strip.tsx) L153-169 | **原始封面 URL + CSS `blur()`/`saturate()`** | **否** |

关键差异：拖拽期 overlay 卡片是「把卡片自己的原始封面再画一张、用 CSS 模糊」——**不需要任何派生图**，所以只要封面 URL 解析出来就一定显示。静置态 base 背光却依赖一张**预生成的 backlight 派生 blob**。

### 2.2 静置态 base 背光的门控（[`media-stage.tsx`](../../../../src/components/player/media-stage.tsx)）

```ts
// L77-87：读 backlight 派生图——注意 generateOnMiss: false（只读，不生成）
const coverBacklightUrl = useCoverDerivativeUrl(
  shouldRequestCoverBacklightDerivative(coverEffectMode, coverBacklightEnabled) ? displayTrack : undefined,
  "backlight",
  { generateOnMiss: false, missDelayMs: COVER_BACKLIGHT_MISS_DELAY_MS, traceSource: "media-stage:backlight" },
);
// L154-155：派生图 URL 为空 → 背光不渲染
const showCoverBacklight =
  coverBacklightEnabled && showCover && coverEffectMode === "backlight" && !!coverBacklightUrl;
```

`generateOnMiss: false` 意味着 [`useCoverDerivativeUrl`](../../../../src/hooks/use-media.ts) 只走 `resolveCoverBacklightDerivative`（**读已存在的派生图**），**不会**调 `ensureCoverBacklightDerivative` 生成。**派生图不存在 → `coverBacklightUrl === null` → `showCoverBacklight === false` → 静置无背光。**

### 2.3 谁来生成 backlight 派生图？—— 三条生成路径全部失效/未覆盖

| 生成路径 | 现状 | 结论 |
|----------|------|------|
| **① 播放预热**（[`use-playback-warmup.ts`](../../../../src/hooks/use-playback-warmup.ts) → [`warmPlaybackPreload`](../../../../src/player/playback-preload.ts) 的 `warmTrackBacklightDerivative`） | c8d93ccc **删掉了** `warmBacklight` 标志的计算与传参，`warmPlaybackPreload` 收到的 `options.warmBacklight` 恒为 `undefined`，backlight 预热分支恒为 `[]` | **已禁用** |
| **② 静置消费端按需生成**（`media-stage` 的 `useCoverDerivativeUrl`） | 同一个 commit 改成 `generateOnMiss: false` | **已禁用** |
| **③ 导入/换封面时预计算**（[`repositories.ts`](../../../../src/db/repositories.ts) `deriveCoverMetadata` L86-99） | 该路径 `targets: ["palette", "thumbhash"]`——**不含 `backlight`**；`schedulePrecomputedCoverDerivativePersistence`（L154-204）因 `coverMetadata.backlight` 为空而早退 | **不覆盖普通音频封面** |

> backlight 派生图当前**仅**在两处生成：(a) 视频封面帧 worker（[`video-poster-worker.ts`](../../../../src/workers/video-poster-worker.ts) L43 `targets` 含 `backlight`）；(b) Settings「修复封面派生图」手动按钮（[`persistent-storage-settings.tsx`](../../../../src/components/settings/persistent-storage-settings.tsx) L508 `repairCoverDerivatives("backlight")`）。**两者都不覆盖普通音频曲目的日常播放。**

### 2.4 回归提交：`c8d93ccc`（"perf: reduce import and playback jank"，2026-06-19）

同一个 commit 同时做了两件互相矛盾的事：

```diff
# src/hooks/use-playback-warmup.ts —— 删除了离关键帧生成 backlight 的预热
-  const warmBacklight = settings.nowPlayingCoverEffectMode === "backlight";
   ...
-          warmBacklight,
-  }, [..., warmBacklight]);
+  }, [...]);

# src/components/player/media-stage.tsx —— 把静置消费端改成只读
   "backlight",
+  { generateOnMiss: false, missDelayMs: COVER_BACKLIGHT_MISS_DELAY_MS, traceSource: "media-stage:backlight" },
```

**意图**（合理）：`generateOnMiss: false` + 1600ms `missDelayMs` 是想把昂贵的 backlight worker 渲染**移出切歌关键帧**，改由「播放预热」在切歌 180ms 后离线生成。
**事故**：但**预热那一半被同 commit 一起删掉了**。于是「静置端不生成、预热也不生成、导入也不生成」三路全断——**派生图永不被生成**，静置背光对几乎所有音频曲目恒灭。

### 2.5 为什么「拖拽时有、松手/切歌后没有」完美吻合

- **drag start**：overlay coverflow 卡片登场，其背光走 §2.1 的 **CSS 模糊原始封面**路径，无需派生图 → **立刻显示**。
- **松手回原曲 / commit 到下一首**：overlay 淡出、交回 base [`NowPlayingCoverBacklight`](../../../../src/components/player/media-stage.tsx#L214)——它依赖派生图，而派生图不存在 → **辉光消失**。

> 与硬规则 3 一致：这是代码回归，回退/修复走 `git`，不是 runtime flag。

---

## 3. 验收信号

沿用本仓库 harness 方法学（CDP 真交互 + **prod rebuild**；`make electron-profile` 是 prod bundle，改码要 rebuild，dev StrictMode 双 effect 会污染时序）：

- **静置态**：选一首**已有封面**的音频曲目、Settings 设为 backlight、**不做任何拖拽**——断言 base `NowPlayingCoverBacklight` 渲染（DOM 中存在 `.now-playing-cover-backlight-clip` 且 `coverBacklightUrl` 非空 / 派生 blob 已落库）。
- **切歌后**：手动 next / 自动续歌 / 拖拽 commit 落定后，下一首在合理时间内（≤ warmup 延时 + 派生耗时）出现背光；连续切多首不丢。
- **不卡顿回归**：切歌关键帧不得新增 backlight worker 渲染长任务（`longtask` / `frame max` 对比 c8d93ccc 前后不恶化）——派生生成必须在切歌帧**之外**（预热 / idle / 延时）。
- **覆盖面**：legacy（导入早于本特性、无派生图）曲目也能显示；far-jump（超出预热窗口 current±prev/+2）最终也能补上。

---

## 4. Implementation Plan

### Phase 1: 观测/复现
**Goal:** 用证据钉死「静置 `coverBacklightUrl` 恒 null + 派生图不存在」。

**Tasks:**
- [x] 源码 + git 定位：c8d93ccc 同 commit 改 `media-stage` `generateOnMiss:false` 又删 `use-playback-warmup` 的 `warmBacklight`；导入 `deriveCoverMetadata` targets 不含 backlight。三路全断。
- [x] 确认拖拽 overlay（`cover-pager-strip`）走 CSS 模糊原图、不依赖派生图 → 解释「拖拽有、静置/提交后无」。

### Phase 1 Checklist
- [x] 静置态 `coverBacklightUrl === null` 根因有据（generateOnMiss:false 只读 + 派生不存在）
- [x] backlight 派生 blob 三条生成路径全部失效/不覆盖普通音频
- [x] 拖拽 overlay 背光走 CSS 模糊（不依赖派生图）已确认

### Phase 2: 修复（恢复生成链）
**Goal:** 静置背光恢复，且不把切歌卡顿带回来。

**候选（推荐 A，必要时 A + B 叠加）：**
- **(A) 恢复播放预热**：在 [`use-playback-warmup.ts`](../../../../src/hooks/use-playback-warmup.ts) 重新计算 `warmBacklight = settings.nowPlayingCoverEffectMode === "backlight"` 并传给 `warmPlaybackPreload`——为 current + prev + 后续 2 首在切歌 180ms 后离线 `ensureCoverBacklightDerivative`。等于把 c8d93ccc 误删的那半补回，恢复 `generateOnMiss: false` 所依赖的离线生成。**改动最小、最贴合原设计意图。**
- **(B) 按需兜底**：把 `media-stage` 的 `generateOnMiss` 改回 `true`（保留 `missDelayMs: 1600` 的延时 + 一次性），覆盖预热窗口之外（far-jump / 手动跳转 / legacy）的曲目。延时 + 一次性确保不落在切歌关键帧。
- **(C) 见 Phase 3**（架构简化，可后置）。

**Tasks:**
- [ ] (A) 恢复 `warmBacklight` 计算 + 传参 + effect 依赖
- [ ] (B) `media-stage` `generateOnMiss: true`（保留延时），验证切歌帧无新 worker 长任务
- [ ] 回归：shadow / off 模式**不得**触发 backlight 派生（沿用 [`shouldRequestCoverBacklightDerivative`](../../../../src/lib/album-cover-appearance.ts)，audit O1 不回退）

### Phase 2 Checklist
- [ ] ⛔ Superseded by Phase 3（C 不依赖派生图，A/B 的「恢复生成」无需进行）

### Phase 3: 加固（统一取色路径，去派生图依赖）✅ 已采纳
**Goal:** 消除静置 backlight 对预生成派生图的脆弱依赖。

**候选：**
- **(C)** 让静置 [`NowPlayingCoverBacklight`](../../../../src/components/player/media-stage.tsx#L214) 像 overlay 卡片那样，直接对**原始封面 URL** 施加 CSS `blur()`/`saturate()`（[`cover-pager-strip.tsx`](../../../../src/components/player/cover-pager-strip.tsx) L153-169 已证明可行），**彻底不依赖 backlight 派生 blob**。拖拽 / 静置两条路径合一，单一事实来源，永不再因派生图缺失而灭。
  - 取舍：CSS 模糊全分辨率原图比模糊 192px 派生图重，但这是**静置态、单个元素**（非每帧），桌面可接受；派生图（更省）仍可保留给别处（如 Pixi 背景纹理）。
  - 若采纳 C，可让 A/B 仅作为「派生图给别的消费者用」的存在，静置背光不再 gate 在它上面。

### Phase 3 Checklist
- [x] 静置背光不再读 backlight 派生 blob（改用 `coverUrl` 原图 CSS 模糊）
- [x] 静置 + 拖拽视觉一致（同 `--now-playing-cover-backlight-*` scale/blur/saturation CSS 变量）
- [x] `tsc` / `vitest`(234) / Biome 通过
- [ ] prod-bundle 手测：全分辨率 CSS 模糊在桌面无明显掉帧（待 `make electron-profile`）

---

## 5. Out of Scope

- shadow 效果（本次只涉及 backlight；shadow 走 CSS class，不依赖派生图，未受影响）。
- 拖拽期 overlay 卡片背光（本就正常，是对照组）。
- Pixi 背景 / 流光（独立图层，取色另有链路）。
- 移动端触摸专属调优。
- hidden flag（硬规则 3：回退 = `git revert`）。

---

## 6. Related Documents

| Document | Description |
|----------|-------------|
| [20260618 coverflow-backlight-shadow-drag PRD](../../20260618-muzero-coverflow-backlight-shadow-drag-prd/20260618-muzero-coverflow-backlight-shadow-drag-prd.md) | 方向相反的旧 bug（拖拽期背光消失）；本 PRD 引用其 overlay CSS 模糊方案作为 Phase 3 参照 |
| [20260613 now-playing-switch-background-perf PRD](../../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) | audit O1 `shouldRequestCoverBacklightDerivative` 门控来历（shadow/off 不请求 backlight 派生，须保留） |
| [20260613 cover-render-pipeline-performance PRD](../../20260613-muzero-cover-render-pipeline-performance-prd/20260613-muzero-cover-render-pipeline-performance-prd.md) | `useCoverDerivativeUrl(track, "backlight")` 与派生图管线设计 |

---

## 7. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 修复用 A（恢复预热）还是 A+B（再加按需兜底）？ | Open | 建议 A 先恢复主路径；B 覆盖 far-jump/legacy 边角，二者不冲突 |
| 2 | 是否一步到位上 Phase 3（C，去派生图依赖）？ | Open | C 最稳但改静置渲染；可先 A/B 止血、C 作为后续加固 |
| 3 | `c8d93ccc` 删 `warmBacklight` 是有意还是误删？ | Open | 从「同 commit 把消费端改只读、却同时删生成」看高度疑似误删；需作者确认 |

---

## 8. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-21 | DoodleBears / Claude | 初稿：定位 c8d93ccc 同时禁用「播放预热」与「按需生成」两条 backlight 派生图生成路径，致静置背光恒灭；拖拽 overlay 走 CSS 模糊不受影响，故「拖拽有、静置/提交后无」。给出 A（恢复预热）/B（按需兜底）/C（统一取色去派生依赖）三档修复 |
| 2026-06-21 | DoodleBears / Claude | 实现：采纳方案 C（`media-stage` 静置背光改用 `coverUrl` 原图 CSS 模糊，删除 backlight 派生图依赖）；A/B 标记 Superseded。`tsc`/`vitest`(234)/Biome 通过；状态 → Final |
