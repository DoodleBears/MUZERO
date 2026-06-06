# PRD: MUZERO — AI DJ Chat Agent Panel（多 Session 对话 · 三形态 · 流式 · 工具调用）

**Status:** Draft
**Created:** 2026-06-07
**Author:** MUZERO
**Module:** AI DJ 对话助手 —— 本地优先、BYOK、Vercel AI SDK v6 tool-loop、Dexie 持久化

> **复刻来源**：doodlekuma.com 的 ClipCombo「subtitle-chat / composition agent」面板是一套**成熟、已评审**的实现与 PRD 簇。本 PRD 把它的 best practice **适配到 MUZERO 的无后端 / 本地优先 / Tauri / Dexie / Zustand** 架构。ClipCombo 与 MUZERO 是姊妹项目（同样 Vite+React、Dexie、AI SDK v6、BYOK），**chat 那套本身就是 100% 客户端直连 provider、Dexie 持久化、无业务后端**——所以几乎不用「拆后端」，主要是换 domain（DJ/曲库 tools + system prompt）、把 key 从 localStorage 挪进 IndexedDB `settings`、HTTP 走 `getAppFetch()`。
>
> 参考 ClipCombo PRD：`agent-multi-session-panel` / `subtitle-chat-panel-vercel-ai` / `subtitle-chat-panel-streamdown-telemetry` / `agent-queued-interrupt-prompts` / `agent-onboarding-empty-context` / `agent-source-composition-tool-contract` / `editor-ai-agent-control-plane`（见 §10）。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Chat runtime 地基（Dexie v3 + Runtime Actor + 单 session 流式 + streamdown） | 🔲 Pending | §7 |
| 2 | 三形态显示外壳（FAB / 底部输入条 / Dock 1∕3 → 移动端全屏） | 🔲 Pending | §7 |
| 3 | DJ 工具调用（search/create/curate/propose/generate + HITL 审批） | 🔲 Pending | §7 |
| 4 | 多 Session + 历史列表（搜索）+ branch/regenerate | 🔲 Pending | §7 |
| 5 | 多 Provider 模型选型（preset 化 + combobox + Settings + key 入 Dexie） | 🔲 Pending | §7 |
| 6 | 队列/打断 prompt + 空态 onboarding + 上下文压缩 | 🔲 Pending | §7 |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 现在用 LLM **DjBrain** 一次性 `generateObject` 写 `TrackBrief[]`、自动续歌（[`dj-brain-ai.ts`](../../../src/dj/dj-brain-ai.ts)）。但用户**没法用自然语言跟 DJ 对话**——「给我做一个深夜 focus 的 set」「把刚才那首换成更 chill 的」「从我 #gym 的上传里挑几首」都做不到。

本 PRD 引入一个**对话式 AI DJ 助手**：用户用聊天驱动 search / create / curate / propose / generate 工具（CLAUDE.md「下一阶段」明确点名的方向），助手通过 **Vercel AI SDK v6 的 tool-loop** 在浏览器里直接调用 `DjEngine` + 仓库函数。它**复刻 ClipCombo 的全部对话能力**：多 session、可搜索历史、每步本地持久化、regenerate / branch、多 provider 模型选择、流式显示（streamdown）。并新增 MUZERO 特有的**三种显示形态**。

### 1.2 Target Users

| Role | Description |
|------|-------------|
| **Listener（主路径）** | 大多数时候只想在一个**底部输入框**里跟 DJ 说一句需求（"来点雨天爵士"），不想打开完整 chat UI。 |
| **Curator / Tinkerer** | 要多轮对话精修歌单、管理多个对话 session、搜历史、branch 出新方向、切换不同 LLM provider/model。 |

### 1.3 Core Value

1. **自然语言驱动 DJ** —— 把「写 brief / 续歌 / 改单 / 搜库」从隐式自动化变成可对话、可确认、可撤销的工具调用。
2. **三形态贴合场景** —— FAB（不打扰）→ 底部输入条（一句话指挥）→ Dock 全功能面板（深度对话），同一套 panel body。
3. **本地优先不变** —— 对话、历史、每一步都进 IndexedDB；LLM 仍是用户 BYOK 直连；无 MUZERO 后端、无遥测（硬规则 #1）。
4. **复用成熟范式** —— 直接搬 ClipCombo 已评审的 Runtime Actor / HITL 审批 / streamdown / 队列打断 / 工具契约，少踩坑。

---

## 2. System Architecture

### 2.1 对话循环（浏览器内，无后端）

```
用户输入 ─▶ Composer ─▶ DjChatRuntimeActor.sendMessage()
                                   │  (module-scope，每 session 一个)
                                   ▼
        AI SDK v6 ToolLoopAgent.stream({prompt, abortSignal})   ← resolveDjModel(settings) + getAppFetch()
                                   │  在浏览器直连 BYOK provider
                  ┌────────────────┴───────────────────┐
                  │ 文本 delta → streamdown 渲染          │ tool-call → tool({execute}) 在浏览器跑
                  │                                      │   读：search/list（仓库 + track-search 纯函数）
                  │  sendAutomaticallyWhen 自动续 loop ◀──┤   写：needsApproval → 审批后走 DjEngine/repos
                  ▼                                      ▼
        UIMessage[] 流进 React（useSyncExternalStore）   markTrackReady / appendTrackIds …
                  │                                      │
       节流 ~1.2s + finish/切换 flush                    （DB 写入由 player-store liveQuery 自动 pump 物化）
                  ▼
        Dexie `chatSessions.messagesJson` 整段快照（每 session 一行）
```

### 2.2 架构原则（从 ClipCombo 直接继承，全部契合 MUZERO 硬规则）

1. **Runtime outlives view / 一 session 一 runtime actor**：每个 chat session 有一个 **框架无关的 TS 类** `DjChatRuntimeActor`，包住 AI SDK 的命令式 `Chat`/`ChatTransport`/`ToolLoopAgent`，拥有 `sendMessage`/`stop`/审批/节流持久化。**放模块作用域、不进 store**（与 `DjEngine`/`MediaEngine` 同构，硬规则 #6）。切到别的 session / 收起面板，**流不中断**。
2. **Dexie 存持久态，Zustand 存实时态**：完整消息历史 = Dexie 快照；Zustand 只存「当前 session 的轻量 runtime meta（status / 预览 / pending 审批数 / 队列摘要）」+ 渲染挂载视图所需的消息尾。列表用 `useLiveQuery` 读 Dexie，**不把可由 DB 派生的数据塞进 Zustand**。
3. **审批状态跟随 AI SDK，禁止自建并行审批状态机**：写工具 `tool({needsApproval:true})`；审批 UI 是 SDK `ToolUIPart` 状态的 **selector**（`isToolUIPart`/`getToolName`/`part.state`/`addToolApprovalResponse`）。**绝不**出现「一个 approvalId 两套 pending 状态」。
4. **浏览器直连 Provider（无后端）**：自定义 `ChatTransport` 包 `ToolLoopAgent`，`sendMessages()` 里 `agent.stream()` 直接打 provider。HTTP 必须走 [`getAppFetch()`](../../../src/lib/platform.ts)（注入到 `createOpenAI({fetch})`/`createAnthropic({fetch})`，绕 Tauri CORS/mixed-content）——这点比 ClipCombo（用 `window.fetch` + `anthropic-dangerous-direct-browser-access`）更严，是 MUZERO 硬规则 #5。
5. **TrackBrief 仍是唯一契约**：任何「生成音乐」的工具都 emit/校验 `trackBriefSchema`、走 `createDjEngine`/repos，**不在 chat/store/UI 里 `if(provider==="cloud")`** 散落分支。
6. **工具 = 类型化命令，不是 UI 自动化**：模型返回**校验过的命令对象**，走人类同款仓库 mutation（可被现有撤销路径覆盖）；绝不模拟点击。

### 2.3 Technology Stack（新增/复用）

| Component | Technology | Rationale |
|---|---|---|
| 对话循环 | `ai@6` `ToolLoopAgent` + `stepCountIs(N)` + 自定义 `ChatTransport` | v6 高层 agent 跑多步 tool-loop，全在浏览器；MUZERO 已有 `ai@^6.0.197` |
| React 绑定 | `@ai-sdk/react` `Chat` 类 + `useSyncExternalStore` | 命令式 `Chat` 支持多 session（不直接 `useChat`）；已有 `@ai-sdk/react@^3.0.199` |
| 模型解析 | [`resolveDjModel`](../../../src/ai/model.ts) + `getAppFetch` | 复用现有 BYOK 解析（Phase 5 扩成多 provider）|
| 流式 Markdown | **`streamdown@^2.5`（新依赖）** | 为流式 LLM 输出优化、容忍不完整语法；ClipCombo 同款。Tailwind v4 需 `@source` 指令 |
| 校验 | `zod@4` | 工具 input schema、`trackBriefSchema` |
| 持久化 | Dexie 4（`muzero-db` v3 新表） | 与现有本地优先一致 |
| 虚拟化 | `@tanstack/react-virtual`（已有） | 长对话消息列表 |
| 动画 | `motion`（已有） | FAB 展开 / 形态切换（ClipCombo chat 区**没有**动画可抄，需自研）|
| UI 原语（**需补**） | COSS registry：`textarea` / `command`(combobox) / `dialog` / `popover` / `scroll-area` | 当前 `src/components/ui/` 缺这些（见 §6、§7 Phase 1/5）|

### 2.4 Project Structure（新增文件，append 为主）

```
src/
├── chat/                                  # 新：对话 runtime + 工具（无 UI）
│   ├── dj-chat-agent.ts                   # ToolLoopAgent + 自定义 ChatTransport（resolveDjModel + getAppFetch）
│   ├── dj-chat-runtime-actor.ts           # 每 session 的命令式 actor（模块作用域注册表）
│   ├── dj-chat-runtime-registry.ts        # Map<sessionId, actor> + snapshot 订阅 hook
│   ├── dj-chat-tools.ts                   # tool() 定义：search/create/curate/propose/generate（Zod）
│   ├── dj-chat-prompt.ts                  # 助手 system prompt（区别于 DJ_SYSTEM_PROMPT）
│   ├── dj-chat-sessions.ts               # Dexie session CRUD + 节流快照 persist + 标题派生
│   ├── dj-chat-context-budget.ts          # 上下文预算/压缩（Phase 6，纯函数）
│   └── dj-chat-tokens.ts                  # 字符≈token 估算（纯函数）
├── stores/
│   └── chat-store.ts                      # 新：三形态 mode + 当前 session id + 轻量 runtime meta（Zustand）
├── components/chat/                       # 新：UI
│   ├── chat-panel.tsx                     # mode-agnostic panel body（header + turns + composer）
│   ├── chat-launcher-fab.tsx             # FAB 形态
│   ├── chat-input-bar.tsx                 # 底部输入条形态（只一个 composer）
│   ├── chat-dock.tsx                      # Dock 形态（桌面 1∕3 侧栏 / 移动全屏）宿主
│   ├── chat-composer.tsx                 # 输入（textarea + 3 态按钮 + @/ 菜单 + 队列）
│   ├── chat-turns.tsx                     # 消息 turn 列表（streamdown + 工具折叠）
│   ├── chat-tool-collapsible.tsx          # ToolUIPart 渲染（审批/结果/错误）
│   ├── chat-session-home.tsx              # 历史 session 列表 + 搜索 + 空态 chips
│   ├── chat-queue-tray.tsx                # 队列 prompt 托盘（Phase 6）
│   └── chat-model-picker.tsx              # per-session 模型 combobox（Phase 5）
├── hooks/use-chat-messages.ts             # useLiveQuery(chatSessions)
├── ai/llm-providers.ts                    # 新（Phase 5）：多 provider preset 注册表（仿 musicgen presets）
└── i18n/locales/*/common.json             # 新 `chat` 命名空间（en 先行）
```

> **CLAUDE.md 漂移提醒**（agent 调查发现）：导航现已是 [`player-dock.tsx`](../../../src/components/shell/player-dock.tsx) → [`nav-row.tsx`](../../../src/components/nav/nav-row.tsx)（不是文档里的 Magic UI Dock）；音频是 [`MediaEngine`](../../../src/player/media-engine.ts)（不是 `AudioEngine`）。实现以真实文件为准。

---

## 3. Data Model

### 3.1 新增 Dexie 表（`muzero-db` v2 → v3，[`muzero-db.ts`](../../../src/db/muzero-db.ts)）

```ts
// version(3).stores({...})  —— 新表无需 .upgrade() 回填（旧行不动；只有改既有表才写 upgrade）
chatSessions: "id, updatedAt"
// （消息不单开表：整段对话以 JSON 快照存在 chatSessions.messagesJson，与 ClipCombo 一致——
//   列表查询轻量、写入是一行 put，避免每 step 一行的高频写）
```

> 决策：**整 session JSON 快照**而非「每消息一行」。ClipCombo 实测此法在流式中 ~1.2s 节流写一次、finish/切换时同步 flush，配合 `useLiveQuery` 反应式读，**简单且够用**；MUZERO 体量更小，直接照搬。超长对话的 RAM 窗口化（archived prefix / Dexie-only head）是后续优化，v1 不做。

### 3.2 类型（[`src/db/types.ts`](../../../src/db/types.ts) 追加）

```ts
/** 一个对话 session（整段历史以 messagesJson 快照存）。 */
export interface ChatSession {
  id: string;                     // newId("cht")  —— 新前缀 cht_（codename 稳定，硬规则 #4）
  title: string;                  // 由首条用户消息派生（≤48 字），未命名时占位
  createdAt: number;
  updatedAt: number;              // 列表排序键（desc）
  messagesJson: string;           // JSON.stringify(DjChatUIMessage[]) —— 整段对话
  composerDraftRaw?: string;      // 未发送的输入，重载后恢复
  // per-session 模型选择（Phase 5；不存 key）
  llmProviderPresetId?: string;
  llmModel?: string;
  // branch 溯源（Phase 4）
  parentSessionId?: string;       // 从哪个 session fork
  forkedFromIndex?: number;       // 在父对话第几条消息处 fork
  // 队列（Phase 6）
  queuedPromptsJson?: string;     // JSON.stringify(DjChatQueuedPrompt[])
  contextStartIndex?: number;     // 压缩指针（Phase 6）：此前消息仍可见但不进 context 估算
}

/** 活跃 session id 单例（MUZERO 无 project 概念 → 单例，不像 ClipCombo 按 projectId 分）。 */
// 复用 AppSettings.lastChatSessionId?（追加可选字段）或一个 chatPrefs 单例行；二选一，见 Open Q1。
```

**消息形状**：直接用 AI SDK 的 `UIMessage`，扩 metadata（不自建 message 表/类型）——

```ts
export type DjChatUIMessage = UIMessage<DjChatMessageMetadata>;
export interface DjChatMessageMetadata {
  composerRaw?: string;           // 含 @/ chip token 的原始输入（display 用；模型看的是 parts.text 展开版）
  interruptionMarker?: boolean;   // "被新指令打断" 标记（Phase 6）
  turnTelemetry?: { inputTokens?: number; outputTokens?: number; costUsd?: number; wallMs?: number }; // 仅本地，不上报
}
```

**实时 runtime meta（仅 Zustand，不持久化，重载后由 messages 重建）**：

```ts
export type DjChatRuntimeStatus = "idle" | "submitted" | "streaming" | "awaiting-approval" | "error" | "stopped";
export interface DjChatRuntimeMeta {
  sessionId: string;
  status: DjChatRuntimeStatus;
  messageCount: number;
  lastAssistantPreview?: string;
  pendingApprovalCount: number;   // = selector over tool parts，不是独立状态
  errorMessage?: string;
}
```

### 3.3 三形态状态（[`src/stores/chat-store.ts`](../../../src/stores/chat-store.ts)，persisted 到 localStorage `muzero-chat-ui`）

```ts
export type ChatMode = "fab" | "bar" | "dock" | "fullscreen";
interface ChatUiState {
  mode: ChatMode;                 // 默认 "bar"（用户说 80% 时间只要一个输入框）
  dockSide: "left" | "right";     // 桌面 Dock 靠哪侧，默认 right
  activeSessionId: string | null; // 当前打开的对话；null = session home
}
```

> 这是**纯 UI 偏好**，放 localStorage 合规（不是行为门控 flag，硬规则 #3 针对的是隐藏后端开关；可见的形态切换控件 + 偏好持久化是 OK 的）。

### 3.4 Migration

- `muzero-db` **bump 到 v3**，只 `version(3).stores({ chatSessions: "id, updatedAt" })`，**不写 `.upgrade()`**（新表，旧行不动；硬规则 #7：改既有表才需 upgrade）。
- `AppSettings` 若追加 `lastChatSessionId?` / Phase 5 的 provider 字段 = settings 行内可选字段，无需 bump（沿用 musicgen preset 的做法）。
- Rollback = `git revert` 注册表/组件（硬规则 #3）；删除的 tool id 走 `unsupported[]` 通道，老对话仍能加载。

---

## 4. Chat Runtime & Tool 设计

### 4.1 Runtime Actor + Transport（Phase 1 核心）

- **`DjChatRuntimeActor`**（[`dj-chat-runtime-actor.ts`](../../../src/chat/dj-chat-runtime-actor.ts)）：构造 `new Chat<DjChatUIMessage>({ id: sessionId, messages, transport, sendAutomaticallyWhen })`。`sendAutomaticallyWhen = ({messages}) => lastAssistantMessageIsCompleteWithApprovalResponses({messages}) || lastAssistantMessageIsCompleteWithToolCalls({messages})` —— 这是**客户端自动续 tool-loop**的关键。actor 暴露 `sendMessage/stop/addToolApprovalResponse/dispose`，并向 Zustand 推紧凑 `DjChatRuntimeMeta` 快照。
- **注册表**（[`dj-chat-runtime-registry.ts`](../../../src/chat/dj-chat-runtime-registry.ts)）：`Map<sessionId, actor>`，模块作用域。`useDjChatRuntimeSnapshot(sessionId)` 用 `useSyncExternalStore` 订阅，**只有挂载的视图重渲染**。
- **Transport**（[`dj-chat-agent.ts`](../../../src/chat/dj-chat-agent.ts)）：自定义 `ChatTransport`，`sendMessages()` → `validateUIMessages` + `convertToModelMessages` → `agent.stream({prompt, abortSignal})` → `result.toUIMessageStream({messageMetadata})`（从 `finish`/`finish-step` 取 usage 填 `turnTelemetry`）。agent 每次 send **懒解析**（`getAgent()`），settings 变了重建 agent、transport 不变。
- **Agent**：`new ToolLoopAgent({ model: await resolveDjModel(settings), tools, stopWhen: stepCountIs(12), instructions: DJ_CHAT_SYSTEM_PROMPT, temperature, maxOutputTokens })`。

### 4.2 工具契约（two-tier 命名，仿 ClipCombo）

| Chat-facing（snake_case，domain 前缀） | Runtime canonical（dotted，product root） | 读/写 | 落点 |
|---|---|---|---|
| `library_search_tracks` | `muzero.library.search_tracks` | 读 | [`track-search.ts`](../../../src/lib/track-search.ts) `searchTracks/matchesQuery` over `listAllTracks` |
| `library_list_tags` | `muzero.library.list_tags` | 读 | `getAllTags` |
| `session_list` / `session_get` | `muzero.session.list` / `.get` | 读 | `listSessions` / `getSession` |
| `session_create` | `muzero.session.create` | **写** | `createSession`（带 seed/config） |
| `set_curate` | `muzero.set.curate` | **写** | `appendTrackIds` / `removeTrackFromSession`（加/删/重排） |
| `track_annotate` | `muzero.track.annotate` | **写** | `setTrackTags/Note/Cover` |
| `dj_propose_briefs` | `muzero.dj.propose_briefs` | 读（产出待确认）| 返回 `TrackBrief[]` + `describeBrief` chips，等用户确认 |
| `dj_generate_tracks` | `muzero.dj.generate_tracks` | **写** | 校验 `trackBriefSchema` → `createPendingTrack` + `appendTrackIds`（物化由 store `pump` 自动）|
| `suggest_next_prompts` | （UI-only） | 读 | 非 mutating、无审批、返回 `{accepted,count}`（空态/续问建议）|

**约定（硬性，抄 ClipCombo）**：
- **domain-first 命名**；每个 description 写清名词边界（"搜索曲库 track，不含 session 元数据"），加测试在用错 domain 名词时失败。
- **读不审批、写 `needsApproval:true`**；所有写走现有仓库 mutation（人类同款路径）。
- **写工具统一返回 `AgentWriteResult`**：`{ status: "applied"|"preview"; commandId; summary; diff; warnings: string[] }`（审批后 `applied`，仅 `dryRun` 时 `preview`）。
- **Zod 校验 + 越界 clamp 到合法区间**（`durationSec∈[10,240]`、`bpm∈[40,220]`），**越界报错而非静默截断**；DJ engine 已对 brief 做 `safeParse` 丢非法项，工具层同样不信任模型。
- **能力 gate（与 [musicgen PRD §4.5](../20260607-muzero-cloud-musicgen-provider-selection-prd/20260607-muzero-cloud-musicgen-provider-selection-prd.md) 联动）**：`dj_generate_tracks` 是否能出器乐/续写等，取决于当前 music provider preset 的能力位；不支持的优雅降级（提示切 provider）。**不在 tool 里 `if(vendor===)`**。
- **单一 fetch 核心**：工具内任何 HTTP 走 `getAppFetch()`，license/成本 gate 只活在一个函数里。

### 4.3 HITL 审批

- `ask`（默认）/ `auto` 是**人类设置**（composer 工具栏 `ShieldQuestion`/`ShieldCheck`，存 chat 偏好）。模型永远不选审批模式。
- `ask`：SDK 弹 `approval-requested` → 用户 Accept → 执行器以「审批已授予」提交（idempotent，一个 approvalId 只批一次）。Reject = 负向审批响应，对话继续、零写入。
- pending 审批**暂停队列派发**（审批权威）。

### 4.4 流式渲染

- 助手 `TextUIPart` → `<Streamdown>{part.text}</Streamdown>`（streaming 与 done 同一路径；Tailwind v4 加 `@source "../../node_modules/streamdown/dist/**/*.js"`）。安全交给 streamdown/rehype-harden，不执行用户脚本。
- `ToolUIPart` → `chat-tool-collapsible.tsx`：`approval-requested` 琥珀确认卡 / `output-available` 折叠 summary（DEV 才展 I/O JSON）/ `output-error` destructive 卡。
- **canonical-for-model vs canonical-for-UI**：`parts.text` 存模型看的展开 prompt；`metadata.composerRaw` 存带 chip 的原文（display）。用户气泡提供「查看发给模型的完整文本」入口；**UI 永不为了好看削弱模型上下文**。
- 上下文占用 ring（估算，标注「估算」，75%/90% 变色）；turn footer 主行 = 成本 + in/out tokens（TPS/wall 仅 tooltip）；**成本未知显示「—」，严禁假数**。

---

## 5. Frontend / 三种显示形态

同一个 **mode-agnostic panel body**（`chat-panel.tsx`，`flex min-h-0 flex-col`：header + `chat-turns` + `chat-composer`），由 `chat-store.mode` 决定宿主与布局（ClipCombo 已证明 body 可被任意重挂载）。

### 5.1 形态 1：FAB（minimize）

- 右下角浮动圆形按钮（`Sparkles`/`Bot` 图标），未读/streaming 时角标。点击 → 切到上次的展开形态（`bar` 或 `dock`）。
- 用 `motion` 做展开动画（ClipCombo 没有可抄，自研：scale+fade from FAB origin）。

### 5.2 形态 2：底部输入条（bar，**默认**）

- 屏幕底部（player-dock 之上）只渲染 **`chat-composer`** 单行输入 + 3 态按钮，不显示历史。回车即把需求发给 DJ；有回复时**就地冒一个轻量 toast/一行流式预览**或自动升到 `dock`（见 Open Q2）。
- 这是「大多数时候只想跟 DJ 说一句」的主路径。composer 是独立组件，可单独挂载。

### 5.3 形态 3：Dock（桌面 1∕3 侧栏 / 移动全屏）

- **桌面（`lg+`）**：靠 `dockSide`（默认右）固定一个 `w-[33%]`（或 `min(33%, 460px)`）的列，完整 panel body。可选 drag-resize（`react-resizable-panels`，v1 可不做，给固定 1∕3）。player-dock / main 内容相应让位（flex sibling，不是遮挡 overlay；移动端才 overlay）。
- **移动（`<md`）**：展开到全屏 / 画面剩余空间（`inset-0` 或占满 main），关闭回 FAB。
- 断点：MUZERO 既定 `md` 为内容桌面/移动分界；用一个 `matchMedia` hook 统一（参考 ClipCombo 的 `useMobileWorkbenchLayout`，但简化为单断点）。

### 5.4 Composer（`chat-composer.tsx`）

- v1 用**新 `textarea` 原语**（auto-grow 上限 ~6 行）；@mention（track/session 引用）与 `/` 命令做成**后续增强**（ClipCombo 用 contentEditable+chips，较重，先不抄）。
- **3 态主按钮**（抄队列 PRD）：idle+有草稿 `ArrowUp` 发送 / running+空 `CircleStop` 停 / running+有草稿 `ListEnd` 入队。
- **键盘契约**：`Enter` 发送（idle）或入队（running）；`Ctrl/Cmd+Enter` 打断并发；`Shift+Enter` 换行。
- **空态 onboarding**：无 session + 输入空时，composer 上方一排**本地化预设 chips**（"做一个深夜 focus set" / "从我 #gym 上传里挑" / "续上更 chill 的"）；点击**只插入不自动发**；有文字/进 session/无 key 时隐藏。

### 5.5 消息列表（`chat-turns.tsx`）

- `UIMessage[]` → turns（一条 user + 其后 assistants），`@tanstack/react-virtual` 虚拟化（`measureElement` + ResizeObserver 保证流式 reflow 行高正确，`top` 定位不用 translate 以免破坏 sticky）。
- 每 turn：user 气泡 sticky 顶部；assistant parts 按 type 渲染（text→streamdown、tool→collapsible）；per-turn **edit-and-resend**（= regenerate，复用 `messageId` 让 SDK 截断重流）；成本/token footer。

### 5.6 历史 Session（`chat-session-home.tsx`）

- `useLiveQuery` 读 `chatSessions` 按 `updatedAt` desc。每行：status 点、标题（行内重命名）、相对时间、模型 hint、确认删除。
- **搜索**：大小写不敏感**子串**匹配，搜**标题 + 用户消息文本**（解析 `messagesJson` 取 user turn 文本，assistant 不搜；匹配行作 snippet）。小体量够用；大库再加预算搜索字段。
- **自动标题**：首条用户消息截 48 字。
- **新建 / 切换**：切换时 flush 当前 session 草稿+快照、设 active id、载目标行。

### 5.7 Branch / Regenerate（Phase 4）

- **Regenerate** = per-turn 编辑用户消息后 resend，复用同 `messageId` → SDK 截断其后全部并重流（**原地覆盖**，不分叉）。
- **Branch（净新，ClipCombo 没有）** = 在某条消息处「fork 出新 session」：深拷贝 `messagesJson` 截断到 fork index，写新 `ChatSession`（`parentSessionId`/`forkedFromIndex`），切过去。快照模型下实现极轻。

### 5.8 队列/打断托盘（Phase 6）

- 队列只存 `composerRaw` + 紧凑 contextSnapshot；**派发时**才重建展开 prompt（不存展开/密钥/媒体）。
- 重载/actor 重建后 `autoDispatchEnabled=false`（reason `reload`），托盘里可见 Switch + 每项「立即发送」。**Stop ≠ Interrupt**：Stop 中止当前 turn 并暂停自动派发；Interrupt 中止并插队即发 + 一次性「被新指令打断」标记。DnD 重排（抄 export-drawer 模式）。session 作用域，不跨 session 泄漏。

---

## 6. 多 Provider 模型选型（Phase 5）

> 用户明确要：「Setting modal 里接入大量不同 API provider + combobox 直接选 model」。MUZERO 现状只有 `LlmProviderId="openai"|"anthropic"` + 自由输入 model（[`model.ts`](../../../src/ai/model.ts)）。要扩成 **preset 化多 provider**（仿我刚做的 musicgen presets，也仿 ClipCombo `CLIP_LLM_PROVIDER_PRESETS`）。

- **`src/ai/llm-providers.ts`（新）**：`LlmProviderPreset[]`，每个 `{ id, label, provider:"openai-compatible"|"anthropic", baseUrl, apiKeyUrl, models: {id,label,contextLimit?,inputCost?,outputCost?}[] }`。内置：**openrouter / openai / claude / gemini / groq / deepseek / custom**（非 Anthropic 全走 OpenAI-compatible adapter + per-provider `baseURL`，Anthropic 单独 `createAnthropic`+浏览器直连 header）。外加用户自定义 `custom:*` OpenAI-compatible endpoint（存 Dexie）。
- **`resolveDjModel` 扩展**：按 preset 解析到 AI SDK model 实例，仍注入 `getAppFetch()`。
- **Key 存储**：**进 IndexedDB `settings` 行**（`apiKeysByPresetId`，硬规则 #2），不像 ClipCombo 放 localStorage。per-provider 记 key + model，切 provider 恢复上次选择。
- **Settings UI**：provider 列表（启用/排序/各自 key）+ **per-session 模型 combobox**（需补 `command`/`combobox` 原语）。provider「有 key 且启用」才进 session 模型选择器。
- **per-session 选择**：`ChatSession.llmProviderPresetId` + `llmModel`（**不存 key**，防陈旧密钥进历史）。
- **上下文限制检测**：多级回退（model 元数据 → 静态已知表 → 保守默认 128k，标「估算」），短 TTL 缓存，与 Settings 模型拉取共享。

---

## 7. Implementation Plan

> **基础设施先于广度**（prd-create.md）：Phase 1（runtime）→ Phase 2（外壳）→ Phase 3（工具）→ Phase 4（多 session）→ Phase 5（多 provider）→ Phase 6（队列/onboarding/压缩）。每 phase 原子 commit + 更新本 PRD 状态。

### Phase 1: Chat runtime 地基
**Tasks:**
- [ ] `muzero-db` v3 加 `chatSessions` 表；`ChatSession`/`DjChatUIMessage`/`DjChatMessageMetadata` 类型；`dj-chat-sessions.ts`（CRUD + 节流快照 persist ~1.2s + finish/切换 flush + 标题派生）。
- [ ] `dj-chat-agent.ts`（ToolLoopAgent + 自定义 ChatTransport，`resolveDjModel`+`getAppFetch`）、`dj-chat-runtime-actor.ts`、`dj-chat-runtime-registry.ts`、`chat-store.ts`（mode/activeSessionId/runtime meta）。
- [ ] 补 `textarea` UI 原语；`chat-panel.tsx`（最小：turns + composer）；`chat-turns.tsx` + `streamdown`（加依赖 + Tailwind `@source`）。
- [ ] 单 session 端到端：发消息→流式→持久化→重载恢复。

**Phase 1 Checklist:**
- [ ] 注入 fake model/transport 的集成测：send→stream→`messagesJson` 落库→重建 actor 后历史恢复（`fake-indexeddb`，硬规则 #7）。
- [ ] runtime/AbortController/actor 全在模块作用域，不进 Zustand state（硬规则 #6）；列表走 `useLiveQuery`。
- [ ] provider HTTP 走 `getAppFetch()`；key 不进日志/历史。
- [ ] `make check` 绿；新字符串先进 en catalog。

### Phase 2: 三形态显示外壳
**Tasks:**
- [ ] `chat-store` 的 `mode`/`dockSide` + persist；`matchMedia` 断点 hook。
- [ ] `chat-launcher-fab.tsx`（FAB + motion 展开）、`chat-input-bar.tsx`（底部 composer-only）、`chat-dock.tsx`（桌面 1∕3 flex sibling / 移动全屏 overlay）。
- [ ] 挂进 [`App.tsx`](../../../src/App.tsx) 外壳（与 `GlobalDropZone` 同级 overlay + Dock 让位 main）；NavRow/player-dock 不重排成 sidebar（硬规则 #9）。

**Phase 2 Checklist:**
- [ ] 三形态切换正确、偏好持久化；桌面 Dock 占 1∕3、移动全屏；reduced-motion 尊重。
- [ ] 浏览器 preview 实测三形态 + 暗色 + 响应式，零 console 报错。

### Phase 3: DJ 工具调用
**Tasks:**
- [ ] `dj-chat-tools.ts`（§4.2 工具集，Zod schema，读/写 + `needsApproval`，`AgentWriteResult`）；`dj-chat-prompt.ts`。
- [ ] `chat-tool-collapsible.tsx`（审批/结果/错误）；HITL `ask`/`auto` 偏好。
- [ ] 工具落 `DjEngine`/repos；`dj_generate_tracks` 走 `createPendingTrack`+`appendTrackIds`（物化由 store pump 自动）；能力 gate 接 musicgen preset。

**Phase 3 Checklist:**
- [ ] 集成测：「做个 lofi set」→ propose→审批→generate→pending 落库→pump 物化→可播（canned model + mock music provider）。
- [ ] 写工具拒绝时零写入；读工具无审批；用错 domain 名词的描述测试失败。

### Phase 4: 多 Session + 历史 + branch/regenerate
**Tasks:**
- [ ] `chat-session-home.tsx`（列表 + 子串搜索 + 自动标题 + 重命名/删除）；多 actor 并发（切走仍流）。
- [ ] regenerate（edit-resend 复用 messageId）；branch（截断深拷贝 messagesJson → 新 session）。

**Phase 4 Checklist:**
- [ ] 集成测：两 session 不同 model 同时跑、一个审批一个错误互不串；切 home 不清流式 session 的 live 消息。
- [ ] 搜索命中标题与用户消息；branch 后父子独立。

### Phase 5: 多 Provider 模型选型
**Tasks:**
- [ ] `ai/llm-providers.ts` preset 注册表；`resolveDjModel` 扩多 provider（仍 `getAppFetch`）；key 入 `settings` 行 `apiKeysByPresetId`。
- [ ] 补 `command`/`combobox`（+ `dialog`/`popover`）原语；Settings 多 provider 配置 + per-session 模型 combobox；上下文限制检测。
- [ ] `ChatSession.llmProviderPresetId`/`llmModel`（不存 key）。

**Phase 5 Checklist:**
- [ ] 切 provider/model 即时生效（重建 agent、transport 不变）；无 key 的 provider 不进选择器；key 不进历史/日志/bundle。
- [ ] i18n 4 语全覆盖（provider/model label、combobox 文案）。

### Phase 6: 队列/打断 + onboarding + 压缩
**Tasks:**
- [ ] `chat-queue-tray.tsx`（DnD 重排、立即发送、auto-dispatch Switch、reload 后默认关）；Stop≠Interrupt + 打断标记。
- [ ] 空态：预设 chips（插入不发）+ 空库/无 seed 引导（指向上传/输入 vibe）。
- [ ] `dj-chat-context-budget.ts` + `dj-chat-tokens.ts`：预算 gate + 滑动 `contextStartIndex` 压缩（block-and-explain，不静默截断）。

**Phase 6 Checklist:**
- [ ] 键盘矩阵测试（Enter/Ctrl+Enter/Shift+Enter）；pending 审批暂停派发；重载恢复队列但不自动发。
- [ ] 超预算时阻塞并解释；压缩指针持久化、旧消息仍可见。

---

## 8. Out of Scope

- **不引入 MUZERO 后端 / 账号 / 遥测**（硬规则 #1）。无服务器 session 同步、无云端队列、不把 runtime 放 Web/Service Worker。
- **不抄 ClipCombo 的 subtitle/composition 专属能力**（字幕附件预算、composition layer 工具）——MUZERO 无对应 domain。
- **contentEditable chips composer**（@mention/slash 富输入）= 后续增强；v1 用 textarea。
- **超长对话 RAM 窗口化**（archived prefix / Dexie-only head 分页）= 后续优化。
- **drag-resize 的 Dock**（v1 固定 1∕3）、**语音输入**、**附件/多模态图片**（ClipCombo 有，MUZERO 暂不需要）。
- **桌面端外部链接走系统浏览器**沿用 musicgen PRD 的 Open Question（Tauri opener 插件）。

## 9. Security / Privacy

- **BYOK key 纪律（硬规则 #2）**：LLM key 只存 IndexedDB `settings` 行，请求时解析、直连 provider；**绝不**进 `messagesJson`/bundle/URL/日志/（不存在的）遥测。per-session 只存 providerPresetId/model，不存 key。
- **无遥测**：MUZERO 不上报任何东西（区别于 ClipCombo 的 PostHog 白名单）。但沿用其**「绝不打印」清单**到 [`logger.ts`](../../../src/lib/logger.ts)：永不 log prompt/lyrics/caption 文本、对话内容、provider key、provider 响应体、工具 I/O 原文、音频 bytes、上传文件名。日志只留 status 枚举、计数 bucket、provider/preset id。
- **审批权威**：破坏性写必须 `needsApproval`；写经现有仓库 mutation（可撤销）；一个 approvalId 只批一次。
- **流式安全**：streamdown + rehype-harden，不执行用户脚本；外链/代码块受控。

## 10. Related Documents

| Document | Description |
|----------|-------------|
| [musicgen provider PRD](../20260607-muzero-cloud-musicgen-provider-selection-prd/20260607-muzero-cloud-musicgen-provider-selection-prd.md) | §4.5 已定 agent tool 的能力 gate / provider-agnostic 意图，本 PRD 承接 |
| ClipCombo `agent-multi-session-panel-prd` | Runtime Actor、Dexie 持久态/Zustand 实时态、并发 session |
| ClipCombo `subtitle-chat-panel-vercel-ai-prd` | 浏览器直连 provider、HITL、自定义 ChatTransport |
| ClipCombo `subtitle-chat-panel-streamdown-telemetry-prd` | streamdown 渲染、canonical-for-model/UI、（其）遥测白名单 |
| ClipCombo `agent-queued-interrupt-prompts-prd` | 3 态按钮、Stop≠Interrupt、队列托盘 |
| ClipCombo `agent-onboarding-empty-context-prd` | 冷启动 chips、空态引导、`suggest_next_prompts` 走 tool 而非强制 JSON |
| ClipCombo `agent-source-composition-tool-contract-prd` | two-tier 工具命名、`AgentWriteResult`、discriminated-union input |
| MUZERO 集成点 | [`ai/model.ts`](../../../src/ai/model.ts) · [`dj/`](../../../src/dj/) · [`stores/player-store.ts`](../../../src/stores/player-store.ts) · [`db/`](../../../src/db/) · [`pages/settings-page.tsx`](../../../src/pages/settings-page.tsx) · [`i18n/`](../../../src/i18n/) · [`App.tsx`](../../../src/App.tsx) |

## 11. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 活跃 session id 存哪？ | Open | 倾向 `AppSettings.lastChatSessionId?`（复用 settings 单例，免新表）vs 单独 `chatPrefs` 行 |
| 2 | `bar` 形态收到回复怎么显示？ | Open | 候选：就地一行流式预览 + 「展开」/ 自动升 `dock` / 轻 toast。Phase 2 实测体验再定 |
| 3 | per-session 模型 vs 全局模型默认？ | Open | 抄 ClipCombo：全局默认 + per-session 覆盖；Phase 5 落地 |
| 4 | `dj_generate_tracks` 与现有自动续歌（`maybeRefill`）的关系？ | Open | 工具是「显式生成」，autoExtend 是「自动续」；二者都写同一队列、由 store pump 统一物化，避免双循环打架。Phase 3 明确 |
| 5 | streamdown bundle 体积？ | Open | Phase 1 测 `pnpm build` 增量（目标 <100KB gz）；超则 dynamic import |
| 6 | 是否需要 contentEditable chips（@/）v1？ | Resolved | 否，v1 textarea，chips 列后续增强 |

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft —— 调研 ClipCombo agent 面板（5 路并行 deep-read：UI/形态、session/持久化、AI SDK/streaming/模型、PRD 簇蒸馏、MUZERO 集成点），落成 6-phase 复刻 PRD：多 session + 可搜历史 + 每步本地持久化 + branch/regenerate + 多 provider combobox + streamdown 流式，外加 MUZERO 三形态（FAB / 底部输入条 / Dock 1∕3→移动全屏）|

---

> **Note（版本锚）**：实现以 `ai@6` 当前文档为唯一真相源。若 `ToolLoopAgent` / `addToolApprovalResponse` / `sendAutomaticallyWhen` 等 API 名变更，更新本句所在锚点。ClipCombo 对应实现（`packages/clipcombo/src/lib/clip-chat-agent.ts`、`clip-subtitle-chat-runtime-registry.ts`、`components/editor/subtitle-chat/`）是可逐文件对照的成熟参考。
