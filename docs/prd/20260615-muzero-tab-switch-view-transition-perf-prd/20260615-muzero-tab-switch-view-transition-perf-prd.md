# PRD: MUZERO Tab 切换 View Transition 掉帧(root 快照不裁剪持久背景)

**Status:** Draft
**Created:** 2026-06-15
**Author:** Claude
**Module:** Shell / Navigation - tab↔tab 切换的 View Transition 性能(root 快照范围)

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测:tab-switch VT 计时 + frame/longtask 标记(before/after ground truth) | 🔲 Pending | [Phase 1](#phase-1-观测tab-switch-vt-计时--framelongtask-标记) |
| 2 | ambient 活跃时跳过 root VT,只做内容层 fade(主修复) | 🔲 Pending | [Phase 2](#phase-2-ambient-活跃时跳过-root-vt) |
| 3 | (可选)非 ambient 时把 VT 裁剪到内容区 / 持久层命名 | 🔲 Pending | [Phase 3](#phase-3-可选非-ambient-时把-vt-裁剪到内容区) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

接着 [`20260613-muzero-now-playing-switch-background-perf-prd`](../20260613-muzero-now-playing-switch-background-perf-prd/)(切歌掉帧,已收敛)之后的下一个性能项:**在底部导航 tab 之间切换(如 search ↔ queue ↔ now)时,FPS 从 ~120 掉到 ~100**,用户怀疑是 View Transition 导致。

排查确认**确实是 root View Transition**:

- 两个入口都把 `setTab` 包进 `transitionState`:
  - NavFab 点击 → [`nav-fab.tsx:120`](../../../src/components/nav/nav-fab.tsx#L120) `transitionState(() => onChange(id))`
  - 键盘快捷键 Ctrl/Cmd+1/2/3 → [`actions.ts:185-187`](../../../src/shortcuts/actions.ts#L185-L187) `ctx.transitionState(() => ctx.setTab(...))`
- `transitionState` → [`view-transition-react.ts:14`](../../../src/lib/view-transition-react.ts#L14) → `document.startViewTransition(() => flushSync(update))`([`view-transition.ts:43`](../../../src/lib/view-transition.ts#L43))。
- CSS 对 **`root`** 伪元素做 200ms 交叉淡入:[`styles.css:438-442`](../../../src/styles.css#L438-L442) `::view-transition-old(root) / ::view-transition-new(root)`。

### 1.2 本 PRD 要解决的产品问题

**`root` View Transition 会快照整个 viewport**,而 MUZERO 的 viewport 里垫着一层**持久、重的 ambient 背景**——[`NowPlayingBackground`](../../../src/components/player/now-playing-background.tsx)(`fixed inset-0 z-0`):Pixi WebGL canvas + flow shader + 可视化 canvas + `<video>` + 模糊层。

掉帧来自两件事:

1. **快照成本**:浏览器要把这些**全屏 compositor 层(WebGL/canvas/video)栅格化成静态图**塞进 `::view-transition-old/new(root)`——这正是 [`view-transition.ts`](../../../src/lib/view-transition.ts#L5-L11) 注释里**已经承认**的「snapshotting full-screen compositor layers (video, canvas visualizers, blurred backgrounds) 会 flicker / 打断媒体」,所以 **WebKit 壳已禁用 VT**;但 **Chromium 壳(Electron 主力桌面)仍开着**,于是在这里掉帧。
2. **双层合成 + 纯浪费**:200ms 交叉淡入期间**两份全屏快照同时合成**,而活的背景 rAF / 可视化 / video 仍在底下跑。更关键:**tab1↔tab2 之间 ambient 背景是共享、不变的**(只有 `<main>` 内容换页,见 §2.1)——root VT 把这层不变的背景也一起 cross-fade,是**纯成本、零视觉收益**(还可能引入轻微 double-composite shimmer)。

### 1.3 Target Users

| Role | Description |
|------|-------------|
| **桌面用户(Electron 主力)** | 在播放中(ambient 背景活跃)频繁切 tab 浏览库/队列/设置;期望切换顺滑不掉帧 |

### 1.4 Core Value

1. **切 tab 不掉帧**:tab↔tab 的 `fpsAvg`/`frameMax`/`longtask` 回到接近无 VT 的水平(目标 ~120 不掉到 100)。
2. **不牺牲观感**:保留 tab 切换的轻过渡感(内容区淡入),只是不再快照/cross-fade 不变的重背景。
3. **与既有壳层纪律一致**:沿用「重全屏 compositor 层不进 VT 快照」的已有判断(WebKit 已禁用),把它扩展到「Chromium 下 ambient 活跃」这一缺口。

---

## 2. System Architecture

### 2.1 现状(tab↔tab 切换)

```
点击 NavFab / 按 Ctrl+1..3
        │
        ▼
transitionState(() => setTab(x))
        │  document.startViewTransition(flushSync(setTab))
        ▼
浏览器快照【整个 root viewport】:
  ├─ header (z-30)
  ├─ <main> 内容 (z-10)  ← 真正换页的只有这层
  └─ NowPlayingBackground (z-0)  ← Pixi WebGL + flow + 可视化 canvas + <video> + 模糊
        │  ↑ 持久、不随 tab 变,但被一起快照 + cross-fade(浪费 + 贵)
        ▼
::view-transition-old(root) / new(root) 交叉淡入 200ms
  └─ 两份全屏快照同时合成,活背景仍在跑 → 120 → 100 FPS
```

- `<main>` 用 `tab === "..."` 条件渲染各页([`App.tsx:279-300`](../../../src/App.tsx#L279-L300));非 Now 页用 [`AmbientPageOverlay`](../../../src/App.tsx#L396) 浮在同一背景之上(`active` 时只加 `bg-background/45` 平涂,**刻意不做** backdrop-blur,因为 [`App.tsx:414-416`](../../../src/App.tsx#L414-L416) 注释已知「全屏 backdrop blur over Pixi 在 Windows Chromium 很贵」)。
- 背景层 [`App.tsx:232`](../../../src/App.tsx#L232) `NowPlayingBackground` 在 App 根、tab 之外,**切 tab 不卸载**。

### 2.2 目标(tab↔tab 切换)

- **ambient 活跃时**:`setTab` 走**普通同步更新**(不 `startViewTransition`),背景完全不被快照;可选给 `<main>` 内容层一个**便宜的 opacity fade**(Motion/CSS,只动换页的那层,不碰背景)。
- **ambient 不活跃时**(纯 app 背景,无 Pixi/video):root VT 成本低,可保留;或统一走内容层 fade(见 Phase 3 取舍)。

### 2.3 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| 过渡 | 原生 View Transition(现状)/ Motion or CSS opacity(内容层) | 现有 `view-transition.ts` 已是引擎门控;内容层 fade 不需要全屏快照 |
| 观测 | 既有 `performance.frame` fps window + `PerformanceObserver longtask` | 复用切歌 PRD 已建的指标管线 |

---

## 3. Data Model Design

不涉及。无 schema 变更、无新设置字段(除非 Phase 3 决定暴露过渡开关——默认不暴露,遵守硬规则 3)。

---

## 4. 模块边界(改动点)

⚠️ 优先改既有代码,不新建大结构。

| 位置 | 现状 | 改动方向 |
|------|------|---------|
| [`view-transition.ts`](../../../src/lib/view-transition.ts) | `canViewTransition()` 仅按引擎(Chromium)门控 | 增加「当前是否有重 ambient 全屏层」这一**额外门控信号**,或新增一个 `startViewTransition(update, { skipWhenHeavy })` 入参,由调用点传入 |
| [`view-transition-react.ts`](../../../src/lib/view-transition-react.ts) | `transitionState` 无条件 startViewTransition | 透传跳过条件;跳过时 `flushSync(update)` 直接更新 |
| [`nav-fab.tsx:120`](../../../src/components/nav/nav-fab.tsx#L120) / [`actions.ts:185`](../../../src/shortcuts/actions.ts#L185) | tab 切换调用点 | 传入「ambient 活跃则跳过 root VT」;可选改走内容层 fade |
| [`App.tsx`](../../../src/App.tsx#L278-L300) `<main>` / `AmbientPageOverlay` | 条件渲染各页 | (Phase 2 可选)给换页内容层加 opacity fade;(Phase 3)给持久层 `view-transition-name` 裁剪 root |
| [`styles.css:438`](../../../src/styles.css#L438) | `::view-transition-*(root)` 200ms | Phase 3 若裁剪到内容区,改为命名伪元素动画 |

**判定「ambient 是否活跃」**:复用 [`App.tsx`](../../../src/App.tsx#L173-L174) 已有的 `ambientBackgroundActive`(`hasAmbientTrack`)——即背景确有 Pixi/可视化/video 在跑。不要新造平行信号(沿用切歌 PRD 的 settledTrack/单一信号纪律)。

---

## 5. Frontend Design

### 5.1 交互口径

- 切 tab 的过渡**观感保留但变轻**:用户仍看到内容「淡入」,但**背景纹丝不动**(它本来就不该变)。
- 不引入可感知延迟:内容 fade ≤ ~150ms,且不阻塞 `setTab` 的 DOM 更新。
- reduced-motion / 现有 `MotionConfig reducedMotion="never"` 口径不变(播放器动画属反馈模型,见 [`App.tsx:225`](../../../src/App.tsx#L225));但 tab 过渡是导航装饰,降级为瞬切是可接受的。

### 5.2 State / 信号

- 复用 `ambientBackgroundActive`(`hasAmbientTrack`)决定是否跳过 root VT。
- 不新增 store state;不藏 localStorage/URL flag(硬规则 3)。

---

## 6. Implementation Plan

> 遵循 §4 性能 PRD 附加要求(prd-create.md):**观测先行**——先有 before/after ground truth,再改过渡路径;指标含 `fps window`(fpsAvg/fpsLow)+ `frameMax` + `longtask max`;**prod build(Electron)** 复测、第二轮取数;回退 = `git revert`,不藏 flag。

### Phase 1: 观测 — tab-switch VT 计时 + frame/longtask 标记

**Goal:** 让 tab↔tab 切换的掉帧有可归因的 before/after 信号,而不是只凭「感觉 120→100」。

**Tasks:**
- [ ] 在 `transitionState` / tab 切换调用点埋一条 trace(`nav.tab.transition` start/end + `usedViewTransition: bool` + `ambientActive: bool`),并记录 `viewTransition.ready`/`finished` 的耗时(Chromium 提供 `ViewTransition.ready` Promise)。
- [ ] 复用既有 `performance.frame` fps window + `longtask` 观测(切歌 PRD 已建),抓一份「连续切 tab(ambient 活跃)」的 trace,确立基线:`fpsAvg`/`fpsLow`/`frameMaxMs`/`longTaskMaxMs`。
- [ ] 对照「ambient 不活跃(无播放)」切 tab 的 trace,验证掉帧确实与背景快照相关。

### Phase 1 Checklist

- [ ] trace 能区分 `usedViewTransition` true/false 两条路径。
- [ ] 抓到 ambient-active 切 tab 的基线窗口(`fpsAvg≈100`、`frameMax` 尖峰)。
- [ ] 纯 observability,低风险,可独立先 ship。

### Phase 2: ambient 活跃时跳过 root VT

**Goal:** ambient 背景活跃时不再快照/cross-fade 整个 viewport,消除 tab 切换掉帧。

**Tasks:**
- [ ] `startViewTransition` / `transitionState` 支持「跳过条件」:`ambientBackgroundActive` 为真时直接 `flushSync(update)`,不 `document.startViewTransition`。
- [ ] (可选,保留观感)给换页内容层(`AmbientPageOverlay` / `<main>` 内容)加一个便宜的 opacity fade(Motion `initial/animate` 或 CSS),**只动内容、不碰背景**。
- [ ] 验证 video / Pixi / 可视化在切 tab 时不被打断(与 WebKit 禁用 VT 的初衷一致)。

### Phase 2 Checklist

- [ ] ambient 活跃时切 tab:`fpsAvg` 回到接近 ~120、`frameMax`/`longtask` 不再出现 VT 快照尖峰(prod build,第二轮 trace)。
- [ ] 切 tab 仍有轻过渡观感(内容淡入),背景无 shimmer / 无媒体打断。
- [ ] ambient 不活跃时行为不变(仍可走 root VT 或同样的内容 fade)。
- [ ] `tsc`/Biome/相关单测通过。

### Phase 3:(可选)非 ambient 时把 VT 裁剪到内容区

**Goal:** 若希望在所有情况下都保留 VT 而非整体跳过,把 root 快照裁剪到只有换页内容参与。

**Tasks:**
- [ ] 给持久层(`NowPlayingBackground`、header、`PlayerDock`)赋稳定 `view-transition-name`,使其从 `root` 快照中**单独成对**;因 DOM 持续存在且不变,不产生 cross-fade。
- [ ] 仅 `<main>` 内容区参与 root(或命名为 `page-content`)的交叉淡入;改 [`styles.css:438`](../../../src/styles.css#L438) 为命名伪元素动画。
- [ ] 实测确认「命名大层」是否仍被快照(若仍贵,则放弃本 Phase,统一用 Phase 2 的跳过 + 内容 fade)。

### Phase 3 Checklist

- [ ] 命名裁剪后 tab 切换 `frameMax` 不回升;若命名层仍贵则记录并回退到 Phase 2 方案。

---

## 7. Out of Scope

- **切歌掉帧**:已由 [`20260613-muzero-now-playing-switch-background-perf-prd`](../20260613-muzero-now-playing-switch-background-perf-prd/) 覆盖(P1–P4 已收敛)。
- **shared-element morph(motion `layoutId`)**:track 行 → 详情等共享元素过渡走 Motion,不在本 PRD 的 root VT 范围。
- **WebKit 壳**:已禁用 VT,无此问题。
- **Now ↔ 其它 tab**:Now tab 进出会改变前台结构(stage/visualizer 显隐),与 tab1↔tab2(同一 ambient、仅内容换页)成本结构不同;本 PRD 聚焦 tab1↔tab2,Now 进出若仍掉帧另行评估。

---

## 8. Security / 本地优先

- 无新增出站请求、无后端、无遥测(硬规则 1)。
- 不藏 hidden flag;需要 runtime toggle 就建可见 Settings 控件(硬规则 3)。回退 = `git revert`。
- codename 层不变(硬规则 4)。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [now-playing-switch-background-perf PRD](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) | 上游:切歌掉帧(已收敛);本 PRD 的指标管线 + ambient 信号复用自此 |
| [`view-transition.ts`](../../../src/lib/view-transition.ts) | VT 引擎门控 shim(已禁 WebKit,注释已述全屏 compositor 快照问题) |
| [immersive-flow-background PRD](../20260611-muzero-immersive-flow-background-prd/) | ambient 背景(Pixi/flow/可视化)的来源 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | ambient 活跃时:整体跳过 VT(Phase 2)还是裁剪到内容区(Phase 3)? | 🔲 待拍板 | 倾向 Phase 2(跳过 + 便宜内容 fade):最低风险、与「重层不进快照」既有判断一致;Phase 3 仅当确认命名层不被快照才值得 |
| 2 | 内容层是否保留过渡 fade,还是 ambient 活跃时直接瞬切? | 🔲 待拍板 | 倾向保留一个 ~120ms opacity fade(只动内容);若实测仍有成本则瞬切 |
| 3 | 非 ambient(无播放)时是否也统一走内容 fade,去掉 root VT? | 🔲 待评估 | Phase 1 trace 后定:若非 ambient 的 root VT 成本可忽略,可保留 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-15 | Claude | 初稿:排查确认 tab↔tab 掉帧 = root View Transition 快照持久重 ambient 背景(Pixi/canvas/video);三入口(NavFab + Ctrl+1/2 shortcut)。落地方案:Phase 1 观测、Phase 2 ambient 活跃跳过 root VT + 内容层 fade、Phase 3(可选)命名裁剪。仅文档,未改代码。 |
