# PRD: Dev 控制端点 + 自动化压测/调优 Harness（Dev Control Endpoint & Automation Harness）

**Status:** Draft
**Created:** 2026-06-15
**Author:** User + Claude
**Module:** electron 主进程（dev-only 控制面）/ shortcuts 命令总线 / player-store / trace recorder / dev-perf HUD

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 控制传输 + 安全门（dev-only HTTP + token + 命令总线桥接） | ✅ Completed | [Phase 1](#phase-1-控制传输--安全门) |
| 2 | 压测数据面（按大小选既有歌单 / 装载队列） | 🔲 Pending | [Phase 2](#phase-2-压测数据面) |
| 3 | Scenario runner + 结构化 perf 报告（markers / 多跑取中位 / baseline / 不变量断言） | 🔲 Pending | [Phase 3](#phase-3-scenario-runner--结构化-perf-报告) |
| 4 | UI 操作全覆盖（命令总线全路由 + settings allowlist + Makefile 入口） | 🔲 Pending | [Phase 4](#phase-4-ui-操作全覆盖) |
| 5 | 自调优 loop playbook（文档 + guardrails，非自动 commit） | 🔲 Pending | [Phase 5](#phase-5-自调优-loop-playbook) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

切歌/换歌单的性能调查（[`20260615-muzero-switch-song-large-queue-fps-prd`](../20260615-muzero-switch-song-large-queue-fps-prd/20260615-muzero-switch-song-large-queue-fps-prd.md)）暴露了一个工作流瓶颈：**每改一版优化，都要人手在 UI 里复现"装载 5983 首队列 → 连切 → 复制 trace log"**。这一步：

1. **慢且易错**：手动点 next、手动找 `.logs/` 文件、手动对照前后数字。
2. **不可复现**：每次切的节奏、起始 index、warm/cold 状态都不同 → before/after delta 没有可比性（违反 prd-create.md §4「prod build 复测 + 第二次循环」方法学）。
3. **挡住了"measure → fix → re-measure"的自动化**：这恰恰是性能工作最适合的闭环。

观测侧其实**已经搭好**：trace recorder（[`trace-recorder.tsx`](../../../src/components/shell/trace-recorder.tsx) + `useTraceArchiveRecorder`）已把结构化 JSONL 落到 `.logs/`；`notePerfWork` / longtask 归因 / fps-window 已经在产出 Claude 能直接 `Read` 的字段。**缺的只是一个确定性触发器 + 结构化报告 + 安全门**。

本 PRD 落地一个 **dev-only 的本地 Electron 控制端点**：`make electron-dev` 起的本机实例额外监听一个 `127.0.0.1` 控制口，Claude Code（或任何脚本）用 `curl` 即可**驱动 App 行为**（切歌、换歌单、改设置、切 tab……）并**取回结构化 perf 报告**，从而把上面的闭环自动化。

> **它不是产品后端。** CLAUDE.md 硬规则 1（无后端无云）约束的是**存储/产品架构**——没有 MUZERO 服务器、没有遥测、没有账号。本控制面是**纯 dev 工具，永不进 production bundle，无持久化、无云**，与该规则不冲突（§8 给出强制的 dev-only 门 + 防回归测试）。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Claude Code / AI agent** | 在终端跑 `curl` 驱动场景、读 `.logs/` 与 perf 报告，迭代性能优化 | 仅 dev 实例；需 per-process token |
| **开发者（人）** | 手动跑同一套 scenario 做 before/after，或调试 UI 状态 | 同上 |
| **CI（可选，后续）** | 跑固定 scenario 做性能回归门禁 | 受同样 dev-only 门约束 |

### 1.3 Core Value

1. **确定性压测**：用**用户本机已配置的真实数据**（含 5983 首大歌单）按大小选歌单 → 装载 → 跑脚本化序列，每次完全一致 → before/after 可比。
2. **闭环自动化**：Claude 一次 `curl` 触发 → 读结构化报告 → 提出修法 → 重测 → 与 baseline diff，无需人手点 UI / 翻日志。
3. **零产品面积**：复用既有命令总线（`runShortcutAction`）+ store actions + `saveSettings`，控制端点只是**薄传输层**，不引入第二套行为逻辑；prod build 里整个能力被 tree-shake / 拒绝启动。
4. **方法学内建**：报告字段对齐 prd-create.md §4（frame cadence / longtask / heap delta），并强制多跑取中位 + 不变量断言，避免"凭感觉调参 + 对噪声过拟合"。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Claude Code  (Bash 工具: curl / Invoke-RestMethod)
   │  HTTP  127.0.0.1:<PORT>   header: X-Muzero-Perf-Token: <per-process token>
   ▼
electron/perf-control.cjs        ← dev-only: 仅当 !app.isPackaged && env MUZERO_PERF_CONTROL=1 才 listen()
   │   • 校验 token（constant-time）+ Host/Origin（防 DNS rebinding）
   │   • 把请求映射成一条 PerfControlCommand（枚举 + zod 校验，无任意 eval）
   │   webContents.send("muzero:perfControl:command", cmd)      ─┐ IPC（main → renderer）
   │   ipcMain.handle("muzero:perfControl:ack", …)              ◀┘   renderer → main 回执
   ▼
electron/preload.cjs             ← contextBridge 暴露最小 onPerfCommand / sendPerfAck（仅 dev）
   ▼
src/dev/perf-control-bridge.ts   ← DEV-only（import.meta.env.DEV 动态 import；prod 不打进 bundle）
   │   路由到【既有】操作面，绝不复制逻辑：
   │     • runShortcutAction(actionId, ctx)   → 所有 UI 命令（playback.* / nav.* / queue.toggle / lyrics.* / visualizer.* / settings 切换）
   │     • usePlayerStore.getState().<action>  → playIndex / setActiveSession / playSystemPlaylist / next / seek / setVolume …
   │     • saveSettings(patch)                 → 任意 AppSettings 变更（allowlist 校验）
   │     • fixtureLoader                       → 列既有歌单(按大小) / 装载为活动队列
   │     • scenarioRunner                      → 脚本化序列 + 写 trace marker(scenario.start/step/end)
   ▼
trace recorder → .logs/<session>/*.jsonl      ← 已存在；marker 把单次 scenario 切片出来
   ▼
perf 报告抽取（按 runId 切片 + 聚合）→ .logs/perf-reports/<runId>.json   ← Claude 用 Read 工具读
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **控制服务** | Node `http`（Electron 主进程内，无新依赖） | 不引第三方 server lib；`127.0.0.1` 即可被 Bash `curl` 命中 |
| **传输到渲染层** | 既有 Electron IPC（`webContents.send` + `ipcMain.handle` + `contextBridge`） | 复用规则 10 的壳层抽象，preload 仍只暴露最小通道 |
| **操作执行** | 既有命令总线 [`runShortcutAction`](../../../src/shortcuts/actions.ts) + `usePlayerStore` actions + `saveSettings` | **单一事实来源**：endpoint 不得新建并行 action 逻辑 |
| **测量** | 既有 trace recorder（JSONL → `.logs/`）+ `notePerfWork` + longtask/fps window | 观测侧已就绪，只加 marker + 聚合 |
| **校验** | Zod 4（命令体 + settings patch） | 与 `TrackBrief` 同纪律，拒绝非法/越权命令 |

### 2.3 Project Structure

```
MUZERO/
├── electron/
│   ├── perf-control.cjs          # 【新】dev-only HTTP 控制服务 + token/Host 校验 + 命令枚举（仅 parser/transport）
│   ├── main.cjs                  # 【改】!app.isPackaged && env 时 registerPerfControl(win)
│   └── preload.cjs               # 【改】dev-only 暴露 onPerfCommand / sendPerfAck 最小通道
├── src/
│   ├── dev/
│   │   ├── perf-control-bridge.ts     # 【新】渲染层路由：命令 → 既有 action 面（DEV-only 动态 import）
│   │   ├── perf-fixtures.ts           # 【新】列既有歌单(按大小) / 装载队列 / (可选)合成队列
│   │   ├── perf-scenario.ts           # 【新】scenario 步骤定义 + runner（写 marker）
│   │   └── perf-report.ts             # 【新】按 runId 切片 .logs + 聚合（中位/分位）→ JSON
│   ├── shortcuts/actions.ts      # 【可能小改】补少量未在总线里的 runnable action（见 §4.x）
│   └── components/shell/trace-recorder.tsx  # 复用（必要时加 scenario marker 事件入口）
├── docs/prd/perf-baselines/      # 【新】各 scenario 的提交基线 JSON（before/after ground truth）
└── Makefile                      # 【改】make perf-drive / make perf-scenario 入口
```

---

## 3. Data Model Design

### 3.1 Core Concepts

⚠️ **本 PRD 不改 IndexedDB schema、不改 codename 层**（规则 4）。压测**复用既有数据**（用户本机已 import 的歌单/曲目）。新增的只有两类**纯文件产物**（落 `.logs/` 或 `docs/prd/perf-baselines/`，不进 DB）：

```
PerfScenarioRun                         PerfReport (聚合 N 次 run)
  runId        : string                   runId, scenario, runs:int
  scenario     : string                   commit/branch（git rev，给 baseline 用）
  steps        : PerfStep[]               longTaskMaxMs / longTaskCount
  startedAt    : number (perf marker)     framePeak（frameMaxMs / frameP99Ms）
  queueSize    : number                   fpsLow / fpsAvg
  warm         : boolean                  queueLiveFetchMaxMs
                                          dbRequeries
PerfStep                                  heapDeltaMb（峰值 - 起始）
  kind: "action"|"player"|"settings"      blobsLiveBytes（泄漏哨兵）
  payload: …                              invariants: { noRemount, queueOrderStable, … }
  atMs: number (相对 scenario.start)
```

### 3.2 Database Schema

- **Current Schema:** 不变（[`muzero-db.ts`](../../../src/db/muzero-db.ts) v2）。
- **Required Changes:** 无。fixtures 用 `listSessions` / `getTracksByIds` 等既有 repo 读现成数据。
- **Data Migration / Rollback:** 不适用（无 schema 变更；回退 = `git revert` 删除 dev 模块 + Makefile 条目）。
- **Privacy & Retention:** perf 报告**只含聚合性能数字**（见 §4.4 whitelist），**绝不含**曲目内容、文件名/路径、封面字节、设置里的 BYOK key。`.logs/` 与 `perf-baselines/` 按需 gitignore（性能数字 baseline 可入库，原始 trace 不入库）。

### 3.3 Data Relationship Diagram

```
既有歌单(DjSession) ──按 trackIds.length 选大小──▶ /fixtures/loadQueue ──▶ 活动队列(player-store)
活动队列 + scenario steps ──runner──▶ trace markers ──▶ .logs JSONL ──切片+聚合──▶ PerfReport ──对比──▶ baseline
```

---

## 4. API Design

> **设计纪律（贯穿全部端点）**
> 1. **端点是薄传输层**：每个操作必须最终落到**既有** action 面（命令总线 / store action / `saveSettings`），endpoint 不持有行为逻辑。
> 2. **无任意执行**：**不**提供通用 `executeJavaScript` / eval 透传（那是 RCE）。只接受**枚举命令 + zod 校验过的 payload**。
> 3. **在 UI 同层触发**：如驱动切歌，调用 `playIndex`（store action，UI 点击最终也调它），而非更底层内部函数——保证测到的就是用户走的路径。

### 4.1 API Endpoints

所有端点：`127.0.0.1:<PORT>`，需 header `X-Muzero-Perf-Token`，仅 dev 存在。

**控制面 / 健康**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | 探活：返回 `{ ok, packaged:false, version, port }` |
| `/state` | GET | 当前快照：`{ tab, activeSessionId, queueLength, currentIndex, isPlaying, settingsDigest }` |

**UI 操作（覆盖"尽可能所有 UI 操作"——通过命令总线全路由）**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/action/:actionId` | POST | 派发任一**命令总线**已注册 action（`playback.*` / `nav.*` / `queue.toggle` / `lyrics.toggleStage` / `visualizer.cycleMode` …）。覆盖随命令注册表自动增长 |
| `/actions` | GET | 列出所有可派发的 actionId（来自 `SHORTCUT_ACTION_HANDLERS` keys + player 显式 action 白名单） |
| `/settings` | POST | `saveSettings(patch)`：任意 `AppSettings` 变更（visualizerStyle / flowEnabled / theme / locale / displayMode …），patch 经 allowlist+zod 校验 |
| `/nav/tab` | POST | `{ tab: "now"\|"search"\|"settings" }` 切 tab（走 `nav.tab*` + view-transition） |

**播放器（store action 直驱，给场景脚本用）**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/player/playIndex` | POST | `{ index }` → `playIndex(index)`（切歌主路径） |
| `/player/playSet` | POST | `{ sessionId }` → `setActiveSession(sessionId)` |
| `/player/playSystemPlaylist` | POST | `{ playlistId }` → `playSystemPlaylist(...)` |
| `/player/next` `/player/prev` `/player/togglePlay` | POST | 直驱对应 store action |
| `/player/seek` `/player/volume` `/player/repeat` `/player/shuffle` | POST | `{ value }` → 对应 setter |

**压测数据面（Phase 2，利用既有环境数据）**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/fixtures/playlists` | GET | 列出本机既有歌单：`[{ sessionId, name, trackCount }]`，按 trackCount 排序 → 直接挑大小 |
| `/fixtures/loadQueue` | POST | `{ sessionId }` 或 `{ approxSize }`（选最接近的既有歌单）→ 装载为活动队列。**复用用户真实数据** |
| `/fixtures/syntheticQueue` | POST | （可选）`{ size }` 从既有曲目采样拼一个 N 首队列，覆盖没有现成大小的场景。**仅 dev 内存态，不落库** |

**测量（Phase 3）**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/perf/scenario` | POST | `{ name, steps[], runs?, settleMs?, warmup? }` 跑脚本化序列；写 `scenario.start/step/end` marker；返回 `{ runId }` |
| `/perf/report/:runId` | GET | 该 run 的**结构化聚合**报告（多跑取中位/分位） |
| `/perf/trace/:runId` | GET | 该 run 的原始 JSONL 切片路径（给 Claude `Read` 深挖归因用） |
| `/perf/marker` | POST | `{ label }` 手动打点（临时调查用） |

### 4.2 Request/Response Examples

```bash
# 1) 列既有歌单挑大小
curl -s 127.0.0.1:7345/fixtures/playlists -H "X-Muzero-Perf-Token: $TOK"
# → [{"sessionId":"ses_352f…","name":"CloudMusic","trackCount":5983}, …]

# 2) 装载 5983 首大歌单为活动队列
curl -s 127.0.0.1:7345/fixtures/loadQueue -H "X-Muzero-Perf-Token: $TOK" \
  -d '{"sessionId":"ses_352f…"}'

# 3) 跑"连切 20 次"场景，重复 3 遍取中位
curl -s 127.0.0.1:7345/perf/scenario -H "X-Muzero-Perf-Token: $TOK" -d '{
  "name":"switch-song-large-queue",
  "steps":[{"kind":"player","action":"playIndex","payload":{"index":"+1"},"repeat":20,"everyMs":1500}],
  "runs":3, "settleMs":3000, "warmup":true
}'
# → {"runId":"perf_8f3a…"}
```

```jsonc
// GET /perf/report/perf_8f3a…  （中位于 3 次 run）
{
  "runId": "perf_8f3a…", "scenario": "switch-song-large-queue",
  "branch": "perf/switch-song-large-queue-fps", "queueSize": 5983, "runs": 3,
  "longTaskMaxMs": 494, "longTaskCount": 61,
  "frameMaxMs": 316.6, "frameP99Ms": 308.3, "fpsLow": 3.2, "fpsAvg": 17.5,
  "queueLiveFetchMaxMs": 451, "dbRequeries": 5, "heapDeltaMb": 179,
  "invariants": { "noRemount": true, "queueOrderStable": true, "schemaValid": true }
}
```

### 4.3 Error Handling

- **401**：token 缺失/不符（constant-time 比较）。**403**：Host/Origin 校验失败（防 DNS rebinding）。**409**：渲染层未就绪（窗口未加载完）→ 返回 `retryAfterMs`。**422**：payload zod 校验失败（列出字段）。**500**：渲染层 ack 超时（默认 30s，可配）。
- **Telemetry & Logging:** 一律走 [`logger`](../../../src/lib/logger.ts)（规则 8），不用 `console.*`；主进程侧用既有 electron 诊断通道。日志**只记命令名 + 结果码**，不记 payload 明细（避免设置里 BYOK key 入日志）。

---

## 5. Frontend Design

> 这里的"frontend"= 渲染进程内的 **dev bridge**，不是新 UI 页面。

### 5.1 Page Structure

无新页面。新增 `src/dev/perf-control-bridge.ts`，由 App 顶层在 **DEV** 下副作用挂载（`if (import.meta.env.DEV && hasElectronPerfChannel) import('./dev/perf-control-bridge')`）。prod build 因常量折叠被 tree-shake，零产品面积。

### 5.2 UI Components

- **Current Implementation:** 复用命令总线 [`shortcuts/actions.ts`](../../../src/shortcuts/actions.ts)（`runShortcutAction` / `createShortcutActionRunnerContext`）、player-store actions、`saveSettings`、trace recorder。
- **Required Changes:**
  - bridge 订阅 `onPerfCommand`，把命令翻成上述既有调用，回 `sendPerfAck`。
  - 命令总线若缺少某 UI 操作（如 `setActiveSession`/`playSystemPlaylist` 不在 `SHORTCUT_ACTION_HANDLERS`），**优先**把它补进一个显式 player-action allowlist（bridge 内），而不是在 bridge 里写新逻辑——保持"既有 action 面"为唯一事实来源。
  - scenario marker：trace recorder 暴露 `markScenario(label, meta)` 入口（或 bridge 直接 `traceEvent`）。
- **UI/Interaction:** 无可见 UI（可选：dev-perf-panel 加一行"control endpoint: :7345 ●"指示灯，仅 dev）。

### 5.3 State Management

- bridge 用 `usePlayerStore.getState()` / `getState().<action>` 命令式读写，**不订阅**（避免自身造成重渲染污染测量）。
- scenario runner 在 bridge 内维护一次性运行态（step 游标 / 定时器），不进任何 store（与规则 6"非响应式单例放模块作用域"一致）。

---

## 6. Implementation Plan

> Phase 顺序遵循 prd-create.md §4「**基础设施先于覆盖广度**」+「**观测先行**」：先把安全传输与最小触发打通，再铺数据面/报告/全覆盖。

### Phase 1: 控制传输 + 安全门

**Goal:** dev-only HTTP 控制口打通到渲染层命令总线，带死硬安全门。

**Tasks:**
- [ ] `electron/perf-control.cjs`：`http` server，仅 `!app.isPackaged && process.env.MUZERO_PERF_CONTROL === "1"` 时 `listen('127.0.0.1', PORT)`；启动打印 `url + token` 到 stdout。
- [ ] token：每进程随机生成，所有请求 constant-time 校验；校验 `Host` 头 = `127.0.0.1:<PORT>`，拒绝带跨源 `Origin` 的请求。
- [ ] IPC 通道：`webContents.send("muzero:perfControl:command")` + `ipcMain.handle("muzero:perfControl:ack")`；preload `contextBridge` 仅 dev 暴露最小 `onPerfCommand/sendPerfAck`。
- [ ] `src/dev/perf-control-bridge.ts`：路由 `/action/:id`（→ `runShortcutAction`）、`/settings`（→ `saveSettings`）、`/player/playIndex`、`/state`、`/health`。
- [ ] App 顶层 DEV-only 动态 import bridge。

### Phase 1 Checklist
- [x] `curl /health` 在 `electron:dev` 下返回 `packaged:false`（已验证 `{ok:true,packaged:false,rendererReady:true}`）。
- [x] **防回归测试**：`shouldEnablePerfControl` 真值表单测（packaged → 永不启用）；bridge 走 `import.meta.env.DEV` 动态 import → prod 常量折叠 tree-shake。
- [x] 无 token → 401；带 `Origin: http://evil` → 403（已验证）。
- [x] `make check` 通过（typecheck + biome + 12 例单测）；无 `console.*`（除主进程启动 banner，无 logger 可用）。

> **已超出 Phase 1（Phase 3-lite）**：为了当场跑通 before/after，额外落了 `dumpTrace` 命令（读 IndexedDB trace archive）+ `scripts/perf-drive.mjs`（scenario 驱动 + 聚合 → `.logs/perf-reports/`）。完整的 baseline diff / 多跑取中位仍归 Phase 3。
> **首个验收**：用 `counted` 场景验证 `playCount`-off-tracks 修复（commit `07811cc`）——counted-play 触发下 `queue.live.fetch=0`、无 `listAllTracks` 级联（修前是 451ms + ~10s longtask 级联）。

### Phase 2: 压测数据面

**Goal:** 用本机既有歌单按大小一键装载为活动队列。

**Tasks:**
- [ ] `src/dev/perf-fixtures.ts`：`/fixtures/playlists`（`listSessions` + trackCount）、`/fixtures/loadQueue`（`{sessionId}` / `{approxSize}` → `setActiveSession` 或 `playQueueSet`）。
- [ ] （可选）`/fixtures/syntheticQueue`：从既有曲目采样拼 N 首内存队列，**不落库**，用完即弃。

### Phase 2 Checklist
- [ ] `loadQueue {approxSize:5983}` 后 `/state.queueLength === 5983`。
- [ ] 合成队列不写 IndexedDB（事后 `listSessions` 数量不变）。
- [ ] `make check` 通过。

### Phase 3: Scenario runner + 结构化 perf 报告

**Goal:** 脚本化序列 + 可比报告，让 loop 的"数字"可信。

**Tasks:**
- [ ] `src/dev/perf-scenario.ts`：step 类型（action/player/settings/wait）、`repeat`/`everyMs`、`warmup`、写 `scenario.start/step/end` marker。
- [ ] `src/dev/perf-report.ts`：按 runId 在 `.logs` 切片，聚合 §4.1 字段；`runs>1` 取中位，输出分位（p99/max）。
- [ ] 不变量断言：noRemount（复用既有 background/gc-closure 哨兵）、queueOrderStable、schemaValid；任一 false → 报告标红。
- [ ] baseline：`docs/prd/perf-baselines/<scenario>.json`（提交入库）；report 自动 diff baseline 并给 delta。

### Phase 3 Checklist
- [ ] 同一 scenario 跑两遍，中位数字 delta 在噪声阈内（验证可比性）。
- [ ] prod build（`make build` 后 serve）下复测，**第二次循环**取数（规则：首次 warmup 上涨为预期）。
- [ ] 报告含 `frameP99/frameMax/longTaskMax`（不只 renderDuration，对齐 §4 方法学）。

### Phase 4: UI 操作全覆盖

**Goal:** "尽可能所有 UI 操作"可端点驱动。

**Tasks:**
- [ ] `/actions` 列全量可派发 id；命令总线缺的 UI 操作补进 `SHORTCUT_ACTION_HANDLERS` 或 bridge 的 player-action allowlist（setActiveSession / playSystemPlaylist / addUploads(夹具) / displayMode / deleteSession 等）。
- [ ] `/settings` allowlist 覆盖全部 `AppSettings` 可调字段 + zod 校验。
- [ ] `Makefile`：`make perf-drive`（交互式）/ `make perf-scenario NAME=…`。
- [ ] dev 文档：端点目录 + 安全说明 + 常用 scenario 配方。

### Phase 4 Checklist
- [ ] 每个 nav/playback/settings/queue/lyrics/visualizer 操作都有对应端点且 `make check` 全绿。
- [ ] 文档列出"哪些 UI 操作尚未覆盖"（显式 out-of-scope，不留隐性缺口）。

### Phase 5: 自调优 loop playbook

**Goal:** 把 harness 编排成 Claude Code 的 measure→fix→verify 闭环（**文档 + guardrails，不自动 commit**）。

**Tasks:**
- [ ] playbook 文档：`loadQueue → scenario → report → 提修法 → 改 → make check + 不变量 → 重测 → diff baseline → 呈给人审 diff`。
- [ ] guardrails 固化：每轮**必须** `make check` 通过 + 不变量全绿 + 多跑取中位，否则该候选作废。
- [ ] 明确 **loop 不自动 commit**；代码变更与设计决策保持人审。

### Phase 5 Checklist
- [ ] 用 `switch-song-large-queue` scenario 跑通一轮端到端（含上条 `playCount` 写回修法的 before/after）。
- [ ] playbook 写明"指标可被 reward-hack"的反例（禁止靠关可视化/跳解码刷 fps）。

---

## 7. Out of Scope

- **进 production**：本能力**永不**随 packaged build 分发；不做"prod 里临时开"开关。
- **Tauri / 移动 / web 壳**：仅 Electron dev（其他壳后续单独评估）。
- **通用 JS eval / 任意 IPC 透传**：明确禁止（RCE 面）。只暴露枚举命令。
- **自动 commit / 自动合并性能修复**：loop 只到"呈 diff 给人审"为止。
- **具体性能修复本身**：归属各性能 PRD（如 [`switch-song-large-queue-fps`](../20260615-muzero-switch-song-large-queue-fps-prd/20260615-muzero-switch-song-large-queue-fps-prd.md)）；本 PRD 只造测量/驱动 harness。
- **CI 性能门禁**：留接口，但接入 CI 是后续 PRD。

---

## 8. Security Considerations

> 这是本 PRD 的**一等公民**——一个能驱动 App 的本地端点，dev 是工具，shipped 就是漏洞。

- **双重 dev 门（不可绕过）**：仅当 `!app.isPackaged` **且** `process.env.MUZERO_PERF_CONTROL === "1"` 才启动；二者缺一则连 `listen()` 都不调用。配 **Phase 1 防回归测试**断言 packaged build 无控制面、bridge 不进 bundle。
- **Authentication:** per-process 随机 token（启动打印到 stdout），每请求 constant-time 校验；无 token = 401。
- **Authorization:** 仅枚举命令；`/settings` 走 allowlist+zod；**无** 文件读写 / 任意 eval / shell 端点。
- **网络面收敛:** 只 `bind 127.0.0.1`（绝不 `0.0.0.0`）；校验 `Host` 头精确等于 `127.0.0.1:<PORT>` + 拒绝跨源 `Origin`（防 **DNS rebinding** / 浏览器页面偷打本地口）。
- **Data Protection:** 报告/日志只含**聚合性能数字 whitelist**（longtask/frame/fps/heap/requery/queueFetch/blobBytes + 不变量 bool）；**永不**含曲目内容、文件名/路径/bytes、封面字节、`AppSettings` 里的 BYOK key/endpoint（与 CLAUDE.md 规则 2 一致）。
- **与硬规则关系（显式说明，免评审反复）:** 不违反规则 1（非产品后端、无云、无持久化、不分发）；不违反规则 3（只暴露**既有**行为、不新增 gated 产品行为、prod 编译剔除）；回退 = `git revert` 删 dev 模块 + Makefile 条目，非 runtime kill switch。
- **Audit Logging:** 记录命令名 + 结果码 + runId（不记 payload 明细）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [switch-song-large-queue-fps PRD](../20260615-muzero-switch-song-large-queue-fps-prd/20260615-muzero-switch-song-large-queue-fps-prd.md) | 本 harness 的首个消费者；`queue.live.fetch`/longtask 字段来源 |
| [now-playing-switch-background-perf PRD](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) | 切歌背景/封面管线基线（noRemount 不变量来源） |
| [queue-search-fps-investigation PRD](../20260614-muzero-queue-search-fps-investigation-prd/20260614-muzero-queue-search-fps-investigation-prd.md) | 大队列/搜索掉帧方法学先例 |
| [`shortcuts/actions.ts`](../../../src/shortcuts/actions.ts) | 命令总线（端点的主路由目标） |
| [`trace-recorder.tsx`](../../../src/components/shell/trace-recorder.tsx) | 既有 trace → `.logs/` 落盘 |
| prd-create.md §4 | 性能/卡顿类 PRD 方法学（本 harness 报告字段所依据） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 端口固定（如 7345）还是 ephemeral？ | Resolved | **固定 `7345`** + `MUZERO_PERF_CONTROL_PORT` env 可覆盖，便于复用脚本；token 每进程随机 |
| 2 | 需要 `/fixtures/syntheticQueue` 合成大小，还是仅靠既有歌单足够？ | Resolved | **先只做"选既有歌单"**（用户已有 5983 首大集）；`syntheticQueue` 降级为 Phase 2 可选项，无现成大小再补 |
| 3 | report 默认跑几遍取中位？ | Resolved | 默认 **`runs:3`** 取中位；噪声大时手动调 5 |
| 4 | 用自建端点 vs Electron `--remote-debugging-port`(CDP)？ | Resolved | **自建端点**：直接返回结构化报告 + 走真实 action 层；CDP 需手写 eval 且更易越权 |
| 5 | loop 是否允许在 worktree 里自动改+自测但不 commit？ | Resolved | **允许自动改+自测**，但**diff 必经人审、不自动 commit** |
| 6 | `.logs/` 原始 trace 是否入库？ | Resolved | **仅 `perf-baselines/*.json`（数字基线）入库**，原始 trace `.logs/` gitignore |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-15 | User + Claude | Initial draft：dev-only 控制端点 + 压测数据面 + scenario/报告 + 安全门 + 自调优 loop playbook |
| 2026-06-15 | User + Claude | Open Questions 全部定稿：固定端口 7345(+env 覆盖) / 先用既有歌单(合成降级可选) / runs:3 / 自建端点 / 自测但不自动 commit / 仅基线入库 |

---

> **Note:** 本 PRD 坚持"复用既有 action 面、端点只做薄传输"，不新建并行行为逻辑；唯一净新增是 dev-only 传输/夹具/报告模块，且 prod 零面积。
>
> **Exception Policy:** 任何想加"通用 eval / 文件 / shell"端点或让控制面进 prod 的提议，必须单独开 dependency/security review，默认 out-of-scope。
