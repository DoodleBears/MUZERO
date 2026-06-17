# PRD: 渲染/响应式可观测性（系统化捕捉「不该重渲」的浪费）

**Status:** Draft
**Created:** 2026-06-17
**Author:** DoodleBear
**Module:** `src/lib/render-trace.ts`（✚ 新）· `src/components/dev/`（dev HUD）· `src/dev/perf-control-bridge.ts` + `scripts/perf-gesture.mjs` / `perf-frames.mjs`（harness）· 各 surface 边界（`App.tsx` tabs / overlays / dock / now-playing）

> **起因**：[`20260617-dock-swipe-switch-jank`](../20260617-muzero-dock-swipe-switch-jank-prd/20260617-muzero-dock-swipe-switch-jank-prd.md) 里发现「切歌时 4 个隐藏 tab（Settings/Search/Sessions/Queue）被 App 级联全量 reconcile」——一个长期存在、影响每次切歌的浪费。它**不是靠现有 trace 发现的**，而是我临时写了个 CPU-profile「最长帧 inclusive 归因」(`perf-frames --components`) 才偶然撞见。**这说明我们的可观测性有结构性盲区**：trace 只记「具名 span」（`switch.toFrame` / `queue.live.fetch` / `image.decode`…），**不记「哪个组件重渲了、为什么、几次、是不是在隐藏时还在渲」**。几乎可以肯定还有同类 edge case 没被发现。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | **观测先行**：dev-only render-trace（React `<Profiler>` 边界 + 记录器），harness 可读 | ✅ Completed（commit `6f662d9`；立刻抓到 2 个 edge case） | [Phase 1](#phase-1-render-trace-instrumentation) |
| 2 | **系统化 sweep**：对所有高频交互场景跑 render-trace，编目「不该渲」清单 | ✅ Completed（`render-sweep.mjs` 6 场景；F2/F3/F4 编目，like/lyrics 干净） | [Phase 2](#phase-2-edge-case-sweep) |
| 3 | 逐项修复 + 回归断言（render-trace 进 harness 验收，防回归） | 🔲 Pending | [Phase 3](#phase-3-fix--regression-guard) |

### Phase 2 Findings（`render-sweep.mjs` 全场景 @5983）
扫了 6 个高频场景（playbackDwell / switch / like / metadata / tabSwitch / lyricsToggle），按 surface 报 actualMs + ⚠ HIDDEN。结论编目：

| 场景 | 判定 | hidden 浪费 |
|---|---|---|
| **like** ×5 | ✅ 干净 | 无（仅 now/dock 4.4/2.8ms）—— Axis A 侧表生效,红心不扇出 |
| **lyricsToggle** ×4 | ✅ 干净 | 无（仅 now/dock）—— overlay 切换不扇出 |
| **playbackDwell**（纯播放 5s,无交互） | ✅ 基本干净 | now 45ms/36× + dock 38ms/26× = **进度条/频谱叶子订 `positionSec`**（应该的,非 bug）；queue 0.6ms borderline |
| **switch** ×5（播放中） | ⚠ | **`tab:search` 130ms/51× + `tab:settings` 124ms/43× HIDDEN**；queue 5.2ms、sessions 0.4ms **正确 bail**（memo 生效对照） |
| **metadata** ×5（播放中） | ⚠ | `tab:search` 42ms + `tab:settings` 40ms HIDDEN（同上 F2/F3,播放心跳混入） |
| **tabSwitch** | ⚠ | 离开 now 时 `tab:now` 32ms HIDDEN（**F4：离场 tab 仍重渲**）；激活的 tab 重渲属预期 |

**根因编目（Phase 3 目标）：**
- **✅ 非 bug**：`positionSec` 只被**叶子**（[`progress-scrubber`](../../../src/components/player/progress-scrubber.tsx) / [`playback-spectrum`](../../../src/components/player/playback-spectrum.tsx)）订阅 → 播放时只重渲进度/频谱,**正确**。F1「App 每心跳重渲」证伪：playbackDwell 下 sessions/queue 没跟着渲（若 App 级联,所有 tab 会同步）→ now 的 36× 是它自己的进度叶子。
- **⚠ F2（主要浪费）**：**SearchPage 隐藏时按自身 `playbackStatsLive`/`playbackEventsLive`（播放心跳写表 + 切歌 flush playCount）重渲 130ms** —— memo 拦不住(自身订阅,非父级级联;sessions/queue 因无此订阅而 bail)。修=非激活时冻结这两个 liveQuery（参考 SearchPage 的 `allTracks` freeze, PRD scalable-track-list 同思路）。
- **⚠ F3**：**SettingsPage 隐藏时真实重渲 124ms** —— settings 某子组件订了高频 store（待 bisect）；同样冻结/窄订阅。
- **⚠ F4**：**离场 tab 仍重渲一次**（tabSwitch 时 now 32ms hidden）—— 较小,可选。
- 备注：现有 memo（hidden-tab）对**纯父级级联**有效（sessions/queue bail）；拦不住的是**页面自身订阅高频 store**——这才是剩余的「不该响应」类,与 scalable-track-list 的数据层扇出同源。

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background：为什么会漏掉隐藏 tab 重渲

现有 trace 是**操作级（span-level）**：在已知热点手动埋 `notePerfWork("queue.live.fetch")` / `image.decode` / `performance.frame` / `longtask`。它能回答「这个**已知**操作多久」，**不能**回答：

- 切歌时**到底哪些组件**被 React 重渲了？（→ 隐藏 tab 被级联，没人记录）
- 某组件为什么重渲？（store selector 变了 / 父级级联 / context / 自身 state）
- 一次交互里某组件渲了**几次**？（重复渲是浪费信号）
- 某 surface 在**不可见**时还在渲吗？（hidden tab / 折叠 overlay）

> 盲区根因：**没有 render-level 观测**。`react-doctor` 是**静态** lint（编译期），抓不到运行时重渲；trace 又只埋在少数 span。于是「隐藏 tab 每次切歌全量 reconcile」这种**与具名 span 无关的浪费**完全隐形，只能靠人肉 CPU 火焰图偶遇。

### 1.2 Core Value

1. **把「不该重渲」变成可见、可断言的信号** —— 系统化发现同类 edge case（不止切歌），而非靠运气撞 flame graph。
2. **覆盖软件方方面面** —— 不再只盯切歌路径；对**所有高频交互**（切歌/红心/改 metadata/播放心跳/增删歌/切 tab/开关 overlay）都能一键看「谁渲了、几次、该不该」。
3. **进 harness = 回归护栏** —— 修完的浪费用 render-trace 断言「该 surface 在该场景渲 0 次」，防止再悄悄回来（隐藏 tab 重渲就是没护栏才长期存在）。

---

## 2. System Architecture

### 2.1 现状 vs 目标

```
现状（span-level，盲区）：
  交互 ──▶ [少数手埋 span: queue.live.fetch / image.decode / frame / longtask]
            └─ 「哪些组件渲了/为什么」= 不记录 = 隐形浪费

目标（+ render-level）：
  交互 ──▶ React <Profiler> 边界（每个 surface 一个）
            └─ onRender(id, phase, actualDuration) → render-trace 记录器
                 ├─ 每 surface：commit 次数 + 累计 actualDuration + 是否「hidden 时还在 commit」
                 └─ harness scenario 结束 → 报「本场景重渲的 surface + 次数 + 可疑标记」
```

### 2.2 为什么用 React `<Profiler>`

- **官方 API、零侵入**：`<Profiler id onRender>` 包住一个 surface 子树，每次 commit 回调 `(id, phase: "mount"|"update", actualDuration, …)`。不用改 surface 内部代码、不用给每个组件加 hook。
- **边界粒度可控**：先按 **surface** 埋（5 个 tab / now-playing stage / dock / 各 overlay），就能抓「隐藏 tab 在切歌时 update」这类——正是漏掉的那类。需要更细再往子树加边界。
- **dev 即可发现**：dev React 自带 profiling，`onRender` 正常触发——**找 edge case 用 dev 足够**（浪费的重渲在 dev/prod 都发生，dev 只是放大）。prod 量化需 `react-dom/profiling`（VITE_MUZERO_PROFILE 构建里 alias），列 Phase 1 可选项。
- **dev-only / 可 tree-shake**：边界与记录器 gated 在 `import.meta.env.DEV`（或 `VITE_MUZERO_PROFILE`），prod release 不含——与现有 perf-control bridge 同纪律。

### 2.3 Project Structure（仅列改动）

```
src/lib/render-trace.ts          # ✚ 记录器：recordCommit(id,phase,dur)；按 surface 聚合；reset/snapshot
src/components/dev/render-trace-boundary.tsx  # ✚ <RenderTraceBoundary id> 薄壳(dev 包 Profiler，prod 直通 children)
src/App.tsx / now-playing / dock / overlays    # ✎ 用 <RenderTraceBoundary> 包各 surface
src/dev/perf-control-bridge.ts   # ✎ 加 renderTrace 命令(reset/snapshot)
scripts/perf-gesture.mjs / perf-drive.mjs      # ✎ scenario 前 reset、后 snapshot，报「重渲 surface + 可疑项」
```

---

## 3. 要抓的「不该渲」类别（编目目标）

| 类 | 例（已知/疑似） | 期望 |
|---|---|---|
| **隐藏 surface 被级联** | 切歌时 Settings/Search/Sessions/Queue update（已修，作回归基准） | 隐藏 surface 在无关交互上 commit = 0 |
| **播放心跳扇出** | `positionSec` 每 ~250ms 写 → 订阅方重渲（SearchPage 的 playbackStats liveQuery 疑似） | 播放时只有进度条/时间相关 surface 重渲 |
| **单曲写扇出残留** | 改 metadata / 红心后是否还有 surface 多余重渲（Axis A/B 之外） | 只重渲被改行 + now-playing |
| **overlay 折叠仍渲** | lyrics / memory / 队列抽屉 关闭时是否还在 commit | 折叠 overlay commit = 0 |
| **切 tab 级联** | 切到某 tab 是否把别的 tab 也带渲 | 只渲目标 tab |
| **重复渲** | 一次交互某 surface commit 多次（StrictMode 之外） | 一次交互每 surface ≤1 update |

---

## 4. 性能测量方法学（验收 ground truth）

遵循 [`prd-create.md` §4](../../../.cursor/commands/prd-create.md)（性能/卡顿类）：**观测先行，再优化**；测帧节奏 + 长任务而非渲染耗时；prod build 复测；回退 = `git revert` 不藏 flag。本 PRD 即「补齐能看见症状的指标」那一步——render-trace 是新增的无歧义信号。

- **新 ground-truth：render-trace**。harness scenario（`perf-gesture` 真实拖拽 / `perf-drive` 程序化）前 `reset`、后 `snapshot`，报：每 surface 的 `{commits, totalActualMs, renderedWhileHidden}`。**可疑判定**：隐藏 surface `commits>0`，或单次交互 `commits` 远超预期。
- **仍并测既有信号**：`fpsAvg`/`fpsLowMin`/`frameMaxMs`（`performance.frame`）、`longTaskCount/TotalMs`、`switchToFrameAvg/Max`、`queue.live.fetch` —— render-trace 解释「为什么这帧长」，frame/longtask 是「用户可感卡顿」的最终信号。配合 `perf-frames --components`（CPU inclusive 归因）交叉验证。
- **dev 找 / prod 验**：edge case 在 dev render-trace 即可暴露（重渲在两端都发生）；关键数字按需 prod-preview（`VITE_MUZERO_PROFILE` + `vite preview --port 41730` 同 origin 共享 IndexedDB）复测（见 dock-swipe-jank PRD §4.0 流程）。dev 数被 StrictMode 双 commit / jsxDEV 放大，render-trace 的 commit **次数**比 duration 更可靠。
- **回归护栏**：修完的项写成 harness 断言（如「switch 场景下 hidden-tab surfaces commits===0」），进 CI 或 manual harness checklist，防止再长出来。
- 启动 harness 须 unset `ELECTRON_RUN_AS_NODE`；control endpoint + `MUZERO_REMOTE_DEBUG_PORT`。

---

## 5. Implementation Plan

### Phase 1: render-trace instrumentation
**Goal:** 能一键看「某场景里哪些 surface 渲了、几次、是否隐藏时渲」。
- [ ] `render-trace.ts`：`recordCommit(id, phase, actualMs)` + 按 id 聚合 + `reset()` / `snapshot()`；dev/`VITE_MUZERO_PROFILE` gated，prod no-op。
- [ ] `<RenderTraceBoundary id active?>`：dev 包 `<Profiler>` 调 recordCommit（带 `active` 标记，便于判「隐藏时渲」）；prod 直通 children（零开销）。
- [ ] 包关键 surface：5 个 tab（带 active）、now-playing stage、dock、lyrics/memory overlay、queue 抽屉。
- [ ] perf-control 加 `renderTrace` 命令（reset/snapshot）；`perf-gesture`/`perf-drive` scenario 前后调用，报告并 flag 隐藏 surface 的 commits。
- [ ] dev HUD（`dev-perf-panel`）显示 live render-trace（可选）。
#### Phase 1 Checklist
- [x] `render-trace.ts` 记录器 + `<RenderTraceBoundary>` + perf-control `renderTrace`(reset/snapshot) + perf-gesture 集成（⚠ HIDDEN flag）。包 5 个 tab + dock。
- [x] **工具有效性验证**：3 次切歌 render-trace → queue/sessions 正确 bail(~0ms,对照基准)，并**立刻抓到 F1（App 播放心跳重渲）+ F2（SearchPage 隐藏心跳重渲）** 两个此前隐形的 edge case。tsc 0、perf-control 12 单测绿。

### Phase 2: edge-case sweep
**Goal:** 把 §3 每类场景都跑一遍 render-trace，编目「不该渲」清单。
- [x] `scripts/render-sweep.mjs`：6 场景（playbackDwell / switch / like / metadata / tabSwitch / lyricsToggle）每个 reset→drive→snapshot，报 surface actualMs + ⚠ HIDDEN。
- [x] 编目（见上 Findings 表）：F2 SearchPage / F3 SettingsPage 隐藏时自身订阅重渲（主要浪费）；F4 离场 tab 重渲（小）；like/lyrics 干净；positionSec 叶子订阅属预期。
#### Phase 2 Checklist
- [x] 覆盖 6 个高频场景；可疑项均有归因（自身高频 store 订阅 vs 父级级联）+ 修复方向（冻结/窄订阅）。
- [ ] 未覆盖：queue add/remove（需 repo 驱动）、memory overlay（避免打开编辑器副作用）—— 列 Phase 3 / follow-up 补。

### Phase 3: fix + regression guard
- [ ] 逐项修（窄 selector / memo / 边界拆分 / 订阅下沉），每项 render-trace before/after。
- [ ] 把「该场景该 surface commits===0/≤1」写成断言进 harness。

---

## 6. Out of Scope

- **大规模组件重写** —— 只做观测 + 针对性修，不重构架构。
- **prod profiling react-dom 切换** —— Phase 1 可选；找 edge case 用 dev 足够。
- **非性能的 render 正确性**（如 stale UI）—— 本 PRD 只关注「浪费的重渲」。
- **第三方 re-render 检测库（react-scan 等）** —— 优先用 React 官方 `<Profiler>`，不引入新 runtime owner（与 CLAUDE.md 规则一致）。

---

## 7. Related Documents

| Document | Description |
|----------|-------------|
| [dock-swipe-switch-jank PRD](../20260617-muzero-dock-swipe-switch-jank-prd/20260617-muzero-dock-swipe-switch-jank-prd.md) | 起因：隐藏 tab 重渲在此被偶遇；`perf-frames --components` 归因法 |
| [scalable-track-list-reactivity PRD](../20260617-muzero-scalable-track-list-reactivity-prd/20260617-muzero-scalable-track-list-reactivity-prd.md) | liveQuery 扇出治理（同「不该响应」思路，数据层版） |
| [[perf-control-endpoint-harness]]（memory） | harness scenario + 启动坑 |
| [`prd-create.md` §4](../../../.cursor/commands/prd-create.md) | 性能/卡顿类 PRD 方法学（观测先行） |

---

## 8. Open Questions

| # | Question | Status |
|---|----------|--------|
| 1 | render-trace 边界粒度：先 surface 级够不够，还是要到 now-playing 子组件级？ | Phase 2 按 sweep 结果定 |
| 2 | 「期望 commits」阈值如何定（StrictMode dev 双 commit 干扰）？ | 用 commit 次数相对比较 + prod 校验，不设绝对阈值 |
| 3 | 是否值得做成 CI 断言（vs manual harness checklist）？ | Phase 3 评估，先 manual |

---

## 9. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-17 | DoodleBear | **Phase 2 ✅**：`render-sweep.mjs` 扫 6 场景。编目：**F2 SearchPage(130ms) / F3 SettingsPage(124ms) 隐藏时自身高频订阅(playbackStats 心跳)重渲**——memo 拦不住(非父级级联);**F4 离场 tab 重渲(32ms,小)**;**like / lyricsToggle 干净**(Axis A + overlay 隔离良好);`positionSec` 只被进度/频谱叶子订(预期非 bug,证伪「App 每心跳重渲」)。剩余浪费同 scalable-track-list「不该响应」同源=页面自身订高频 store,修法=非激活冻结/窄订阅。 |
| 2026-06-17 | DoodleBear | **Phase 1 ✅**（commit `6f662d9`）：render-trace（`<Profiler>` 边界 + 记录器 + perf-control/perf-gesture 集成 + ⚠ HIDDEN flag）落地，包 5 tab + dock。**工具一上来就抓到 2 个隐形 edge case**：F1 = App 在播放心跳上重渲 ~25-47× 级联 wrapper；F2 = SearchPage 隐藏时仍按 playbackStats 心跳重渲 106ms。queue/sessions 正确 bail 作对照。证明「span-level trace 看不见、render-level 一眼可见」的论点。 |
| 2026-06-17 | DoodleBear | 初稿：dock-swipe-jank 调查暴露可观测性结构盲区——trace 只记具名 span，不记 render-level，于是「隐藏 tab 切歌全量 reconcile」靠人肉 CPU 火焰图才偶遇。提出 render-trace（React `<Profiler>` 边界 + 记录器 + harness 集成）系统化捕捉「不该重渲」，3 phase（观测→sweep→修+护栏）。 |
