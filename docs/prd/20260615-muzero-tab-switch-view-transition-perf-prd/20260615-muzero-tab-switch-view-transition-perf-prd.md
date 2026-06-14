# PRD: MUZERO Tab 切换 View Transition 掉帧(root 快照不裁剪持久背景)

**Status:** Draft
**Created:** 2026-06-15
**Author:** Claude
**Module:** Shell / Navigation - tab↔tab 切换的 View Transition 性能(root 快照范围)

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测:tab-switch VT 标记(`shell.transition` used/skip/suppressed) | ✅ Completed(QA#1:正是它揪出了误诊) | [Phase 1](#phase-1-观测tab-switch-vt-计时--framelongtask-标记) |
| 2 | ambient 活跃时跳过 root VT | ✅ 代码完成(QA#1:VT 确认被抑制,但**不是掉帧主因**) | [Phase 2](#phase-2-ambient-活跃时跳过-root-vt) |
| 3 | (可选)非 ambient 时把 VT 裁剪到内容区 / 持久层命名 | ⏸️ 暂缓(VT 非主因,优先级降) | [Phase 3](#phase-3-可选非-ambient-时把-vt-裁剪到内容区) |
| 4 | **真因:tab 切换 page remount → liveQuery 重查 + 封面重渲染 → GC** | ✅ Completed(QA#2 验证:切 tab 不卡了) | [Phase 4](#phase-4真因page-remount--livequery-重查--封面重渲染) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending | ⏸️ 暂缓
>
> **⚠️ 方向修正(QA#1,2026-06-15):**Phase 1 的 `shell.transition` trace 证明 **View Transition 不是 tab 切换掉帧的主因**——VT 被确认抑制(`phase=skip suppressed=true used=false`)后,FPS 仍从 115 掉到 60(`frameMax 166`、heap 107→238)。真因是**切 tab 时 page 条件渲染卸载/重挂 → Dexie `useLiveQuery` 重新订阅重查(`listAllTracks`/`trackPlaybackStats`/`memoryNotesByTrack`)+ 封面 surface 重渲染 → 主线程反序列化 + heap churn → GC 长任务(150ms)**。VT 抑制(Phase 2)是个真实但次要的省成本,保留;主修复转 Phase 4。
>
> **实现说明(2026-06-15):**Phase 2 采用「ambient backdrop 活跃 → 全局抑制 root VT」(模块级 `setViewTransitionSuppressed`,由 App.tsx 跟 `ambientBackdropActive` 驱动),抑制时 `startViewTransition` 直接同步更新(等同 WebKit 壳)。**未加内容层 fade**(Open Question #2 暂定瞬切:连续背景已是视觉锚点,瞬切 tab 不突兀);如 QA 觉得太硬可再加便宜 opacity fade。抑制是**全局**的(不止 tab 切换)——所有 root VT 在重背景下都付同样快照成本,一并跳过更一致;shared-element morph 走 Motion 不受影响。

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

**Tasks(✅ 代码完成):**
- [x] [`view-transition.ts`](../../../src/lib/view-transition.ts) `startViewTransition` 每次发 `shell.transition transition` trace:`phase=start|skip`、`used`、`canViewTransition`、`suppressed` —— 一条日志即可区分「跑了 root VT」vs「被引擎/抑制跳过」。
- [ ] (QA)复用既有 `performance.frame` fps window + `longtask`,抓一份「连续切 tab(ambient 活跃)」trace,确立基线:`fpsAvg`/`fpsLow`/`frameMaxMs`/`longTaskMaxMs`。
- [ ] (QA)对照「ambient 不活跃」切 tab 的 trace,验证掉帧确实与背景快照相关。

### Phase 1 Checklist

- [x] trace 能区分 `used` true/false(`shell.transition` 的 `phase=start|skip` + `suppressed` 字段)。
- [ ] (QA)抓到 ambient-active 切 tab 的基线窗口(`fpsAvg≈100`、`frameMax` 尖峰)。
- [x] 纯 observability,低风险,随 Phase 2 一起 ship。

### Phase 2: ambient 活跃时跳过 root VT

**Goal:** ambient 背景活跃时不再快照/cross-fade 整个 viewport,消除 tab 切换掉帧。

**Tasks(✅ 代码完成):**
- [x] [`view-transition.ts`](../../../src/lib/view-transition.ts) 加模块级 `suppressed` + `setViewTransitionSuppressed()` / `isViewTransitionSuppressed()`;`startViewTransition` 在 `canViewTransition() && !suppressed` 才走 native,否则直接同步 `update()`(等同 WebKit 壳)。透传到 `transitionState`(无需改调用点签名)。
- [x] [`App.tsx`](../../../src/App.tsx) `useEffect([ambientBackdropActive])` → `setViewTransitionSuppressed(ambientBackdropActive)`;复用既有 `ambientBackdropActive`(=`hasAmbientTrack && !lyricsOnlyIdle`,即重背景实际在渲染的信号),不造平行信号。
- [~] 内容层 opacity fade:**未实现**(Open Question #2 暂定瞬切;连续背景已是锚点)。如 QA 要求再加。
- [x] 抑制是全局的 → video / Pixi / 可视化在切 tab 时完全不进 VT 快照,不被打断(与 WebKit 禁用初衷一致)。

### Phase 2 Checklist

- [x] 单测:抑制时即便 Chromium + API 在也走同步更新;清除后恢复 native(`view-transition.test.ts`,13 例绿)。
- [ ] (QA)ambient 活跃时切 tab:`fpsAvg` 回到接近 ~120、`frameMax`/`longtask` 不再出现 VT 快照尖峰(prod build,第二轮 trace);`shell.transition phase=skip suppressed=true` 可见。
- [ ] (QA)切 tab 背景无 shimmer / 无媒体打断;瞬切观感可接受(否则加内容 fade)。
- [x] ambient 不活跃时行为不变(`suppressed=false` → 仍走 root VT)。
- [x] `tsc`/Biome/相关单测通过。

### Phase 3:(可选)非 ambient 时把 VT 裁剪到内容区

**Goal:** 若希望在所有情况下都保留 VT 而非整体跳过,把 root 快照裁剪到只有换页内容参与。

**Tasks:**
- [ ] 给持久层(`NowPlayingBackground`、header、`PlayerDock`)赋稳定 `view-transition-name`,使其从 `root` 快照中**单独成对**;因 DOM 持续存在且不变,不产生 cross-fade。
- [ ] 仅 `<main>` 内容区参与 root(或命名为 `page-content`)的交叉淡入;改 [`styles.css:438`](../../../src/styles.css#L438) 为命名伪元素动画。
- [ ] 实测确认「命名大层」是否仍被快照(若仍贵,则放弃本 Phase,统一用 Phase 2 的跳过 + 内容 fade)。

### Phase 3 Checklist

- [ ] 命名裁剪后 tab 切换 `frameMax` 不回升;若命名层仍贵则记录并回退到 Phase 2 方案。

---

## 6bis. QA#1 + 方向修正(2026-06-15,Phase 1/2 后第一份 trace)

trace 见 [`.logs/commit-…/tab-1-tab-2-switch.log`](../../../.logs/commit-afff3201fa47cf84792181199d04565942f93069/tab-1-tab-2-switch.log)(运行 Phase 1/2 代码,含 `shell.transition`)。

**关键观察:**

1. **VT 已被确认抑制**:全部 20 条 `shell.transition` 均为 `phase=skip canViewTransition=true suppressed=true used=false` → Phase 2 生效,root VT **没有运行**。
2. **但掉帧照旧**:切 tab 时 `fpsAvg` 仍从 **115 → 60**(`fpsLow 6~8`、`frameMax 125~166`、`heapMb 107→238` 后 GC、`longTaskMaxMs 150`);停止切换后立刻回到**稳定 120**(`frameMax 8.5`、`fpsLow 117`)。
3. **→ View Transition 不是主因(被证伪)。**

**真因(trace 自洽):**每次 `shell.transition phase=skip` 紧跟着——
- `db listAllTracks requery` + `db trackPlaybackStats requery` + `db memoryNotesByTrack requery`(页面的 Dexie `useLiveQuery` 因 page 卸载/重挂而**重新订阅 → 重查**,`dbRequeries` 整段 +30);
- 一串 `cover.render`(列表 / Now Playing stage 的封面 surface 重渲染,全 cache-hit 但每切几十条);
- → 主线程 IndexedDB 结果反序列化 + React 整页重挂 reconcile + 封面渲染 → **heap churn → GC 长任务(150ms)** = `frameMax 166`。

**根因机制:**[`App.tsx:279-300`](../../../src/App.tsx#L279-L300) 用 `tab === "x" && <Page>` **条件渲染**,切 tab 时旧页**整棵卸载**、新页**整棵重挂** → 其 `useLiveQuery`(`listAllTracks`/`trackPlaybackStats`/`memoryNotesByTrack` 等)每次都重新订阅重查;Now Playing 重挂还会重跑 stage/coverflow 封面渲染。背景层是持久的(切 tab 不卸),但**页面层不是**。

**符合 prd-create §4 方法学**:`renderDuration` 健康不代表不卡;真凶是渲染 tick 之间的 GC pause + IndexedDB 反序列化,落在渲染测量之外——正是 §4 点名的「GC 是周期性、与类型无关、不进渲染 mark 的首要嫌疑」。Phase 1 观测先行才让我们用 `suppressed=true` 一举证伪 VT,不至于在错误方向上调参。

---

## 6ter. Phase 4(真因):page remount → liveQuery 重查 + 封面重渲染

**Goal:** 切 tab 时不再卸载/重挂整页,消除 liveQuery 重订阅重查 + 封面重渲染 + GC 长任务,让 tab 切换 `fpsAvg` 稳在 ~120、`frameMax` 不再出现 150ms 尖峰。

**现状:** `tab === "x" && <Page>` 条件挂载(`App.tsx`);各页 `useLiveQuery` 随挂载重订阅。

**候选方案(QA#1 后待选,见 Open Question #4):**
- **(A) 保活页面(keep-mounted)**:四个 tab 页常驻挂载,用 CSS(`hidden`/`display:none` 或 `content-visibility`)切显隐,而非条件渲染 → liveQuery 订阅不断、不重查;封面不重渲染。代价:所有页(含虚拟列表)常驻内存。可只保活重的几页(search/queue),Now/settings 仍条件挂。
- **(B) 缓存 liveQuery 结果**:让 `listAllTracks`/`trackPlaybackStats`/`memoryNotesByTrack` 走共享缓存层(模块级单例订阅 + 组件读快照),重挂时立即拿缓存、不空查。符合 CLAUDE.md 规则 6(集合用 liveQuery 读但别每次重订阅重算)。
- **(C) 推迟/合并 requery**:切 tab 时把非可见页的 liveQuery 订阅 defer 到 idle;但这是缓解非根治。

**决策(用户拍板,Open Question #4):采用 (A) keep-mounted。**

**Tasks(✅ 代码完成):**
- [x] [`App.tsx`](../../../src/App.tsx) `<main>` 五个 tab 页改为常驻挂载 + `<TabPanel active>`(非活跃 `hidden`/`display:none`);删除 `tab===x && <Page>` 条件渲染。liveQuery 订阅常驻 → 切 tab 不再重查;封面不再重渲染。
- [x] 防 rAF-while-hidden:`PlaybackSpectrum` 加 `IntersectionObserver` `onscreen` 门(`display:none` → 不相交 → 暂停 rAF;也顺带关掉 P1 遗留的「滚出视口不停」项)。可视化 host(背景 + Settings 预览)本就 IO + `document.hidden` 暂停;Lenis 是自停共享 driver(空闲 0 rAF)——三类 rAF 在隐藏页都不空转。
- [x] 不引入新信号:`TabPanel` 纯 `hidden` 切换;`onscreen` 自包含在 spectrum 内,无 prop 穿线。

### Phase 4 Checklist

- [x] 单测:`shouldAnimateSpectrum` 加 `onscreen` 门(off-screen 永不动,即便 playing/dragging);`view-transition`/`playback-spectrum` 共 17 例绿;player/pages/lib 全量 751 例绿(无回归)。
- [x] **(QA#2)切 tab 不再触发 liveQuery 重查:`dbRequeries` 全程平在 2(QA#1 是每切 +30)。**
- [x] **(QA#2)tab 切换 `fpsAvg 119/109`、`frameMax 16.6/33.4`(QA#1 是 60 / 166)、heap 平在 187–195(QA#1 107→238→GC)——切 tab「完全不卡了」(用户确认)。**
- [ ] (QA,可选)内存峰值/boot 成本未单独量化;本轮 `heapMb≈190` 正常,未见 keep-mounted 明显代价,暂不回退混合。
- [x] `tsc`/Biome 通过。

### QA#2(2026-06-15 7ec4a58 prod build):Phase 4 验证 —— 切 tab 不卡了

用户实测确认「切换完全不卡了」。trace 关键:

| 指标 | QA#1(remount) | QA#2(keep-mounted) |
|---|---|---|
| `dbRequeries`(整段切 tab) | 每切 +30(73→103) | **平在 2** |
| `fpsAvg` | 115 → **60** | **119.3 / 109.6** |
| `frameMaxMs` | **166** | **16.6 / 33.4** |
| `heapMb` | 107 → **238** → GC | **187–195 平** |
| `shell.transition` | `phase=skip suppressed=true`(VT 已抑制) | 同 |

- **核心证据:`dbRequeries` 平在 2** —— keep-mounted 后 `listAllTracks`/`trackPlaybackStats`/`memoryNotesByTrack` 不再随切 tab 重订阅重查 → 无 IndexedDB 反序列化 → 无 GC 长任务 → `frameMax` 从 166 砍到 ≤33。
- VT 仍被 Phase 2 抑制(`suppressed=true used=false`),与本修复正交。
- **小观察(非阻塞):**隐藏的 Now Playing `SyncedLyricsView` 仍每帧跑 `lyrics.cascade.frame`(`viewportHeight:1`,即被 `display:none` 折叠),但 `avgMs≈0.08`——可忽略。若日后想更干净,可给歌词 cascade 也加 onscreen 门(与 spectrum 同模式)。归入 §7 Out of Scope 的「后续微优化」。

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
| 3 | 非 ambient(无播放)时是否也统一走内容 fade,去掉 root VT? | ⏸️ 优先级降 | VT 经 QA#1 证伪为非主因;此问随 Phase 3 一起暂缓 |
| 4 | **Phase 4 真因修复:keep-mounted 页面(A)还是 liveQuery 结果缓存(B)?** | ✅ Resolved(用户拍板 A) | **keep-mounted**:五页常驻 + `hidden` 切显隐;rAF 子项靠各自可见性门暂停(spectrum IO、visualizer IO、Lenis 自停)。若 QA 测出内存/boot 成本过高,回退混合(重页保活、Now/settings 条件挂) |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-15 | Claude | 初稿:排查确认 tab↔tab 掉帧 = root View Transition 快照持久重 ambient 背景(Pixi/canvas/video);三入口(NavFab + Ctrl+1/2 shortcut)。落地方案:Phase 1 观测、Phase 2 ambient 活跃跳过 root VT + 内容层 fade、Phase 3(可选)命名裁剪。仅文档,未改代码。 |
| 2026-06-15 | Claude | **Phase 1 + Phase 2 代码完成(TDD)**:`view-transition.ts` 加模块级抑制(`setViewTransitionSuppressed`)+ `shell.transition` trace(`phase=start|skip`/`used`/`suppressed`);`App.tsx` 跟 `ambientBackdropActive` 驱动抑制。抑制为全局(所有 root VT 在重背景下同跳过),shared-element morph 走 Motion 不受影响。**未加内容层 fade**(暂定瞬切,Open Question #2)。`view-transition.test.ts` 13 例绿;`tsc`/Biome 通过。待 QA 抓 ambient-active 切 tab trace 验证 `fpsAvg` 回 ~120 + `shell.transition phase=skip`。 |
| 2026-06-15 | User+Claude | **QA#2 验证:Phase 4 解决问题**。7ec4a58 prod build,用户确认「切换完全不卡了」。关键证据 `dbRequeries` 整段平在 2(QA#1 每切 +30);`fpsAvg 119/109`(QA#1 60)、`frameMax 16.6/33.4`(QA#1 166)、heap 平在 ~190(QA#1 →238→GC)。VT 仍被 Phase 2 抑制(正交)。Phase 4 标 ✅ Completed。小观察:隐藏的 `SyncedLyricsView` 仍每帧跑 `lyrics.cascade.frame`(`avgMs≈0.08`,可忽略)→ 后续可加 onscreen 门。 |
| 2026-06-15 | User+Claude | **Phase 4 代码完成(keep-mounted,TDD)**:用户拍板方案 A。`App.tsx` 五页改常驻挂载 + `<TabPanel hidden>` 切显隐(删条件渲染)→ liveQuery 订阅不断、切 tab 不重查、封面不重渲染。防 rAF-while-hidden:`PlaybackSpectrum` 加 `IntersectionObserver` `onscreen` 门(顺带补 P1「滚出视口暂停」);visualizer host 本就 IO 暂停、Lenis 自停 driver 空闲 0 rAF。`shouldAnimateSpectrum` 加 `onscreen` 参数 + 测试;player/pages/lib 全量 751 例绿、`tsc`/Biome 通过。待 QA 抓 trace 验证 `db …requery` 不再每切出现 + `fpsAvg≈120`。 |
| 2026-06-15 | User+Claude | **QA#1 方向修正:VT 被证伪为非主因**。第一份 trace(Phase 1/2 代码)显示 `shell.transition` 全 `suppressed=true used=false`(VT 没跑),但切 tab 仍 `fpsAvg 115→60`/`frameMax 166`/heap 107→238/`longTask 150`,停手即回稳 120。真因 = `tab===x && <Page>` 条件渲染导致**切 tab 整页卸载/重挂 → `useLiveQuery` 重订阅重查(`listAllTracks`/`trackPlaybackStats`/`memoryNotesByTrack`)+ 封面 surface 重渲染 → IndexedDB 反序列化 + GC 长任务**。Phase 3 暂缓、VT 抑制(Phase 2)保留为次要省成本;新增 Phase 4(真因):keep-mounted 页面 或 liveQuery 结果缓存(Open Question #4)。Phase 1 观测先行正是它一举证伪 VT。 |
