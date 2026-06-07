# PRD: MUZERO — Cloud Music-Gen Provider Selection (Mureka default · ACE-Step cheap tier)

> **2026-06-07 决策更新**：默认推荐从 ACE-Step 改为 **Mureka（质量优先）**——Mureka V8/V9 是盲测榜 #2、$0.045/首仍在 < $0.05 红线内。ACE-Step 保留为「最便宜 / 器乐」档。文件名沿用旧 codename，不改。

**Status:** Completed（4 phase 代码全实现，76 tests 绿；真实 key 端到端验证待手动）
**Created:** 2026-06-07
**Author:** MUZERO
**Module:** Music generation — cloud BYOK vendor selection & preset adapters

> 这是 [Foundation PRD](../20260606-muzero-ai-dj-foundation-prd/20260606-muzero-ai-dj-foundation-prd.md) **Phase 2（Cloud music API BYOK）** 的落地选型文档。Foundation 阶段已把 `MusicGenProvider` 接口、`cloud` 的 submit→poll→download 流程、`cloud-job.ts` 轮询引擎和 mock provider 备好了；本 PRD 决定**接哪个云 vendor、怎么接**。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Preset infra（auth scheme + 预设注册 + 选型 settings） | ✅ Completed | §6 |
| 2 | ACE-Step (fal.ai) 预设 — 便宜 / 器乐档 | ✅ Completed | §6 |
| 3 | Mureka 预设 — **默认 · 质量/多语种档** | ✅ Completed | §6 |
| 4 | Settings UI + 成本提示 + i18n | ✅ Completed | §6 |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 的核心循环是「LLM DJ 写 `TrackBrief` → 音乐生成 API 出歌 → 续上歌单」。Foundation 阶段只有离线 `mock` provider（合成纯音），无法产出真正的歌。要让产品成立，必须接一个**能按歌词生成整曲人声**的云 API。

本 PRD 基于 2026-06 的横向调研（见 §9 调研报告），从 Suno / Udio / ElevenLabs Music / Mureka / ACE-Step / Stable Audio / Google Lyria / 各 royalty-free API 中做选型。结论：

- **默认推荐 Mureka（质量优先）**：Artificial Analysis 音乐盲测榜 **第 2**（V8，Elo 1144，仅次于 Suno；最新 **V9** 厂商宣称更强但尚无独立 benchmark），有官方异步 API（`api.mureka.ai` submit + 轮询）、付费带商用授权、**中日韩语种友好**（V9 重点改了 zh/ja/ko 发音）。官方 API 是**预充值余额 + 按次扣费**：入门 **TRIAL $30**（12 个月有效、Full Model Access 含 V9、1 并发），**Song Generation V8/V9 = $0.045/首、V7.6 = $0.03/首**（设 `n=1`）——**就在 < $0.05/首 红线之内**，故选它作默认（音乐质量优先于绝对最低价）。代价：有 $30 预充门槛、$0.045/首。本期集成仅 vocal 歌（`/v1/song/generate`）；器乐改走 Mureka BGM 端点 `/v1/instrumental/generate`（§4.5，后续；因 ACE-Step 音质差不再当器乐路径）。
- **ACE-Step（fal.ai 托管）= 最便宜可选档（已降级）**：开源权重官方托管 API，`tags`+`lyrics`（`[inst]` 器乐）直映 `TrackBrief`，$0.012/首、纯按量无预充。⚠️ **2026-06-07 用户实听反馈：ACE-Step 音质太差 → 目前只主推 Mureka**。ACE-Step 代码已建成（保留为「最省钱」可选档），但**不再投入计费/质量验证**（Q3/Q6 搁置）；器乐也改走 **Mureka BGM 端点**（不再用 ACE-Step `[inst]`，见 §4.5）。
- **明确避开 Suno / Udio**：Suno 盲测榜第 1 但**无官方 API**（市面全是逆向 wrapper，违反 ToS、封号风险）；Udio 被 UMG 起诉后和解、转做授权平台，无可用公开 BYOK API。
- **ElevenLabs Music 留作未来 premium 档**（官方 API + 明确商用授权 + composition plan，但 ~$0.13–0.50/首太贵），本期 **out of scope**（§7）。

### 1.2 Target Users

| Role | Description |
|------|-------------|
| **Listener（默认路径）** | 充 $30 Mureka 余额、填 key，就能让 DJ 用榜单第 2 的人声质量无限续歌（~$0.90/小时唯一新歌，仍在红线内）。 |
| **省钱 / 器乐用户** | 一键切到 ACE-Step（fal.ai）：$0.012/首、纯按量无预充、`[inst]` 出器乐。 |
| **Tinkerer / 进阶用户** | 用 `custom` 预设接任意兼容的 submit→poll→download 云 API。 |

### 1.3 Core Value

1. **质量优先** — 默认 Mureka（盲测榜 #2、多语种），$0.045/首仍在 < $0.05 红线内，续歌可放养。
2. **成本可降级** — 一个下拉切到 ACE-Step（$0.012/首、无预充、器乐），无需改 DJ/DB。
3. **架构不破** — 两个 vendor 共用同一套 `cloud` provider + `cloud-job.ts` 轮询引擎，差异只落在每个预设的纯函数里；`musicGenProvider` codename union 保持 `"mock" | "cloud"` 不变（硬规则 #4）。

---

## 2. System Architecture

### 2.1 选型对比（2026-06，BYOK 视角）

| 提供方 | 官方 API | 人声+自定义歌词 | $/首(60s) | 速度 | 盲测榜 | 授权 | 本期决策 |
|---|---|---|---|---|---|---|---|
| **Mureka** | ✅ `api.mureka.ai` 异步轮询 | ✅(`lyrics`+`desc`/`prompt`) | **$0.045 (V8/V9) / $0.03 (V7.6)** | ~45–60s, 1 并发@$30 | **#2**(V8 Elo 1144;V9 未上榜) | 付费 API 全商用 | **✅ 默认（质量优先）** |
| **ACE-Step (fal.ai)** | ✅ 文档化 | ✅ `tags`+`lyrics`+`[verse]/[chorus]`/`[inst]` | **~$0.012** | 快 | 开源模型(未上榜) | 开源权重，商用宽松 | **✅ 便宜 / 器乐档** |
| ElevenLabs Music | ✅ `POST /v1/music` | ✅ composition plan | ~$0.13–0.50 | 异步 | 高 | 付费广义商用 | ⏸️ 未来 premium (§7) |
| Suno | ❌ 仅逆向 wrapper | ✅ | (订阅) | — | **#1**(V5.5) | 免费禁商用 | ❌ 避开(无官方 API) |
| Udio | ❌ 无公开 BYOK | ✅ | — | — | 上榜 | 诉讼后转授权平台 | ❌ 避开 |
| Stable Audio 2.5 | ✅ | ❌ 纯器乐 | 低 | **<2s** | 器乐榜靠前 | 企业向 | ⏸️ 仅器乐回退(未来) |
| Google Lyria 2/3 | ✅(Vertex) | 人声弱 | — | — | 器乐 #4 | — | ❌ 不主推 |
| Mubert/Loudly/Beatoven/Soundraw | ✅ | ❌ 无歌词/人声 | — | — | royalty-free 背景乐 | 商用 | ❌ 非整曲 |

> 单价口径：ACE-Step `$0.0002/秒生成音频`（[fal.ai 官方页](https://fal.ai/models/fal-ai/ace-step/api)）；Mureka 5 credits/首、API 充值 $48/1600cr（[murekav9 pricing](https://murekav9.com/pricing)、[platform.mureka.ai](https://platform.mureka.ai/pricing)）；ElevenLabs 各源冲突、随档位浮动（[help.elevenlabs.io](https://help.elevenlabs.io/hc/en-us/articles/37821528996497-How-much-does-Eleven-Music-cost)）。盲测榜见 [Artificial Analysis Music Arena](https://artificialanalysis.ai/music/leaderboard/vocals)。

### 2.2 续歌成本测算（决策关键）

按「每 ~3 分钟一首新歌 = 20 首/小时」算**唯一新生成歌曲**成本（已缓存歌重播免费）：

| Provider | $/首(60s) | $/小时 | 8 小时 | 角色 |
|---|---|---|---|---|
| **Mureka V8/V9（默认）** | $0.045 (n=1) | **~$0.90** | ~$7 | **默认续歌**（质量优先，红线内）✅ |
| Mureka V7.6 | $0.03 | ~$0.60 | ~$5 | Mureka 省钱档 |
| ACE-Step | $0.012 | ~$0.24 | ~$1.9 | 最便宜 / 器乐回退 ✅ |

> 成本红线（用户决策）：**< $0.05/首**。**Mureka V8/V9 $0.045、V7.6 $0.03、ACE-Step $0.012 全部达标**。用户选择**质量优先 → 默认 Mureka**（盲测榜 #2、多语种）；$0.90/小时唯一新歌在可放养范围。代价是 $30 预充门槛 + 单价 4×，想再省 / 要器乐则一键切 ACE-Step。两者 `DjConfig.autoExtend` 都可默认常开（均在红线内），UI 成本提示让用户随时看到当前单价。

### 2.3 适配点（既有架构如何承载两个 vendor）

两个 vendor 都是「POST 提交 → 轮询 task → 下载音频」，**完全复用** [`cloud-job.ts`](../../../src/musicgen/cloud-job.ts) 的 `pollUntilComplete` 与 [`cloud-provider.ts`](../../../src/musicgen/cloud-provider.ts) 的 `generate` 主流程。差异只有三处纯函数 + 两个连接细节：

```
                     ┌─ ace-step preset ─┐
TrackBrief ─▶ cloud  │ mapBriefToBody    │ ─▶ submit→poll→download ─▶ {blob,mime,durationSec}
              provider│ parseCreate       │      (cloud-job.ts 不变)
   (id 仍是 "cloud")  │ parseStatus       │
                     │ authScheme/paths  │
                     └─ mureka preset ───┘
```

**两个已知连接细节（必须处理，属各预设的 vendor mapping）：**

1. **Auth header scheme 不统一**：现 `cloud-provider.ts` 硬编 `authorization: Bearer <key>`。fal.ai 用的是 `Authorization: Key <FAL_KEY>`；Mureka 用 `Bearer`。→ 把 auth 头做成**每预设可配**（`"bearer" | "key"`，或自定义 header builder）。
2. **fal.ai 是两段式（status → result）**：`.../requests/{id}/status` 只回状态，完成后要 `GET .../requests/{id}` 取 `audio.url`。→ 由 ace-step 预设的 `statusPath`/`parseStatus` 吸收这个差异（让轮询端点直接打 result 端点、未完成时回 pending），**不改 `cloud-job.ts`**。Mureka 的 query-task 端点同时返回状态+音频 URL，走现有形状。

### 2.4 Technology Stack（新增部分）

| Component | Technology | Rationale |
|-----------|------------|-----------|
| 默认音乐生成 | Mureka API（V8/V9） | 盲测榜 #2、官方异步 API、付费商用、中日韩友好、$0.045/首（红线内）|
| 便宜 / 器乐档 | ACE-Step @ fal.ai（sync API） | 开源权重官方托管、$0.012/首、`[inst]` 器乐、`tags`/`lyrics` 直映 brief |
| 出站 HTTP | Tauri `http` 插件 via [`getAppFetch()`](../../../src/lib/platform.ts) | 绕过 WebView CORS / mixed-content（硬规则 #5） |

---

## 3. Data Model Design

`muzero-db` schema **零破坏性变更**，只在 `settings` 单例上追加可选字段。

### 3.1 `AppSettings` 变更（[`src/db/types.ts`](../../../src/db/types.ts)）

- **保持不变（硬规则 #4 codename 稳定）**：`musicGenProvider: "mock" | "cloud"` union 不动；`Track.provider` 仍写 `"cloud"`。
- **新增字段**：
  - `musicCloudPreset?: "ace-step" | "mureka" | "custom"` — 选哪个 vendor 预设；`provider === "cloud"` 时生效，**默认 `"mureka"`**（质量优先；Settings 下拉也把 Mureka 排第一）。
  - 复用现有 `musicCloudUrl / musicCloudApiKey / musicCloudModel`：预设会**预填** url/model 默认值，`custom` 时由用户全填。
- **`DEFAULT_SETTINGS`**：`musicGenProvider` 保持 `"mock"`（离线即用）；`musicCloudPreset: "mureka"` —— 用户切到 `cloud` 时默认就是 Mureka，要省钱/器乐再切 ACE-Step。
- **provenance + 自动 Note（Q5 决议：要）**：生成的 `Track` 上新增可选 **`Track.providerPreset?`**（哪个 vendor/model 生成，缺省安全），服务于「music carries memories」与未来按 vendor 过滤。**且生成时自动附一条 Note**（如「DJ 为 <seed> 生成 · Mureka V9 · <djNote>」），写进 `Track.note`。**Agent 还能在听歌时对话帮加/改 note**——这是 chat 助手 [`track_annotate` 工具](../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md)的核心用例（now-playing 感知）。

### 3.2 Migration

- Dexie schema 版本**无需 bump**（新增的是 `settings` 行内可选字段，非索引/表结构变更）。
- 新用户：`DEFAULT_SETTINGS.musicCloudPreset = "mureka"`。`resolveCloudPreset(undefined)` 仍兜底 `custom`（防御性，正常不会命中，因默认值已填 mureka）。
- Rollback = `git revert` 注册表/预设条目（硬规则 #3，不藏 runtime flag）。

---

## 4. API / Adapter Design

### 4.1 预设注册表（新增，隔离 vendor 映射）

⚠️ 遵循 PRD「不新增源代码文件除非引入新 parser / lib bridge」与硬规则 #5——这里每个 vendor 是一组 vendor-specific 纯函数，属「新 adapter 源」，允许 append 新文件；**禁止**在 DJ/store/UI 散落 `if (preset === ...)`。

新增（建议）：

```
src/musicgen/
├── cloud-provider.ts        # 改：auth scheme 可配 + 接受注入的三个纯函数
├── cloud-job.ts             # 不动
├── presets/
│   ├── index.ts             # CLOUD_PRESETS 注册表：id → {defaults, mappers}
│   ├── ace-step.ts          # mapBriefToBody/parseCreate/parseStatus + fal 两段式
│   └── mureka.ts            # mapBriefToBody/parseCreate/parseStatus
└── registry.ts              # 改：resolveMusicGenProvider 按 preset 取 mappers 注入
```

每个预设导出：

```typescript
interface CloudPreset {
  id: "ace-step" | "mureka";
  label: string;
  defaults: { baseUrl: string; createPath: string; statusPath: string; model?: string };
  authScheme: "bearer" | "key";              // fal=key, mureka=bearer
  mapBriefToBody(brief: TrackBrief, cfg): Record<string, unknown>;
  parseCreate(json: unknown): { jobId?: string; audioUrl?: string };
  parseStatus(json: unknown): JobStatus;
}
```

### 4.2 ACE-Step (fal.ai) 映射要点

| brief 字段 | fal `ace-step` 入参 | 备注 |
|---|---|---|
| `caption` | `tags` | 风格/流派/情绪，逗号分隔 |
| `lyrics`（空）| `lyrics = "[inst]"` | 空歌词 → 纯器乐 |
| `lyrics`（有）| `lyrics`（保留 `[verse]/[chorus]/[bridge]`）| 结构标签直传 |
| `durationSec` | `duration` | 秒；按生成秒数计费 |
| `bpm/keyscale/...` | （ACE-Step 不直接吃，可揉进 `tags` 文本）| DJ 可在 caption 内体现 |

- **Endpoint（已实现：sync）**：`POST https://fal.run/fal-ai/ace-step`，**同步**端点——POST 阻塞至渲染完成、直接回 `{ audio: { url } }`，完美契合 generic create→download 流、**不动 `cloud-job.ts`**，可确定性注入测试。`parseStatus` 仍兜底 fal queue 态（`IN_QUEUE/IN_PROGRESS/COMPLETED/FAILED`）以备改用 `queue.fal.run` 两段式。
- **Auth**：`Authorization: Key <FAL_KEY>`（`authScheme: "key"`）。
- **Output**：WAV。

### 4.3 Mureka 映射要点

| brief 字段 | Mureka 入参 | 备注 |
|---|---|---|
| `caption` | `desc`（或 `prompt`）| 逗号分隔的 genres/moods/vocals，如 "r&b, slow, passionate, male vocal" |
| `lyrics`（有）| `lyrics`（≤5000 字符，保留结构标签）| **空歌词 ≠ 器乐**：Mureka song 端点默认**自动写词**；纯器乐改走 BGM 端点（见下）|
| `vocalLanguage` | （随歌词语言）| 多语种是 Mureka 强项，V9 改进 zh/ja/ko 发音 |
| `model` | **V9 / V8 / V7.6**（API 各档均 Full Model Access）| 默认 V8（榜单第 2、benchmarked）或 V9（更新、自报更强）；V7.6 最便宜($0.03)。O2 仅器乐/高质长耗时。V7/O1/V6/V5.5 已退役→重定向 V7.6 |
| `n`(变体数) | **1**（默认 2，可 1–3）| 续歌设 `n=1` → $0.045/首；要省可保 2 都入队 |
| `title` / `vocal_gender` / `ref_id` | 可选 | DJ 未来可在 brief 加 hint |

- **Base URL**：`https://api.mureka.ai`。**Auth**：`Authorization: Bearer <key>`。
- **计费模型**：**预充值余额 + 按操作扣费**（非月订阅）。入门 **TRIAL $30**（12 个月有效、1 并发、Full Model+API Access **含 V9**）；并发按每笔购买计（$1000=5 并发，连买不累加）。Song Generation **V8/V9 $0.045/首、V7.6 $0.03/首**（`n=1`）。
- **歌曲 Endpoint**：`POST /v1/song/generate` → `{id, status, model, trace_id}` → 轮询 `GET /v1/song/query/{task_id}`（完成回状态 + 音频 URL）。**用轮询不用 webhook**（`replyUrl` 回调需服务器，与 no-backend 冲突）。
- **器乐 Endpoint**：`brief.lyrics` 为空 / `allowVocals=false` 时改打 **BGM 生成**（V8/V9 $0.045/BGM，≤4m30s）——这是 ace-step（`[inst]`）与 mureka 的**关键映射分叉**，预设据 `allowVocals`/空歌词二选一端点。
- **2 变体**：默认返回 2 首数组；`parseStatus` 取第一首落队、第二首作 alternate（或都入队摊薄成本）——ACE-Step 没有的形状，预设需处理多结果。
- **Output**：mp3，≤5m30s（brief 上限 240s 在内）。~45–60s/次。

### 4.4 Error Handling

- 复用现有 `MusicGenError`（带 provider id）与 `JobTimeoutError`/`JobFailedError`。
- 新增可识别错误：401/403（key 无效 → Settings 引导）、429（限流 → 退避；DJ 续歌降速）、配额耗尽。
- **日志纪律（硬规则 #8）**：全程走 [`logger.ts`](../../../src/lib/logger.ts)；**绝不**打印 key、歌词全文、音频 bytes（隐私白名单：provider id / preset id / status / durationSec / 错误码）。

### 4.5 Mureka API 全貌（官方 MCP 源码核实）与对 Agent tool-call 的影响

> 依据：官方 [Skywork Mureka-MCP](https://github.com/SkyworkAI/Mureka-mcp) `mureka_mcp/api.py` 源码 + [platform.mureka.ai 文档](https://platform.mureka.ai/docs/api/operations/post-v1-song-generate.html)。这是真实请求体的权威来源，**印证了我们 `mureka.ts` 的映射**（`{lyrics,model,prompt}` → `{status,choices:[{url}]}`，状态 `succeeded/failed/cancelled/timeouted`）。

**Mureka 端点 → 能力 → 未来 Agent tool 映射**：

| Mureka 端点 | 请求体（核实） | 能力 | 未来 agent tool（provider-agnostic 意图）| 当前适配 |
|---|---|---|---|---|
| `POST /v1/song/generate` | `{lyrics, model:"auto", prompt}` | 带词整曲 | `generate_track`（写 brief）| ✅ 已接 |
| `POST /v1/instrumental/generate` | `{model, prompt}`（**无 lyrics**）→ `/v1/instrumental/query/{id}` | 纯器乐/BGM | `generate_track`（`allowVocals=false`）| ⏸️ 延后（器乐今用 ACE-Step `[inst]`）|
| `POST /v1/lyrics/generate` | `{prompt}` → `{lyrics,title}` | 仅出歌词 | `draft_lyrics`（喂回 brief）| ⏸️ DJ 自己写词，未来可调 |
| `POST /v1/song/extend` | `{ ... }`（prepend/append）| 续写/延长 | `extend_track` | ⏸️ Mureka-only |
| `POST /v1/soundtrack/generate` | `{prompt, image/video}` | 图/视频→配乐 | `score_media`（给上传 MV 配乐）| ⏸️ Mureka-only |
| Stem / Region-edit / Remix（§7 杠杆）| — | 后期编辑 | `extract_stems` / `edit_region` / `remix_track` | ⏸️ Mureka-only |
| `GET /v1/{song,instrumental}/query/{id}` | — | 轮询 | （内部，非 tool）| ✅ 已接 |

**对 Agent tool-call 设计的硬性结论**（下一 phase「对话式助手」要遵守）：

1. **Agent tool 仍 provider-agnostic**：和 DJ 一样，助手写 `TrackBrief` / 发 provider-agnostic 意图（`generate_track` / `extend_track` / `score_media`），由当前 preset 的 adapter 翻译——**禁止**在 tool 实现里 `if (vendor==="mureka")`（沿用硬规则 #5）。
2. **能力按 provider gate**：不同 vendor 能做的事不同（ACE-Step：带词曲 + `[inst]` 器乐；Mureka：带词曲 + 器乐 + extend + soundtrack + stems + remix）。助手要能查询「当前 provider 支持哪些 tool」→ 建议给 `CloudPreset` 加 `supports: { instrumental, extend, soundtrack, stems, remix }` 能力位，agent 只暴露当前 provider 支持的 tool，不支持的优雅降级（如 `score_media` 仅 Mureka 可用；用户在 ACE-Step 下问就提示切换或回退）。
3. **vendor-only 高级能力 = 单独 capability tool**：soundtrack / stems / region-edit / remix 是 Mureka 独有，不强行抽象成所有 provider 的通用接口；它们是「按能力位点亮」的可选 tool，对应 §7 的未来杠杆。
4. **成本/确认**：每个 tool 调用都花钱（MCP 源码每个 tool 都带 "⚠️ COST WARNING"）——agent tool 必须在 UI 上对**有成本的写操作**做一次确认 + 显示预估 $（复用 `estCostPerSongUsd` 等成本元数据）。
5. **本期只落地基**：本 PRD 不实现 agent tools（chat 助手是独立 phase），但已把「能力位 + provider-agnostic 意图 + 成本元数据」的地基对齐好。

---

## 5. Frontend Design

### 5.1 Settings — 音乐生成区块（[`src/pages/settings-page.tsx`](../../../src/pages/settings-page.tsx)）

- **Provider 选择**：`mock`（离线）/ `cloud`（BYOK）。
- 选 `cloud` 后出现 **Preset 下拉**：`ACE-Step (fal.ai) · 便宜推荐` / `Mureka · 高质量·多语种` / `Custom`。
  - 选预设 → 预填 `musicCloudUrl` + 默认 `model`，只需填 API key。
  - `Custom` → 暴露 url/createPath/statusPath/model 全量字段（即现有通用行为）。
- **成本提示**：每个预设旁显示 ~$/首 与「续歌成本」，并在切到 Mureka 时提示 `autoExtend` 会产生明显费用（成本红线 < $0.05/首）。
- **获取 key 直达**：API key 字段下一个「获取 API key ↗」链接，按预设 `apiKeyUrl` 直跳 vendor 的 key 页（ace-step→`fal.ai/dashboard/keys`、mureka→`platform.mureka.ai/apiKeys`；custom 无则不显示）。当前用 `<a target="_blank" rel="noreferrer">`（`make dev` 浏览器即用）；打包桌面端若要强制走系统浏览器需 Tauri opener 插件（见 Open Questions）。
- **按 vendor 具体化（2026-06-07）**：
  - **`model` 字段按 `CloudPreset.usesModel` 显隐**——ACE-Step 的 fal 端点 IS the model（无 `model` 参数）→ **隐藏 model 字段**；Mureka/custom 显示。
  - Mureka model 占位 `auto` + 说明「auto = 最新模型（V9）；或填具体版本 id」（i18n `modelHint`）。
  - **「API 文档 ↗」链接**（`CloudPreset.docsUrl`）：ace→fal ace-step api、mureka→`/v1/song/generate` 文档；custom 无。
- **健康检查**：复用 `provider.health()` + TanStack Query 显示连通状态。
- key 仅存 IndexedDB `settings` 行（硬规则 #2），不写日志/bundle/URL。

### 5.2 DJ Config 联动（[`src/db/types.ts`](../../../src/db/types.ts) `DjConfig`）

- 选 ACE-Step：`autoExtend` 默认 `true`（沿用 `DEFAULT_DJ_CONFIG`）。
- 选 Mureka：新建 session 时 `autoExtend` 默认 `false`，或保留 true 但弹一次成本确认。

### 5.3 State Management

- provider/preset 解析仍是非响应式单例路径（`resolveMusicGenProvider`），**不进 Zustand state**（硬规则 #6）。
- Settings 表单本地 state；落库后由 `useLiveQuery` 驱动 UI。

---

## 6. Implementation Plan

### Phase 1: Preset 基础设施

**Goal:** 让 `cloud` provider 支持「可配 auth scheme + 注入式纯函数」，并把 preset 选择落进 settings —— 基础设施先于具体 vendor（避免后续 vendor PR 反复 rebase）。

**Tasks:**
- [x] `cloud-provider.ts`：auth header 改为按 `authScheme`（`bearer`/`key`）构造（导出纯函数 `buildAuthHeaders`）；`createCloudMusicGenProvider(cfg, mappers?)` 接受注入的 `mapBriefToBody/parseCreate/parseStatus`（保留 `GENERIC_MAPPERS` 作 `custom` 默认）；加 `fetchImpl` 注入便于测试。
- [x] `AppSettings` 加 `musicCloudPreset?: CloudPresetId`；`resolveMusicGenProvider` 按 preset 从注册表取 mappers + defaults + authScheme 注入（`fixedEndpoint` 决定 URL 来自 preset 还是用户）。
- [x] `presets/index.ts` 注册表（Phase 1 仅 `custom`，`resolveCloudPreset` 回退 custom）。

### Phase 1 Checklist
- [x] `cloud-job.ts` 完全未改（diff 为 0）。
- [x] `musicGenProvider` union 仍是 `"mock" | "cloud"`（codename 未动）。
- [x] 现有 `cloud-provider` 测试（含 `cloud-job.test.ts`）仍绿。
- [x] 新增 TDD 测试：`buildAuthHeaders`（bearer/key/无 key）、注入 fetch 的 auth+body、preset 注册表回退 → `pnpm test src/musicgen` 20 绿、typecheck/biome 清。

### Phase 2: ACE-Step (fal.ai) 预设 — 默认

**Goal:** 默认可用的真实出歌路径。

**Tasks:**
- [x] `presets/ace-step.ts`：三个纯函数 + **fal sync 端点**（`https://fal.run/fal-ai/ace-step`，create 直接回 `audio.url`，避开 queue 两段式、不动 `cloud-job.ts`）+ `authScheme: "key"`。
- [x] 单测：`mapBriefToBody`（caption→tags、空/空白 lyrics→`[inst]`、结构标签保留）、`parseCreate`（sync `audio.url` / queue `request_id`）、`parseStatus`（`IN_QUEUE/IN_PROGRESS/COMPLETED/FAILED`）。
- [x] 集成测：注入 fake fetch，跑通 submit→download→WAV blob（auth `Key`、body `{tags,lyrics,duration}`、返回 `{blob,mime,durationSec}`）。
- [x] 注册 ace-step 并设为 `DEFAULT_SETTINGS.musicCloudPreset`。`pnpm test src/musicgen` 28 绿。

### Phase 2 Checklist
- [x] 代码/测试：8 ace-step tests 绿；typecheck + biome 清。
- [ ] **（待真实 key 手动验证）** 用真实 fal.ai key 端到端出一首带歌词的歌 + 一首 `[inst]` 器乐，落库可播。
- [ ] **（待真实 key 手动验证）** 复核实时计费 `$0.0002/秒`、sync 端点对 ~240s 长曲是否超时（超时则切 `queue.fal.run` 两段式）。

### Phase 3: Mureka 预设 — 质量/多语种档

**Goal:** 一个下拉切到榜单第 2 的人声质量。

**Tasks:**
- [x] `presets/mureka.ts`：三个纯函数 + `authScheme: "bearer"` + 异步 `/v1/song/generate` → `/v1/song/query/{id}`；`firstAudioUrl` 兜底 `choices/songs/data[]` 多变体（取第一首）+ 多种 url 字段。
- [x] 单测 + 集成测（注入 fake fetch，submit→poll(running→succeeded)→download mp3、Bearer auth）。
- [~] 选 Mureka 时 `autoExtend` 默认关 / 成本确认 → 移至 **Phase 4**（属 Settings/建集行为，非 preset 层）。
- [x] 注册到 `CLOUD_PRESETS`。`pnpm test src/musicgen` 36 绿。

### Phase 3 Checklist
- [x] 代码/测试：mureka tests 绿；typecheck + biome 清；不动 `cloud-job.ts`。
- [ ] **（待真实 key 手动验证）** 用真实 Mureka key 出一首中文 + 一首日文/韩文歌，落库可播；确认确切端点/字段/model 字符串（Q4）与 `n` 单位（Q8）。
- [ ] **（待真实 key 手动验证）** 确认付费 API 输出带商用授权（[Mureka FAQ](https://platform.mureka.ai/docs/en/faq.html)）。

> v1 限制：Mureka 预设仅 vocal 歌（`/v1/song/generate`）。空歌词/器乐 → 用默认 ACE-Step `[inst]`；Mureka BGM 端点路由因 generic 流用静态 createPath 而延后（见 Out of Scope / Open Questions）。

### Phase 4: Settings UI + 成本提示 + i18n

**Goal:** 用户能看懂地选 provider 与成本。

**Tasks:**
- [x] Settings 预设下拉（`CLOUD_PRESET_IDS` 渲染）+ 按 `fixedEndpoint` 条件显示 URL + 按 `authScheme` 切 key 占位符 + model 占位用 preset 默认 + 健康检查（按 preset）。
- [x] 成本提示：`CloudPreset.estCostPerSongUsd`（通用字段，非 id 分支）+ 纯 helper `continuousHourlyUsd` → UI 显示「≈ $X/首 · 续歌 ≈ $Y/小时」；custom 显示未知。
- [x] 文案进 i18n catalog（en/zh/ja/ko 全量：`preset`/`presetAceStep`/`presetMureka`/`presetCustom`/`costHint`/`costUnknown`/`getApiKey`），强类型 key 校验通过。
- [x] 「获取 API key ↗」直达链接（preset `apiKeyUrl` 数据驱动；浏览器 preview 验证三态：ace-step→fal、mureka→mureka apiKeys、custom→无链接 + 显示 URL 字段；成本/占位随预设更新；零 console 报错）。
- [~] Mureka 续歌默认关：改以**成本提示**实现（两 provider 均 < $0.05 红线，硬关 `autoExtend` 理由减弱，且会引入 `if(preset===mureka)` 分支违反硬规则 #5）→ 用户可在 DJ console 自行 toggle。

### Phase 4 Checklist
- [x] 四语种文案齐全（en/zh/ja/ko 各 +6 key）。
- [x] `make check`（typecheck + lint 70 files + test 76）全绿。
- [ ] **（待真实 key 手动验证）** 截图/实机确认 Settings 预设切换、成本提示、健康检查显示正常。

---

## 7. Out of Scope

- **ElevenLabs Music**（留作未来 premium 档）：官方 API + composition plan + 明确商用授权很强，但 ~$0.13–0.50/首超出本期成本红线；其 $/首 在调研中三个定价声明均未通过对抗校验，需后续单独核价。
- **Suno / Udio**：无官方 BYOK API，永久排除（除非官方放出 API）。
- **Stable Audio 2.5 / Google Lyria 等纯器乐**：可作未来「器乐 session」可选回退，本期不接（DJ brief 以人声+歌词为中心）。
- **royalty-free 背景乐 API（Mubert/Loudly/Beatoven/Soundraw）**：无歌词/人声控制，不符合整曲生成定位。
- 不引入 MUZERO 自有后端 / 账号 / 遥测（硬规则 #1）。
- 不本地跑模型（ACE-Step 本地已下线，仅走云托管）。
- **Mureka Studio 能力（本期不接，记为未来杠杆，官方已明码标价）**：均为编辑/后期类，核心续歌循环用不到，但未来可映射 MUZERO 方向——
  - **Describe Song $0.10**（自动识别乐器/流派、生成 tags+描述）→ **自动给上传曲打 tag**，直接喂注释/搜索（[`track-search.ts`](../../../src/lib/track-search.ts)）。
  - **Export Stem V2 $0.70**（12 轨 + MIDI）/ V1 $0.06（5 轨）→ 可视化/波形增强（替代当前原生 `<video>` 取声）。
  - **Region Editing $0.10** / **Remix $0.20** → 中途「重 roll 某段 / 换风格保旋律」的 DJ steering。
  - **Single Track Gen $0.09** → 给用户上传曲加 AI 伴奏/人声（混合集增强）。
  - **Soundtrack $0.10**（图/视频→音乐）→ 给上传 MV / 视频单配乐。
  - **Extend Song**（append/prepend，V7.6 $0.036 / V8 $0.10）、**Lyric 生成 $0.009**、**Lyrics Video $0.10**、**Vocal Cloning $5**。
  - 需要时各自开 PRD。

---

## 8. Security Considerations

- **BYOK 密钥纪律（硬规则 #2）**：fal.ai / Mureka 的 key 只存 IndexedDB `settings` 行，用户自填；不写 bundle / `.env`（committed）/ URL / 日志 / 遥测。`.env.example` 只放非密默认（如示例 baseUrl）。
- **出站面**：仅两个用户配置的第三方 API（音乐 + LLM DJ），经 Tauri `http` 插件。
- **隐私白名单**：日志只记 provider/preset id、status、durationSec、错误码；绝不记 key / 歌词 / 音频 bytes / prompt。
- **授权合规**：Mureka 仅**付费** API 输出带商用授权；ACE-Step 为开源权重，UI 可注明生成物使用边界。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Foundation PRD](../20260606-muzero-ai-dj-foundation-prd/20260606-muzero-ai-dj-foundation-prd.md) | 本 PRD 是其 Phase 2 落地 |
| [CLAUDE.md](../../../CLAUDE.md) | 硬规则 #1–#9（本地优先 / BYOK / provider 边界 / codename 稳定） |
| [`cloud-provider.ts`](../../../src/musicgen/cloud-provider.ts) · [`cloud-job.ts`](../../../src/musicgen/cloud-job.ts) · [`registry.ts`](../../../src/musicgen/registry.ts) | 改动落点 |
| [fal.ai ACE-Step API](https://fal.ai/models/fal-ai/ace-step/api) | 默认 provider 官方文档 |
| [Mureka API FAQ](https://platform.mureka.ai/docs/en/faq.html) · [pricing](https://platform.mureka.ai/pricing) | 质量档官方文档 |
| [Artificial Analysis Music Arena](https://artificialanalysis.ai/music/leaderboard/vocals) | 盲测质量榜 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 接哪些 vendor？默认谁？ | Resolved | Mureka + ACE-Step + custom；**2026-06-07 默认改为 Mureka（质量优先）**，ACE-Step 作便宜/器乐档 |
| 2 | 单首成本红线？ | Resolved | < $0.05/首；Mureka($0.045)/ACE-Step($0.012) 均达标，续歌可放养 |
| 3 | fal.ai ACE-Step 实时计费确为 $0.0002/秒？ | **Resolved（搁置）** | **用户实听 ACE-Step 音质太差 → 目前只主推 Mureka**，不再投入 fal 计费验证；如未来重启 ACE-Step 再测 |
| 4 | Mureka 默认用哪个 model？ | Resolved（partial）| **官方 MCP 确认 `model:"auto"`=选最新（=V9）→ 默认 auto**（质量优先正好）；exact `V8`/`V9` API 字符串仍需 live key 实测，但 auto 安全且最优 |
| 4b | Mureka 器乐/BGM 端点形状？ | Resolved | **官方 MCP 确认 `POST /v1/instrumental/generate {model,prompt}`(无 lyrics) → `/v1/instrumental/query/{id}` → `{status,choices:[{url}]}`**；**因 ACE-Step 音质差，器乐改以此为正式路径**（不再用 ACE-Step `[inst]`），作后续增强（§4.5）|
| 5 | `Track.provider` 是否记录 preset 以保留 provenance？ | **Resolved** | **要**：加 `Track.providerPreset?` + 生成时自动附 Memory；Agent 听歌时可对话加/改 memory（chat `add_memory` 工具）。运行时写入已完成，UI 展示待页面 WIP 解锁。见 §3.1 |
| 6 | ACE-Step 实际延迟 / 采样率 / 立体声 / 最大时长？ | **Resolved（搁置）** | ACE-Step 音质差不主推，相关验证搁置；只主推 Mureka |
| 7 | Mureka 一次返 2 变体：`n=1` / 落队第一首 / 都入队？ | **Resolved** | **默认 `n=1`**（$0.045/首达标红线）；用户主动「再来个变体」时才 2 |
| 8 | Mureka `$0.045/song` 单位确认（按产出首数还是按调用）？ | **Resolved（人工）** | **用户人工用 Mureka key 测**（已只主推 Mureka）；页面标 "/song" + 默认 2 首/次，确认 `n=1` 是否=$0.045 |
| 9 | 「获取 API key」打包桌面端走系统浏览器？ | **Resolved** | **必须走系统浏览器（用户要求）→ 加 `@tauri-apps/plugin-opener`**：JS dep + `lib.rs` 注册 + capability `opener:allow-open-url` + `openExternalUrl()` 包装（Tauri 用 opener、浏览器回退 `window.open`）已完成；Settings/Get-key 接线待并行 UI WIP 落地后补。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft — 选型定为 ACE-Step (fal.ai) 默认 + Mureka 档，基于 2026-06 横向调研 |
| 2026-06-07 | MUZERO | 补 Mureka V9 深挖：确认 `api.mureka.ai` 端点/字段/model enum、V9 改 zh/ja/ko 发音但未上独立榜；Studio 编辑能力记为未来杠杆 |
| 2026-06-07 | MUZERO | **更正定价**：官方 API 是预充值余额(TRIAL $30 起、12mo、含 V9)+按次扣费，**非 $1000/月门槛**（useapi.net 误导）。Song Gen V8/V9 **$0.045/首**、V7.6 $0.03，**在 < $0.05 红线内** → Mureka 稳作 tier-2。补空歌词→BGM 端点分叉、`n` 变体、Studio 明码标价 |
| 2026-06-07 | MUZERO | **Phase 1 完成**（TDD）：`cloud-provider` 加 `buildAuthHeaders`(bearer/key)+注入式 `CloudMappers`+`fetchImpl`；`presets/index.ts` 注册表(custom)；`AppSettings.musicCloudPreset`；`registry` 按 preset 注入。20 tests 绿，`cloud-job.ts` 未动 |
| 2026-06-07 | MUZERO | **Phase 2 完成**（TDD）：`presets/ace-step.ts`（fal sync 端点、`Key` auth、caption→tags / 空歌词→`[inst]`）；注册为默认 preset。8 ace-step tests（含注入 fetch 端到端），musicgen 28 绿。sync 端点对长曲超时风险留作真实 key 验证 |
| 2026-06-07 | MUZERO | **Phase 3 完成**（TDD）：`presets/mureka.ts`（异步 `/v1/song/generate`+`/song/query/{id}` 轮询、Bearer、caption→prompt、多变体取第一首）；注册档。mureka tests（含注入 fetch submit→poll→download），musicgen 36 绿。autoExtend-默认关移至 Phase 4 |
| 2026-06-07 | MUZERO | **Phase 4 完成**：Settings 预设下拉 + 条件 URL + 成本提示（`estCostPerSongUsd`/`continuousHourlyUsd` 通用字段，非 id 分支）+ 健康检查；i18n 4 语 ×6 key。`make check` 全绿（typecheck/lint 70/test 76）。**4 phase 代码全部完成** |
| 2026-06-07 | MUZERO | **+ 获取 API key 直达按钮**：preset 加 `apiKeyUrl`（ace→fal.ai/dashboard/keys、mureka→platform.mureka.ai/apiKeys），Settings 渲染「获取 API key ↗」链接 + i18n ×4。浏览器 preview 三态验证通过、零报错 |
| 2026-06-07 | MUZERO | **默认改为 Mureka（质量优先）**：`DEFAULT_SETTINGS.musicCloudPreset` ace-step→mureka，下拉 Mureka 排第一 + 标「推荐」，i18n ×4。ACE-Step 降为便宜/器乐档。单测锁定默认；浏览器清 IndexedDB 旧行后实机确认默认=mureka、链接/成本随之更新 |
| 2026-06-07 | MUZERO | **API 核实 + Settings 具体化 + Agent 设计**：用官方 Mureka MCP 源码核实 schema（印证 `mureka.ts`），挖出器乐端点 `/v1/instrumental/generate`。preset 加 `usesModel`/`docsUrl`；Settings 隐藏 ACE-Step 的 model 字段、加 Mureka model 说明 + 「API 文档↗」链接（i18n ×4）。新增 §4.5「Agent tool-call 设计」（端点→provider-agnostic 能力映射、能力位 gate、成本确认）。浏览器三态验证、零报错；42 musicgen tests 绿 |
| 2026-06-07 | MUZERO | **战略转向 + Open Q 收口**：用户实听 **ACE-Step 音质太差 → 只主推 Mureka**（ACE-Step 保留为可选便宜档但不再验证，Q3/Q6 搁置）；器乐改以 **Mureka BGM 端点**为正式路径（Q4b）。Q5=要 provenance(`Track.providerPreset`)+生成自动 Note+Agent 听歌对话加 note；Q7=默认 `n=1`；Q8=用户人工 Mureka key 测；**Q9=必须走系统浏览器 → 加 `@tauri-apps/plugin-opener`（待实现）** |
| 2026-06-07 | Codex | 推进 OPENER infra：新增 `@tauri-apps/plugin-opener` / `tauri-plugin-opener`，Rust 注册 opener plugin，capability 加 `opener:allow-open-url`，新增 `openExternalUrl()`（Tauri 系统浏览器 + browser fallback + http(s) 协议校验）。补 Vitest；`make check` 通过（49 files / 356 tests），`cargo check` 通过。 |
| 2026-06-07 | Codex | 推进 Q5 provenance runtime：新增 musicgen provenance helper，cloud provider/registry 暴露 `providerPreset`（vendor:model），repo 在生成 pending track 时写 `Track.providerPreset` 并自动加 provenance Memory；chat/DJ 生成路径接入。补测试；`make check` 通过（50 files / 361 tests）。 |

---

> **Note:** 本 PRD 强调**改既有代码**而非新建结构：复用 `cloud-job.ts` 轮询引擎与 `cloud-provider.ts` 主流程，新增的只有 vendor-specific 预设纯函数（属允许 append 的新 adapter 源）。`musicGenProvider` codename union 与 `muzero-db` schema 保持稳定。
