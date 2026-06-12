# PRD: MUZERO Lyrics Motion Effects（歌词惯性滚动 + Apple Music-like 级联动效）

**Status:** Draft
**Created:** 2026-06-13
**Author:** MUZERO
**Module:** `src/components/player/synced-lyrics-view.tsx` · `src/lyrics/lyric-style.ts` · Settings / i18n · `src/db/types.ts`

> 需求来源：产品经理希望歌词字幕保留当前默认「滚动到当前歌词」模式，同时新增一种更接近 Apple Music 的歌词运动感：active 行切换后，前后歌词不是同时、僵硬地跳到新位置，而是带一点惯性和相邻行 delay 地跟随上移。本 PRD 基于当前实现与 Motion / GSAP 调研，落地为可见的歌词动效模式设置。v1 推荐继续用仓库已引入的 `motion`，不引入 GSAP。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 产品模式 + 设置契约 + 运动参数纯函数 | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 歌词 follow controller 重构：Classic / Inertial 两种滚动手感 | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Cascade 模式：active 邻近行级联 delay / residual y / opacity-scale 协调 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Settings / tuning panel / i18n / reduced-motion / 真机验收 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 当前的同步歌词面已经完成了歌词源、行级/逐字解析、翻译/罗马音与基础 Apple-Music 风的逐行高亮：

- [`SyncedLyricsView`](../../../src/components/player/synced-lyrics-view.tsx) 通过 `useActiveLyricLine` 以 rAF 读取 `MediaEngine.getCurrentTime()`，只在 active line index 变化时重渲染，避免播放期每帧刷新整树。
- [`SyncedLines`](../../../src/components/player/synced-lyrics-view.tsx) 当前用原生滚动容器加 rAF follow：将 active 行中心缓慢 lerp 到 viewport 顶部约 38% 的视觉锚点。
- 每行已经是 `motion.button`，active/inactive 通过 `opacity + scale` 做过渡，避免 font-size 触发布局和重排。
- 富歌词 PRD 已完成逐字 karaoke fill、翻译与罗马音子行；本 PRD 不再扩展歌词格式。

当前问题是：active 行变化时，整体滚动虽然平滑，但质感仍更像「容器把当前行拉到锚点」。产品希望补一种「歌词栈被新 active 行牵引」的感觉：active 行移动更有重量，前后歌词有轻微滞后、层叠跟随和残余位移。

### 1.2 Target Users

| Role | Description | Value |
|------|-------------|-------|
| **沉浸听歌用户** | 在 Now Playing / 全屏歌词里跟唱，关注歌词与音乐节奏是否贴合。 | 获得更接近 Apple Music 的歌词流动感。 |
| **偏好稳定/低动效用户** | 对动态敏感，或只想要清晰字幕。 | 保留当前 Classic 默认；尊重 `prefers-reduced-motion`。 |
| **桌面用户** | 主要在 1180×780 左右的桌面窗口听歌。 | 歌词在右栏/沉浸式背景上更有质感，但不影响播放性能。 |

### 1.3 Core Value

1. **默认稳定**：现有用户不被打扰，`Classic` 继续作为默认。
2. **可选择的高级动效**：新增 `Inertial` 与 `Cascade`，满足产品要的「惯性 + 前后歌词 delay」。
3. **低风险复用现有技术栈**：继续使用已在仓库里的 `motion`，不引入 GSAP，不新增 runtime owner。
4. **性能可控**：滚动和逐字 fill 仍走 DOM / MotionValue / rAF，不把每帧状态放进 React 或 Zustand。

---

## 2. Research Summary

### 2.1 Apple Music-like 歌词体验拆解

本 PRD 不复制 Apple Music 的品牌视觉，只拆解可落地的交互特征：

| Layer | 现状 | 目标 |
|-------|------|------|
| Active line tracking | 已有：active 行滚到 38% 锚点 | 保留，并允许更有惯性的 spring 手感 |
| Line emphasis | 已有：active opacity/scale，非 active 变小变淡 | 保留，可按模式调整 transition |
| Neighbor response | 目前基本同步移动 | `Cascade` 模式让 active 附近行带距离相关 delay / y offset |
| Word-level karaoke | 已有：逐字 fill | 不改；与运动模式正交 |
| User scroll detach | 已有：wheel/touch 脱离 follow + “回到当前”按钮 | 必须保留 |

### 2.2 Motion vs GSAP

| Option | Fit | Decision |
|--------|-----|----------|
| **Motion / `motion`** | 仓库已依赖 `motion@^12`；现歌词行已用 `motion.button`；官方支持 spring / inertia transitions、`useSpring`、motion values、layout animations。 | ✅ v1 采用 |
| **GSAP ScrollToPlugin** | 能很好地 tween `scrollTop`，有 `autoKill` 处理用户手动滚动打断。 | ❌ v1 不引入；收益不足以覆盖新依赖/桥接成本 |
| **GSAP InertiaPlugin** | 更强的惯性/甩动模型，适合复杂拖拽和 timeline。 | ❌ out of scope；未来做复杂歌词秀再评估 |
| **纯 CSS transition** | 可做 opacity/scale，但难以控制 scrollTop spring 与用户打断。 | ❌ 只作为 per-row 样式辅助 |

参考：

- Motion layout / transition / spring docs: https://motion.dev/docs/react-layout-animations · https://motion.dev/docs/react-transitions · https://motion.dev/docs/react-use-spring
- GSAP ScrollTo / Inertia docs: https://gsap.com/docs/v3/Plugins/ScrollToPlugin/ · https://gsap.com/docs/v3/Plugins/InertiaPlugin/
- Apple Music Sing / animated synced lyrics public reporting: https://www.wired.com/story/apple-music-sing/

### 2.3 Dependency Policy

本 PRD 属于「Effect / 外部依赖类」轻量动效 PRD，按 `.cursor/commands/prd-create.md` 的附加要求：

- **License 第一公民**：v1 不新增第三方动画库；`motion` 已在依赖树中。
- **不新增 runtime owner**：不引入 GSAP / anime.js / 自定义 timeline runtime。
- **可见设置，不藏 flag**：动效模式必须是 Settings 控件，不用 `localStorage` / URL / `window.*`。
- **回退 = git revert**：没有远程 kill switch。

---

## 3. System Architecture

### 3.1 Architecture Overview

```
MediaEngine.getCurrentTime()
          │
          ▼
activeLineIndex(lines, ms)
          │
          ▼
LyricsMotionMode setting
          │
          ├─ classic   ── current rAF lerp scrollTop follow
          │
          ├─ inertial  ── spring-follow scrollTop target
          │
          └─ cascade   ── spring-follow + neighbor row stagger / residual y
          │
          ▼
SyncedLines viewport
          │
          ├─ user wheel/touch → detach follow
          ├─ click lyric line → seek + reattach follow
          └─ Follow current button → reattach follow
```

### 3.2 Key Design Decisions

| Decision | Requirement |
|----------|-------------|
| **Keep Classic default** | Existing behavior remains default and regression baseline. |
| **Mode is persisted setting** | `AppSettings.lyricsMotionMode?: "classic" | "inertial" | "cascade"`; visible in Lyrics settings and tuning panel. |
| **No DB migration** | `settings` is a single Dexie row; optional field, no store schema bump. |
| **No per-frame React state** | MotionValues / DOM writes / rAF refs only; React state changes only when active line or user follow state changes. |
| **No scattered provider-style branches** | A single resolver decides motion config; UI passes `mode`, renderer consumes resolved config. |
| **Reduced motion wins** | `prefers-reduced-motion` forces Classic-like instant/low-motion behavior regardless of selected mode. |
| **Lenis conflict must be resolved** | Current lyrics viewport calls `useSmoothScroll(viewportRef)` while follow code writes `scrollTop` directly. Phase 2 must stop these two controllers fighting. |

### 3.3 Project Structure

```
src/
├── db/
│   └── types.ts                         # AppSettings += lyricsMotionMode?
├── lyrics/
│   ├── lyric-style.ts                   # LyricStyle may include resolved motion-safe transition hints
│   └── lyric-motion.ts                  # 🆕 pure resolver: mode → scroll + row animation config
├── components/player/
│   ├── synced-lyrics-view.tsx           # SyncedLines follow controller + row transitions
│   ├── lyrics-tuning-controls.tsx       # visible segmented control
│   └── lyrics-tuning-panel.tsx          # reuses controls
├── components/settings/
│   └── lyrics-settings.tsx              # shared controls already embedded
└── i18n/locales/{en,zh,ja,ko}/common.json
```

> 新文件只允许 `src/lyrics/lyric-motion.ts` 这种纯配置/决策文件；不新增动画 runtime bridge。

---

## 4. Data Model Design

### 4.1 Settings Field

```ts
// src/db/types.ts — AppSettings
/**
 * Synced lyrics motion mode.
 * classic = current behavior;
 * inertial = spring-follow scroll;
 * cascade = spring-follow plus neighbor stagger.
 * undefined defaults to "classic".
 */
lyricsMotionMode?: "classic" | "inertial" | "cascade";
```

### 4.2 Pure Resolver

```ts
// src/lyrics/lyric-motion.ts
export const LYRICS_MOTION_MODES = ["classic", "inertial", "cascade"] as const;
export type LyricsMotionMode = (typeof LYRICS_MOTION_MODES)[number];

export interface ResolvedLyricsMotion {
  mode: LyricsMotionMode;
  follow: {
    kind: "lerp" | "spring";
    anchorRatio: number;      // default 0.38
    lerp?: number;            // classic
    stiffness?: number;       // inertial/cascade
    damping?: number;
    mass?: number;
  };
  row: {
    transition: "tween" | "spring";
    neighborDelayMs: number;  // 0 classic, >0 cascade
    residualYPx: number;      // 0 classic/inertial, >0 cascade
    maxAffectedDistance: number;
  };
}

export function resolveLyricsMotionMode(
  mode: LyricsMotionMode | undefined,
  env: { reducedMotion: boolean },
): ResolvedLyricsMotion;
```

### 4.3 Defaults

| Mode | Label | Follow | Row Animation | Default |
|------|-------|--------|---------------|---------|
| `classic` | Classic / 经典 | current `scrollTop += delta * 0.16` style | current 350ms opacity/scale tween | ✅ |
| `inertial` | Inertial / 惯性 | spring to target scrollTop | spring opacity/scale, no neighbor delay |  |
| `cascade` | Cascade / 级联 | spring to target scrollTop | neighbor delay + residual y offset by distance from active |  |

### 4.4 Migration / Rollback

- **Migration:** none. Optional settings field defaults to `classic`.
- **Rollback:** revert PR; old clients ignore `lyricsMotionMode`.
- **Data quality:** invalid persisted value is sanitized to `classic` by resolver.

---

## 5. Frontend Design

### 5.1 Settings UI

Reuse existing lyrics controls rather than creating a new page:

- Location: Settings → Lyrics, via [`LyricsTuningControls`](../../../src/components/player/lyrics-tuning-controls.tsx), so the floating lyrics tuning panel and Settings stay in sync.
- Control: segmented control / select with three options:
  - `Classic`: stable follow, current behavior.
  - `Inertial`: heavier spring follow.
  - `Cascade`: Apple Music-like neighbor delay.
- Tooltip / hover copy may explicitly use **Apple Music-like** as a descriptive phrase, e.g. "Apple Music-like cascading lyric motion", while the persisted mode id remains codename-stable (`cascade`).
- Reduced-motion hint: when OS reduce motion is active, show a local hint that advanced modes are softened.

All labels go through i18n keys under `lyricsSettings.*`.

### 5.2 SyncedLines Behavior

Current behavior to preserve:

- Active line calculation remains in `useActiveLyricLine`.
- Wheel/touch detaches following.
- Tapping a line seeks and reattaches.
- “Follow current” button reattaches.
- Word-by-word karaoke fill remains independent of motion mode.

New behavior:

| Mode | Scroll Follow | Per-row Motion |
|------|---------------|----------------|
| `classic` | Existing rAF lerp. | Existing `opacity + scale` transition. |
| `inertial` | Target scroll position is followed by a spring value; DOM `scrollTop` updates from MotionValue subscription. | Active/inactive transitions use spring values, no neighbor delay. |
| `cascade` | Same spring follow. | Neighbor rows receive distance-based delay and transient y offset. Active line settles first; nearby previous/next lines follow within ~20-90ms. |

### 5.3 Lenis / Smooth Scroll Interaction

Current code calls `useSmoothScroll(viewportRef)` inside lyrics and also directly mutates `viewport.scrollTop`. This is fragile because Lenis maintains its own target and can snap back when raw scrollTop writes happen.

Required fix in Phase 2:

| Option | Decision |
|--------|----------|
| Route follow through Lenis | Acceptable for manual/programmatic scroll, but spring-follow needs frame-level control. |
| Disable Lenis while auto-following lyrics | ✅ Preferred for lyrics viewport. Lyrics has its own dedicated follow controller; global smooth scroll should not own it. |
| Keep both | ❌ Not allowed; produces double smoothing / target desync risk. |

The lyrics viewport should remain native `overflow-y-auto overscroll-contain`; global smooth scroll hook should not own this surface while follow is active.

### 5.4 Accessibility

- Respect `prefers-reduced-motion`: advanced modes degrade to low-motion Classic behavior.
- Keyboard/click seek behavior unchanged.
- Text must remain readable; cascade y offset must be small enough not to overlap sub-lines or translations.
- Touch targets remain ≥44px.

---

## 6. Implementation Plan

### Phase 1: Product Mode + Settings Contract

**Goal:** Add the visible product mode and pure config resolver without changing runtime motion yet.

**Tasks:**
- [ ] Add `lyricsMotionMode?: "classic" | "inertial" | "cascade"` to `AppSettings`.
- [ ] Add `src/lyrics/lyric-motion.ts` with mode constants, sanitizer, and `resolveLyricsMotionMode`.
- [ ] Add unit tests for resolver defaults, invalid values, and reduced-motion fallback.
- [ ] Add i18n keys for en / zh / ja / ko.
- [ ] Add UI control in shared lyrics tuning controls; default selection displays Classic.

### Phase 1 Checklist

- [ ] Old settings rows render as Classic.
- [ ] Invalid stored mode resolves to Classic.
- [ ] Reduced-motion resolver returns low-motion config.
- [ ] No hidden localStorage / URL / global flags.
- [ ] Typecheck and Biome pass for touched files.

### Phase 2: Follow Controller Refactor

**Goal:** Make the current follow behavior explicit and add Inertial mode without breaking user scroll detach.

**Tasks:**
- [ ] Extract target scroll calculation from `SyncedLines` into a small local helper: active line center → viewport anchor target.
- [ ] Keep Classic using current lerp behavior as baseline.
- [ ] Implement Inertial mode using Motion `useMotionValue` / `useSpring` or `animate` with DOM `scrollTop` subscription.
- [ ] Remove or bypass `useSmoothScroll(viewportRef)` for lyrics auto-follow to avoid Lenis target conflicts.
- [ ] Preserve follow detach/reattach behavior.

### Phase 2 Checklist

- [ ] Classic mode visual behavior matches current baseline.
- [ ] Inertial mode settles to the same target as Classic, without overshooting into negative scroll.
- [ ] User wheel/touch cancels follow in all modes.
- [ ] Clicking a lyric line seeks and reattaches follow.
- [ ] No React state updates occur every frame.

### Phase 3: Cascade Mode

**Goal:** Add the Apple Music-like delayed neighbor motion.

**Tasks:**
- [ ] For each row, compute `distance = Math.abs(i - activeIndex)`.
- [ ] In Cascade, apply distance-based transition delay capped by `maxAffectedDistance`.
- [ ] Add small transient y offset for affected rows, based on direction of active index movement.
- [ ] Ensure translation/romanization sub-lines move as part of the same row, not independently.
- [ ] Tune motion constants on desktop viewport first; verify mobile does not overlap.

### Phase 3 Checklist

- [ ] Active row becomes visually dominant immediately enough to read on beat.
- [ ] Neighbor rows follow within a short window; effect is visible but not sluggish.
- [ ] No row overlap with long lyrics, translations, or romanization.
- [ ] Word-by-word fill remains correct while row motion is active.
- [ ] `prefers-reduced-motion` disables cascade offset/delay.

### Phase 4: Settings, QA, and Acceptance

**Goal:** Polish UX, document behavior, and validate on real playback.

**Tasks:**
- [ ] Place control in Settings → Lyrics and any existing lyrics tuning popover.
- [ ] Add four-locale i18n.
- [ ] Add component tests for selected mode wiring.
- [ ] Manual QA with line-level LRC and word-level TTML/YRC.
- [ ] Desktop QA at Tauri default window size 1180×780 and a narrow viewport.

### Phase 4 Checklist

- [ ] Switching modes while a song plays does not reset playback or detach current track.
- [ ] Mode persists across reload.
- [ ] Advanced modes do not break manual scroll / follow-current button.
- [ ] No console usage added; logging only via logger if needed.
- [ ] `make check` passes, or unrelated failures are documented.

---

## 7. Out of Scope

- **New lyrics providers / formats**: already covered by synced/rich lyrics PRDs; this PRD only changes motion.
- **GSAP integration**: out of v1. Revisit only if future requirements need complex timeline choreography, text splitting, or drag/inertia beyond Motion’s scope.
- **AMLL full visual renderer**: no dependency on `@applemusic-like-lyrics/*`; no AGPL code.
- **3D / particle / shader lyric effects**: not part of this UX pass.
- **Per-track motion presets**: one global setting only.
- **Telemetry / A-B testing**: local-first; no analytics.

---

## 8. Security / Privacy / Compliance

- **No network / no backend**: pure frontend animation, no new requests.
- **No secrets**: does not touch BYOK settings.
- **No telemetry**: no user lyrics, track titles, timing, or mode choices leave device.
- **No hidden flags**: visible Settings only.
- **License**: v1 adds no dependency. Existing `motion` dependency is already in `package.json`; GSAP is intentionally not added.
- **Accessibility**: reduced-motion is mandatory; Classic remains available.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Synced Lyrics PRD](../20260610-muzero-synced-lyrics-lrclib-prd/20260610-muzero-synced-lyrics-lrclib-prd.md) | Baseline synced lyrics architecture and current Apple-Music-style line following. |
| [Rich Lyrics Formats PRD](../20260611-muzero-rich-lyrics-formats-prd/20260611-muzero-rich-lyrics-formats-prd.md) | Word-level karaoke, translation, romanization, TTML/YRC/QRC/ELRC parsing. |
| [Smooth Scroll Lenis PRD](../20260611-muzero-smooth-scroll-lenis-prd/20260611-muzero-smooth-scroll-lenis-prd.md) | Global smooth scroll architecture and exclusion rationale; important for lyrics viewport conflict. |
| [`synced-lyrics-view.tsx`](../../../src/components/player/synced-lyrics-view.tsx) | Primary implementation surface. |
| [`lyric-style.ts`](../../../src/lyrics/lyric-style.ts) | Current visual style resolver for font size, opacity, color, shadow, line gap. |
| Motion docs | https://motion.dev/docs/react-transitions · https://motion.dev/docs/react-use-spring |
| GSAP docs | https://gsap.com/docs/v3/Plugins/ScrollToPlugin/ · https://gsap.com/docs/v3/Plugins/InertiaPlugin/ |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 默认模式是否保持当前 Classic？ | ✅ Resolved | 是。Classic 默认，避免打扰现有用户。 |
| 2 | v1 是否引入 GSAP？ | ✅ Resolved | 否。先用现有 Motion。 |
| 3 | 模式命名是否用 Classic / Inertial / Cascade？ | ✅ Resolved | 保留 `Classic / Inertial / Cascade` 作为 UI 基础命名；hover tooltip / popover 可明确使用 **Apple Music-like** 这类说明性字眼，例如 "Apple Music-like cascading lyric motion"。持久化 id 仍保持 `classic/inertial/cascade`。 |
| 4 | Cascade 的具体强度是否开放给用户调节？ | ✅ Resolved | v1 不开放。只开放模式选择，避免设置复杂化。 |
| 5 | 沉浸式歌词 overlay 是否使用同一模式？ | ✅ Resolved | 使用同一全局 `lyricsMotionMode`，Now Playing 右栏、移动歌词面、沉浸式歌词 overlay 保持统一动效口径；后续若要 overlay 专属增强，另开 PRD。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | MUZERO | Initial draft: lyrics motion modes PRD. Recommends Motion-based Classic / Inertial / Cascade; explicitly excludes GSAP v1; captures Lenis conflict and reduced-motion requirements. |
| 2026-06-13 | MUZERO | Resolved Q3/Q5: UI may explicitly describe Cascade as Apple Music-like in hover tooltip/popover copy; all lyrics surfaces, including immersive overlay, use one global `lyricsMotionMode`. |

---

> **Note:** 本 PRD 是 synced/rich lyrics 的 UX follow-up。它不改变歌词数据来源、解析格式或逐字 timing 模型，只改变「active 行切换后歌词栈如何运动」。优先扩展现有 `SyncedLines` 与 `LyricsTuningControls`，新增代码限定在纯 resolver 和局部 follow controller 内。
