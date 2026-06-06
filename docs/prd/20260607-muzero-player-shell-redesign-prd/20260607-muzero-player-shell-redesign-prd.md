# PRD: 统一播放-导航底栏（3 行 Player Dock）+ View Transitions 前端重设计

**Status:** Draft
**Created:** 2026-06-07
**Author:** DoodleBear / MUZERO
**Module:** App Shell — 底部「3 行播放容器」（信息+播放 / 进度 / 导航）/ 响应式 / 页面与共享元素过渡

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | 过渡基础设施（view-transition helper + reduced-motion + 选择器隔离） | ✅ Completed | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | PlayerDock 容器：3 行结构（信息+播放 / 进度 / 导航）合并 PlayerBar+DockNav | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 导航行：扁平集成 nav row（取代 Magic UI 放大 Dock） | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 页面切换 View Transition（tab → tab 丝滑过渡） | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 移动端：mini ↔ 全屏 Now Playing sheet（共享封面 + 完整 transport） | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 打磨：i18n / a11y / 安全区 / 文档对齐（含 CLAUDE.md #9 改写） | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

当前 App shell（[`src/App.tsx`](../../../src/App.tsx)）底部挂了**两个相互独立**的浮层：

1. [`PlayerBar`](../../../src/components/player/player-bar.tsx) —— 全宽贴底、带 `border-t` 的 transport 条（标题 + 上一首/播放/下一首/repeat + 进度 Slider + 音量）。
2. [`DockNav`](../../../src/components/nav/dock-nav.tsx) —— 居中浮动的 Magic UI macOS 放大 Dock（now / queue / search / sets · settings）。

问题：两条独立浮层、视觉割裂、竖向叠放浪费空间，且「播放」与「导航」分离，不符合「以音乐 playback 为中心」的产品定位；tab 切换是 `App.tsx` 的条件渲染硬切，无任何过渡；移动端没有原生播放器（mini ↔ 全屏）范式。

**目标参考 = Poweramp 的底部播放器（对话附图）**：一个**单一圆角深色容器，内部分 3 行**——

```
┌─────────────────────────────────────────────┐
│  [▢封面]  I'm With You                    ⏸    │  ← 行 1：音乐信息（封面+标题+作者）+ 播放/暂停
│           DJ OKAWARI、Emily Styler - Restore   │
│  ●───────────────────────────────────────     │  ← 行 2：整宽播放进度条
│   ▦          .ıl          🔍          ☰        │  ← 行 3：导航 item（扁平、等距）
└─────────────────────────────────────────────┘
```

要点（与之前「胶囊 + 独立 dock」方案的差异）：

- **一个容器、3 行**：信息+播放、进度、导航三层清晰分行，全部在同一个 rounded 容器里。
- **行 1 transport 极简**：只有**播放/暂停**一个钮（参考图如此）；上一首/下一首/repeat/音量**不在收起态出现**，移到展开后的 Now Playing。
- **行 3 是扁平等距 nav 行**：不是放大 Dock，而是集成进播放容器的一排扁平图标（本质上是「集成式 bottom tab bar」）。

### 1.2 ⚠️ 导航约定改向（覆盖 CLAUDE.md 硬规则 #9）

> CLAUDE.md 硬规则 #9 现写：**「导航 = 底部 Magic UI Dock（居中浮动 macOS 风 dock）… 不要再加回 sidebar / 底部 tab bar」**。
>
> **本 PRD 由产品所有者明确改向，覆盖该条**：导航改为「**集成进播放容器第 3 行的扁平 nav row**」——即原 #9 所禁止的「底部 tab bar」形态，但它**集成在播放容器内**、与播放信息/进度同属一个 player-first 的底部簇，而非独立系统级 tab bar。
>
> 取舍理由：参考设计（Poweramp）把导航并入播放器，强化「这是个音乐播放器」的语言，且省空间、节奏统一。**仍然不引入 sidebar**。Magic UI 放大 Dock 退居为**桌面可选的 hover 微动效**（见 §5.3），不再是导航主形态。Phase 5 据此改写 CLAUDE.md #9 全段。

### 1.3 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **桌面用户** | Tauri 桌面窗（默认 1180×780）或浏览器 `make dev` | 容器居中不占满宽、nav 行键盘可达、桌面可有 hover 反馈 |
| **移动用户** | iOS / Android（后续打磨，但布局现在就 responsive） | 一手可及、tap 容器展开全屏、安全区不被遮挡 |
| **「音乐承载回忆」用户** | 上传自己的音视频、加 tag/note/cover、混合歌单 | 行 1 看到自己的封面、上传/生成状态有反馈 |

### 1.4 Core Value

1. **播放是主角**：底部从「两条工具栏」变成「一个会发光的 3 行播放容器」，导航并入其中，第一眼就是音乐播放器。
2. **空间与一致性**：3 行结构清晰、占用更少；桌面/移动共用同一 `PlayerDock`，仅尺寸/展开形态分叉。
3. **丝滑感知**：页面切换、mini→全屏展开、封面共享元素过渡让 App 从「网页」变「原生应用」手感。
4. **零架构破坏**：纯前端 shell / 展示层重构 —— 不动 DB schema、不动 codename 层、不动 DJ↔musicgen 契约、不引入后端或 hidden flag。

---

## 2. System Architecture

### 2.1 Shell 结构：Before → After

**Before（[`App.tsx`](../../../src/App.tsx)）**

```
<div h-screen flex-col>
  <header>  MUZERO logo + tagline
  <main>    { tab === "now"  && <NowPlayingPage> } …   ← 条件渲染，硬切
  <PlayerBar>        ← 全宽贴底 transport 条（border-t）
  <DockNav>          ← 独立浮动 macOS 放大 dock
```

**After**

```
<div h-screen flex-col>
  <header>                       （保留，可后续瘦身；本期不动）
  <main> ─── <RouteOutlet> ───   { 当前 tab 页面，套过渡容器；tab 变化触发 page View Transition }

  <PlayerDock>                   ← 新增：单一 rounded 容器，fixed 居安全区上方，3 行
     ├─ 行1 <TrackIdentityRow>   ← [封面] 标题/作者 ……………………… ⏸ 播放/暂停
     │        └─ 点封面/标题：桌面→切 "now" tab；移动→展开 <NowPlayingSheet>（共享 layoutId 封面）
     ├─ 行2 <ProgressScrubber>   ← 整宽进度条（独立 selector，避免每 tick 全树重渲染）
     │        └─ 状态时在此行上方/内嵌极小状态文案（Uploading / Generating，复用 isUploading/isGenerating）
     └─ 行3 <NavRow>             ← 扁平等距导航 item（唯一导航；桌面可选 hover 微放大）

  <NowPlayingSheet>              ← 仅移动：全屏展开播放器（motion sheet, AnimatePresence + 完整 transport）
```

### 2.2 Technology Stack

| 关注点 | 选型 | Rationale |
|--------|------|-----------|
| **共享元素 / 布局过渡** | `motion` v12（已装，`layoutId` / `AnimatePresence` / `layout`） | 跨所有 WebView 一致；`layoutId` 即共享元素机制，封面 mini↔sheet 复用 |
| **页面 tab 过渡** | 原生 **View Transitions API**（`document.startViewTransition`）渐进增强 + motion 兜底 | 原生 API 在 WebKit/WebView2 版本不一（见 §2.4），必须能优雅降级 |
| **状态** | Zustand（[`player-store`](../../../src/stores/player-store.ts)）+ 一个 ephemeral UI 字段 `isSheetOpen` | 沿用现有；展开态是瞬时 UI，最小 selector 隔离 |
| **进度/波形** | 进度=可键盘操作 Slider（现有 [`ui/slider`](../../../src/components/ui/slider.tsx)）；装饰波形（可选）复用 [`aura-visualizer`](../../../src/components/player/aura-visualizer.tsx) 的 `getAnalyser()` | **真实音频波峰（peaks）走 mediabunny 解码，CLAUDE.md 已标记后续增强，本期不做** |
| **导航行** | 扁平 nav row（Tailwind flex `justify-around`），桌面可选保留 [`dock.tsx`](../../../src/components/ui/dock.tsx) 的 hover 微放大 | 贴合 Poweramp 形态；不丢弃既有 dock 投入（降级为桌面 enhancement） |
| **样式** | Tailwind v4（`@theme`）+ 现有 oklch token | 不新增 config；容器 `rounded-3xl`/`rounded-2xl`，进度 `rounded-full` |
| **i18n** | i18next（4 locale） | 新文案走 `t()`，先加 en 再补 zh/ja/ko |

**不引入**：新动画库（无 GSAP / anime.js）、新 router（继续用 `App.tsx` tab state，不上 react-router）、新 state manager、任何后端或遥测。

### 2.3 Project Structure（新增/改动）

```
src/
├── App.tsx                                  # 改：main 套过渡容器；底部由 PlayerDock 取代 PlayerBar+DockNav
├── components/
│   ├── shell/
│   │   └── player-dock.tsx                  # 新：3 行容器（布局/安全区/响应式/桌面-移动分叉）
│   ├── player/
│   │   ├── track-identity-row.tsx           # 新：行1（封面 + 标题/作者 + 播放/暂停）；可点击展开
│   │   ├── progress-scrubber.tsx            # 新：行2（整宽进度+时间 leaf，独立 selector）
│   │   ├── now-playing-sheet.tsx            # 新：移动端全屏展开播放器（完整 transport）
│   │   ├── transport-controls.tsx           # 新（可选）：⏮⏯⏭/repeat/音量，sheet 与桌面 now 页共用
│   │   ├── player-bar.tsx                   # 删/合并：内容迁入上述组件（保留 git 历史）
│   │   └── mini-waveform.tsx                # 新（可选）：analyser 驱动的装饰波形
│   └── nav/
│       ├── nav-row.tsx                      # 新：行3 扁平等距导航（取代放大 dock 为主形态）
│       └── dock-nav.tsx                     # 改/降级：仅桌面 hover 微放大增强，或并入 nav-row
├── lib/
│   └── view-transition.ts                   # 新：startViewTransition() 封装（原生→兜底）+ reduced-motion 判定
└── stores/
    └── player-store.ts                      # 微调：新增 isSheetOpen + open/closeSheet（ephemeral UI）
```

### 2.4 跨平台过渡能力矩阵（关键约束）

原生 View Transitions API 支持度随 WebView 版本变化，**不能假设普遍可用**：

| 平台 | WebView | 原生 View Transitions | 策略 |
|------|---------|----------------------|------|
| macOS / iOS | WKWebView (WebKit) | Safari 18+（macOS Sequoia / iOS 18+）才有 | 检测 `document.startViewTransition`，无则 motion 兜底 |
| Windows | WebView2 (Chromium) | 111+ 支持 | 通常可用 |
| Linux | WebKitGTK | 视版本而定 | 检测 + 兜底 |
| 浏览器 `make dev` | 取决于本机浏览器 | Chrome 111+ / Safari 18+ | 检测 + 兜底 |

**结论**：以 **motion `layoutId` / `AnimatePresence`（普适、跨 WebView 一致）为共享元素与 sheet 的主用机制**；原生 View Transitions API 仅用于 **page tab→tab 整页 cross-fade 做渐进增强**，并在 [`view-transition.ts`](../../../src/lib/view-transition.ts) 做能力检测 + 直接执行回调的降级。全部受 `prefers-reduced-motion` 控制。

---

## 3. Data Model / State Design

⚠️ **无 DB schema 改动、无 migration、无 codename 变更。** 本期纯展示层 + 一处 ephemeral UI state。`muzero-db`、表名、id 前缀、`TrackBrief`、provider id、`displayMode`/`autoExtend` 全部不动（守 CLAUDE.md 硬规则 #4）。

### 3.1 复用的现有 store 字段（[`player-store.ts`](../../../src/stores/player-store.ts)）

3 行容器与 sheet 全部从既有字段派生，**不新增播放语义**：

| 字段 | 在新 UI 的用途 | 所在行 |
|------|------|------|
| `queue` / `currentIndex` | 当前曲目 = `queue[currentIndex]`，取 `title`、封面、`trackSubtitle()` | 行1 |
| `isPlaying` / `togglePlay` | 行1 唯一的播放/暂停钮 | 行1 |
| `positionSec` / `durationSec` / `seek` | 整宽进度条 + 时间（**独立 leaf 订阅**） | 行2 |
| `isUploading` / `isGenerating` / `isDrafting` / `djError` | 状态文案（`Uploading 2 tracks…` / `DJ 续写中…` / 错误） | 行2 上方 |
| `next` / `prev` / `repeat` / `setRepeat` / `volume` / `setVolume` | 完整 transport（**仅展开后**：移动 sheet / 桌面 now 页） | sheet |
| `addUploads` / `draftNow` | 展开后的「上传 / DJ 续写」入口（行1 收起态不放，保持极简） | sheet |
| `displayMode` / `audioOnly` | sheet 内复用 Now Playing 的 stage 与显示模式切换 | sheet |

### 3.2 新增的唯一 UI state（ephemeral，不持久化）

```ts
// player-store.ts 内新增（或独立 ui-store slice）
isSheetOpen: boolean        // 移动端全屏 Now Playing sheet 是否展开
openSheet: () => void
closeSheet: () => void
```

- **不写入 IndexedDB**（瞬时视图态，不属于「本地优先持久化」的数据）。
- 桌面端不使用 sheet（点封面/标题直接切 `now` tab），`isSheetOpen` 仅移动布局消费。

### 3.3 选择器纪律（守 CLAUDE.md 硬规则 #6）

进度每 tick 刷新（`onTimeUpdate` → `set({ positionSec })`）是重渲染热点。3 行必须各订各的最小 selector：

```
PlayerDock
├── 行1 <TrackIdentityRow>  订 queue[currentIndex] 的 title/cover/subtitle + isPlaying   （切歌/播放态才变）
├── 行2 <ProgressScrubber>  订 positionSec / durationSec                                （每 tick 变 → 只它重渲染）
│        <UploadStatusLine> 订 isUploading / isGenerating / djError                       （状态才变）
└── 行3 <NavRow>            订 当前 tab（来自 App，非 store）                              （切 tab 才变）
```

**禁止** `usePlayerStore()` 整 store 订阅；`mediaEngine` / analyser 等非响应式单例继续留模块作用域，不进 store state。

---

## 4. Transition & Interaction Contract

（本项目无后端，此节取代模板「API Design」——定义过渡 helper 契约与交互行为。）

### 4.1 `view-transition.ts` 契约

```ts
/** 能力检测：原生 View Transitions 可用且用户未要求减少动效。 */
export function canViewTransition(): boolean

/**
 * 用原生 View Transitions 包裹一次 DOM 变更（如 setTab）；
 * 不支持 / reduced-motion 时直接同步执行 update，保证零回归。
 */
export function startViewTransition(update: () => void): void
```

- 调用点：`App.tsx` 的 `setTab` 包一层 `startViewTransition(() => setTab(next))`。
- 受 `prefers-reduced-motion: reduce` 控制：返回 `false` / 直接执行。
- 整页 cross-fade 的 `::view-transition-old/new(root)` 时长/缓动在 `styles.css` 配置（见 §5.4）。

### 4.2 交互行为表

| 交互 | 桌面 | 移动 | 过渡 |
|------|------|------|------|
| 点 NavRow 某 tab | 切页面 | 切页面 | page View Transition（cross-fade，~200ms）；当前 tab 高亮 |
| 点行1 封面 / 标题 | 切到 `now` tab | 展开 `NowPlayingSheet` | 桌面=page VT；移动=`layoutId` 封面共享元素展开（spring） |
| 行1 播放/暂停 | 原地 toggle | 原地 toggle | 钮态 micro-interaction（非 reduced-motion） |
| 行2 拖动进度 | seek | seek | 无页面级过渡 |
| sheet 内 ⏮⏭/repeat/音量 / 上传 / DJ 续写 | —（桌面在 now 页） | sheet 内操作 | — |
| sheet 下滑 / 收起钮 | — | 收起 sheet | 反向 `layoutId` 折叠 + `AnimatePresence` exit |
| DJ 续写 / 上传中 | 行2 状态文案淡入 | 同 | opacity/height 过渡 |

### 4.3 Error / Edge States

- **无 active set**（`activeSessionId == null`）：`PlayerDock` 行1/行2 显占位（曲名 "MUZERO" / 「按下播放」），行3 导航正常（沿用现有 `activeSessionId && <PlayerBar/>` 的条件思路，但 NavRow 始终在）。
- **当前曲目未 ready**（pending/generating）：行1 显曲名 + 行2 状态文案「生成中」，进度禁用。
- **`prefers-reduced-motion`**：layoutId / sheet / page VT 退化为即时或 ≤80ms opacity，**不得**保留位移/缩放。
- **原生 VT 不支持**：`startViewTransition` 直接执行回调，硬切但功能不回归。
- **媒体元素不可中断**：sheet 展开/折叠用 `layoutId` 对**封面图**做共享元素，而非搬运 `<video>`；持久 `<video>`（[`MediaEngine`](../../../src/player/media-engine.ts)）的 `mount()/unmount()` 时机保持现状，detach 不停播。

---

## 5. Frontend Design

### 5.1 桌面布局（≥ md）

```
┌──────────────────── header（保留，可后续瘦身）──────────────────┐
│                  <main> 当前 tab 页面（套过渡容器）                │
│        ┌──────────────────────────────────────────────┐        │
│        │ [▢] I'm With You                          ⏸    │        │  ← 行1
│        │     DJ OKAWARI、Emily Styler - Restore          │        │
│        │ ●──────────────────────────────────────────    │        │  ← 行2（状态文案: Uploading 2 tracks… 在其上方）
│        │   ▦ Queue      .ıl Search      ✦ Sets      ⚙    │        │  ← 行3（扁平等距 + 桌面 hover 微放大）
│        └──────────────────────────────────────────────┘        │
└─────────────────── env(safe-area-inset-bottom) ────────────────┘
```

- 容器 `mx-auto max-w-2xl/3xl`（不拉满宽，守断点纪律）；`fixed`/`sticky` 浮动 + shadow + `backdrop-blur`；`main` 底部留出容器高度 padding。
- 点行1 封面/标题 → 切 `now` tab（桌面 Now Playing 已有大 stage + 常驻队列，承载完整 transport，无需 sheet）。
- 桌面 NavRow 可保留 [`dock.tsx`](../../../src/components/ui/dock.tsx) 的 hover 微放大作为增强（移动禁用）。

### 5.2 移动布局（< md）

```
   <main> 当前页面（全宽）
 ┌────────────────────────────────────┐
 │ [▢] I'm With You              ⏸     │  ← 行1
 │     DJ OKAWARI、Emily Styler         │
 │ ●──────────────────────────────     │  ← 行2
 │  ▦        .ıl        🔍       ☰      │  ← 行3（扁平等距, tap 区 ≥44px, 无放大）
 └────────────────────────────────────┘
        ── env(safe-area-inset-bottom) ──
```

**展开后（NowPlayingSheet，全屏）= 完整 transport 落点**

```
 ┌────────────────────────────────────┐
 │  ⌄ 收起                        ⋯     │
 │       ┌──────────────────┐          │
 │       │   大封面 / MV       │          │  ← 与行1封面共享 layoutId="now-cover"
 │       └──────────────────┘          │
 │  I'm With You                        │
 │  DJ OKAWARI、Emily Styler - Restore   │
 │  ●━━━━━━━━━━━━━━━━━━  01:40 / 06:13    │
 │         ⏮      ⏯      ⏭              │
 │   🔁   🔊                  audio-only │
 │  + 上传 / DJ 续写                      │
 │  ──── 显示模式 / 注释 / 队列 ────       │
 └────────────────────────────────────┘
```

- 行1封面 → sheet 大封面用 **`motion` `layoutId="now-cover"`** 共享元素展开（spring，~`stiffness 320, damping 32`）。
- sheet 复用现有 [`MediaStage`](../../../src/components/player/media-stage.tsx) + 显示模式切换 + [`AnnotationEditor`](../../../src/components/track/annotation-editor.tsx)（把 [`NowPlayingPage`](../../../src/pages/now-playing-page.tsx) 左栏内容收进 sheet），避免重复实现；完整 transport（⏮⏭/repeat/音量/上传/续写）只在这里。

### 5.3 UI Components

- **改造**：[`player-bar.tsx`](../../../src/components/player/player-bar.tsx) 拆为 `track-identity-row.tsx`（行1：封面 + 标题/作者 + 播放暂停）+ `progress-scrubber.tsx`（行2）。封面缩略图复用 [`useTrackCoverUrl`](../../../src/hooks/use-media.ts) + `resolveStageContent`，无封面回退首字母块或装饰波形。
- **新增**：`nav-row.tsx`（行3 扁平等距导航，取代放大 dock 为主形态）。**tab 集合 = queue/search/sets/settings 四项（去「now」，已定 Q1）**，正好对上参考的 4 图标；「now」由点行1播放区进入。
- **新增**：[`player-dock.tsx`](../../../src/components/shell/player-dock.tsx)（3 行容器：布局/`fixed`/`env(safe-area-inset-bottom)`/`md:` 分叉）。
- **新增**：[`now-playing-sheet.tsx`](../../../src/components/player/now-playing-sheet.tsx)（仅移动，完整 transport）。
- **降级保留**：[`dock-nav.tsx`](../../../src/components/nav/dock-nav.tsx) / [`dock.tsx`](../../../src/components/ui/dock.tsx) → 仅作桌面 hover 微放大增强，或并入 `nav-row.tsx`；不再是导航主形态。

### 5.4 动效规格（Animation Spec）

| 动作 | 机制 | 时长 / 物理 | reduced-motion |
|------|------|------|----------------|
| page tab→tab | 原生 VT（增强）/ motion opacity（兜底） | 180–220ms cross-fade | 即时切换 |
| 封面 mini ↔ sheet | motion `layoutId` | spring `stiffness 320 / damping 32` | 即时（无位移） |
| sheet 进出 | `AnimatePresence` + `layout` | 260–320ms spring | opacity ≤80ms |
| 播放钮按压 | motion `whileTap` | 90ms scale 0.96 | 无 |
| 状态文案（Uploading/Generating） | height+opacity | 150ms | opacity only |
| NavRow icon hover（仅桌面） | `useSpring`（[`dock.tsx`](../../../src/components/ui/dock.tsx)） | 既有 | 移动禁用 |

- 全局 reduced-motion：`view-transition.ts` 检测 + `motion` 的 `MotionConfig reducedMotion="user"` 包 App。
- 原生 VT root cross-fade 在 `styles.css` 配 `::view-transition-old/new(root)`；`view-transition-name` 仅按需赋少量元素，避免全树快照开销。

### 5.5 视觉 token

- 容器深色：沿用 `--card` 深色基底；浮起感用 shadow + `backdrop-blur-md`（与现 dock 一致）。
- 圆角：容器 `rounded-3xl`（移动）/ `rounded-2xl`（桌面）；进度 `rounded-full`；sheet `rounded-t-3xl`。
- 强调色：`--primary`（oklch 紫 305）用于激活 tab、进度已播段、播放钮。
- 不新增颜色 token；统一主题可后续 `pnpm dlx shadcn@latest add @coss/style`。

### 5.6 Accessibility

- 图标钮保留 `aria-label`（沿用 `t("player.*")` / `t("nav.*")`）；激活 tab `aria-current="page"`。
- 行2 进度用可键盘 Slider（方向键 seek）。
- sheet 打开焦点移入、`Esc`/下滑关闭、`role="dialog"` + `aria-modal`，关闭后焦点回行1。
- 触摸目标 ≥44×44px。
- 尊重 `prefers-reduced-motion`。

---

## 6. Implementation Plan

### Phase 0: 过渡基础设施

**Goal:** 先把「能丝滑、能降级、不抖动」的地基铺好。

**Tasks:**
- [x] 新建 [`view-transition.ts`](../../../src/lib/view-transition.ts)：`canViewTransition()` / `prefersReducedMotion()` / `startViewTransition()`（原生检测 + reduced-motion + 直接执行兜底）。TDD：[`view-transition.test.ts`](../../../src/lib/view-transition.test.ts) 8 例覆盖三态分支。
- [x] App 顶层包 `motion` 的 `MotionConfig reducedMotion="user"`（放 [`App.tsx`](../../../src/App.tsx)，避开他人 WIP 的 `main.tsx`）。
- [x] `styles.css` 加 `::view-transition-*(root)` cross-fade（`prefers-reduced-motion: reduce` 分支置 `animation: none`）。
- [→] 进度/标题/transport selector 拆 leaf：**改在 Phase 1 随新组件落地**（现 `PlayerBar` 即将被替换，先拆旧组件是浪费）。

#### Phase 0 Checklist
- [x] `make check`（typecheck + lint + test）通过：88 tests / 12 files 全绿，Biome 0 fix。
- [x] 不支持原生 VT（或 stub）下 `startViewTransition` 同步执行 update 一次（单测覆盖）；`setTab` 实际接线在 Phase 3。
- [x] 开「减少动态效果」时：helper 跳过原生 VT、`MotionConfig reducedMotion="user"`、CSS reduce 分支三重兜底（helper 单测覆盖 reduced-motion 分支）。

### Phase 1: PlayerDock 3 行容器

**Goal:** 把 PlayerBar 拆成行1/行2，套进 PlayerDock 容器（行3 先放占位或临时复用 DockNav）。

**Tasks:**
- [x] 新建 [`player-dock.tsx`](../../../src/components/shell/player-dock.tsx)（单一 rounded 容器，3 行；normal-flow `shrink-0`，body 已有 `env(safe-area-inset-*)`）。
- [x] 新建 [`track-identity-row.tsx`](../../../src/components/player/track-identity-row.tsx)（封面 + 标题/作者 + 单一播放/暂停钮）；点击封面/文案 → `onOpen`（Phase 1 桌面切 now；移动 sheet 在 Phase 4 接）。
- [x] 新建 [`progress-scrubber.tsx`](../../../src/components/player/progress-scrubber.tsx)（整宽进度 + 时间）+ [`player-status-line.tsx`](../../../src/components/player/player-status-line.tsx)（状态文案独立 leaf）。
- [x] TDD：抽纯逻辑到 [`transport.ts`](../../../src/player/transport.ts)（`progressPercent` / `resolveStatusLine`），[`transport.test.ts`](../../../src/player/transport.test.ts) 7 例。
- [x] 改 [`App.tsx`](../../../src/App.tsx)：`<PlayerDock>` 取代 `<PlayerBar/>` + `<DockNav/>`；删除 `player-bar.tsx`（内容已迁移）。

#### Phase 1 Checklist
- [x] 各行独立重渲染（按 selector 设计：per-tick `positionSec` 仅触发 `ProgressScrubber`；`TrackIdentityRow` 订 `queue/currentIndex/isPlaying`，`PlayerStatusLine` 订状态，互不影响）。
- [x] 切歌封面/标题更新；无 active set 优雅占位（preview 验证：显 `MUZERO` + `点击播放…` + Disc 占位）。
- [x] i18n 复用既有 key（`player.play/pause`、`nav.now`、`app.pressPlay`、`sessions.importing`、`dj.generating`），**零新增 key**（避开他人 WIP 的 `common.json`）。
- [x] `make check` 通过：typecheck 干净、95 tests 全绿、Biome（本期文件）0 fix；preview 无 Vite error overlay、无运行时报错。
- [→] 行3 暂复用 `DockNav`（嵌套 dock 视觉），**Phase 2 替换为扁平 nav-row**。

### Phase 2: 扁平导航行

**Goal:** 行3 扁平等距 nav row 取代放大 Dock 为主形态。

**Tasks:**
- [x] 新建 [`nav-row.tsx`](../../../src/components/nav/nav-row.tsx)（扁平等距 `justify-around`，激活 `text-primary` + `aria-current`，每项 `aria-label`/`title`）。
- [x] tab 集合（已定 Q1）：**queue / search / sets / settings 四项**，去掉「now」；点行1播放区进 Now Playing。TDD [`nav-row.test.ts`](../../../src/components/nav/nav-row.test.ts) 3 例锁定「四项 + 永不含 now」。
- [x] 桌面 hover 微放大：CSS `hover:scale-110` + `motion-reduce:hover:scale-100`（触摸无 hover 不触发；reduced-motion 不动）。未引 `dock.tsx` 的 follow-cursor 放大，保持轻量。
- [→] [`dock-nav.tsx`](../../../src/components/nav/dock-nav.tsx) 降级保留：仍作 `Tab` 类型源；`DockNav` 组件已无人渲染（不删，以**避免改动正被他人并发编辑的 `App.tsx`**）。`dock.tsx` 随之闲置（Q4 仍开放）。

#### Phase 2 Checklist
- [x] 桌面：容器 `mx-auto max-w-2xl` 居中、normal-flow `shrink-0`、`main` `flex-1 overflow-hidden` 在其上滚动，不遮挡末项。
- [x] 移动：等距 nav、tap 区 `size-11`=44px、`env(safe-area-inset-*)`（body）不被 home indicator 遮挡。
- [x] `make check` 通过：typecheck 干净、98 tests 全绿、Biome 本期文件 0 fix；preview 验证 4 项导航点击切页（搜索→SearchPage）正常、无嵌套 dock 边框。

### Phase 3: 页面切换 View Transition

**Goal:** tab→tab 丝滑过渡。

**Tasks:**
- [x] 把 tab 切换 + 行1→Now Playing 包进 view transition——在 [`nav-row.tsx`](../../../src/components/nav/nav-row.tsx) 的 `onChange` 与 [`track-identity-row.tsx`](../../../src/components/player/track-identity-row.tsx) 的 `onOpen` 调用 `transitionState`。**避开正被他人并发编辑的 `App.tsx`**（不改 App）。
- [x] TDD：新建 [`view-transition-react.ts`](../../../src/lib/view-transition-react.ts) `transitionState = startViewTransition(() => flushSync(update))`（flushSync 让原生 API 快照到更新后的 DOM）；[`view-transition-react.test.ts`](../../../src/lib/view-transition-react.test.ts) 2 例（mock flushSync，覆盖支持/不支持）。
- [→] 未给 page root 赋 `view-transition-name`：默认 `::view-transition(root)` 已 cross-fade 整页；dock 持久化（命名以免随页 fade）作为可选 polish 留 Phase 5。

#### Phase 3 Checklist
- [x] 支持环境：preview 实测 `document.startViewTransition` 存在（true），tab 切换走原生 VT、切页正常、无 console 警告/报错、无布局抖动。
- [x] 不支持 / reduced-motion：`transitionState` 经 `startViewTransition` 同步执行 `flushSync(update)`，即时切换、零回归（Phase 0 + 本期单测覆盖三态）。
- [x] 播放不中断：`transitionState` 只切 tab state，不触碰 `mediaEngine`/持久 `<video>`（切 tab 持续出声）。

### Phase 4: 移动端 mini ↔ 全屏 sheet

**Goal:** 行1 tap 展开全屏 Now Playing（完整 transport），封面共享元素。

**Tasks:**
- [x] sheet 开合状态放**新建 [`ui-store.ts`](../../../src/stores/ui-store.ts)**（`isSheetOpen`/`openSheet`/`closeSheet`，ephemeral）——**不进 `player-store.ts`**（其正被他人并发编辑）。TDD [`ui-store.test.ts`](../../../src/stores/ui-store.test.ts) 2 例。
- [x] 新建 [`now-playing-sheet.tsx`](../../../src/components/player/now-playing-sheet.tsx)：完整 transport（⏮⏯⏭/repeat/音量）+ 大封面/可视化 + `AnnotationEditor`（有 current 时）。`repeat` 循环抽纯函数 `nextRepeatMode`（[`transport.ts`](../../../src/player/transport.ts)）+ 单测。
- [x] 行1封面与 sheet 大封面共享 `layoutId="now-cover"`（[`track-identity-row.tsx`](../../../src/components/player/track-identity-row.tsx) `motion.span` ↔ sheet `motion.div`）；`AnimatePresence` 进出 + 背景淡入。
- [x] 焦点/关闭：`role="dialog"` + `aria-modal` + `Esc` 关闭 + chevron-down 关闭钮；移动 `matchMedia(min-width:48rem)` 分叉（preview 实测 375px → mobile 分支 true）。
- [→] **偏离 PRD 原案（已记录）**：sheet **不挂 `MediaStage`/`<video>`**——`MediaEngine` 是单元素，二次 `mount()` 会从桌面 stage 抢走它；改显封面/`AuraVisualizer`。**sheet 内看视频画面 = 后续增强**。显示模式切换不进 sheet（无 video 时无意义）。
- [→] close 钮 aria-label 暂复用 `t("nav.now")`；专用 `player.collapse` 文案留 Phase 5（避免改动并发编辑中的 `common.json`，否则会把他人 i18n 串裹进本提交）。

#### Phase 4 Checklist
- [x] 共享封面：`layoutId="now-cover"` 在行1缩略图 ↔ sheet 大封面间 morph；sheet 全屏不透明覆盖 dock，无双封面叠现。
- [x] sheet 与行1 共享同一 `usePlayerStore` 播放状态（无重复播放器实例；transport 调既有 actions）。
- [x] reduced-motion：`MotionConfig reducedMotion="user"`（Phase 0）统一降级 layout/opacity 动画。
- [x] 桌面不开 sheet（`matchMedia` 桌面分支 → `transitionState(setTab("now"))` 走 page VT）。
- [x] 验证：render 测试 [`now-playing-sheet.test.tsx`](../../../src/components/player/now-playing-sheet.test.tsx) 确认收起态不渲染 dialog、展开态渲染 dialog + 完整 transport（Play/Previous/Next/Volume）；119 tests 全绿、Biome 0 fix。**交互式 preview 验证受他人并发编辑触发的 HMR reload 干扰（active session 被反复重置），故以确定性 render 测试为准。**

### Phase 5: 打磨 + 文档对齐

**Goal:** i18n / a11y / 安全区 / 文档收口。

**Tasks:**
- [ ] 新增文案补齐 zh/ja/ko（en 类型源）。
- [ ] a11y 全量过（aria / 焦点 / tap 区 / 对比度）。
- [ ] **改写 [`CLAUDE.md`](../../../CLAUDE.md) 硬规则 #9**：从「导航 = 居中浮动 Magic UI 放大 Dock，不要加回 tab bar」改为「导航 = 集成进 `PlayerDock` 第 3 行的扁平 nav row（player-first 底部簇的一部分）；放大 Dock 降级为桌面 hover 增强；仍不引入 sidebar」。同步更新「项目结构」「导航口径」指向新文件。
- [ ] 更新 README / 截图（如有）。

#### Phase 5 Checklist
- [ ] 4 locale 文案齐全，无硬编码可见字符串。
- [ ] CLAUDE.md 与代码一致。
- [ ] `make check` 通过；`make desktop` 与 `make dev` 实机各验一遍。

---

## 7. Out of Scope

- **真实音频波形数据（peaks）**：mediabunny 解码波峰属 CLAUDE.md 已标记的后续增强；本期进度=Slider、波形=analyser 装饰。
- **上 react-router / URL 路由**：继续用 `App.tsx` tab state。
- **DB schema / migration / codename 变更**：零改动。
- **顶部 header 大改 / 整体品牌视觉重设计**：本期保留现有 header；全面视觉刷新另开 PRD。
- **桌面端 sheet**：桌面用 `now` tab 承载全屏播放与完整 transport，不做 sheet。
- **新增遥测 / 后端 / hidden flag**：守硬规则 #1/#3。
- **DJ 续歌逻辑 / musicgen provider / 队列数学**：不动，仅消费其状态。

---

## 8. Security & 架构合规

- **本地优先 / 无后端（#1）**：纯前端 shell 重构，无新增出站请求、无服务端、无遥测。
- **BYOK / 密钥纪律（#2）**：不触碰 settings / key 路径；UI 不展示、不日志任何密钥。
- **无 hidden flag（#3）**：过渡/形态不藏 `localStorage`/URL/`window.*` 开关；reduced-motion 走系统媒体查询；回滚 = `git revert` + 重发版。
- **codename 稳定（#4）**：`muzero-db`、表名、id 前缀、`TrackBrief`、provider id 不动。
- **导航约定（#9）**：本 PRD **显式覆盖** #9（见 §1.2），Phase 5 同步改写该规则文本。
- **选择器纪律（#6）**：进度热点按 leaf 隔离，`mediaEngine`/analyser 留模块作用域。
- **媒体连续性（#9 媒体部分）**：共享元素只对封面图，不搬运持久 `<video>`；`mount/unmount` 时机不变。
- **Console（#8）**：新代码走 [`logger`](../../../src/lib/logger.ts)，不直连 `console.*`。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [CLAUDE.md](../../../CLAUDE.md) | 硬规则 #6/#8/#9——本 PRD 据此约束，并在 §1.2 显式覆盖 #9、Phase 5 改写其文本 |
| [20260606-muzero-ai-dj-foundation-prd](../20260606-muzero-ai-dj-foundation-prd/20260606-muzero-ai-dj-foundation-prd.md) | DJ 续歌地基 PRD（本期消费其 store 状态，不改其逻辑） |
| [App.tsx](../../../src/App.tsx) · [player-bar.tsx](../../../src/components/player/player-bar.tsx) · [dock-nav.tsx](../../../src/components/nav/dock-nav.tsx) · [dock.tsx](../../../src/components/ui/dock.tsx) | 本期改造主体 |
| [player-store.ts](../../../src/stores/player-store.ts) · [media-engine.ts](../../../src/player/media-engine.ts) · [media-stage.tsx](../../../src/components/player/media-stage.tsx) | 状态 / 媒体 / stage 复用来源 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | NavRow tab 集合？ | ✅ Resolved | **去掉「now」，NavRow = queue/search/sets/settings 四项**。「now」不进导航行，点行1播放区即进 Now Playing（桌面切 `now` tab / 移动开 sheet）。`App.tsx` 内部仍保留 `now` tab 状态，只是不在 NavRow 呈现。 |
| 2 | 行1 收起态 transport 放多少？ | ✅ Resolved | **只放播放/暂停一个钮**。⏮⏭/repeat/音量/上传/续写全部进展开态（移动 sheet / 桌面 now 页）。 |
| 3 | 页面过渡机制？ | ✅ Resolved | **原生 View Transitions API（整页 cross-fade，渐进增强）+ motion 兜底（不支持/reduced-motion）**；共享元素（封面）统一 motion `layoutId`。 |
| 4 | 是否**完全弃用** Magic UI 放大 Dock，还是保留为桌面 hover 增强？ | Open | 倾向保留为桌面 hover 增强（不浪费既有投入，移动禁用） |
| 5 | 移动 sheet 是否支持下滑手势关闭，还是仅按钮 + 顶部把手？ | Open | 建议 v1 按钮+把手，手势作为打磨项 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | DoodleBear | Initial draft：统一底部簇（播放胶囊 + 紧凑 Dock）+ 响应式 + View Transitions |
| 2026-06-07 | DoodleBear | v2：按 Poweramp 参考改为**单一圆角容器 3 行结构**（信息+播放 / 进度 / 导航）；明确覆盖 CLAUDE.md #9（导航改集成扁平 nav row）；行1 transport 极简为单一播放钮，完整 transport 进展开态 |
| 2026-06-07 | DoodleBear | v3：锁定 Q1（NavRow = queue/search/sets/settings 四项，去「now」，点播放区进 Now Playing）、Q2（行1 仅播放/暂停）、Q3（原生 VT + motion 兜底） |
