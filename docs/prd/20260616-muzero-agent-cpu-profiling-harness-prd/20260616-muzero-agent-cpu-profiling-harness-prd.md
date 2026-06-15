# PRD: Agent 自助 CPU Profiling Harness（self-profile → flame graph → loop）

**Status:** Draft
**Created:** 2026-06-16
**Author:** User + Claude
**Module:** dev 控制端点 harness（扩展）/ CDP Profiler 客户端 / .cpuprofile 分析器 / perf-drive 编排

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | dev-only 远程调试端口（`--remote-debugging-port` 门控启动） | 🔲 Pending | [Phase 1](#phase-1-远程调试端口) |
| 2 | 零依赖 CDP Profiler 客户端（connect → start/stop → 写 .cpuprofile） | 🔲 Pending | [Phase 2](#phase-2-cdp-profiler-客户端) |
| 3 | .cpuprofile 分析器（self/total time 归并 → top frames JSON） | 🔲 Pending | [Phase 3](#phase-3-cpuprofile-分析器) |
| 4 | 编排：profile 包住一段 driven scenario（CDP + 控制端点） | 🔲 Pending | [Phase 4](#phase-4-编排-profile--scenario) |
| 5 | 自优化 loop playbook（profile→归因→改→re-profile，带 guardrails） | 🔲 Pending | [Phase 5](#phase-5-自优化-loop) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

切歌掉帧调查（[`switch-song-large-queue-fps`](../20260615-muzero-switch-song-large-queue-fps-prd/20260615-muzero-switch-song-large-queue-fps-prd.md)）用 [dev 控制端点 harness](../20260615-muzero-dev-control-endpoint-automation-harness-prd/20260615-muzero-dev-control-endpoint-automation-harness-prd.md) 把「驱动切歌 + 取结构化 trace」自动化后，**坐实并排除了一连串嫌疑**：切歌的 ~100ms `switch.toFrame` **不是** layout/paint（隐藏整页 `display:none`、旁路全屏背景都不降）、**不是** cover 解码/派生（warm 仍卡）、**不是** 音频加载（449ms 才发生）、**不是** 组件 render（Profiler 实测 page 6ms / dock 4ms）。剩下一个 **~46–61ms 的 `toCommit` 弥散成本**（React commit cycle + 每切歌的 liveQuery requery + motion 的 `useLayoutEffect` 量测 + 一堆小工作），**JS span 级埋点已无法再细分**——每个可埋的 span 都很便宜，成本散在 React 内部 / 浏览器 commit / 许多小处。

唯一能归因这种弥散成本的工具是 **CPU profile / flame graph**。但手动开 DevTools Performance 面板录制 → 导出 → 人看火焰图，**把 agent 踢出了 loop**——而本仓库的整套 harness 哲学就是「measure→fix→re-measure 闭环自动化」。

[Deep research（2026-06-16）](#9-related-documents) 证实了可落地路径：Electron 渲染进程就是一个 CDP target，用 `--remote-debugging-port` 暴露后，**CDP `Profiler` 域** `Profiler.start`/`Profiler.stop` 返回的 `Profile`（`nodes`/`samples`/`timeDeltas`）**就是 `.cpuprofile` 格式**（DevTools/VSCode/speedscope 可读），全程可脚本化、无需 GUI。Google 的 `chrome-devtools-mcp` 也封装了同一套 CDP，但它面向 Chrome 受控页、对 Electron renderer 的 attach 未经证实——所以本 PRD 走**直连 CDP**（确定可行 + 复用我们已有的 scenario 驱动），把 chrome-devtools-mcp 作为可选增强。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Claude Code / AI agent** | 自行 profile 一次 driven 切歌、dump `.cpuprofile`、读 top self-time 归因、提修法、re-profile 验证 | 仅 dev 实例；localhost 调试端口 |
| **开发者（人）** | 拿同一份 `.cpuprofile` 丢进 DevTools/speedscope 看火焰图，与 agent 归因对照 | 同上 |

### 1.3 Core Value

1. **闭合最后一环**：把「弥散成本归因」从「人开 DevTools」变成 agent 一条命令——`profile 包住切歌 → 写 .cpuprofile → 解析 top frames JSON → agent 直接读`。
2. **机读火焰图**：分析器把采样栈归并成 **top self-time / top total-time / collapsed stacks**，agent 无需 GUI 就能定位「那 ~46–61ms 花在哪个函数/哪个 React 内部阶段」。
3. **复用而非重造**：profile 只是「包住」已有的 perf-control scenario 驱动；同一次切歌既出 trace 字段又出火焰图，before/after 同源可比。
4. **零新增运行时依赖**：Node 24 自带全局 `WebSocket` + `fetch`，直连 CDP 无需 `chrome-remote-interface`/puppeteer（守「不引入新 runtime owner」纪律）。
5. **产物即标准格式**：`.cpuprofile` 是 DevTools/speedscope/VSCode 通用格式，人和 agent 看同一份。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Claude Code (Bash)
   │ node scripts/perf-profile.mjs switch --switches 8 --interval 120
   ▼
scripts/perf-profile.mjs  (编排器, dev-only)
   │ 1) GET http://127.0.0.1:<DBG>/json/list  → 选 renderer page target (type=page, url=app)
   │ 2) WebSocket 连 target.webSocketDebuggerUrl  (Node 全局 WebSocket, 零依赖)
   │ 3) CDP: Profiler.enable → Profiler.setSamplingInterval(µs) → Profiler.start
   │ 4) ──── 复用控制端点驱动场景 ────────────────────────────┐
   │        POST /perf/marker scenario.start                  │  (perf-control.cjs :7345)
   │        POST /player/playIndex {index:"+1"} × N (spaced)  │  → 真实切歌路径
   │        POST /perf/marker scenario.end                    │
   │ 5) CDP: Profiler.stop  → Profile{nodes,samples,timeDeltas} ◄┘
   │ 6) 写 .logs/perf-profiles/<name>-<ts>.cpuprofile          (raw, DevTools/speedscope 可开)
   │ 7) 分析器: 归并 self/total time → <name>-<ts>.analysis.json
   ▼
Claude `Read` analysis.json  →  归因那 ~46–61ms  →  提修法  →  re-profile 验证
```

> **两条独立通道**：CDP（profile，连渲染进程调试端口）与 HTTP 控制端点（驱动切歌，:7345）是**两个连接**——编排器同时持有。这样 profile 精确包住「真实 UI 触发的切歌」，而不是某个内部函数。

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **渲染进程 attach** | Electron `--remote-debugging-port`（Chromium switch） | renderer 即 CDP target；官方机制，dev-only |
| **CDP 传输** | Node 全局 `WebSocket` + `fetch`（`/json/list`） | 零新依赖；CDP 是 JSON-RPC over WS，手写即可 |
| **采样源** | CDP `Profiler` 域（`start`/`stop`/`setSamplingInterval`） | `stop` 直接返回 `.cpuprofile` schema（research 实锤） |
| **场景驱动** | 既有 [perf-control 端点](../20260615-muzero-dev-control-endpoint-automation-harness-prd/20260615-muzero-dev-control-endpoint-automation-harness-prd.md) `/player/playIndex` + `/perf/marker` | 复用真实切歌路径，不重造 |
| **分析** | 自研 `.cpuprofile` 解析（self/total time 归并） | 机读 top frames；产物仍是标准 `.cpuprofile`，人可丢 speedscope |
| **可选增强** | `chrome-devtools-mcp`（`--browser-url`） | 若能 attach Electron renderer，给 LLM-ready insights；未证实，备选 |

### 2.3 Project Structure

```
MUZERO/
├── scripts/
│   ├── electron-dev.mjs          # 【改】dev-only 透传 --remote-debugging-port（env 门控）
│   ├── perf-profile.mjs          # 【新】编排器：CDP profile 包住 perf-control 驱动的 scenario
│   └── lib/
│       ├── cdp-client.mjs        # 【新】零依赖 CDP over WebSocket（connect/send/on/close）
│       └── cpuprofile-analyze.mjs# 【新】.cpuprofile → {topSelf, topTotal, collapsed} 归并
├── electron/
│   └── main.cjs                  # （无需改：远程调试端口是启动参数，不进主进程逻辑）
├── .logs/perf-profiles/          # 【新】<name>-<ts>.cpuprofile + .analysis.json（gitignore）
└── docs/prd/20260616-...-prd/    # 本 PRD
```

---

## 3. Data Model Design

### 3.1 Core Concepts

⚠️ 不碰 IndexedDB schema。新增仅两类**纯文件产物**（落 `.logs/perf-profiles/`，gitignore）：

```
<name>-<ts>.cpuprofile              （CDP Profiler.stop 原样，标准格式）
  nodes:     ProfileNode[]  { id, callFrame{functionName,url,lineNumber,columnNumber}, hitCount, children[] }
  samples:   number[]       （每个采样命中的栈顶 node id）
  timeDeltas:number[]       （相邻采样间隔 µs）
  startTime/endTime: µs

<name>-<ts>.analysis.json           （自研归并，agent 读这个）
  scenario, sampleCount, durationMs, samplingIntervalUs
  topSelf:  [{ fn, url, line, selfMs, selfPct }]     ← 自身耗时榜（火焰图最宽的叶子）
  topTotal: [{ fn, url, line, totalMs, totalPct }]   ← 含子调用耗时榜
  byCategory: { script, gc, layout, paint, system, idle, program }  ← 按 (program)/(garbage collector)/url 粗分类
  collapsedTop: ["a;b;c 123", ...]                   ← speedscope/flamegraph collapsed-stack（可选）
```

### 3.2 Database Schema

- **Current Schema:** 不变。Profiling 不读写 IndexedDB。
- **Rollback:** `git revert` 删脚本 + electron-dev env 透传；无 schema/无迁移。
- **Privacy & Retention:** `.cpuprofile` 含**函数名 + 源文件路径 + 行号**（本仓库自己的源码，非用户数据），**不含**曲目内容/封面/BYOK key。落 gitignore 的 `.logs/`，不入库、不上报。

---

## 4. Interface Design

> 不是 HTTP API——是一个 **CLI 编排器** + 两个内部 lib。CDP 通道是 agent 经 `node` 脚本持有，不暴露成新端点。

### 4.1 CLI

```bash
node scripts/perf-profile.mjs <scenario> [opts]
  scenario : switch | pingpong | counted | idle      （复用 perf-drive 语义）
  --switches N        切歌次数 (默认 8)
  --every MS          切歌间隔 (默认 1400)
  --interval US       采样间隔微秒 (默认 120；越小分辨率越高、开销越大)
  --port DBG          远程调试端口 (默认 9222 / env MUZERO_REMOTE_DEBUG_PORT)
  --name LABEL        产物命名
  --top N             分析榜单条数 (默认 25)
```

### 4.2 输出（agent 读）

```jsonc
// .logs/perf-profiles/switch-<ts>.analysis.json
{
  "scenario": "switch", "sampleCount": 4820, "durationMs": 11800, "samplingIntervalUs": 120,
  "topSelf": [
    { "fn": "commitLayoutEffectOnFiber", "url": "react-dom…", "line": 1234, "selfMs": 142.3, "selfPct": 12.1 },
    { "fn": "(program)", "url": "", "line": 0, "selfMs": 98.0, "selfPct": 8.3 },
    { "fn": "extractImagePalette", "url": "src/lib/image-palette.ts", "line": 40, "selfMs": 70.1, "selfPct": 5.9 }
    // …
  ],
  "topTotal": [ /* 含子调用 */ ],
  "byCategory": { "script": 71.0, "gc": 9.2, "layout": 6.1, "paint": 0, "system": 8.0, "idle": 5.7 }
}
```

### 4.3 Error Handling

- 调试端口未开/连不上 → 明确报错 + 提示「以 `MUZERO_REMOTE_DEBUG_PORT=9222` 重启 electron:dev」。
- `/json/list` 多 target（DevTools、worker）→ 选 `type==="page"` 且 url 匹配 app origin（localhost:41730 / app://）。
- 控制端点未就绪 → 复用 `.logs/perf-control.json` + 既有 401/409 语义。
- 日志走 stdout（脚本），不触 `src/**` 的 logger 纪律。

---

## 5. Frontend Design

无 UI 改动。Profiling 全在 dev 脚本 + Chromium 调试端口；渲染层零侵入（不加组件、不加 hook）。`switch.toFrame`/`switch.toCommit` 既有埋点继续提供「墙钟」对照，火焰图提供「归因」——两者互补。

---

## 6. Implementation Plan

> 遵循 prd-create.md §4「观测先行、基础设施先于覆盖广度」。Phase 1-3 是基础设施（端口/客户端/分析器），Phase 4 串起来，Phase 5 是用法。

### Phase 1: 远程调试端口

**Goal:** dev-only 暴露渲染进程 CDP 端口。
**Tasks:**
- [ ] `electron-dev.mjs`：当 `MUZERO_REMOTE_DEBUG_PORT`（默认 9222）set 时，给 electron 启动追加 `--remote-debugging-port=<port> --remote-allow-origins=http://127.0.0.1:<port>`。仅 dev launcher 注入，packaged 永不带。
- [ ] 校验 `curl http://127.0.0.1:9222/json/version` 可达。

### Phase 1 Checklist
- [ ] `make electron:dev` 后 `/json/list` 列出 renderer page target。
- [ ] packaged build 不含该端口（启动参数只在 dev launcher）。

### Phase 2: CDP Profiler 客户端

**Goal:** 零依赖连 CDP、跑 Profiler。
**Tasks:**
- [ ] `scripts/lib/cdp-client.mjs`：`connect(wsUrl)` (全局 WebSocket) + `send(method, params)`（id 关联 Promise）+ `on(event, cb)` + `close()`。
- [ ] profile 序列：`Profiler.enable` → `Profiler.setSamplingInterval(us)` → `Profiler.start` → (driven) → `Profiler.stop` → 写 `.cpuprofile`。

### Phase 2 Checklist
- [ ] 跑一次空 profile（idle）能拿到非空 `Profile{nodes,samples,timeDeltas}` 并落盘。
- [ ] 落盘的 `.cpuprofile` 能被 Chrome DevTools「Load profile」打开（人工抽检一次）。

### Phase 3: .cpuprofile 分析器

**Goal:** 采样栈 → 机读榜单。
**Tasks:**
- [ ] `scripts/lib/cpuprofile-analyze.mjs`：按 node.id 建表；self time = `hitCount × 平均interval`（或按 `samples`/`timeDeltas` 精确累加）；total time = 子树累加；按 fn 键（functionName + url:line）归并；输出 `topSelf`/`topTotal`/`byCategory`/`collapsedTop`。
- [ ] 分类：`(program)`/`(idle)`/`(garbage collector)`/`(root)` 走 system 桶；url 含 `react-dom`/`scheduler` 标 react；其余按源文件。

### Phase 3 Checklist
- [ ] 单测（`scripts/**/*.test.mjs`，vitest include 已覆盖）：喂一个手造 mini cpuprofile，断言 self/total 归并正确、idle 不计入。
- [ ] top self 百分比之和 ≈ 100%（含 idle）。

### Phase 4: 编排 profile + scenario

**Goal:** 一条命令出火焰图归因。
**Tasks:**
- [ ] `scripts/perf-profile.mjs`：选 target → CDP profile.start → 经 `.logs/perf-control.json` 调 `/perf/marker` + `/player/playIndex` 跑 scenario → profile.stop → 写 `.cpuprofile` + `.analysis.json` → 打印 topSelf。
- [ ] 复用 perf-drive 的 scenario 语义（switch/pingpong/counted）。

### Phase 4 Checklist
- [ ] `node scripts/perf-profile.mjs switch` 一把出 `.cpuprofile` + `.analysis.json`，agent 读后能说出「那 ~46–61ms 的 top self 函数」。
- [ ] profile 时间窗 ≈ scenario 时间窗（用 marker 校对）。

### Phase 5: 自优化 loop

**Goal:** profile→归因→改→re-profile 的可信闭环。
**Tasks:**
- [ ] playbook：`profile baseline → 读 topSelf → 提 UX-不减分 的修法 → 改 → make check + 不变量 → re-profile → 对比 topSelf/toFrame → 人审 diff`。
- [ ] guardrails：每轮 `make check` + 不变量（no-remount/不串歌/不闪/crossfade 自然）必须绿；火焰图 before/after 同 scenario 同采样间隔；**不自动 commit**。

### Phase 5 Checklist
- [ ] 用本 harness 把切歌 `switch.toFrame` 的弥散成本归因到具体 top self 帧，并出至少一版 before/after。
- [ ] playbook 写明反例：不得靠关可视化/降画质/砍 crossfade 刷数字（UX 不减分硬约束）。

---

## 7. Out of Scope

- **主进程（Node）CPU profile 与 renderer 关联**：本期只做 renderer（切歌卡顿在前端）。主进程用 `--inspect` + `inspector` 是后续单独项（research 标注该边界未完全收敛）。
- **进 production**：调试端口与 profile 脚本永不随 packaged 分发。
- **chrome-devtools-mcp 集成**：列为可选增强，不阻塞；先用直连 CDP（确定可行）。
- **自动 commit / 自动改**：loop 只到「呈火焰图归因 + diff 给人审」。
- **具体切歌优化本身**：归属 switch-fps PRD；本 PRD 只造「让 agent 能自助 profile」的能力。
- **Tauri / web 壳**：仅 Electron。

---

## 8. Security Considerations

- **dev-only 调试端口**：`--remote-debugging-port` 只由 dev launcher 注入；packaged build 启动参数不含；配 `--remote-allow-origins` 收敛到 loopback，挡浏览器页面跨源连 CDP（CDP 无 token，靠 origin allowlist + 仅 `127.0.0.1` 绑定）。
- **不进 prod**：与 [控制端点 harness](../20260615-muzero-dev-control-endpoint-automation-harness-prd/20260615-muzero-dev-control-endpoint-automation-harness-prd.md) 同纪律（双重 dev 门 + 防回归）。CDP 端口比控制端点更敏感（可执行任意调试命令）——所以**默认不开**，需显式 `MUZERO_REMOTE_DEBUG_PORT` 才注入。
- **Data Protection**：`.cpuprofile` 只含本仓库源码符号（fn/url/line），不含用户数据/密钥；落 gitignore `.logs/`。
- **回退**：`git revert` 脚本 + env 透传，无 runtime flag。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [dev-control-endpoint-automation-harness PRD](../20260615-muzero-dev-control-endpoint-automation-harness-prd/20260615-muzero-dev-control-endpoint-automation-harness-prd.md) | 本 PRD 复用其 scenario 驱动 + `.logs/perf-control.json` |
| [switch-song-large-queue-fps PRD](../20260615-muzero-switch-song-large-queue-fps-prd/20260615-muzero-switch-song-large-queue-fps-prd.md) | 本 profiling 能力的首个消费者（弥散 commit 成本归因） |
| Deep research (2026-06-16) | CDP `Profiler`→`.cpuprofile`、`--remote-debugging-port`、Electron renderer=CDP target、chrome-devtools-mcp 备选——均 3-0 adversarial 验证 |
| [CDP Profiler 域](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/) | `Profiler.start/stop`、`Profile{nodes,samples,timeDeltas}` 规格 |
| [paulirish/trace-stuff](https://github.com/paulirish/trace-stuff) | 备用：从 trace 抽 `.cpuprofile`（若改走 Tracing 域） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 采样间隔默认值？ | Resolved | **120µs**：对 ~46–61ms 弥散成本够分辨；可 `--interval` 调 |
| 2 | 走 `Profiler` 域还是 `Tracing` 域？ | Resolved | **Profiler**：`stop` 直接给 `.cpuprofile`，无需 trace→cpuprofile 转换 |
| 3 | 多 renderer/worker target 怎么选？ | Resolved | 选 `type==="page"` 且 url 匹配 app；多页时取第一个可见窗口 |
| 4 | 用 `chrome-remote-interface` 还是手写 WS？ | Resolved | **手写 WS**（Node 24 全局 WebSocket）——零新依赖 |
| 5 | 主进程 profile 是否本期做？ | Resolved | 否，out-of-scope（切歌卡在前端）；后续 `--inspect` 单独项 |
| 6 | chrome-devtools-mcp 能否 attach Electron renderer？ | Open | 未证实；先直连 CDP，MCP 留作 5min 试探的可选增强 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-16 | User + Claude | Initial draft：dev-only 远程调试端口 + 零依赖 CDP Profiler 客户端 + .cpuprofile 分析器 + profile 编排 + 自优化 loop playbook |

---

> **Note:** profile 只「包住」既有 perf-control 的真实切歌驱动；同源出 trace 字段 + 火焰图，把弥散成本归因从「人开 DevTools」收进 agent loop。零新增运行时依赖、prod 零面积。
>
> **Exception Policy:** 任何想把调试端口/profile 脚本带进 prod、或引入 puppeteer/chrome-remote-interface 等新运行时依赖的提议，需单独 dependency/security review。
