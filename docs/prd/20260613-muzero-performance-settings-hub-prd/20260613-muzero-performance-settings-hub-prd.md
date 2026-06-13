# PRD: MUZERO 性能设置中枢(Settings「性能」侧栏项)

**Status:** Draft
**Created:** 2026-06-13
**Author:** Claude
**Module:** Settings IA - 新增「性能」pane,聚合「画质/特效 ↔ FPS/续航」取舍开关

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 「性能」pane(GPU 加速 + 开销开关)+ IA + i18n | ✅ 代码完成 | [Phase 1](#phase-1-性能-pane) |
| 2 | 画质预设(省电 / 均衡 / 画质,一键套用) | ✅ 代码完成 | [Phase 2](#phase-2-画质预设) |

> **定位(已拍板):性能页是「开关」面板——硬件加速(是否/如何用 GPU)+ 重负载层的开/关**,**不放效果调节**(dim/opacity 这类 slider、渲染器风格选择属「效果」,留在背景/可视化页)。

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

性能相关的开关现在**散落在多个面板**:GPU 后端/性能档在「背景」面板里(语义上它是硬件/性能取舍,放在「外观>背景」错位),而真正影响 FPS 的 `backgroundRenderer`(noise=Pixi 是最重的那个)、`visualizerAsBackground` + dim/opacity、`flowEnabled`、`immersiveIdle` 又分散在背景/可视化/流光各页。用户想「降帧时调一下」找不到统一入口。

本 PRD 新增一个**独立「性能」侧栏项**,把这些「拿画质/特效换帧率/续航」的旋钮**聚合到一处**(单一数据源不变,只是多一个就近编辑入口),并配一段「什么吃 FPS」的说明。GPU 控件**同时保留**在背景面板(就近控制它影响的 Pixi 背景)。

> 这是 [`20260613-muzero-now-playing-switch-background-perf-prd`](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) 的延伸:那份解决「切歌掉帧」的渲染机制,本份解决「性能开关的可发现性/信息架构」。

### 1.2 Target Users

| Role | Description |
|------|-------------|
| 低端/集显/笔电用户 | 想一处把背景特效降下来、切省电、关流光,换 FPS/续航 |
| 高性能设备用户 | 想确认走的是 WebGPU + 高性能 GPU,享受满特效 |
| QA / 排查 | 掉帧时快速逐项关掉重负载层定位瓶颈 |

### 1.3 Core Value

1. **一处可调**:所有「画质 ↔ 性能」取舍集中,降帧时不必翻三个面板。
2. **语义归位**:GPU 后端/性能档从「外观」移到「性能」语境(背景面板保留就近入口)。
3. **可解释**:每项标注它的性能影响(谁最吃 FPS),让取舍有依据。

---

## 2. System Architecture

### 2.1 IA 变更([`settings-nav.ts`](../../../src/components/settings/settings-nav.ts))

在 `SETTINGS_NAV` 新增一个**单项 section**(与现有 `navSecStorage`/`navSecListening`/`navSecAdvanced` 单项 section 同范式),放在 `navSecAppearance` 之后:

```ts
{
  labelKey: "settings.navSecPerformance",
  items: [{ id: "performance", labelKey: "settings.navPerformance", icon: "gauge" }],
},
```

- pane 注册:[`settings-page.tsx`](../../../src/pages/settings-page.tsx) 加一行 `{activeItem === "performance" && <PerformanceSettings />}`(与 `background`/`visualizer` 同模式)。
- 不需要改 `resolveActiveSettingsItem` 逻辑(自动纳入 id 集);如担心旧持久化选择,无需 alias(新 id 不会与旧冲突)。

### 2.2 数据流(单一数据源)

```
PerformanceSettings ─┐
                     ├─ saveSettings({ <existing field> })  ←→  同一 settings 行
BackgroundEffect ────┘            (GPU 两项两个 pane 共写同一字段,无副本)
```

**不新增设置字段(Phase 1)**——只渲染绑定到现有字段的控件。Phase 2 的预设若做,才新增一个 `graphicsQualityPreset`。

---

## 3. Data Model

### 3.1 Phase 1:复用现有字段(均已存在于 [`db/types.ts`](../../../src/db/types.ts))

| 字段 | 现默认 | 性能含义 |
|---|---|---|
| `backgroundGpuBackend` | "auto" | GPU 后端(本 PRD 上游已加) |
| `backgroundGpuPowerPreference` | "auto" | GPU 性能档(同上) |
| `backgroundRenderer` | "noise" | **最重的 FPS 杠杆**(noise/pixel/… 走 Pixi;image/blur 轻) |
| `visualizerAsBackground` | true | 频谱当背景(每帧合成) |
| `visualizerBackgroundDim` / `visualizerBackgroundOpacity` | 30 / 70 | 背景合成 dim/opacity(alpha 合成成本) |
| `flowEnabled` | true | 流光层(额外 shader) |
| `immersiveIdle` | true | 闲置时是否继续沉浸渲染 |
| `visualizerStyle` | "bars" | "off" 最省 |

### 3.2 Phase 2:画质预设(**改为 derive,不存字段**)

- **不新增 DB 字段**——实现时改为**从现有设置派生**活动预设([`graphics-quality.ts`](../../../src/lib/graphics-quality.ts) `matchActiveQualityPreset`),比存 `graphicsQualityPreset` 更稳:手动改任一开关(本页或背景/可视化页)自然读回 `"custom"`,**没有需要同步的字段**。App 默认值正好匹配 `"quality"`。
- 选某预设 = `saveSettings(resolveQualityPresetSettings(preset))` 写一组字段(纯函数 bundle);选择器的当前值 = `matchActiveQualityPreset(settings)`。
- 预设梯度:battery(`image`/全关/low-power)→ balanced(`blur`/viz 开 flow 关)→ quality(`noise`/全开,= 默认)。

---

## 4. Frontend Design

### 4.1 新组件 `PerformanceSettings`([`src/components/settings/performance-settings.tsx`](../../../src/components/settings/performance-settings.tsx))

一个 `Card`,标题 `t("performance.title")`。**只放「开关型」控件**(加速 + 开/关),**不放效果调节 slider**(dim/opacity 留可视化页;渲染器风格选择留背景页):

1. **硬件加速(GPU)**:复用与背景面板相同的两个 `Select`(后端 auto/WebGPU/WebGL、性能档 auto/高性能/省电)。**抽出共享子组件** `GpuBackendControls`(从 `background-effect-controls.tsx` 抽出),背景面板与性能 pane 都引用,避免两份控件代码。
2. **重负载层开关**:`visualizerAsBackground`、`flowEnabled`、`immersiveIdle` 三个 `Switch`/checkbox + 各一句「关掉省 FPS/续航」说明。**都是 on/off**,符合性能页定位。
3. **说明块**:`t("performance.explainer")` —— 简述哪些层吃 FPS/续航;并指路「想换背景渲染器(image/blur 更省)去 设置→背景」。

> **不进性能页**:`visualizerBackgroundDim`/`Opacity`(效果 slider,留可视化页)、`backgroundRenderer` 风格下拉(效果选择,留背景页)。控件复用现有 `Select`/`Switch`/checkbox + `saveSettings`,文案走 i18n。

### 4.2 GPU 控件双置(去重)

- 把现 [`background-effect-controls.tsx`](../../../src/components/settings/background-effect-controls.tsx) 里那段 GPU 后端/性能档 JSX **抽成 `GpuBackendControls` 组件**,背景面板与性能 pane 都渲染它(读写同字段)。这样不产生重复控件逻辑,只是两个入口。

### 4.3 i18n(en 先,再 zh/ja/ko)

- 新 section/item:`settings.navSecPerformance`、`settings.navPerformance`。
- pane 文案:`performance.title`、`performance.explainer`、各分组 label + hint(`performance.groupGpu/Background/Overlays`、`performance.rendererHint`、`performance.visualizerBgHint`、`performance.flowHint`、`performance.immersiveIdleHint` 等)。GPU 子控件文案复用已加的 `background.gpu*`。
- Phase 2 预设:`performance.preset*`(battery/balanced/quality/custom + hint)。

### 4.4 图标

`gauge`(或 `zap`/`activity`);若图标集无 `gauge`,`make icons` 重生成或选现有近似(沿用 `settings-nav` 的 lucide 名)。

---

## 5. Implementation Plan

### Phase 1: 「性能」pane

**Goal:** 新增独立「性能」侧栏项,聚合现有性能开关 + GPU 控件 + 说明;不新增设置字段。

**Tasks:**
- [x] `settings-nav.ts` 加 `navSecPerformance` section + `performance` item(icon `gauge`);`settings-sidebar.tsx` 注册 `Gauge` 图标;更新 [`settings-nav.test.ts`](../../../src/components/settings/settings-nav.test.ts) 期望 id 集(`performance` 排在 `lyrics` 后)。
- [x] 抽 [`GpuBackendControls`](../../../src/components/settings/gpu-backend-controls.tsx) 共享子组件(从 `background-effect-controls.tsx`);背景面板改为引用它(行为不变)。
- [x] 新建 [`PerformanceSettings`](../../../src/components/settings/performance-settings.tsx):GPU 组(复用 `GpuBackendControls`)+ 三个开关(viz-as-bg / flow / immersive-idle,通用 `PerfToggle`,类型安全的 boolean 字段)+ 说明块。**不含**渲染器下拉、**不含** dim/opacity slider。
- [x] `settings-page.tsx` 注册 `{activeItem === "performance" && <PerformanceSettings />}`。
- [x] i18n:en/zh/ja/ko 全部补 `settings.navSecPerformance`/`navPerformance` + 新 `performance` 命名空间。

**Checklist:**
- [x] `settings-nav.test.ts`(7 例)通过;`src/` 全量 **2370 例**通过(含 i18n 对齐);`tsc`/Biome 干净。
- [ ] **待实测(桌面)**:侧栏出现「性能」项,点开各控件读写正确、与背景面板/可视化页同字段联动;背景面板 GPU 控件改用共享子组件后行为不变。

### Phase 2: 画质预设

**Goal:** 一键「省电 / 均衡 / 画质」,套用一组字段;手动改任一项转 custom。

**Tasks:**
- [x] **不加 DB 字段**——[`graphics-quality.ts`](../../../src/lib/graphics-quality.ts):`QUALITY_PRESET_BUNDLES`(battery/balanced/quality 三组 bundle)+ `resolveQualityPresetSettings(preset)` + `matchActiveQualityPreset(settings)`(派生活动预设,默认匹配 quality);6 例单测。
- [x] `PerformanceSettings` 顶部加预设选择器:value=`matchActiveQualityPreset(settings)`,选 battery/balanced/quality 即 `saveSettings(bundle)`;`custom` 为派生态(disabled,手动改任一开关自然回落)。
- [x] i18n:en/zh/ja/ko 加 `performance.preset*`。

**Checklist:**
- [x] 预设纯函数单测(6 例:bundle 取值、默认=quality、混搭=custom、undefined 用默认匹配);`src/` 全量 **2376 例**通过;`tsc`/Biome 干净。
- [ ] **待实测(桌面)**:选预设后相关开关一致变化;手动改任一项选择器回落 custom。

---

## 6. Out of Scope

- **不新增 MUZERO 级 reduced-motion 开关**:动效减弱目前跟随系统 `prefers-reduced-motion`(见 `view-transition` 兜底);如要 app 级开关,另开 PRD。
- **不动渲染机制本身**:持久化 Pixi / settle 去抖 / device-lost 属上游 background-perf PRD。
- **不动其他面板的非性能设置**(只「就近」surface 性能相关项,不搬走背景/可视化页的全部控件)。

---

## 7. Security / 本地优先

- 无新增出站、无后端、无遥测;所有写入仍是本地 `settings` 行。
- 无隐藏 flag(硬规则 3):全是可见 Settings 控件。
- codename 层不变(硬规则 4)。

---

## 8. Related Documents

| Document | Description |
|----------|-------------|
| [now-playing-switch-background-perf PRD](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) | 渲染机制(持久 Pixi + settle + GPU 后端字段),本 PRD 的上游 |
| [settings-information-architecture PRD](../20260613-muzero-settings-information-architecture-prd.md) | 两栏 Settings IA(section→item)的来源 |

---

## 9. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 「性能」section 放侧栏哪个位置? | ✅ Resolved | 放 `navSecAppearance` 之后(高可发现) |
| 2 | dim/opacity Slider 要不要进性能 pane? | ✅ Resolved | **不进**——它们是效果调节;性能页只放「开关型」(加速 + 开/关)。渲染器风格下拉同理不进 |
| 3 | Phase 2 画质预设这次做不做? | ✅ Resolved | **做**(Phase 1 后接 Phase 2) |
| 4 | 图标用 `gauge` 是否在现有 lucide 集? | Open | 实现时确认,缺则选近似 + `make icons` |

---

## 10. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Claude | 初稿:独立「性能」pane 聚合现有性能开关 + GPU 控件双置;Phase 2 画质预设可选 |
| 2026-06-13 | Claude | 拍板:性能页定位为「开关」面板(加速 + 开/关),移除 dim/opacity slider 与渲染器下拉;位置放外观之后;Phase 2 画质预设纳入本期 |
| 2026-06-13 | Claude | Phase 1 代码完成:新增「性能」侧栏项 + `PerformanceSettings`(GPU + 三开关)+ 抽出共享 `GpuBackendControls`(背景面板复用)+ en/zh/ja/ko;`src` 全量 2370 例通过 |
| 2026-06-13 | Claude | Phase 2 代码完成:`graphics-quality`(battery/balanced/quality bundle + 派生活动预设,**不存字段**)+ 预设选择器 + en/zh/ja/ko;6 例新单测,`src` 全量 2376 例通过 |
