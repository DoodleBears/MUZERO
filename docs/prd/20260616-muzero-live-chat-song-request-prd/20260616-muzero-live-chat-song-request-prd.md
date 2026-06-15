# PRD: 直播弹幕点歌 —— 通用接线 + 多来源可配置映射（仿 anysoul 测试→上线）+ mu0.app 网页 SSN WebSocket

**Status:** Final
**Created:** 2026-06-16
**Author:** MUZERO Team
**Module:** live-requests（观众点歌引擎）· lib/desktop（壳层抽象）· components/settings · stores/player —— 把已建好的引擎接进 App，把 intake 泛化成「多来源 + 模板字段映射 + 启用前测试」的通用层（仿 `anysoul` webhook 形式），并让托管网页 `mu0.app` 也能收弹幕

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 通用接线 + 模板引擎：runtime 单例 + intake 消费者 + `request-template.ts`（移植 anysoul 模板引擎）+ 映射预设 + 无审核默认值（地基） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 多来源 + 测试生命周期：`sources[]`（status: testing/active/disabled）+ server 按 `/v1/intake/<id>` 路由 + testing 模式捕获 sanitized payload（不触发播放） | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Web SSN WebSocket transport：泛化 bridge 接口 + `web.ts` 出站 WS 实现 + `social-stream-relay.ts`（转发原始事件，交给 ssn 模板预设） | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 映射对话框 UX（仿 anysoul）：JSON 树点选映射 + 每字段实时预览（同引擎 parity）+ 预设/visual/raw + Go Live + 来源列表（状态徽章/生命周期/复制 URL） | 🔄 In Progress | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | i18n（en/zh/ja/ko）+ 测试 + 收尾 | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

我们已有一整套**观众点歌（audience request）引擎**，按「直播弹幕点歌 + Social Stream Ninja（SSN）转发」设计：

- **归一化层** [`audience-request-schema.ts`](../../../src/live-requests/audience-request-schema.ts)：`sourceKind: "social-stream-ninja"` 一等公民，已能探测一组写死的候选 key（`message`/`chatmessage`/`comment`…）抽 query + 剥 `commandPrefixes`（默认 `["点歌","!sr","song:"]`）。
- **路由层** [`audience-request-router.ts`](../../../src/live-requests/audience-request-router.ts)：纯函数，`library-search`/`ai-dj`/`hybrid` + 低置信度联网兜底。
- **运行时** [`audience-request-runtime.ts`](../../../src/live-requests/audience-request-runtime.ts)：去重/冷却/限流/搜库（[`audience-request-search.ts`](../../../src/live-requests/audience-request-search.ts)）/执行播放（`append-queue`/`play-next`/`play-now`）/AI DJ 入队（[`audience-request-ai-dj.ts`](../../../src/live-requests/audience-request-ai-dj.ts)）/在线兜底。
- **桌面 transport** [`electron/live-request-intake.cjs`](../../../electron/live-request-intake.cjs)：Electron 主进程本地 loopback HTTP server（`127.0.0.1:<port>/v1/audience/request`），SSN「Call Webhook」POST 进来；经 [`bridge.liveRequestIntake`](../../../src/lib/desktop/bridge.ts) 暴露 `start/stop/status/onMessage`。
- **设置面板** [`live-request-settings.tsx`](../../../src/components/settings/live-request-settings.tsx)：路由/播放/阈值/限流/token/调试收件箱。
- **部署面** [`wrangler.toml`](../../../wrangler.toml) + [`docs/deploy/mu0-app-release.md`](../../deploy/mu0-app-release.md)：`mu0.app` 已是 Cloudflare Pages 静态 `dist/` build（无后端）。

**关键缺口（核心动因）：`runtime.handle()` 至今没有接进运行中的 App —— 任何端都没接。** 全仓搜索确认 `normalizeAudienceRequest`/`runtime.handle()` **只在单测里被调用过**；唯一消费 `onMessage` 的是设置面板那个**调试收件箱**（[`live-request-settings.tsx:76`](../../../src/components/settings/live-request-settings.tsx)），它只把消息显示成文字，不搜库/入队/播放。

> **结论**：今天即便桌面端，一条弹幕点歌 POST 进来也只是 Settings 里多一行文字，**不会真的播**。引擎/transport/UI 三块各自做好，但「最后一公里接线」缺失。

**三个动因合并为本期范围：**
1. **接线**：把引擎接进 App，桌面端真正端到端（弹幕→搜库→入队→播放）。
2. **泛化成通用映射层**：intake 不绑死 SSN，本质是「**任意 JSON 请求体 → 字段映射 → query → AI DJ / search library**」。一个固定 port、多个来源端点 `/v1/intake/<id>`，每来源各自映射 + 路由目标。SSN 退化为众多预设之一。
3. **mu0.app 联网**：网页端出站 SSN WebSocket（公共 relay），零 MUZERO 后端。

### 1.2 参考实现：复刻 `anysoul` 的 webhook「测试→上线 + 模板映射」形式（Q7）

用户指定**参考 `D:\code\project\anysoul`** 的 webhook 自定义 + 启用前测试形式。研究其实现（文件清单见 §9），核心机制如下，我们**复刻**：

- **`testing → active` 生命周期**（anysoul `webhook_endpoints.status`）：新建来源默认 `testing`。**testing 模式下，进来的请求只被「捕获 + 映射预览」，不触发真实动作**（不入队/不播）。用户基于真实捕获到的 body 把 mapping 调对，再点 **Go Live**（`testing → active`）才开始驱动播放。这正是「启用之前可以测试」。
- **实际看到请求来源的 JSON body**（anysoul `webhook_test_payloads` + 映射对话框）：testing 模式把每条进来的 payload **脱敏**（剥 key/token/secret 等）后存起来，映射对话框左栏用**可点击的 JSON 树**展示真实 body；点某个字段 → 把它的路径表达式插入当前聚焦的目标字段（**click-to-map**）。
- **模板引擎映射**（anysoul `applyTemplateString`，client/server 同一份 → preview parity）：mapping 不是死的 dot-path，而是**模板字符串**——`{{ payload.chatmessage || payload.textContent }}`、三元 `{{ payload.donationAmount ? 'donation' : 'chat' }}`、管道 `{{ payload.messages | map '${item.user}: ${item.message}' | join '\n' }}`、字面量、`payload.a.b` 路径。**这天然覆盖「拼接多字段」（如 `artist + title`）**——所以之前列为 v2 的 query 模板**本期就有**。
- **每字段实时预览**：右栏每个目标字段一个输入框 + 把该模板**对当前选中的真实 payload** 求值后的预览值（含报错）。用同一个引擎在前端预览、在 ingest 时真正执行 → **所见即所得**。
- **预设 + visual/raw 双模式**：预设下拉（含 `Ninja Social Stream`）一键填模板；visual（逐字段）/ raw（直接编辑 mapping JSON）两个 tab；顶部一条「**点歌会搜什么**」的合成预览行。
- **来源列表 + 生命周期操作**：每来源卡片显示状态徽章（testing/active/disabled）、复制端点 URL、Go Live / Pause / Test mode / Delete。

**MUZERO 的本地优先适配**（与 anysoul 的云端 D1/DO 不同）：

- **无后端**：anysoul 的 ingest 在 server、test payload 存 DB；MUZERO 的 ingest 是 **Electron 主进程本地 server**（桌面）/ **SSN WebSocket**（网页），两者都已通过 IPC/`onMessage` **实时推给渲染端**。所以 testing 捕获的 payload 直接在**渲染端 controller 的内存环形缓冲**里（复用现有 50 条收件箱思路），**不需要 anysoul 那样 5s 轮询 DB**，也**不需要新 DB 表**——对话框订阅 controller 即可实时刷新。
- **目标字段是 MUZERO 的**：anysoul 映射到 `platform/element/event_type/title/payload`；MUZERO 映射到 **`query`（必填）+ `requester`/`platform`/`role`/`externalId`**（喂进 `NormalizedAudienceRequest`）。
- **脱敏 + 体积**：复刻 anysoul `stripSensitiveFields`（剥 `key/api_key/secret/token/password/authorization/...`）再存/显示；沿用 `maxBodyBytes`（256KB）。

### 1.3 决策记录（产品方向）

形态 **「桌面全能 + 网页轻量」**，逐条裁决见 §10（Q1–Q7）：

- **桌面 Electron**：全功能（库内 + AI 生成 + 联网搜歌）。两种 transport 都可选。
- **托管 `mu0.app` 网页**：出站 SSN WebSocket（公共 relay）。`ai-dj`/`hybrid` **不硬锁**——BYOK 端点 CORS-friendly 就能用，否则优雅失败（Q3）。
- **transport 两个轴**（Q5）：机制 `http-webhook`（你当 server，仅桌面）vs `ssn-websocket`（订阅 relay，两端）；relay 位置 公共 vs 自建。
- **无审核**（Q4）：不做审核看板/人工放行；命中即按 `playbackAction` 入队/播放，低置信度/无命中丢弃（仅状态日志可见）。`requireApprovalForPlayNow` 默认 `false`。注意：这与 §1.2 的「testing 不触发」是**两件事**——testing 是上线前的调试闸；active 之后无人工审核。
- **通用多来源 + 模板映射 + 测试生命周期**（Q6 + Q7）：见 §1.1/§1.2。

### 1.4 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **主播（Broadcaster）** | 配一个或多个来源（SSN / 别的 bot / OBS 脚本），先 testing 看真实 body 调好 mapping，再 Go Live 让观众弹幕点歌 | 桌面：多来源 webhook + websocket + 全路由；网页：SSN WebSocket（+ best-effort ai-dj） |
| **观众（Viewer）** | 弹幕里 `点歌 <歌名>`，由来源工具转发 → MUZERO 入队/播放 | 间接、`commandPrefixes` 触发、受限流/冷却/去重（无人工审核） |
| **第三方来源工具** | SSN / bot / OBS 脚本等，按各自端点 `/v1/intake/<id>` POST **任意 JSON** | 由该来源的模板映射抽取 query 与元数据 |

### 1.5 Core Value

1. **打通最后一公里**：引擎在桌面端真正端到端跑通。
2. **通用、可测试、可扩展的来源接入**：任意能发 JSON 的工具，先 testing 看真实 body、用模板把 mapping 调对、再 Go Live；每来源独立路由到 AI DJ 或 search library。
3. **所见即所得映射**：同一模板引擎跑预览与 ingest（parity）；click-to-map + 实时预览，零猜测。
4. **mu0.app 联网播放器**：托管网页 + 出站 SSN WebSocket，零 MUZERO 后端（符合本地优先硬规则）。
5. **复用既有架构**：路由/搜库/安全/AI-DJ 不动；归一化从「写死候选 key」演进为「模板映射 + `auto` 预设兜底」，向后兼容。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
   桌面 (Electron) —— 多来源 webhook                      托管网页 (mu0.app)
   ──────────────────────────────                        ────────────────────
   来源A(SSN) ─POST /v1/intake/ssn──┐                     SSN relay (wss://, sessionId)
   来源B(bot) ─POST /v1/intake/bot──┤                            │ 出站订阅 channel 4 (read-only)
   ...                              │                            ▼
                                    ▼          [新增] web.ts.liveRequestIntake ─ SSN WS client
                      live-request-intake.cjs          │ (转发原始事件 JSON；非聊天帧丢弃)
                      (本地 127.0.0.1 server)            │ onMessage({sourceId:"ssn", body})
                           │ emit({sourceId, body})      │
                           ▼                             ▼
                 bridge.liveRequestIntake.onMessage(cb) ◀┘   （统一契约，按端不同实现）
                           │
                           ▼
       [新增] live-request-controller.ts · 模块级单例（硬规则 #6：不进 store）
         1. 按 sourceId 找 source（status / mapping / 路由覆盖）
         2. 脱敏 payload → 存入 testing 捕获环（内存，对话框订阅）
         3. applyMapping(rawPayload, source.mapping) → { query, requester, platform, role, externalId }
              · auto 预设 → 走现有候选-key 启发式（向后兼容）
              · 其余预设 / custom → 模板引擎 request-template.ts
         4. normalizeAudienceRequest（剥命令前缀）
         5. ── source.status ──┬─ testing → 仅捕获 + 映射预览，**不 handle**（不触发播放）
                               └─ active  → runtime.handle(req, { routeMode, playbackAction })
                           │
                           ▼
       createAudienceRequestRuntime({ playNow, getActiveSessionId, ... })  ← 已存在，本期实例化
         去重/冷却/限流 → searchLocal → planAudienceRequestRoute
                           │
        ┌──────────────────┴───────────────────┐
        ▼                                       ▼
    playback (append/next/now)             ai-dj / online-search
        │                                  (桌面全功能；web best-effort，CORS 限)
        ▼
  playQueueAppend / playQueuePlayNext / deps.playNow → player-store.playTrack
  低置信度/无命中 → ignored（仅状态日志可见，无审核）
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **模板映射引擎** | 移植 anysoul `applyTemplateString`（纯函数，新增 `request-template.ts`） | `{{ }}` + `\|\|` + 三元 + 管道 + 路径；前端预览与 ingest 同一份 → parity；覆盖多字段拼接 |
| **映射预设** | 预设注册表（`auto`/`social-stream-ninja`/`generic-json`/`custom`） | `auto` = 现有启发式（向后兼容）；来源形状收口在预设模板 |
| **多来源路由** | `AudienceRequestSource[]` + server 按 `/v1/intake/<id>` 分发 | 一个 port、多端点；每来源独立映射 + 路由目标 + 状态 |
| **测试生命周期** | 来源 `status: testing\|active\|disabled` + 渲染端内存捕获环 | testing 只捕获+预览不触发；Go Live 上线；无后端、无新表 |
| **桌面 transport** | Node `http`（已存在 `live-request-intake.cjs`，扩多路径） | 本地 loopback；SSN「Call Webhook」/任意 bot POST |
| **网页 transport** | 浏览器原生 `WebSocket`（出站连 SSN relay） | 网页不能监听入站端口；WSS 无 CORS/混合内容；无需后端 |
| **路由/搜库/安全/AI-DJ** | 已存在纯函数（live-requests/*） | 不改契约，最大化复用 |
| **设置持久化** | Dexie `settings` 行（`AudienceRequestIntakeSettings`） | 追加可选字段 + `sources[]`；不破坏 codename 层 |

### 2.3 Project Structure

```
src/
├── live-requests/
│   ├── audience-request-schema.ts          # [改] auto 预设 = 现有启发式；其余走模板映射结果
│   ├── request-template.ts                 # [新增] 移植 anysoul 模板引擎 applyTemplateString（纯函数）
│   ├── request-mapping-presets.ts          # [新增] 目标字段 schema + 预设(auto/ssn/generic/custom) + 检测/转换 helper
│   ├── audience-request-sources.ts         # [新增] AudienceRequestSource 解析 + 默认来源 + sourceId 路由 + resolveMapping
│   ├── audience-request-router.ts          # 已存在：路由（纯，不动）
│   ├── audience-request-runtime.ts         # [改] 实例化 + 注入依赖 + handle() 接受每来源路由覆盖
│   ├── audience-request-search.ts          # 已存在：搜库（纯，不动）
│   ├── audience-request-security.ts        # 已存在：去重/冷却（纯，不动）
│   ├── audience-request-ai-dj.ts           # 已存在：AI DJ 入队（不动）
│   ├── live-request-controller.ts          # [新增] 模块级单例 + onMessage→(找来源→脱敏捕获→映射→testing?预览:handle)
│   └── social-stream-relay.ts              # [新增] SSN WebSocket 客户端（转发原始事件；vendor 隔离）
├── lib/desktop/
│   ├── bridge.ts                           # [改] 泛化 LiveRequestIntakeStartInput（判别联合）；payload 带 sourceId
│   ├── electron.ts                         # [改] http-webhook 按 /v1/intake/<id> 路由（默认来源兼容旧 URL）
│   ├── web.ts                              # [改] 新增 liveRequestIntake（SSN WS 实现）
│   └── tauri.ts                            # 保持 omit（不支持，面板显示 unsupported）
├── components/settings/live-request/       # [新增目录] 仿 anysoul webhook UI
│   ├── live-request-settings.tsx           # [改] 来源列表 + transport 选择 + 只读状态日志（壳）
│   ├── source-card.tsx                     # [新增] 单来源卡片：状态徽章/复制 URL/Go Live·Pause·Test·Delete
│   ├── mapping-dialog.tsx                  # [新增] 映射对话框：JSON 树 + 目标字段 + 预设 + visual/raw + Go Live
│   ├── json-payload-tree.tsx               # [新增] 可点击 JSON 树（点字段→插入 payload.path）
│   └── target-field-input.tsx             # [新增] 目标字段输入 + 实时预览值/报错
└── stores/player-store.ts                  # 已存在 playTrack/getActiveSession（被 controller 引用，基本不动）
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
AudienceRequestIntakeSettings (settings 行，单例 id="app" 的子对象)
  ├─ enabled
  ├─ transport: "http-webhook" | "ssn-websocket"            ← 判别字段（web 默认后者）
  ├─ (http-webhook) bindHost/port/authToken
  ├─ (ssn-websocket) ssnRelayUrl?/ssnSessionId?
  ├─ sources: AudienceRequestSource[]                        ← 多来源（含默认来源）
  │     每来源: { id, name, status, authMode, mappingPreset, mapping?,
  │              commandPrefixes?, routeMode?, playbackAction? }
  ├─ routeMode / playbackAction / searchScope                ← 全局默认（来源未覆盖时回退）
  ├─ confidenceThreshold / scoreMarginThreshold / commandPrefixes / includeLyrics / onlineFallbackOnLowConfidence
  └─ dedupeWindowSec / requesterCooldownSec / maxRequestsPerMinute / requireApprovalForPlayNow(默认 false)

RequestMapping (模板映射，纯数据；每目标字段一个模板字符串)
  └─ { query, requester?, platform?, role?, externalId? }   值如 "{{ payload.chatmessage || payload.text }}"

映射预设: "auto" | "social-stream-ninja" | "generic-json" | "custom"
  └─ auto = 现有候选-key 启发式（零配置、向后兼容；不走模板）

CapturedPayload (testing 捕获，内存环 ≤50；脱敏后)
  └─ { sourceId, rawPayload, mappedPreview, mappingErrors[], receivedAt }

NormalizedAudienceRequest / AudienceRequestRuntimeItem  (内存态，不入库)
```

### 3.2 Database Schema

⚠️ 偏向修改既有结构，全部追加可选字段，不破坏既有数据；**无新表**（捕获在内存）。

- **Current**：[`AudienceRequestIntakeSettings`](../../../src/db/types.ts#L522) 当前是单 HTTP-server 形状（`bindHost`/`port`/`authToken`），默认值 [`DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS`](../../../src/db/types.ts#L541)。
- **Required Changes**：
  ```ts
  export type AudienceRequestTransport = "http-webhook" | "ssn-websocket";
  export type AudienceRequestSourceStatus = "testing" | "active" | "disabled";
  export type AudienceRequestAuthMode = "open" | "secret";
  export type MappingPresetId = "auto" | "social-stream-ninja" | "generic-json" | "custom";

  // 每个目标字段一个模板字符串（模板引擎求值）。query 必填。
  export interface RequestMapping {
    query: string;        // → normalizedQuery（剥命令前缀前）。如 "{{ payload.chatmessage || payload.text }}"
    requester?: string;   // → 显示名 / requesterKey
    platform?: string;    // → platform
    role?: string;        // → requesterRole
    externalId?: string;  // → 去重 id
  }

  export interface AudienceRequestSource {
    id: string;                       // 端点路径后缀 /v1/intake/<id>（codename 稳定，禁改已发布 id）
    name: string;
    status: AudienceRequestSourceStatus;        // 新建默认 "testing"
    authMode: AudienceRequestAuthMode;          // 默认 "open"（本地 loopback 低风险）；"secret" 用 token
    mappingPreset: MappingPresetId;
    mapping?: RequestMapping;                    // preset==="custom" 时生效；预设选中时由预设填充
    commandPrefixes?: string[];                  // 每来源覆盖（缺省回退全局）
    routeMode?: AudienceRequestRouteMode;        // 每来源「转发到 ai-dj / library-search / hybrid」
    playbackAction?: AudienceRequestPlaybackAction;
  }

  export interface AudienceRequestIntakeSettings {
    enabled: boolean;
    transport?: AudienceRequestTransport;        // ?? (web ? "ssn-websocket" : "http-webhook")
    bindHost: "127.0.0.1"; port: number; authToken?: string;       // http-webhook
    ssnRelayUrl?: string;                         // 默认 "wss://io.socialstream.ninja"（公共，Q1）
    ssnSessionId?: string;                        // 客户端拼 `${ssnRelayUrl}/join/${ssnSessionId}/4`
    sources?: AudienceRequestSource[];            // 缺省回填默认来源
    // 其余 routeMode/playbackAction/searchScope/阈值/限流/commandPrefixes 作为全局默认保持
  }
  ```
- **默认来源（向后兼容）**：`sources` 缺省回填 `{ id:"default", name:"Default", status:"active", authMode:"open", mappingPreset:"auto" }`，走旧路径 `/v1/audience/request`（保留）。可选内置一条 `{ id:"ssn", mappingPreset:"social-stream-ninja", status:"testing" }`。
- **`requireApprovalForPlayNow` 默认改 `false`**（Q4）。
- **映射预设模板**（`request-mapping-presets.ts`）：
  - `auto` → 不用模板，走现有候选-key 启发式。
  - `social-stream-ninja` → `query: "{{ payload.chatmessage || payload.textContent }}"`, `requester: "{{ payload.chatname || payload.userid || 'viewer' }}"`, `platform: "{{ payload.type || payload.platform || 'stream' }}"`, `externalId: "{{ payload.id }}"`。**同时兼容 SSN webhook payload 与公共 WS channel-4 事件**（两者都用 `chatmessage`/`chatname`/`type`），因此 WS 路径不再需要 remap（见 §4.2）。
  - `generic-json` → `query: "{{ payload.message || payload.text }}"`, `requester: "{{ payload.username }}"`, `platform: "{{ payload.platform }}"`, `externalId: "{{ payload.messageId || payload.id }}"`。
  - `custom` → 用户在对话框里写的模板。
- **Data Migration**：`settings` 单例行启动与 `DEFAULT_SETTINGS` 浅合并；新增字段全可选，**无需 bump DB version / 写 upgrade**。`sources` 缺省回填默认来源；来源 `id` = 端点路径（codename 稳定，不可改已发布 id）。
- **Privacy & Retention**：`ssnSessionId`/`authToken` 禁日志/遥测；testing 捕获 payload **脱敏后**仅在内存环（≤50，刷新即清），**不入库**。

### 3.3 Bridge 接口变更（壳层契约）

[`bridge.ts`](../../../src/lib/desktop/bridge.ts#L135) 当前 `LiveRequestIntakeStartInput = { port; token; maxBodyBytes? }`。泛化为判别联合（硬规则 #10）：

```ts
export type LiveRequestIntakeStartInput =
  | { transport: "http-webhook"; port: number; token: string; maxBodyBytes?: number;
      sourceIds: string[] }                       // 路径白名单 /v1/intake/<id>（含 "default"）
  | { transport: "ssn-websocket"; relayUrl: string; sessionId: string; sourceId: string };

export interface LiveRequestIntakePayload {
  sourceId: string;   // [新增] 命中的来源（http: 取自 /v1/intake/<id>；ws: 固定该 ssn 来源）
  body: string;
  receivedAt: number;
}
```

`onMessage`/`start`/`stop`/`status` 形态不变；主进程**只**按路径白名单分发 + 转发 `{sourceId, body}`，**不做映射/脱敏**（vendor 与映射逻辑全在渲染端 `src/`，主进程薄）。`tauri.ts` 继续 omit。

---

## 4. API / 集成设计

### 4.1 桌面 webhook（多来源）

固定 port，多来源端点；body 是**任意 JSON**，由该来源模板映射抽取。

| Endpoint | Method | Description |
|----------|--------|-------------|
| `http://127.0.0.1:<port>/v1/intake/<sourceId>?token=…` | POST | 通用来源端点（`<sourceId>` ∈ 已配置且非 disabled）；body 任意 JSON |
| `http://127.0.0.1:<port>/v1/audience/request?token=…` | POST | **保留**为默认来源（`sourceId="default"`）别名，向后兼容 |
| `http://127.0.0.1:<port>/health` | GET | 健康检查 |

token 沿用现有（query `?token=` 或 `Authorization: Bearer`），仅当来源 `authMode==="secret"` 时校验。未知/disabled 的 `sourceId` → 404。

### 4.2 网页：SSN WebSocket 订阅

**已核实的 SSN 公共协议**（来源见 §9）：

- **连接**：`wss://io.socialstream.ninja/join/<SESSION_ID>/4`（channel 4 = 扩展聊天消息）；或握手帧 `{"join":"<SESSION_ID>","in":4,"out":null}`（`out:null` → 只收不发，天然 read-only）。
- **事件形状**：`{ chatname, chatmessage, type, id, hasDonation? }`（`type` = 平台）。
- **超时/重连**：约每分钟 timeout（5s 无响应回 `"timeout"`）→ 必须重连/rejoin。

**与模板映射的关系（简化）**：`social-stream-relay.ts` 只需 **转发原始事件 JSON**（非聊天/无 `chatmessage` 帧丢弃），并打上 `sourceId`（该 SSN 来源）。**不再需要 remap `type→platform`/注入 `app`**——因为 SSN 来源用 `social-stream-ninja` **模板预设**，模板直接读 `payload.chatmessage`/`payload.type`/`payload.chatname`，webhook 与 WS 两种形状都覆盖。`buildJoinUrl(relayUrl, sessionId)` + 退避重连/定时 rejoin（注入 `now`/`sleep`，对齐 [`cloud-job.ts`](../../../src/musicgen/cloud-job.ts) 确定性单测）。

### 4.3 来源 → 捕获 → 映射 → 归一化 → (testing 预览 | active 执行)

```typescript
// live-request-controller.ts（新增）—— 桌面与网页都走这条
const unsub = bridge.liveRequestIntake.onMessage((payload) => {
  let raw: unknown;
  try { raw = JSON.parse(payload.body); } catch { return; }                 // 非 JSON 丢弃
  const intake = resolveIntake(settings);
  const source = findSource(intake.sources, payload.sourceId);
  if (!source || source.status === "disabled") return;

  const sanitized = stripSensitiveFields(raw);                              // 脱敏（移植 anysoul）
  const mapping = resolveMapping(source);                                   // 预设 or custom；auto→null
  const mapped = applyMapping(sanitized, mapping);                          // 模板引擎；auto 走启发式
  const request = normalizeAudienceRequest(mapped, {
    commandPrefixes: source.commandPrefixes ?? intake.commandPrefixes,
  });

  captureForTesting(source.id, sanitized, mapped, request);                 // 内存环；对话框订阅

  if (source.status === "testing") return;                                  // testing：只预览，不触发
  void runtime.handle(request, {                                            // active：每来源路由覆盖
    routeMode: source.routeMode ?? intake.routeMode,
    playbackAction: source.playbackAction ?? intake.playbackAction,
  });
});
```

- `applyMapping`：`auto` 预设直接交给现有 `normalizeAudienceRequest` 启发式；其余按模板引擎对每个目标字段求值，产出 `{ query, requester, platform, role, externalId }`（再交给 `normalizeAudienceRequest` 做剥前缀 + 组装）。
- **runtime 小改**：`handle()` 接受每调用 `{routeMode, playbackAction}` 覆盖（其余逻辑/既有单测不变）。
- `runtime` 单例注入 `playNow`/`getActiveSessionId`/`getCurrentTrackId`；`canUseAiDj`/`onlineFallback` 用默认（不按端硬禁，Q3）。

### 4.4 Error Handling

- **非 JSON / 缺 query**：丢弃/标记；`query` 模板求值为空 → 在对话框预览显示报错（红字），active 模式下该条 `ignored`。
- **WS 断线**：退避重连；UI status `error`。
- **限流/冷却/重复**：runtime 返回 `ignored`（`rate-limited`/`cooldown`/`duplicate`），状态日志标注。
- **Telemetry**：无遥测（硬规则 #1）。仅 [`logger.ts`](../../../src/lib/logger.ts)；禁记 `ssnSessionId`/`authToken`/身份字段/原始 payload 全文（可记 status + 截断 query）。

---

## 5. Frontend Design

### 5.1 接线挂载点

- 新增 [`live-request-controller.ts`](../../../src/live-requests/live-request-controller.ts)：`startLiveRequestIntake()`/`stopLiveRequestIntake()`，持有 runtime 单例 + onMessage 订阅 + testing 捕获环 + 当前 `start()` 生命周期。App 启动挂一次（参照 `AudioEngine`），随 `enabled`/`transport`/`sources` 变化 re-apply。**不进 store state**（硬规则 #6）。

### 5.2 映射对话框 UX（Phase 4，仿 anysoul）

对应 anysoul `WebhookMappingDialog`。布局：左「真实 payload（JSON 树）」/ 右「目标字段 + 预览」，顶部预设 + 合成预览行，底部 Save / Go Live。

- **左栏 · 真实 payload**：testing 捕获的 payload 列表下拉（最新在前，自动选第一条到达的）+ **可点击 JSON 树** [`json-payload-tree.tsx`](../../../src/components/settings/live-request/json-payload-tree.tsx)：点某叶子 → 把 `{{ payload.<path> }}` 插入当前**聚焦的目标字段**（click-to-map）。空态提示「向该来源端点发一条请求即可在此看到 body」。复制/刷新/清空按钮。**实时**（订阅 controller 捕获环，无需轮询）。
- **右栏 · 目标字段** [`target-field-input.tsx`](../../../src/components/settings/live-request/target-field-input.tsx)：`query`(必填) / `requester` / `platform` / `role` / `externalId`，每个一个模板输入框 + 把模板对**当前选中真实 payload**求值的**预览值 / 报错**。底部一行管道语法提示。
- **预设下拉**：`auto` / `Ninja Social Stream` / `Generic JSON` / `Custom`，选中填充模板；检测当前模板匹配哪个预设否则 `custom`（移植 `detectWebhookPresetId`）。
- **visual / raw 双 tab**：visual 逐字段；raw 直接编辑 mapping JSON（`{{ payload.x }}` 语法）。切换时同步 + 校验 JSON。
- **合成预览行**：顶部一条「点歌会搜什么 / 会怎么路由」的合成预览（query + platform + requester），用预览值实时拼。
- **底部**：testing 时显示「测试模式 —— 不会真的点歌」提示 + **Save mapping** + **Go Live**（保存后 `status→active`）。active 时只有 Save。

### 5.3 来源列表 + transport（Phase 4）

[`live-request-settings.tsx`](../../../src/components/settings/live-request-settings.tsx) 重构（对应 anysoul `WebhooksSettingsView`）：

- **transport 选择器**（Q5）：`http-webhook`（仅桌面）/ `ssn-websocket`（两端）。桌面默认 webhook，网页默认 websocket 且隐藏 webhook。
- **来源列表**（http-webhook）：可增/删来源；每来源 [`source-card.tsx`](../../../src/components/settings/live-request/source-card.tsx)：名称 + **状态徽章**（testing 琥珀 / active 绿 / disabled 灰）+ authMode 徽章 + **复制端点 URL** + **配置映射**（开对话框）+ 生命周期按钮（testing：Go Live / Disable；active：Pause / Test mode；disabled：Enable）+ Delete。
- **ssn-websocket 表单**（两端）：SSN session ID + relay URL（默认公共，折叠可改自建）+ 连接状态。这条来源固定 `social-stream-ninja` 预设；仍可设 routeMode/播放动作/status。
- **routeMode 不锁**（Q3）：web + 来源路由到 `ai-dj`/`hybrid` 时挂非阻断 CORS 提示。
- **只读状态日志**（无审核，§1.3 Q4）：底部沿用现有收件箱位置，升级为请求状态日志（status/query/匹配曲目/置信度，纯可观测、无操作）。
- 顶部状态 pill（listening/stopped/error/unsupported）。

### 5.4 State Management

- runtime 单例 + WS 客户端 + testing 捕获环：模块作用域，非响应式（硬规则 #6）。
- 设置（含 `sources[]`）：Dexie `settings` 行，`useSettings()` 响应式读、`saveSettings()` 写。
- 映射对话框：捕获 payload 从 controller 取快照 + 订阅刷新；模板预览为本地计算；mapping 草稿本地 state，Save 才落 `saveSettings`。

---

## 6. Implementation Plan

> Phase 顺序「基础设施先于覆盖广度」：先接线 + 模板引擎（Phase 1），再多来源 + 测试生命周期（Phase 2）、web WS（Phase 3），最后映射 UI（Phase 4）。

### Phase 1: 通用接线 + 模板引擎（地基）

**Goal:** 弹幕真正驱动搜库→入队→播放；桌面默认来源（`auto` 映射）端到端跑通；无审核。

**Tasks:**
- [x] 新增 `request-template.ts`：移植 anysoul `applyTemplateString`（`{{ }}` / `||` / 三元 / `map`·`join`·`time` 管道 / 路径 / 字面量 / `BLOCKED_KEYS` 防原型污染）。纯函数。**10 测试通过。**
- [x] 新增 `request-mapping-presets.ts`：目标字段 schema（`query` 必填）+ 预设（`auto`/`ssn`/`generic`/`custom`）+ `applyMapping`/`getPresetMapping`/`detectPresetId`。**7 测试通过。**
- [x] `audience-request-schema.ts`：`auto` = 现有候选-key 启发式（无需改 schema）；`applyMapping` 输出键已被 `normalizeAudienceRequest` 探测 → 天然「接受已映射对象」。
- [x] 新增 `live-request-controller.ts`：runtime 模块级单例 + 注入 `playNow`（懒加载 player-store）；onMessage → JSON.parse → normalize → `runtime.handle`。**5 测试通过。**（脱敏/applyMapping/sourceId 路由留 Phase 2）
- [x] `audience-request-runtime.ts`：`handle(request, override?)` 接受每调用 routeMode/playbackAction 覆盖（合并进 effective intake）。**runtime 测试 12 通过。**
- [x] App 启动挂载 `startLiveRequestIntake()`（订阅 onMessage；server 起停仍由 Settings 面板按 enabled 控制，onMessage 多订阅共存）；卸载清理。
- [x] `DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS.requireApprovalForPlayNow` 改 `false`（+ 同步 `default-settings.test.ts`）。
- [x] 单测：模板引擎穷举（10）+ mapping 预设（7）+ controller 管线/订阅（5）+ runtime override（12 total）；低置信度 → `ignored` 由 runtime 测试覆盖。

### Phase 1 Checklist
- [ ] 桌面真实链路：默认来源 POST（curl/SSN）→ 队列出现该曲目并按 `playbackAction` 生效。
- [ ] 模板引擎与 anysoul 行为对齐（移植测试用例）。
- [ ] controller 不进 store state（grep 确认）。

### Phase 2: 多来源 + 测试生命周期

**Goal:** 多来源端点 + 每来源映射/路由；testing 模式只捕获预览不触发。

**Tasks:**
- [x] 新增 `audience-request-sources.ts`：`resolveSources`（默认来源回填）/`findSource`（absent→default）/`resolveSourceMapping`（auto→null、custom→自带、预设）。**3 测试通过。**
- [x] settings：`db/types.ts` 加 `AudienceRequestSource`（status/authMode/mappingPreset/mapping/路由覆盖）+ `sources?` + `DEFAULT_AUDIENCE_REQUEST_SOURCE`（id:"default", auto）回填进 DEFAULT。
- [x] `bridge.ts` + `electron.ts`：`LiveRequestIntakePayload` 带 `sourceId?`；主进程 `resolveSourceId` 按 `/v1/intake/<id>` 路由，`/v1/audience/request`→`default`，非法路径 404。（`LiveRequestIntakeStartInput` 判别联合 → Phase 3 web WS；per-source `authMode` token 校验 → Phase 4 UI）
- [x] controller：脱敏（移植 `stripSensitiveFields`，深度递归）+ testing 捕获内存环（≤50，`getCaptured`/`getCapturedLiveRequests` 供对话框）；`status==="testing"` 只捕获预览**不 handle**；active 按来源映射 + 路由覆盖 `runtime.handle`。
- [x] 单测：testing 来源捕获不触发；active ssn 来源抽 query + 路由覆盖 `ai-dj`；脱敏（含嵌套）；disabled/未知 sourceId 丢弃。**controller 9 + sources 3 通过。**

### Phase 2 Checklist
- [x] 多来源各自端点独立映射/路由/状态（controller 单测覆盖）。
- [x] testing 来源 → 被捕获、**不入队不播**；active 才驱动播放（Go Live = 改 status，Phase 4 UI）。
- [x] 默认来源旧 URL `/v1/audience/request` → `default` 仍工作。

### Phase 3: Web SSN WebSocket transport

**Goal:** `mu0.app` 网页出站订阅 SSN 公共 relay。

**Tasks:**
- [x] 新增 `social-stream-relay.ts`：`buildJoinUrl`（channel 4）+ `parseRelayEvent`（转发聊天帧、丢控制帧）+ `connectSocialStreamRelay`（退避重连，注入 socket 工厂 + sleep，read-only）。**6 测试通过。**
- [x] `web.ts`：实现 `liveRequestIntake`（`start({transport:"ssn-websocket",…})` → 连 relay；多订阅者 `onMessage` 吐带 `sourceId` 的 body；`stop`/`status`）；`http-webhook` 在 web 返回 unsupported。
- [x] `bridge.ts`：`LiveRequestIntakeStartInput` 改判别联合（`http-webhook` transport 可选，兼容现有面板调用 / `ssn-websocket`）。
- [x] SSN 来源用 `social-stream-ninja` 预设（读 `chatmessage`/`type`/`chatname`，无需 remap——relay 转发原始事件）。
- [x] 单测：channel-4 事件转发 + 控制帧丢弃 + 重连 + stop（relay 6）；映射经 ssn 预设由 mapping-presets 测试覆盖。

### Phase 3 Checklist
- [x] WS 超时/断开自动重连（退避）；`status()` 反映 connecting/open/closed。
- [x] electron 仍走 http-webhook（union 的 transport 可选，面板 `start({port,token})` 不破；typecheck 通过）。
- [ ] `make dev`（浏览器）端到端：填 session id → 真实弹幕进 controller —— **依赖 Phase 4 的设置面板 transport/来源 UI 驱动 `start`**，留 Phase 4 验证。

### Phase 4: 映射对话框 UX + 来源列表（仿 anysoul）

**Goal:** §5.2/§5.3 完整 UI：真实 body JSON 树 click-to-map、每字段实时预览、预设/visual/raw、Go Live、来源列表生命周期。

**Tasks:**
- [x] `json-payload-tree.tsx`：可点击 JSON 树，点叶子插入 `{{ payload.path }}`。
- [x] `target-field-input.tsx`：模板输入 + 用 `request-template.ts` 对选中 payload 求值的实时预览/报错。
- [x] `mapping-dialog.tsx`：左 payload（下拉 + 树 + 刷新/清空）/ 右目标字段 + 预设下拉(`Select`) + visual/raw(`Tabs`) + Save / Go Live；用 `@/components/ui/{dialog,tabs,select,textarea}`。+ `mappingToFieldValues`/`fieldValuesToMapping` helper（带测试）。
- [ ] `source-card.tsx`：状态徽章 + 复制端点 URL + 配置映射 + 生命周期按钮 + Delete。
- [ ] `live-request-settings.tsx`：transport 选择器(`Select`) + 来源列表 + ssn-websocket 表单 + 只读状态日志 + web CORS 提示 + controller 生命周期驱动 `start`。

### Phase 4 Checklist
- [ ] testing 来源发请求 → 对话框实时看到真实 body → 树点选/写模板 → 每字段预览正确 → Go Live → active 真正点歌。
- [ ] 预设一键填模板；visual/raw 切换同步；合成预览行随 payload/模板更新。
- [ ] 桌面多来源可配；网页 SSN session + CORS 提示；默认来源旧 URL 可复制（兼容）。

### Phase 5: i18n + 测试 + 收尾

**Tasks:**
- [ ] i18n key（来源列表/增删/状态、映射对话框、预设名、目标字段标签、管道语法提示、JSON 树空态、Go Live、SSN session/relay、CORS 提示、状态日志）en→zh/ja/ko 全量。
- [ ] `make check`（typecheck + lint + test）全绿。
- [ ] 更新 [`docs/deploy/mu0-app-release.md`](../../deploy/mu0-app-release.md)：网页 SSN 配置 + 桌面多来源 webhook + 测试→上线流程。

### Phase 5 Checklist
- [ ] 四语言无缺 key（缺则 PR 标 pending translation + followup issue）。
- [ ] CHANGELOG / release note 更新。

---

## 7. Out of Scope

- **审核看板 / 人工放行**（Q4）：不做。低置信度/无命中直接丢弃。注意 `testing` 是上线前调试闸，不是逐条审核。
- **网页直连 localhost 的 SSN**（Q2）：不做（mixed-content/PNA 脆弱；本地需求用桌面 webhook）。
- **MUZERO 自建 relay / 后端**：不做（违反硬规则 #1）。
- **testing 捕获持久化入库**：内存环（≤50，刷新即清）即可；不入 IndexedDB（与 anysoul 不同——anysoul 因云端跨进程才落库，MUZERO 同进程 onMessage 推送够用）。
- **每来源独立限流配额 / webhook rotate**：本期全局限流 + 单 token；anysoul 的 per-webhook rotate/rate-limit 留 v2。
- **移动端 / 多平台聊天聚合自研**：交给 SSN。
- **运营 kill switch / hidden flag**：回退 = `git revert` + 重新发版（硬规则 #3）。

> 注：网页端 `ai-dj`/`hybrid` 不再 out of scope（Q3，best-effort）；「多字段拼接 / query 模板」也不再 out of scope（Q7，模板引擎原生支持）。

---

## 8. Security Considerations

- **观众文本 untrusted**：AI DJ prompt 已声明把弹幕当不可信内容、不泄露 key/endpoint/路径（[`formatAudienceRequestForDjChat`](../../../src/live-requests/audience-request-ai-dj.ts)）。沿用。
- **testing 捕获脱敏**（移植 anysoul `stripSensitiveFields`）：存/显示 payload 前剥 `key/api_key/secret/token/password/authorization/access_token/...`，避免把对方工具携带的密钥落进捕获环或显示在 UI。
- **testing 不触发动作**：上线前请求不入队/不播，避免误配映射直接打断直播。
- **网页 WS 只读订阅**：`out:null`，仅收不发。
- **来源端点白名单 + authMode**：主进程只接受已配置且非 disabled 的 `sourceId`；`authMode:"secret"` 校验 token（query/Bearer）；`open` 仅限本地 loopback 低风险场景。
- **滥用防护**：去重/按人冷却/每分钟限流（[`audience-request-security.ts`](../../../src/live-requests/audience-request-security.ts)）；`playbackAction` 默认 `play-next`（不打断当前曲）。
- **任意 JSON body**：限 `maxBodyBytes`（256KB）；模板只读取指定路径，`BLOCKED_KEYS` 防原型污染。
- **密钥纪律（硬规则 #2）**：`authToken`/`ssnSessionId` 禁日志/遥测；BYOK key 不经此路径。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| `D:\code\project\anysoul` `packages/server/src/db/schema/webhooks.ts` | **参考**：`webhook_endpoints`(status/authMode/mappingJson/samplePayload/excludeFields) + `webhook_test_payloads`(rawPayload/mappedResult/errors) |
| `anysoul` `packages/server/src/services/webhooks.ts` | **参考**：模板引擎 `applyTemplateString`、`ingestWebhook`（testing 捕获、脱敏、go-live）、`testWebhookMapping`、rate limit、auth |
| `anysoul` `packages/server/src/routes/webhook-ingest.ts` + `routes/agents/webhooks.ts` | **参考**：ingest 路径 `/:agentId/:webhookId`、CRUD + test-payloads API |
| `anysoul` `packages/web/src/components/agent/webhook/{WebhookMappingDialog,TargetFieldInput,mapping-presets}.tsx` + `WebhooksSettingsView.tsx` + `lib/template-engine.ts` | **参考**：映射对话框（JSON 树 click-to-map、每字段预览、预设、visual/raw、Go Live）、来源列表生命周期、前端同款模板引擎（preview parity） |
| [Social Stream Ninja API 文档](https://socialstream.ninja/api.html) | WS `wss://io.socialstream.ninja/join/<id>/4`、握手帧、事件字段（`chatname`/`chatmessage`/`type`）、超时重连 |
| [`docs/deploy/mu0-app-release.md`](../../deploy/mu0-app-release.md) | mu0.app（Cloudflare Pages）+ 桌面 artifact 发布手册 |
| [`CLAUDE.md`](../../../CLAUDE.md) | 硬规则 #1（无后端）/ #6（selector 纪律）/ #10（壳层抽象） |
| [`src/musicgen/cloud-job.ts`](../../../src/musicgen/cloud-job.ts) | 注入 now/sleep 的轮询引擎（WS 重连参照其确定性单测） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | SSN relay URL / 握手帧 / 信封 | ✅ Resolved | 用公共 `wss://io.socialstream.ninja/join/<id>/4`（或握手帧 `{join,in:4,out:null}`）；事件 `{chatname,chatmessage,type,id}`（§4.2）；`ssnRelayUrl` 可改自建 |
| 2 | 网页直连本地 SSN（localhost）可行吗？ | ✅ Resolved | 澄清 + 不做：本地 SSN 也能推公共 relay；直连 `https→ws://127.0.0.1` 受 PNA/浏览器差异限制，脆弱；完全本地用桌面 webhook。out-of-scope |
| 3 | 网页 CORS-friendly BYOK 时解锁 ai-dj？ | ✅ Resolved | 解锁。不硬锁 routeMode；web ai-dj/hybrid best-effort，失败优雅降级 + 非阻断提示 |
| 4 | 需要审核看板吗？ | ✅ Resolved | 不需要。无审核看板/人工放行；`requireApprovalForPlayNow` 默认 false；只读状态日志 |
| 5 | 桌面也暴露 SSN WebSocket？ | ✅ Resolved | 支持。两端 transport 选择器；webhook(server,仅桌面) vs websocket(relay,两端)；relay 公共/自建是另一轴 |
| 6 | intake 泛化成「多来源 + 可配置映射」到哪个程度？ | ✅ Resolved | 完整多来源：每来源端点 `/v1/intake/<id>` + 独立映射 + 路由目标 + 状态 |
| 7 | 映射/测试形式怎么做？ | ✅ Resolved | **复刻 anysoul**：`testing→active` 生命周期（testing 只捕获+预览不触发）+ 实际看真实 JSON body（脱敏、JSON 树 click-to-map）+ **模板引擎映射**（`{{ }}`/`\|\|`/三元/管道，前端预览与 ingest 同引擎 parity）+ 预设/visual/raw + Go Live。MUZERO 适配：无后端、捕获在内存（无新表、无轮询）、目标字段为 `query`(必填)/requester/platform/role/externalId |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-16 | MUZERO Team | Initial draft：通用接线 + mu0.app 网页 SSN WebSocket；记录「runtime 未接线」关键发现 |
| 2026-06-16 | MUZERO Team | 定稿 Final：裁决 Q1-Q5；核实 SSN 公共 WS 协议 |
| 2026-06-16 | MUZERO Team | 扩展 Q6：intake 泛化为多来源 + 可配置映射 |
| 2026-06-16 | MUZERO Team | 扩展 Q7：复刻 anysoul「测试→上线 + 模板引擎映射」形式——`testing/active` 生命周期、testing 脱敏捕获真实 body、JSON 树 click-to-map、每字段实时预览（同引擎 parity）、预设/visual/raw、Go Live。dot-path 升级为模板引擎（覆盖多字段拼接），新增 `request-template.ts`/`request-mapping-presets.ts` + 映射对话框组件；重排 phase（模板引擎 → 多来源+测试生命周期 → web WS → 映射 UI） |

---

> **Note:** 复用既有 live-requests 引擎（路由/搜库/安全/AI-DJ 不动）。新增量：模板引擎 + 映射预设 + 多来源（sources[] + `/v1/intake/<id>`）+ 测试生命周期（testing 捕获预览、Go Live 上线）+ 接线单例 + web WS + 仿 anysoul 映射 UI。来源形状收口在模板预设；遵循无后端 / selector / 壳层抽象三条硬规则。SSN 退化为众多预设之一，intake 成为通用「JSON 请求 → 模板映射 → AI DJ / search library」层。
