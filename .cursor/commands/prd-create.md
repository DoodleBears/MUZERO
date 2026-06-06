# PRD (Product Requirement Document) 创建指南

## 🎯 概述

本指南介绍项目的 PRD（产品需求文档）创建工作流，包括文档创建、组织、维护和协作等完整流程。确保每个功能开发都有清晰的产品需求定义，为开发、测试和部署提供标准化的指导。

请根据 prompt 中的需求分析，创建 PRD 文档

## 📋 目录结构

### 1. 相关功能分组
- **相同日期目录**：相关联的功能可以放在同一个日期目录下
- **版本迭代**：同一个功能的多次迭代使用不同日期
- **关联引用**：在 PRD 中引用相关的其他文档


### 2. 目录导航
```bash
# 查看所有 PRD 文件
find docs/prd -name "*.md" | grep -v template

# 查看特定模块的 PRD
find docs/prd/reading-prd -name "*.md"

# 查看最近的 PRD
find docs/prd -name "*.md" -mtime -7 | head -10
```


## 📝 PRD 文件命名规范

### 1. 基本格式
```
YYYYMMDD-<prd key content>-prd.md
```

### 2. 命名规则
- **日期格式**：`YYYYMMDD`（年月日，无分隔符）
- **内容标识**：用 `-` 分隔的关键内容关键词
- **文件后缀**：固定为 `-prd.md`


### 3. 命名示例

```bash
20250915-add-dark-mode-support-prd.md
```

## 🏗️ PRD 创建工作流

### Phase 1: 需求分析与规划

#### 1.1 识别需求来源
请根据 prompt 中的需求分析，识别需求来源

#### 1.2 评估开发价值
- **业务价值**：解决的用户问题、带来的收益
- **技术价值**：代码质量改善、维护性提升
- **优先级评估**：紧急程度、影响范围

### Phase 2: PRD 文档创建

#### 2.1 准备工作目录
```bash
# 1. 确定功能模块
# 示例：音频播放功能属于 reading-prd/audio-prd

# 2. 创建日期目录（如果不存在）
mkdir -p docs/prd/reading-prd/audio-prd/20250915-add-playback-controls-prd

# 3. 复制模板文件
cp docs/prd/prd-template.md docs/prd/reading-prd/audio-prd/20250915-add-playback-controls-prd/20250915-add-playback-controls-prd.md
```

#### 2.2 填写 PRD 内容
基于项目模板 `docs/prd/prd-template.md` 填写 PRD 内容

- **明确性**：需求描述清晰，无歧义
- **完整性**：覆盖所有使用场景和边界情况
- **可实现性**：技术上可行，资源充足
- **可测试性**：每个需求都可以验证


## 🔄 PRD 生命周期管理

### 1. 状态管理
```markdown
**Status:** Draft      # 草稿阶段
**Status:** Final      # 定稿可执行
**Status:** Completed  # 开发完成
**Status:** Deprecated # 已废弃
```

### 2. 关联管理
```markdown
## Related Documents
- [API 设计文档](../api/audio-api-v1.md)
- [UI 设计稿](../design/audio-player.fig)
- [测试用例](../test/audio-player-tests.md)

## Related Issues
- Closes #123: Audio player enhancement request
- Related to #456: Mobile audio support
```

## 🎯 最佳实践

### 1. PRD 编写原则
- **用户中心**：从用户视角出发，关注用户价值
- **可度量**：每个需求都有明确的验收标准
- **可拆分**：复杂功能拆分为可独立开发的任务
- **可验证**：每个需求都可以通过测试验证

### 2. 商业化 / Paywall PRD 附加要求
- **Release 状态先行**：明确产品是否已正式 release、是否已有付费用户；如果没有付费用户，可以优先选择更清晰的 tier 命名、Stripe lookup key 和 entitlement model，不需要为历史付费权益背负迁移成本。
- **价格与能力分离**：PRD 必须同时写清楚价格假设、功能 gate、视觉惩罚/水印/片尾、导出限制、素材数量限制、AI/BYOK 成本边界，避免只写价格表。
- **竞品差异化**：对 CapCut/剪映、OpusClip、Adobe Premiere/After Effects、Final Cut Pro、DaVinci Resolve 等竞品分别写出价格锚点、核心强项、ClipCombo 不追随的范围、ClipCombo 要赢的 job-to-be-done。
- **Stripe fixture 对齐**：任何 public plan 都要映射到明确的 internal tier、lookup key、entitlement keys 和 checkout/portal 行为；前端展示价格应来自 API 或 fixture snapshot，不在 UI 中散落硬编码。
- **可解释的 paywall**：付费卡点要发生在用户理解价值的时刻，提供可预览的 locked state，并说明升级后立刻解锁什么，不用羞辱式文案。
- **本地化与法规**：pricing、paywall、来源说明、AI/BYOK 成本披露必须进入 i18n；价格调研要标注日期、地区和来源，避免把竞品浮动价格写成永久事实。
- **实验与复盘**：上线前定义 activation、paywall intent、checkout start、checkout complete、refund/cancel reason；定价未确认时，可以先做预算 slider / 竞品矩阵帮助用户和团队理解价格带。

### 3. Effect / Shader / 外部依赖类 PRD 附加要求

针对引入 GPU shader、第三方 filter 库（如 `pixi-filters`、`gl-transitions`）、外部资产（LUT / displacement map / preset library）或付费 plugin（如 Club GSAP）的 PRD，参考 [`docs/prd/clip-prd/20260527-clipcombo-color-adjust-effect-prd/`](../docs/prd/clip-prd/20260527-clipcombo-color-adjust-effect-prd/) 的扩展模式：

- **License 第一公民**：每个第三方 shader / filter 必须在 PRD 表格中声明 `license.source` / `spdx` / `attribution` / `url` 四元组；使用语义化 enum（`"pixi-filters"` / `"gl-transitions"` / `"clean-room"` / `"other"`），不要散落在注释里。MIT / Apache / CC0 / CC BY 是 ship-friendly；GPL / 商业 EULA / 未明 license 默认 out-of-scope，需开单独 dependency manifest review。
- **Renderer parity 三态**：每个 effect / transition / preset 显式声明在 `pixiV8` / `deterministicExport` / `domRealtimePreview` 三个 renderer 上的支持等级（`"approved"` / `"experimental"` / `"unsupported"`）。Preview-export parity 是硬要求 —— preview 和 export 跑同一份 evaluated render plan / shader chain。
- **Curate, 不要穷举**：第三方库（pixi-filters 36 个 filter，gl-transitions 100+ shader）不要 v1 全量集成。按 day-1 用户价值 curate ~10-20 个，剩余分到 v2 列表 / out-of-scope，PRD 表格中显式声明 status。
- **不引入新 runtime owner**：付费 plugin（GSAP `SplitText` / `PixiPlugin` 等 Club GSAP）、新动画 lib（anime.js）、新 state manager 等都构成「第二套事实来源」风险，必须先开 dependency manifest review PRD。优先 home-grown 替代方案（典型 100-200 LOC 覆盖 80% 用例，避免 vendor lock-in 与 license renewal 风险）。
- **第三方资产清单**：bundled LUT / shader / preset / texture 必须维护 `THIRD-PARTY-LICENSES.md`（per-asset license + author attribution），与 LICENSE 要求一致 ship。Self-authored 资产标注 `MIT (ClipCombo)` 等同 in-house。
- **Bundle size 预算**：每个 PRD cluster 上线前测一次 `pnpm build` 包大小，每 cluster 增量目标 < 100 KB gzipped；超出必须分 phase 上线或评估子路径 import / tree-shake / dynamic import。
- **不新增源代码文件，除非引入新 parser / lib bridge**：registry / adapter / runtime stack 都只 append 不新建。新文件只允许给：新 parser（如 `.cube` parser）、第三方 lib bridge（如 SplitText 自研替代）、新 shader 源（每个 .glsl 一个文件）。
- **i18n 4 locale 全量覆盖**：label / description / parameter label / 多语 search terms（en / zh / ja / ko）。少一个 locale 在 PR description 中标注「pending translation」，并新建 i18n followup issue。
- **不在 UI 散落硬编码**：effect labels / transition names / preset names / 参数 label 走 i18n key 系统；shader 内部 uniform 命名走 ClipCombo prelude，不依赖原 lib uniform 名（便于跨 lib 切换）。
- **Telemetry whitelist**：只上报 `effect_kind` / `transition_kind` / `preset_id` / `has_keyframes` (bool) / `mix_nonzero` (bool)；**永远不上报** 用户色值、LUT 文件内容、文字 `text` 内容、SplitText 内容、源媒体文件名 / URL / bytes、Agent prompt。与 [`feedback_no_hidden_backend_flags`](../../.claude/projects/-home-doodlebear-project-doodlekuma-com/memory/feedback_no_hidden_backend_flags.md) 一致。
- **Shader uniform prelude 约定**：当从第三方 GLSL 库（gl-transitions 等）移植时，每个 .glsl 文件 header 保留原 author / license 注释，并在 top 加 ClipCombo prelude（`uTextureFrom` / `uTextureTo` / `uProgress` / `uRatio` 统一命名 + `getFromColor(uv)` / `getToColor(uv)` helpers），避免原 lib uniform 名混入 ClipCombo runtime。
- **Phase 顺序：基础设施先于覆盖广度**：当一个 PRD 同时引入「新基础设施」（如 `.cube` parser、新 shader runtime）和「广度覆盖」（如 ~20 个新 effect），phase 顺序必须基础设施在前 —— 否则覆盖广度 phase 的 PR 会反复 rebase 等基础设施合并。
- **运营回退 = `git revert`，不是 runtime flag**：与 [`feedback_no_hidden_backend_flags`](../../.claude/projects/-home-doodlebear-project-doodlekuma-com/memory/feedback_no_hidden_backend_flags.md) 一致。任何 effect / transition / preset 都不藏 hidden `localStorage` / URL flag / `window.*` toggle；rollback 路径 = revert 注册表条目 + redeploy，老 composition 中已删除的 effect id 走 `unsupported[]` 通道。

### 4. 性能 / 播放卡顿（"顿一下"）/ realtime preview 类 PRD 附加要求

针对"播放/预览卡顿、丢帧、顿一下、掉帧、内存增长、realtime 渲染性能"类 PRD，先把**测量方法学**写进 PRD，再写优化方案——否则容易"凭感觉调参 + 改了无法验证"。源自 2026-05-30 composition 播放 "顿一下" 调查（[`20260529-clipcombo-video-decode-pipeline-optimization-prd`](../docs/prd/clip-prd/20260529-clipcombo-video-decode-pipeline-optimization-prd/)）。

- **先确认症状是否 layer-type-specific**：如果卡顿在 shape-only / GIF precomp / video 三类 composition 上都复现，根因就**不在**某条 layer 专用路径（如视频解码 ring / BlobSource cache），而在 layer-type-**无关**的公共路径（playback loop / final-frame cache / warmup 调度 / GC）。不要在还没确认普遍性前就一头扎进 video decode。
- **渲染 compute ≠ 卡顿**：`renderDuration`（renderAt 内部耗时）健康（p99 < 4ms）**不代表**不卡。"顿一下"通常是渲染 tick **之间**的主线程停顿（GC pause、IndexedDB 结果反序列化、解码 burst、layout），落在 renderAt 测量**之外**。PRD 必须区分「渲染耗时」和「呈现帧间隔（frame cadence）」两个指标。
- **必须测呈现帧节奏 + 长任务，而不仅是渲染耗时**：
  - **frame interval**：Pixi canvas 预览没有 `<video>` 元素，`requestVideoFrameCallback` 不触发——composition 模式必须用 `requestAnimationFrame` 回退测真实合成帧间隔（一次 274ms 的 GC gap 会显示为 `frame max` 飙升）。
  - **Long Tasks API**：`PerformanceObserver({ entryTypes: ["longtask"] })` 记录每一次 ≥50ms 主线程停顿，**不管成因**，是"顿一下"的无歧义 before/after 信号。
  - 任何 realtime preview 性能 PRD 的验收标准都应包含 `frame p99` / `frame max` / `longtask max`，不能只有 `renderDuration`。
- **先用现有诊断排除"显而易见的嫌疑"，再猜**：用真实快照字段证伪，而不是凭直觉。典型可排除项与对应字段：音频 meter 轮询（`meterSubscriberCount === 0` → 没在跑）、每帧 final-frame 写回读（`finalFrameCache.writes` 是整场总数而非每帧）、cache strip 大查询（gated 到非播放态；`playing` 快照里的 `lastPersistedQueryDurationMs` 可能是开播前旧值）。
- **GC 是周期性、与 layer 类型无关、不进渲染 mark 的卡顿首要嫌疑**：每帧分配（render plan / property evaluator 新对象、VideoFrame churn——看 `framesEvictedRing`）累积触发 major GC。PRD 若怀疑 GC，验收手段是 Chrome DevTools Performance 火焰图（长帧颜色 = 🟢 GC / script / IDB 的归因），配合 `longtask` 指标定位频率与幅度。
- **prod build 复测，dev mode 不作数**：性能/内存数字必须在 `make clip-preview`（prod build + serve，前后端都起）下采，并按 [`内存问题复现规则`](../../packages/clipcombo/CLAUDE.md)第二次循环复测（首次 warmup 上涨是预期）。dev mode 的 React StrictMode + HMR + sourcemap 开销会污染基线。
- **每-tick 主线程工作要显式预算**：playback loop 里每帧跑的东西（warmup 调度、disk prefetch、cache 查询、property 评估）都要在 PRD 里列出"每 tick 成本"，并标注哪些可在 `playMode === "playing"` 时 gate 掉 / 降频 / defer 到 idle。缓存为空时仍每帧查询是典型的可消除浪费。
- **观测先行，再优化**：当根因不明时，PRD 第一个 phase 应是"补齐能看见症状的指标"（如本案补 `frame cadence` + `longtask`），让后续优化 phase 有 before/after ground truth，而不是直接改渲染路径。指标补强属纯 observability、低风险，可独立先 ship。
- **回退 = `git revert`，不藏 flag**：与 [`feedback_no_hidden_backend_flags`](../../.claude/projects/-home-doodlebear-project-doodlekuma-com/memory/feedback_no_hidden_backend_flags.md) 一致；性能优化不要塞 hidden `localStorage` / URL 开关，需要 runtime toggle 就建可见 Settings 控件。

### 5. 协作规范
- **早期沟通**：需求阶段就与开发、测试团队讨论
- **持续更新**：开发过程中及时更新 PRD 状态
- **版本控制**：重大变更创建新版本文档
- **知识共享**：定期分享 PRD 编写经验和教训

### 6. 质量保证
- **评审机制**：所有 PRD 都要经过技术评审
- **验收标准**：明确的功能验收条件
- **文档维护**：及时更新已完成的 PRD 状态
- **经验积累**：建立 PRD 最佳实践知识库

## 🔗 相关资源

- [PRD 模板](../../docs/prd/prd-template.md) - 标准 PRD 文档模板
---

## 📝 快速开始

1. **确定功能模块**：选择合适的目录结构
2. **创建日期目录**：使用当前日期作为目录名
3. **复制模板文件**：从 `prd-template.md` 开始
4. **填写具体内容**：根据实际需求完善各个部分
5. **技术审查**：邀请相关人员审查文档
6. **定稿执行**：更新状态为 Final，等待开始开发

## 💡 提示

- **保持简单**：PRD 应该聚焦核心需求，避免过度设计（利用已有代码）
- **迭代更新**：开发过程中根据实际情况调整需求
- **关联追踪**：建立 PRD 与代码、测试、文档的关联
- **经验复用**：参考已完成的 PRD，不断优化编写质量

这个指南确保了项目的 PRD 管理工作标准化、有序、高效！🚀
{{ 额外要求（可留空）： }}
