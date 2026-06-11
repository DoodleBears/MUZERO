# PRD: MUZERO — AI DJ Chat Agent Panel（多 Session 对话 · 三形态 · 流式 · 工具调用）

**Status:** In Progress（Phase 1 ✅；Phase 2–6 的运行时 / 组件 / 测试**全部已建并绿**[`src/chat/*` runtime actor·tools·sessions·tokens·budget；`src/components/chat/*` FAB·bar·dock·session-home·model-picker·queue-tray·empty·notice；Dexie v5 chatSessions]，但统一阻塞于两件事：① `App.tsx` 挂载属并行 Now Playing redesign WIP → 待其落地做 CHAT-2b；② chat 命名空间 i18n 4 语 + Settings key 管理接线。即「逻辑齐备、外壳未挂」——审计 2026-06-11）
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
| 1 | Chat runtime 地基（Dexie v5 + Runtime Actor + 单 session 流式 + streamdown） | ✅ Completed | §7 |
| 2 | **Dock 集成对话入口**（minimize 图标 / normal 圆角 chip 输入条 / expand framer-motion widget；gated on LLM+musicgen 已配置） | ✅ Completed（2026-06-11 重设计后落地：`canUseDjChat` 门控 + 三态 `dj-chat-entry` 挂 dock 工具行 + i18n ×4；preview 实测零报错，动效手感待真实窗口） | §7 |
| 3 | DJ 工具调用（search/create/curate/propose/generate + HITL 审批） | ✅ Completed（6 工具+审批桥+折叠 UI+ask/auto 偏好切换+labels i18n ×4 全接线；余 store-pump E2E 一项见 checklist） | §7 |
| 4 | 多 Session + 历史列表（搜索）+ branch/regenerate | ✅ Completed（search/branch/regenerate + session-home 挂进 expanded widget：History 切换 + 新建即开 + 重命名/删除；切换零 dispose） | §7 |
| 5 | 多 Provider 模型选型（preset + **自定义 provider，复刻 ClipCombo** + combobox + Settings + key 入 Dexie） | 🔄 7 preset+model picker+dialog/popover/command/scroll-area 原语 ✅；**动态 custom-provider（Dexie）+ Settings provider 面板 + enabled grid + i18n 待** | §7 |
| 6 | 队列/打断 prompt + 空态 onboarding + 上下文压缩 | 🔄 token/budget/queue-tray/empty/notice ✅；App 挂载 + i18n 待 | §7 |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

> 🔄 **2026-06-11 — Phase 2 外壳重新设计（owner 定）**：放弃旧「FAB / 底部输入条 / Dock 1∕3 侧栏 / 全屏」四形态，改为**集成进 player-dock 上方工具行**的单一对话入口（详见 §5 重写）：
> - **位置**：dock 卡片**上方的浮动工具行**，置于「切 tab 的 `NavFab` + 记忆 `DockMemoryToggle`」**左侧**，吃掉剩余空间。
> - **三态**：**minimize**（只一个 icon）→ **normal**（full-rounded 圆角 chip 文字输入框，默认）→ **expand**（framer-motion `layoutId` 过渡成对话 widget）。
> - **门控（硬性）**：**未配置 LLM API 且未配置 musicgen API 时，入口不可用、且 icon 根本不渲染**（单一纯函数 `canUseDjChat(settings)` 裁决，见 §5.1）。
> - **Provider 复刻 ClipCombo**：§6 扩成「内置 preset + 用户动态自定义 provider（OpenAI-compatible baseURL，存 Dexie）+ 每 provider key + enabled grid + model 选择器」，逐项对照 ClipCombo `clip-llm-providers.ts` / `EditorSettingsPopover` / `clip-chat-model.ts`。
>
> 旧 `chat-launcher-fab` / `chat-input-bar` / `chat-dock` / `use-chat-breakpoint` 壳**作废重做**；**runtime（`src/chat/*`）+ 展示层（composer / turns / session-home / model-picker / queue-tray / empty / notification）+ 工具/会话/provider 后端全部保留**，只换宿主与状态机。

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
│   ├── dj-chat-tokens.ts                  # 字符≈token 估算（纯函数）
│   └── dj-chat-availability.ts            # 【新】canUseDjChat / hasUsableLlm / hasUsableMusicgen 门控（纯函数 + TDD）
├── stores/
│   └── chat-store.ts                      # 新：三形态 mode + 当前 session id + 轻量 runtime meta（Zustand）
├── components/chat/                       # 新：UI
│   ├── chat-panel.tsx                     # mode-agnostic panel body（header + turns + composer）
│   ├── dj-chat-entry.tsx                  # 【2026-06-11 重设计】Dock 工具行集成入口：icon/chip/expanded 三态 + framer-motion layoutId morph（取代 fab/bar/dock 三壳）
│   ├── chat-reply-notification.tsx        # 折叠态（icon/chip）回复 = 顶部 Notification toast（motion，仿 anysoul MessageToast）
│   ├── chat-composer.tsx                 # 输入（textarea + 3 态按钮 + @/ 菜单 + 队列）
│   ├── chat-turns.tsx                     # 消息 turn 列表（streamdown + 工具折叠）
│   ├── chat-tool-collapsible.tsx          # ToolUIPart 渲染（审批/结果/错误）
│   ├── chat-session-home.tsx              # 历史 session 列表 + 搜索 + 空态 chips
│   ├── chat-queue-tray.tsx                # 队列 prompt 托盘（Phase 6）
│   └── chat-model-picker.tsx              # per-session 模型 combobox（Phase 5）
├── hooks/use-chat-messages.ts             # useLiveQuery(chatSessions)
├── ai/llm-providers.ts                    # 新（Phase 5）：多 provider preset 注册表（仿 musicgen presets）
├── ai/custom-llm-providers.ts             # 新（Phase 5，§6.1）：动态自定义 provider repo（Dexie llmCustomProviders + normalize，复刻 ClipCombo）
├── components/settings/llm-provider-settings.tsx  # 新（Phase 5）：provider 面板（enabled grid + api-key-field + 自定义编辑）
├── components/settings/api-key-field.tsx  # 新（Phase 5）：per-provider key 输入（遮罩 / reveal / apiKeyUrl）
└── i18n/locales/*/common.json             # 新 `chat` 命名空间（en 先行）
```

> **CLAUDE.md 漂移提醒**（agent 调查发现）：导航现已是 [`player-dock.tsx`](../../../src/components/shell/player-dock.tsx) → [`nav-row.tsx`](../../../src/components/nav/nav-row.tsx)（不是文档里的 Magic UI Dock）；音频是 [`MediaEngine`](../../../src/player/media-engine.ts)（不是 `AudioEngine`）。实现以真实文件为准。

---

## 3. Data Model

### 3.1 新增 Dexie 表（`muzero-db` v4 → v5，[`muzero-db.ts`](../../../src/db/muzero-db.ts)）

```ts
// version(5).stores({...})  —— 新表无需 .upgrade() 回填（旧行不动；只有改既有表才写 upgrade）
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
  // per-session 模型选择（Phase 5；决议 Q3：全局默认 + 本 session 覆盖；**不存 key**）
  llmProviderPresetId?: string;   // 缺省 = 继承全局默认；combobox 覆盖后写这里
  llmModel?: string;
  // branch 溯源（Phase 4）
  parentSessionId?: string;       // 从哪个 session fork
  forkedFromIndex?: number;       // 在父对话第几条消息处 fork
  // 队列（Phase 6）
  queuedPromptsJson?: string;     // JSON.stringify(DjChatQueuedPrompt[])
  contextStartIndex?: number;     // 压缩指针（Phase 6）：此前消息仍可见但不进 context 估算
}

/** 活跃 session id（resume 指针）→ AppSettings.lastChatSessionId?（决议 Open Q1）。
 *  MUZERO 无 project 概念，不像 ClipCombo 需要 per-project 的 chatPrefs 行；复用单例
 *  AppSettings（与既有播放恢复点 lastSessionId/lastTrackIndex 同级），不为一个字段开新表。
 *  纯 UI 的 mode 留在 chat-store 的 localStorage（instant boot，无需 Dexie）。 */
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

### 3.3 显示态状态（[`src/stores/chat-store.ts`](../../../src/stores/chat-store.ts)，persisted 到 localStorage `muzero-chat-ui`）

```ts
export type ChatMode = "icon" | "chip" | "expanded"; // minimize / normal / expand
interface ChatUiState {
  mode: ChatMode;                 // 默认 "chip"（80% 时间只想要一个输入框）；"icon"=minimize、"expanded"=widget
  activeSessionId: string | null; // 当前打开的对话；null = session home
}
```

> **可见性是派生、不入 store**：入口是否渲染由 `canUseDjChat(settings)`（§5.1）裁决——**未配置 LLM + musicgen 时无论 `mode` 为何都不渲染**（连 icon 都不出）。`mode` 只在「可用」时决定 icon/chip/expanded 形态。
> 这是**纯 UI 偏好**，放 localStorage 合规（不是行为门控 flag——硬规则 #3 针对隐藏后端开关；可见的形态切换 + 偏好持久化 OK，与 theme/locale/primary 同模式）。
> **`activeSessionId`**：chat-store 持 live 值；持久 resume 指针镜像到 `AppSettings.lastChatSessionId?`（决议 Q1），boot 回填——与 ClipCombo「nav store(live)+Dexie(durable)」双写、MUZERO 既有 theme/primary 镜像同构。`mode` 不入 Dexie。旧 `dockSide` 字段移除——入口已锚定 dock 工具行、widget 自该处展开。

### 3.4 Migration

- `muzero-db` **bump 到 v5**，只 `version(5).stores({ chatSessions: "id, updatedAt" })`，**不写 `.upgrade()`**（新表，旧行不动；硬规则 #7：改既有表才需 upgrade）。
- `AppSettings` 追加 `lastChatSessionId?`（Q1 决议，Phase 1）+ Phase 5 的 `defaultLlmProviderPresetId?`/`defaultLlmModel?`/`apiKeysByPresetId?` = settings 行内可选字段，**无需 bump**（沿用 musicgen preset 的做法）。
- Rollback = `git revert` 注册表/组件（硬规则 #3）；删除的 tool id 走 `unsupported[]` 通道，老对话仍能加载。

---

## 4. Chat Runtime & Tool 设计

### 4.1 Runtime Actor + Transport（Phase 1 核心）

- **`DjChatRuntimeActor`**（[`dj-chat-runtime-actor.ts`](../../../src/chat/dj-chat-runtime-actor.ts)）：构造 `new Chat<DjChatUIMessage>({ id: sessionId, messages, transport, sendAutomaticallyWhen })`。`sendAutomaticallyWhen = ({messages}) => lastAssistantMessageIsCompleteWithApprovalResponses({messages}) || lastAssistantMessageIsCompleteWithToolCalls({messages})` —— 这是**客户端自动续 tool-loop**的关键。actor 暴露 `sendMessage/stop/addToolApprovalResponse/dispose`，并向 Zustand 推紧凑 `DjChatRuntimeMeta` 快照。
- **注册表**（[`dj-chat-runtime-registry.ts`](../../../src/chat/dj-chat-runtime-registry.ts)）：`Map<sessionId, actor>`，模块作用域。`useDjChatRuntimeSnapshot(sessionId)` 用 `useSyncExternalStore` 订阅，**只有挂载的视图重渲染**。
- **Transport**（[`dj-chat-agent.ts`](../../../src/chat/dj-chat-agent.ts)）：自定义 `ChatTransport`，`sendMessages()` → `validateUIMessages` + `convertToModelMessages` → `agent.stream({prompt, abortSignal})` → `result.toUIMessageStream({messageMetadata})`（从 `finish`/`finish-step` 取 usage 填 `turnTelemetry`）。agent 每次 send **懒解析**（`getAgent()`），settings 变了重建 agent、transport 不变。
- **Agent**：`new ToolLoopAgent({ model: await resolveDjModel(settings), tools, stopWhen: stepCountIs(12), instructions: DJ_CHAT_SYSTEM_PROMPT, temperature, maxOutputTokens })`。

### 4.2 工具契约（two-tier 命名，仿 ClipCombo；落在[数据模型 PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md) 的歌单/播放列表/记忆概念上）

> **前置依赖**：本工具集建在「歌单 Set / 播放列表 Play Queue / 歌曲 Track / 记忆 Memory」四概念上 → **数据模型 PRD 先落地**。审批策略 = **成本驱动**（只有花钱的 `dj_generate_tracks` 必审批；改歌单/队列/记忆都免费可撤 → 不审批）。**不含 playback transport**（播/停/切由用户手动；agent 只管歌单/队列内容 + 切换 + play-next）。

| Chat-facing | Runtime canonical | 读/写 | 落点 |
|---|---|---|---|
| `library_search_tracks` | `muzero.library.search_tracks` | 读 | [`track-search.ts`](../../../src/lib/track-search.ts)（搜 tags + 各曲 memory.note）over `listAllTracks` |
| `library_list_tags` | `muzero.library.list_tags` | 读 | `getAllTags` |
| `now_playing_get` | `muzero.player.now_playing` | 读 | player-store：当前曲 + 队列摘要 + 活跃歌单（**也每轮注入 system**，见下）|
| `set_list` / `set_get` | `muzero.set.list` / `.get` | 读 | `listSessions` / `getSession`（歌单=`DjSession`）|
| `set_create` | `muzero.set.create` | 写·免费 | `createSession`（seed/config）|
| `set_update` | `muzero.set.update` | 写·免费 | 改名/config；歌单成员加删重排（`appendTrackIds`/`removeTrackFromSession`，union op）|
| `set_delete` | `muzero.set.delete` | 写·免费 | 删歌单 |
| `set_switch` | `muzero.set.switch` | 写·免费 | `playSet(setId)`：把歌单灌进播放列表 |
| `queue_add` | `muzero.queue.add` | 写·免费 | `playNext` / `addToQueue`（曲或整张歌单加入播放列表，含「下一手」）|
| `queue_edit` | `muzero.queue.edit` | 写·免费 | `removeFromQueue` / `reorderQueue` / `setRepeat`（union op）|
| `add_memory` | `muzero.memory.add` | 写·免费 | `addMemory(trackId,{note,photo?})`；**now-playing 感知**：默认作用于「正在播放的曲」，让你**听歌时对话加记忆**（"给这首记一句『写代码神器』、加 #雨天"）。一曲多条（见数据模型 PRD）|
| `dj_propose_briefs` | `muzero.dj.propose_briefs` | 读（产出待确认）| 借对话上下文起草 `TrackBrief[]` + `describeBrief` chips，**等确认**（C 方案）|
| `dj_generate_tracks` | `muzero.dj.generate_tracks` | **写·花钱 ✅审批** | 校验 `trackBriefSchema` → `createPendingTrack` + 写当前歌单 + **`playNext` 续在下一手**；物化由 store `pump` 自动 |
| `suggest_next_prompts` | （UI-only） | 读 | 非 mutating、无审批、返回 `{accepted,count}` |

**约定（硬性）**：
- **C 方案 propose→确认→generate**：`dj_propose_briefs` 出提案 → 用户确认 → `dj_generate_tracks` 花钱生成。提供**「无审批模式」开关**（auto-accept，不用每次点 suggest，自动 accept）——即 HITL 的 `auto`（§4.3）。
- **审批 = 成本驱动**：只有 `dj_generate_tracks`（Mureka $0.045/首）`needsApproval:true`；`set_*`/`queue_*`/`add_memory` 免费可撤 → 不审批，体验顺。
- **now-playing 每轮注入 system**：当前曲（title/brief/tags + 该曲已有记忆摘要）+ 播放列表 upcoming 摘要 + 活跃歌单 → 注入 system，让「这首」「下一首」有所指；`now_playing_get` 作补充读工具。
- **domain-first 命名** + 每个 description 写清名词边界（"歌单 Set ≠ 播放列表 Queue ≠ 记忆 Memory"），测试在用错 domain 名词时失败。
- **写工具统一返回 `AgentWriteResult`** `{status,commandId,summary,diff,warnings}`；走现有仓库 mutation（人类同款、可撤）。
- **Zod 校验 + 越界报错而非静默截断**；DJ engine 已 `safeParse` 丢非法 brief，工具层同样不信任模型。
- **能力 gate**（接 [musicgen §4.5](../20260607-muzero-cloud-musicgen-provider-selection-prd/20260607-muzero-cloud-musicgen-provider-selection-prd.md)）：`dj_generate_tracks` 能否器乐/续写看当前 music provider 能力位，**不在 tool 里 `if(vendor===)`**；HTTP 走 `getAppFetch()`。

### 4.3 HITL 审批

- `ask`（默认）/ `auto`（**无审批模式**，用户主动开）是**人类设置**（composer 工具栏 `ShieldQuestion`/`ShieldCheck`，存 chat 偏好）。模型永远不选审批模式。
- 因审批=成本驱动，`ask` 下**只有** `dj_generate_tracks` 会弹 `approval-requested`；`auto` 下自动 accept（连生成也不弹）。
- `ask`：用户 Accept → 执行器以「审批已授予」提交（idempotent，一个 approvalId 只批一次）。Reject = 负向响应，对话继续、零写入。pending 审批**暂停队列派发**。

### 4.4 流式渲染

- 助手 `TextUIPart` → `<Streamdown>{part.text}</Streamdown>`（streaming 与 done 同一路径；Tailwind v4 加 `@source "../../node_modules/streamdown/dist/**/*.js"`）。安全交给 streamdown/rehype-harden，不执行用户脚本。
- `ToolUIPart` → `chat-tool-collapsible.tsx`：`approval-requested` 琥珀确认卡 / `output-available` 折叠 summary（DEV 才展 I/O JSON）/ `output-error` destructive 卡。
- **canonical-for-model vs canonical-for-UI**：`parts.text` 存模型看的展开 prompt；`metadata.composerRaw` 存带 chip 的原文（display）。用户气泡提供「查看发给模型的完整文本」入口；**UI 永不为了好看削弱模型上下文**。
- 上下文占用 ring（估算，标注「估算」，75%/90% 变色）；turn footer 主行 = 成本 + in/out tokens（TPS/wall 仅 tooltip）；**成本未知显示「—」，严禁假数**。

---

## 5. Frontend / Dock 集成对话入口（三态：minimize → normal → expand）

同一个 **mode-agnostic panel body**（`chat-panel.tsx`：header + `chat-turns` + `chat-composer`）被三态宿主复用（ClipCombo 已证明 body 可任意重挂载）。**入口锚在 player-dock 上方工具行**，不再有独立 FAB / 侧栏 / 全屏四形态。

**位置**（[`player-dock.tsx`](../../../src/components/shell/player-dock.tsx) 卡片上方的浮动工具行）：该行现为 `[DockMemoryToggle][NavFab]` 右对齐、`w-fit self-end`（左侧 click-through）。改为铺满：

```
[ DjChatEntry —— min-w-0 flex-1，吃掉剩余空间 ]   [ DockMemoryToggle(记忆) ]   [ NavFab(切 tab) ]
```

chat 入口落在**记忆 icon + 切 tab icon 的左边**、占该行剩余宽度（行 `w-fit self-end` → `w-full`，右两枚 icon `shrink-0`）；`mode==="icon"` 时入口收成 `w-fit` 圆 icon、左侧恢复 click-through。

**门控（硬性，requirement #1）**：单一纯函数 **`canUseDjChat(settings)`**（[`src/chat/dj-chat-availability.ts`](../../../src/chat/dj-chat-availability.ts)，TDD 穷举）= `hasUsableLlm(settings) && hasUsableMusicgen(settings)`：
- `hasUsableLlm` —— 当前/默认 LLM provider 有可用 key（或显式 keyless-local 的 custom endpoint）；LLM 是 BYOK 无离线兜底 → 没 key 即不可用。
- `hasUsableMusicgen` —— 选定 music provider 可用（`mock` 永真；`cloud`/Mureka 需 key）。
- **`false` → 整个入口（连 icon）不渲染**（不是 disabled、是不存在），工具行恢复旧 `[memory][nav]` 右对齐布局。配好缺项后即出现。判定走 `useSettings()` 派生 selector，**别散落 `if(provider===)`**（硬规则 #5/#6）。

### 5.1 形态 1：minimize（只一个 icon）

- 收起态：工具行左侧只一枚圆 icon 按钮（`Sparkles`/`MessageCircleMore`，与 dock 既有圆形控件同款 `h-11 rounded-full bg-card/90 ring-1 backdrop-blur`），不占满宽度。未读/streaming 时角标。
- 点击 → `mode="chip"`。`motion` 宽度 + 透明度过渡（icon ↔ chip）。
- 折叠态（icon）收到 DJ 回复 → 顶部通知（§5.2.1），不原地铺开。

### 5.2 形态 2：normal（full-rounded 圆角 chip 输入条，**默认**）

- 默认态：一个 **full-rounded（`rounded-full`）chip** 作单行输入，`min-w-0 flex-1` 吃掉工具行剩余宽度；内含左侧小 DJ icon + **`chat-composer`** 单行输入 + 3 态主按钮（发送/停/入队）+ 右侧「展开」`Maximize2` 钮。回车即把需求发给 DJ，不显示历史。
- 「大多数时候只想跟 DJ 说一句」的主路径。chip 对齐 dock 卡片视觉（`bg-card/90 backdrop-blur ring-1 ring-border/40 shadow-lg`）、与右侧 memory/nav 控件等高（`h-11`）。
- 收起 → `mode="icon"`（chip 内最小化钮；v1 手动，不自动收）；展开 → `mode="expanded"`。
- 折叠态（icon/chip 皆算）DJ 回复 → 顶部通知（§5.2.1）。

### 5.2.1 DJ 回复通知（`chat-reply-notification.tsx`，折叠态回复显示）

> **决议（Open Q2）**：icon/chip 折叠态收到 DJ 回复 → **顶部居中单条 Notification toast**，仿 anysoul 的 [`MessageToast`](../../../../anysoul/packages/web/src/components/hud/MessageToast.tsx)。不占信息、不打扰；点击展开到 `expanded` widget。多条/错误并发时用堆叠版（仿 anysoul [`NotificationStack`](../../../../anysoul/packages/web/src/components/hud/NotificationStack.tsx)），v1 先单条。

**何时显示**：`mode ∈ {icon, chip}` 且当前 session 有新 assistant 输出（streaming 或 finish）。`mode === "expanded"`（widget 已展开可见）时**不显示**（避免重复）。

**框架与动效**（`motion`，MUZERO 已有，用 `import { AnimatePresence, motion } from "motion/react"`，无需新依赖）：
- 容器：`fixed inset-x-0 top-0 z-[100] flex flex-col items-center px-4 pointer-events-none`，`paddingTop: calc(env(safe-area-inset-top,0px) + 12px)`（移动端安全区）。
- `<AnimatePresence mode="wait">` 包单条 `motion.div`（`key=notificationId`）：
  - `initial={{ opacity:0, y:-40, scale:0.95 }}` → `animate={{ opacity:1, y:0, scale:1 }}` → `exit={{ opacity:0, y:-20, scale:0.97 }}`
  - `transition={{ type:"spring", stiffness:380, damping:28, opacity:{duration:0.18} }}`
- 卡片：`pointer-events-auto w-full max-w-md`，圆角 + `bg-card/95 backdrop-blur-xl ring-1 ring-border/30 shadow-lg`，`active:scale-[0.98]`。内容一行：DJ 图标（`Sparkles`/`Bot`）+ 标题（"DJ"）+ **一行预览**（assistant 文本截 ~80 字，`truncate`）。
- **streaming**：预览实时更新（订阅 runtime actor 的最新 assistant 文本），尾部小 pulse/`Loader2`；**finish 后才启动自动消失计时**（~4–6s，参 `DISPLAY_MS`）。期间用户输入新一句则替换当前通知（`mode="wait"` 自然过渡）。
- **点击**：`dismiss()` + 切 `mode = "expanded"` + 打开该 session（`activeSessionId`）——等价 anysoul 的 `handleTap`（展开 widget + 定位 thread）。
- **错误**：DJ 出错也走这条通知（destructive 配色），点击展开看详情。
- 纯通知、`pointer-events-none` 包裹不挡操作；无障碍：`role="status"` + 可聚焦点击区。

> 实现参考可逐行对照 anysoul `MessageToast.tsx`（顶部单条、spring、自动消失、tap-to-expand）与 `NotificationStack.tsx`（`mode="popLayout"` + `layout="position"` 堆叠、`@/lib/animations` 的 `springDefault`/`layoutSpring`，留给 v2 多条场景）。

### 5.3 形态 3：expand（framer-motion 过渡成对话 widget）

- 点 chip 右侧「展开」钮 / 点回复通知 → `mode="expanded"`：从 dock 入口处**framer-motion 过渡**成一个对话 widget，承载完整 panel body（header + `chat-turns` 历史 + `chat-composer` + session 控件 + 模型 picker + 队列托盘）。**实现注记**：icon↔chip 间用 `layoutId` 共享布局 morph；chip→widget 用 widget 自身 spring（origin-bottom scale+y+fade，从 dock 区域长出）——widget 经 portal 渲染（dock 容器带 centering transform，`fixed` 相对它解析），跨 portal 共享 `layoutId` 会死锁 motion projection。
- **桌面（`md+`）**：widget 是一个**从 dock 入口上方长出的浮层卡片**（锚在入口处向上展开），约 `w-[min(36rem,calc(100vw-1.5rem))] h-[min(70vh,40rem)]`，圆角 + `bg-card/95 backdrop-blur-xl ring-1 shadow-2xl`，盖在 main 之上（**不挤** player-dock 布局、**不引入 sidebar**，硬规则 #9；点外侧 / `Esc` 收回）。
- **移动（`<md`）**：展开成**全屏 sheet**（复用 now-playing sheet 同款 `inset-0` + 安全区），关闭回 chip/icon。断点用统一 `matchMedia` hook（`md` 分界，参考 ClipCombo `useMobileWorkbenchLayout` 简化为单断点）。
- 收起：`Minimize2` / `Esc` / 点外侧 → 回 `chip`（或上次的 `icon`）；`layoutId` 反向 widget→chip 过渡。
- reduced-motion：`MotionConfig reducedMotion="user"` 下 morph 退化为即时切换（无缩放/位移），仍正确挂载。

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

### 5.9 State 纪律（Zustand slice / selector / 防无关重渲染）—— 硬性

> chat 是多 slice、高 re-render 风险区（消息流、runtime status、三形态、队列、模型选择各自变化频率不同）。**状态跨组件解耦做到位，state 更新不得波及无关组件**（硬规则 #6）。沿用 MUZERO 现有范式（[`track-identity-row.tsx`](../../../src/components/player/track-identity-row.tsx) 是模板：`useShallow` + 只取当前曲*标量*，别的歌变动重建数组也不重渲染它）。

- **最小 selector，永不整 store 订阅**：组件订阅它真正用到的最小切片；选对象/数组用 `useShallow`（`zustand/react/shallow`）+ **提取标量字段**（如 `{title, coverBlobId}`），别订阅整个 `messages`/`queue` 对象引用。
- **chat-store 分 slice**：`uiSlice`（mode）、`navSlice`（activeSessionId）、`runtimeMetaSlice`（per-session status/preview/pendingApprovalCount）。各 slice 独立更新，互不牵连。high-frequency 的流式 token **不进 store**——走 runtime actor 的 `useSyncExternalStore` 快照，只让挂载的消息视图重渲染。
- **非响应式单例进模块作用域**：`DjChatRuntimeActor` 注册表、`AbortController`、transport 等**不进 store state**（同 `DjEngine`/`MediaEngine`）。
- **派生用 selector，不冗余存**：`pendingApprovalCount`、`currentTrack` 等是 selector over tool parts / queue，不另立可能与真相分叉的 state。
- **diff 守卫高频订阅**：liveQuery / 外部订阅推数据前比签名，内容没变不 `set`（参 player-store 的 `queueSig` 守卫），避免数组引用 churn 触发列表全量重渲染。
- **列表用 `useLiveQuery` 读 Dexie**，不塞进 Zustand（硬规则 #6）。

---

## 6. 多 Provider 模型选型（Phase 5）

> 用户明确要：「Setting modal 里接入大量不同 API provider + combobox 直接选 model」。MUZERO 现状只有 `LlmProviderId="openai"|"anthropic"` + 自由输入 model（[`model.ts`](../../../src/ai/model.ts)）。要扩成 **preset 化多 provider**（仿我刚做的 musicgen presets，也仿 ClipCombo `CLIP_LLM_PROVIDER_PRESETS`）。

- **`src/ai/llm-providers.ts`（新）**：`LlmProviderPreset[]`，每个 `{ id, label, provider:"openai-compatible"|"anthropic", baseUrl, apiKeyUrl, models: {id,label,contextLimit?,inputCost?,outputCost?}[] }`。内置：**openrouter / openai / claude / gemini / groq / deepseek / custom**（非 Anthropic 全走 OpenAI-compatible adapter + per-provider `baseURL`，Anthropic 单独 `createAnthropic`+浏览器直连 header）。外加用户自定义 `custom:*` OpenAI-compatible endpoint（存 Dexie）。
- **`resolveDjModel` 扩展**：按 preset 解析到 AI SDK model 实例，仍注入 `getAppFetch()`。
- **Key 存储**：**进 IndexedDB `settings` 行**（`apiKeysByPresetId`，硬规则 #2），不像 ClipCombo 放 localStorage。per-provider 记 key + model，切 provider 恢复上次选择。
- **Settings UI**：provider 列表（启用/排序/各自 key）+ **全局默认 provider/model** + **per-session 模型 combobox**（需补 `command`/`combobox` 原语）。provider「有 key 且启用」才进 session 模型选择器。
- **全局默认 + per-session 覆盖（决议 Q3）**：新建 session **继承全局默认**（存在 `AppSettings` 的 `defaultLlmProviderPresetId`/`defaultLlmModel`，或复用现有 `llmProvider`/`llmModel` 迁移）；用户用 combobox 覆盖时写 `ChatSession.llmProviderPresetId`+`llmModel`（**不存 key**，防陈旧密钥进历史）。解析时 `ChatSession` 有覆盖用覆盖、否则用全局默认。改 settings 即重建 agent、transport 不变。
- **上下文限制检测**：多级回退（model 元数据 → 静态已知表 → 保守默认 128k，标「估算」），短 TTL 缓存，与 Settings 模型拉取共享。

### 6.1 复刻 ClipCombo 的「内置 preset + 动态自定义 provider」（逐项对照，requirement #2）

> 蓝本：ClipCombo `packages/clipcombo/src/lib/clip-llm-providers.ts`（preset 注册 + 自定义 provider 归一化）、`components/editor/EditorSettingsPopover.tsx`（provider/model picker + 自定义编辑 + enabled grid + `ApiKeyField`）、`lib/clip-chat-model.ts`（AI SDK 装配）。MUZERO 现状已有 `src/ai/llm-providers.ts`（7 preset）、`chat-model-picker.tsx`、`apiKeysByPresetId`——**缺的是「动态自定义 provider 系统 + Settings provider 面板 + enabled grid + ApiKeyField」**。

| ClipCombo | MUZERO 落点 | 状态 |
|---|---|---|
| `EditorLlmProviderPreset`（id/label/baseUrl/apiKeyUrl/provider/models[]）| `LlmProviderPreset`（[`src/ai/llm-providers.ts`](../../../src/ai/llm-providers.ts)）| ✅ 已有 7 内置 |
| `EditorCustomLlmProviderRecord`（`custom:${uuid}`，label/baseUrl/models[]/时间戳）| **新 `CustomLlmProvider` 类型 + Dexie 表 `llmCustomProviders`（bump v6，`&id,createdAt,label`，新表不写 upgrade）** | 🔲 待做 |
| `list/put/deleteEditorCustomLlmProvider` + `useLiveQuery` + `notify…Changed` 事件 | **`src/ai/custom-llm-providers.ts` repo**（list/put/delete + `useLiveQuery`）；`normalizeCustomProviders()`（去重 / trim / 至少一 model）| 🔲 待做 |
| `customLlmProviderConfigToPreset()`（custom → preset，恒 `openai-compatible`）| 同名纯函数，merge 进 `resolveProviderPresets(builtins, customProviders)` | 🔲 待做 |
| `apiKeysByPresetId` / `modelsByPresetId`（per-provider 记 key + 上次 model）| settings 行（key 进 IndexedDB，硬规则 #2）；**补 `modelsByPresetId`** 切 provider 复原上次 model | 🔄 key 有、`modelsByPresetId` 待补 |
| Provider 选择 = Popover+Command；「+ Add Custom Provider」建 `custom:${uuid}` | `chat-model-picker.tsx`（✅）扩 provider 维度 + Settings「+ 自定义 provider」按钮 | 🔄 |
| 自定义编辑：label / baseUrl / model 列表 add-remove / delete provider | **Settings provider 面板新组件 `llm-provider-settings.tsx`** | 🔲 待做 |
| 「Enabled providers」勾选网格 + 每项 key 状态（ready / optional / missing）| 同面板内 grid；纯函数 `isLlmProviderKeyReady(settings, id)` | 🔲 待做 |
| `ApiKeyField`（遮罩 + reveal + `apiKeyUrl` 链接 + onCommit 提交）| **新 `api-key-field.tsx`**（每 provider 一枚，写 `apiKeysByPresetId[id]`）| 🔲 待做 |
| `createClipChatLanguageModel(settings)`：anthropic vs openai-compatible / keyless-local 去 auth header / baseURL 归一（补 `/v1`）| `resolveDjModel` 扩（[`src/ai/model.ts`](../../../src/ai/model.ts)）：anthropic 走 `createAnthropic`+浏览器直连 header；其余 `createOpenAI({ baseURL, apiKey, fetch: getAppFetch() })`；无 key 的 local endpoint 用 `fetchWithoutAuthorization` | 🔄 preset 解析有、custom/keyless 分支待补 |
| 视觉能力推断（`supportsVision` per model/provider）| v1 可省（DJ chat 暂不收图）；留 `models[].supportsVision?` 字段位 | ⏸️ 省 |

**纪律**：custom provider 恒 `openai-compatible`；key **只进 IndexedDB `settings`**（不像 ClipCombo 放 localStorage——硬规则 #2）；HTTP 全程 `getAppFetch()`（桌面 muzfetch 绕 CORS——硬规则 #5/#10）；删 provider/model 走可撤的 repo mutation；`custom:` id 前缀属 codename 层稳定（硬规则 #4）。**`canUseDjChat` 的 `hasUsableLlm` 直接复用 `isLlmProviderKeyReady`**（任一「启用且 key-ready」的 provider 即满足门控）。

---

## 7. Implementation Plan

> **基础设施先于广度**（prd-create.md）：Phase 1（runtime）→ Phase 2（外壳）→ Phase 3（工具）→ Phase 4（多 session）→ Phase 5（多 provider）→ Phase 6（队列/onboarding/压缩）。每 phase 原子 commit + 更新本 PRD 状态。

### Phase 1: Chat runtime 地基 ✅
**Tasks:**
- [x] `muzero-db` v5 加 `chatSessions` 表；`ChatSession`/`DjChatUIMessage`/`DjChatMessageMetadata` 类型；`dj-chat-sessions.ts`（CRUD + 节流快照 persist ~1.2s + finish/切换 flush + 标题派生）。
- [x] `dj-chat-agent.ts`（ToolLoopAgent + 懒解析 DirectChatTransport，`resolveDjModel`+`getAppFetch`）、`dj-chat-runtime-actor.ts`、`dj-chat-runtime-registry.ts`、`chat-store.ts`（mode/activeSessionId/runtime meta）。
- [x] 补 `textarea` UI 原语；`chat-panel.tsx`（最小：turns + composer）；`chat-turns.tsx` + `streamdown`（加依赖；组件内导入 package CSS，未触碰 dirty `styles.css`）。
- [x] 单 session 端到端：发消息→流式→持久化→重载恢复。

**Phase 1 Checklist:**
- [x] 注入 fake transport 的集成测：send→stream→`messagesJson` 落库→重建 actor 后历史恢复（`fake-indexeddb`，硬规则 #7）。
- [x] runtime/AbortController/actor 全在模块作用域，不进 Zustand state（硬规则 #6）；列表走 Dexie/live-query-ready repository surface。
- [x] provider HTTP 走 `getAppFetch()` via `resolveDjModel`; key 不进日志/历史。
- [x] `make check` 绿；本 phase 未新增用户可见正文文案（按钮仅 aria-label）。

### Phase 2: Dock 集成对话入口（**2026-06-11 重新设计**）
> 旧四形态壳（FAB / bar / Dock-1∕3 / 全屏）作废重做；并行 Now Playing redesign 已落地、`App.tsx`/`player-dock.tsx` 不再 WIP-blocked，本 phase 可直接做。
**Tasks:**
- [x] `chat-store` 的 `mode` + persist：`ChatMode` 改 `icon`/`chip`/`expanded`（默认 chip）、移除 `dockSide`；persist `version:1` + `migrateChatUiState`（fab→icon、bar→chip、dock/fullscreen→expanded、丢 dockSide、未知值回 chip，直接单测）。
- [x] ~~`chat-launcher-fab` / `chat-input-bar` / `chat-dock` / `use-chat-breakpoint`（旧壳）~~ **已删除**（`git rm` + chat-shell.test 重写为 `chat-reply-notification.test.tsx`）；逻辑并入新 `dj-chat-entry.tsx`（CHAT-2c）。`chat-reply-notification` 判定改 `mode !== "expanded"`、点击展开到 `expanded`。
- [x] **`dj-chat-availability.ts`（纯函数 + TDD）**：`canUseDjChat` / `hasUsableLlm` / `hasUsableMusicgen`（9 测：fresh install false、`apiKeysByPresetId` 任一非空 key、空白 key 忽略、legacy openai/anthropic 字段、`mock` 永真、cloud 无 key false、mureka fixed-endpoint+key true、custom preset 还需 baseUrl、AND 门控矩阵）。keyless-local 留 Phase 5 动态 custom provider 落地时扩。
- [x] **`dj-chat-entry.tsx`**：挂进 [`player-dock.tsx`](../../../src/components/shell/player-dock.tsx) 上方工具行（记忆+nav icon **左侧**、`min-w-0 flex-1` 吃满；行改 `w-full`，pointer-events 落在**子元素**上保持空白区 click-through）。`canUseDjChat===false` 整入口不渲染。三态：**icon**（圆钮）/ **chip**（`rounded-full` 单行输入 + 3 态主按钮[发送/停/入队] + 展开钮，默认）/ **expanded**（widget：桌面浮层卡片 576×520、移动全屏 sheet，内嵌 `ChatPanel`，chip 发送自动建 session）。⚠️ **实现修正**：icon↔chip 用 `layoutId` morph；**widget 用自身 spring**（进出场 scale+y+fade）——chip 在 dock 树内、widget 经 portal 渲染（dock 容器有 centering transform，`fixed` 会相对它解析），跨 portal 共享 `layoutId` 会让 motion projection 死锁（幽灵卡在 chip 尺寸）。AnimatePresence 子元素必须**带 key 直挂**（fragment 包裹会断 exit 追踪导致退场后不卸载）。`ChatReplyNotification` 一并经 portal 挂 body（同 transform 祖先问题）。8 组件测。
- [x] `chat-reply-notification.tsx`（§5.2.1）：折叠态（icon/chip）DJ 回复走顶部 toast；expanded 时不显示。
- [x] reduced-motion（App 根 `MotionConfig reducedMotion="user"` 继承）morph 退化为即时切换；`Esc` / 点 backdrop 收回（组件测覆盖两者）。

**Phase 2 Checklist:**
- [x] **门控**：未配 LLM / musicgen → 入口与 icon 都不渲染、工具行恢复右对齐；配齐后出现（`canUseDjChat` 9 单测穷举 + 2 组件测；preview 实测写 key 进 IndexedDB 后 liveQuery 即时出现）。
- [x] 三态切换正确（icon↔chip↔expanded）、偏好持久化（含 v0→v1 迁移）；chip 吃满剩余宽度（实测 652px @1280 viewport）且与 memory/nav 等高 h-11；expanded 桌面浮层 576×520 / 移动全屏 sheet（CSS 断点）。
- [x] 折叠态收到回复 → 顶部通知出现 / streaming 实时预览 / 点击展开到 expanded；expanded 态不重复弹。
- [x] 浏览器 preview 实测（:1440 隔离实例）：门控开关、icon↔chip↔expanded 全循环、Esc/backdrop 收回 + AnimatePresence 正确卸载、widget computed 样式（bg-card/95 + blur24 + 576×520）、i18n zh 文案、**零 console 报错**。⚠️ spring 动画视觉效果在 preview 隐藏 tab 冻结（rAF 节流，已知沙箱限制）——动效手感请在真实前台窗口复核。

### Phase 3: DJ 工具调用
**Tasks:**
- [x] `dj-chat-tools.ts`（§4.2 工具集，Zod schema，读/写 + `needsApproval`，`AgentWriteResult`）；`dj-chat-prompt.ts`。
- [x] `chat-tool-collapsible.tsx` presentational 组件（审批/结果/错误；labels 由调用方传入，避免内置文案）。
- [x] `ChatTurns`/`ChatPanel` 可选接入 `chat-tool-collapsible` + runtime approval callbacks。
- [x] HITL `ask`/`auto` 偏好 + App/i18n labels 接线：`chat-store.approvalMode`（ask 默认/auto，persist）+ expanded header `ShieldQuestion`/`ShieldCheck` 切换钮；`pendingApprovalIds`（actor 导出纯函数）+ `ChatPanel.autoApprove` effect 自动 accept（响应幂等，安全重跑）；`dj-chat-entry` 给 ChatPanel 接 `toolLabels`（7 态）+ `queueLabels` 全量 i18n（`chat.*` 21 keys ×4 语）。
- [x] Runtime approval bridge：actor 可响应 tool approval，并让 AI SDK tool loop 继续。
- [x] 工具落 repos；`dj_generate_tracks` 走 `createPendingTrack`+`prependTrackIds` + play-next queue（物化由 store pump 自动）；provider id 从 settings 注入，保持 provider-agnostic。
- [x] `dj_propose_briefs`：校验候选 `TrackBrief[]` 并返回 proposal id + summaries，不写 DB、不花钱、不审批；确认后才走 `dj_generate_tracks`。

**Phase 3 Checklist:**
- [x] Core 集成测：propose→generate→pending 落库→mock provider materialize→ready + media blob（不经 UI/store pump）。
- [ ] Store pump E2E：「做个 lofi set」→ propose→审批→generate→pending 落库→pump 物化→可播（canned model + mock music provider）。**Blocked:** `src/stores/player-store.ts` 当前属于并行 Now Playing WIP。
- [x] Runtime approval response 测试：pending approval→approve/reject response 写入消息→tool loop 自动续轮。
- [x] `chat-tool-collapsible` 组件测试：approval actions、output、error 三态渲染。
- [x] `ChatTurns` opt-in tool UI 测试：带 labels 时渲染 collapsible 并透传 approve/reject。
- [x] 写工具 schema 拒绝时零写入；读工具无审批；`dj_generate_tracks` 才 `needsApproval:true`。
- [x] `dj_propose_briefs` 无审批且零写入，生成摘要给确认 UI 使用。
- [x] `library_search_tracks` 使用 memory-aware search；`dj_generate_tracks` 写 pending track + set + play-next queue。

### Phase 4: 多 Session + 历史 + branch/regenerate
**Tasks:**
- [x] `chat-session-home.tsx` 展示层（列表 + 子串搜索标题/user 文本 + 自动标题显示 + 重命名/删除/打开回调，无内置文案）。
- [x] Session home App/ChatPanel 切换接线：expanded widget header 加 `History` 切换（home 视图：`ChatSessionHome` + `useLiveQuery(listChatSessions)`，labels 全 i18n）+ `SquarePen` 新建即开；open→`setActiveSessionId`+回 panel、rename/delete 走 repo（删活跃 session 时清 activeSessionId）。**切 session 只换 panel 的 sessionId**——actor 是模块作用域 per-session，流式 session 切走仍在后台继续（组件测覆盖 open/new；并发流式断言已有 runtime 集成测）。i18n `chat.home*` 11 keys ×4。
- [x] regenerate（edit-resend 复用 messageId）；branch（截断深拷贝 messagesJson → 新 session）。

**Phase 4 Checklist:**
- [x] 集成测：两 session 不同 model 同时跑、一个审批一个错误互不串。
- [x] 切 home 不清流式 session 的 live 消息（actor 注册表模块作用域，切换零 dispose；open/new 组件测 + 既有双 session 并发集成测）。
- [x] Runtime 基座：两个 session actor 可并发发送、分别 stream/persist，preview 与 messagesJson 不串线。
- [x] 空 session 首次持久化 user 消息时自动派生标题，不覆盖手工标题。
- [x] 搜索命中标题与用户消息（不搜 assistant-only 文本）；branch 后父子独立。
- [x] `ChatSessionHome` 展示层搜索复用同一口径：标题 + user 文本，assistant-only 不命中；open/rename/delete 只回调给上层。
- [x] edit-resend regenerate 复用 user `messageId`，截断后续并重流。

### Phase 5: 多 Provider 模型选型
**Tasks:**
- [x] `ai/llm-providers.ts` preset 注册表；`resolveDjModel` 扩多 provider（仍 `getAppFetch`）；key 入 `settings` 行 `apiKeysByPresetId`。
- [x] 补 `dialog` primitive（Base UI wrapper：trigger/content/title/description/close，COSS/shadcn-style classes）。
- [x] 补 `popover` primitive（Base UI wrapper：trigger/content/title/description/close/positioner，COSS/shadcn-style classes）。
- [x] 补 `scroll-area` primitive（Base UI wrapper：root/viewport/content/scrollbar/thumb/corner，默认 keepMounted scrollbar）。
- [x] 补 `command` primitive（无内置文案：items/placeholder/empty 由调用方传入；label+keywords 搜索过滤；select 回调）。
- [x] `chat-model-picker.tsx` 展示层（无内置文案，Popover+Command 选择 enabled provider/model，回调 `{presetId, model}`）。
- [x] **动态自定义 provider 数据层（复刻 ClipCombo §6.1，CHAT-5a）**：`CustomLlmProvider` 类型（types.ts）+ Dexie **v21** 新表 `llmCustomProviders`（`id, createdAt`，无 upgrade）+ `src/ai/custom-llm-providers.ts`（`isCustomLlmProviderId`/`createCustomLlmProviderId`/`normalizeCustomLlmProviders`[去重/trim/≥1 model/仅 `custom:` id]/`customLlmProviderToPreset`/list-put-delete repo/`useCustomLlmProviders` liveQuery）；`llm-providers.ts` 拓宽 `LlmProviderPresetId = Builtin | custom:${string}` + `allLlmProviderPresets`/`resolveLlmProviderPreset(id, custom)`/`llmProviderAllowsMissingApiKey`（keyless-local）/`enabledLlmPresetIds(settings, custom)`（custom 无 key 也 enabled）/`llmModelForPreset`+`AppSettings.modelsByPresetId`（per-preset 记忆上次 model）。16 测。
- [x] **Settings provider 面板 `llm-provider-settings.tsx`（CHAT-5c，`feat/chat-llm-providers` worktree）**：provider grid（全 preset+custom，per-provider key 状态 ready/optional/missing，点选编辑）+ 内联 `ApiKeyField`（遮罩/reveal/`apiKeyUrl` 外链 `openExternalUrl`，blur 提交 `apiKeysByPresetId[id]`）+「+ 自定义 provider」建 `custom:${uuid}`（默认 `localhost:11434/v1`）+ 自定义编辑器（label/baseUrl blur 保存、model 列表 Enter/按钮增删、删 provider）+ 全局默认模型 `ChatModelPicker`（enabled=有 key 内置+全部 custom；选中写 `defaultLlm*`+`modelsByPresetId`）。替换 settings-page `playback-dj` 旧双 provider 表单（legacy 字段留 bridge）。i18n `settings.llm*` 20 键 ×4 语。组件测 5 例。注：main 继承的 chat-model-picker / virtual-track-list 2 个既有测试失败与本分支无关（stash 验证）。
- [x] `resolveDjModel` 扩 custom/keyless 分支（CHAT-5b）：`normalizeOpenAiCompatibleBaseUrl`（trim/去尾斜杠/无版本段补 `/v1`，`/v1beta/openai` 保留）+ `fetchWithoutAuthorization`（keyless 用占位 key + 剥 `Authorization` 头）；transport `defaultResolveModel` 每次 send 懒读 `listCustomLlmProviders` 传入 selection+model 解析（settings/custom 改完即生效）。`modelsByPresetId` 记忆已随 5a 落（`llmModelForPreset`）。model.test.ts 新增（keyless 不抛/keyed 缺 key 抛/头剥离）。
- [ ] Settings/App/i18n/DB 接线：provider key 管理、全局默认、per-session 覆盖持久化；上下文限制检测。
- [x] `ChatSession.llmProviderPresetId`/`llmModel`（不存 key）字段已随 CHAT-1 落库；Phase 5a 补全全局默认 fields + legacy bridge。

**Phase 5 Checklist:**
- [x] 切 provider/model 解析即时生效（runtime 每次 send 懒建 agent、transport 不变）；无 key 的 provider 不进 enabled list；key 不进 chat history。
- [x] Runtime 按 `ChatSession.llmProviderPresetId/llmModel` 覆盖全局默认模型，API key 仍只从 settings 读取。
- [x] Dialog primitive 具备 trigger/open、title/description a11y、close/onOpenChange 测试覆盖。
- [x] Popover primitive 具备 trigger/open、positioned content、title、close/onOpenChange 测试覆盖。
- [x] ScrollArea primitive 具备 root/viewport/content/scrollbar/thumb 稳定结构测试覆盖。
- [x] Command primitive 具备 label/keyword 过滤、empty state、select id 回调测试覆盖。
- [x] ChatModelPicker 展示层具备选中模型展示、provider/model 搜索过滤、空态与 select 回调测试覆盖。
- [ ] 自定义 provider 全链路：建 `custom:${uuid}` → 编辑 baseUrl/model → 选中 → `resolveDjModel` 装配 openai-compatible → 对话可用；删除走可撤 mutation；key 只在 settings、不进 history（单测 + 组件测）。
- [ ] i18n 4 语全覆盖（provider/model label、combobox 文案、自定义编辑/key 面板）。

### Phase 6: 队列/打断 + onboarding + 压缩
**Tasks:**
- [x] `chat-queue-tray.tsx` 展示层（DnD 重排、可访问按钮重排、立即发送/删除回调、auto-dispatch Switch 默认关、无内置文案）。
- [x] ChatPanel 可选 `queueLabels` 挂接 `chat-queue-tray.tsx` 到 runtime actor（send/delete/reorder）；runtime snapshot 暴露 queued prompt 详情。
- [ ] App 挂载 + i18n labels + auto-dispatch 偏好持久化接线；待并行 App/i18n WIP 落地后补。
- [x] 队列 runtime 核心：`ChatSession.queuedPromptsJson` 解析/入队/重排/删除；actor 重建只恢复队列计数、不自动派发；手动派发移除 queued prompt 后发送；actor 重排/删除不触发发送；interrupt 立即发送并带一次性 marker。
- [x] `chat-empty-state.tsx` 展示层：预设 chips 只触发 insert 回调不发送 + 空库/无 seed 引导动作（上传/输入 vibe），无内置文案。
- [ ] 空态 App/composer draft/i18n 接线：chips 插入 textarea draft、上传/输入 vibe 导航动作。
- [x] `dj-chat-context-budget.ts` + `dj-chat-tokens.ts`：预算 gate + 滑动 `contextStartIndex` 压缩（block-and-explain，不静默截断）。

**Phase 6 Checklist:**
- [x] 键盘矩阵测试（Enter/Ctrl+Enter/Shift+Enter）；running+draft Enter 入队，Cmd/Ctrl+Enter interrupt，Shift+Enter 保留换行。
- [x] pending 审批暂停派发；`sendQueuedPrompt` 保留 queued prompt 且返回 false。
- [x] 重载恢复队列但不自动发；手动派发 queued prompt 后从 session 队列移除；interrupt 不入队并带 `interruptionMarker`。
- [x] Runtime actor 支持 queued prompt reorder/delete，持久化顺序/数量且不 dispatch。
- [x] Queue tray 展示层支持 DnD drop、上/下移按钮、send/delete、auto-dispatch 切换；组件只把 prompt id 顺序/动作回调给上层。
- [x] Runtime snapshot 暴露 `queuedPrompts` 详情；`ChatPanel` opt-in 渲染 queue tray 并转发 send/delete/reorder 给 actor。
- [x] 空态 preset chips 只走 insert 回调，不触发 send；上传库/输入 vibe 引导只回调给上层。
- [x] 超预算时纯函数返回 block（调用点负责解释）；压缩指针计算保留最新 user turn，不静默截断。
- [x] 压缩指针 actor/repo 持久化、旧消息仍可见。
- [x] `chat-context-budget-notice.tsx` 展示层：ok 默认隐藏、warn=`status`、block=`alert`，压缩动作只回调给上层，无内置文案。
- [ ] 上下文预算 ChatPanel/App/composer 发送拦截与 block-and-explain 文案（待 i18n/App 挂载解锁）。

---

## 8. Out of Scope

- **不引入 MUZERO 后端 / 账号 / 遥测**（硬规则 #1）。无服务器 session 同步、无云端队列、不把 runtime 放 Web/Service Worker。
- **不抄 ClipCombo 的 subtitle/composition 专属能力**（字幕附件预算、composition layer 工具）——MUZERO 无对应 domain。
- **contentEditable chips composer**（@mention/slash 富输入）= 后续增强；v1 用 textarea。
- **超长对话 RAM 窗口化**（archived prefix / Dexie-only head 分页）= 后续优化。
- **drag-resize 的 Dock**（v1 固定 1∕3）、**语音输入**、**附件/多模态图片**（ClipCombo 有，MUZERO 暂不需要）。
- **桌面端外部链接走系统浏览器 = 要做**（用户要求「必须走系统浏览器」）：加 `@tauri-apps/plugin-opener` + `openExternalUrl()` 包装（见 musicgen PRD Q9）。chat 里的 docs/key 链接也复用它。

## 9. Security / Privacy

- **BYOK key 纪律（硬规则 #2）**：LLM key 只存 IndexedDB `settings` 行，请求时解析、直连 provider；**绝不**进 `messagesJson`/bundle/URL/日志/（不存在的）遥测。per-session 只存 providerPresetId/model，不存 key。
- **无遥测**：MUZERO 不上报任何东西（区别于 ClipCombo 的 PostHog 白名单）。但沿用其**「绝不打印」清单**到 [`logger.ts`](../../../src/lib/logger.ts)：永不 log prompt/lyrics/caption 文本、对话内容、provider key、provider 响应体、工具 I/O 原文、音频 bytes、上传文件名。日志只留 status 枚举、计数 bucket、provider/preset id。
- **审批权威**：破坏性写必须 `needsApproval`；写经现有仓库 mutation（可撤销）；一个 approvalId 只批一次。
- **流式安全**：streamdown + rehype-harden，不执行用户脚本；外链/代码块受控。

## 10. Related Documents

| Document | Description |
|----------|-------------|
| **[数据模型 PRD（歌单/播放列表/记忆）](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md)** | **前置依赖**：本 PRD 的 `set_*`/`queue_*`/`add_memory` 工具落在它的概念上，建议先落地 |
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
| 1 | 活跃 session id 存哪？ | **Resolved** | `AppSettings.lastChatSessionId?`（best practice）——MUZERO 无 project 概念，不需 ClipCombo 的 per-project chatPrefs 行；与既有 `lastSessionId`/`lastTrackIndex` 同级，不为一字段开新表。`mode`（icon/chip/expanded）留 chat-store localStorage |
| 2 | 折叠态收到回复怎么显示？ | **Resolved** | **顶部 Notification toast**（§5.2.1，仿 anysoul `MessageToast`：spring 下滑、一行预览、自动消失、点击展开到 expanded widget）。折叠态(icon/chip)显示、expanded 态不显示。轻量不占信息 |
| 3 | per-session 模型 vs 全局模型默认？ | **Resolved** | **两者都要**（best practice，抄 ClipCombo）：新建 session 继承全局默认（`AppSettings.defaultLlm*`），combobox 可覆盖到 `ChatSession.llmProviderPresetId`/`llmModel`（不存 key）。Phase 5 落地 |
| 4 | `dj_generate_tracks` 与现有自动续歌（`maybeRefill`）的关系？ | **Resolved**（best practice）| 工具是「显式生成」、autoExtend 是「自动续」；**二者都写同一队列、由 store `pump` 统一物化，不开第二个生成循环**（避免双循环打架）。Phase 3 落地 |
| 5 | streamdown bundle 体积？ | **Resolved** | 用户接受 streamdown bundle 增量；Phase 1 仍跑 `pnpm build` 记录实际增量备查 |
| 6 | 是否需要 contentEditable chips（@/）v1？ | Resolved | 否，v1 textarea，chips 列后续增强 |
| 7 | 对话入口形态 + 何时显示？ | **Resolved**（owner 2026-06-11）| 集成进 **player-dock 上方工具行**（记忆 + nav icon 左侧、吃满剩余宽度），三态 **icon / chip / expanded**（framer-motion `layoutId` morph）；**门控**：未配 LLM + musicgen 则连 icon 都不渲染（`canUseDjChat`）。取代旧四形态（FAB/bar/Dock-1∕3/全屏）|
| 8 | provider 配置范围？ | **Resolved**（owner 2026-06-11）| **逐项复刻 ClipCombo** 多 provider + **动态自定义 provider**（OpenAI-compatible baseURL，存 Dexie `llmCustomProviders`）+ per-provider key（进 `settings`，硬规则 #2）+ enabled grid + ApiKeyField（§6.1）|

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft —— 调研 ClipCombo agent 面板（5 路并行 deep-read：UI/形态、session/持久化、AI SDK/streaming/模型、PRD 簇蒸馏、MUZERO 集成点），落成 6-phase 复刻 PRD：多 session + 可搜历史 + 每步本地持久化 + branch/regenerate + 多 provider combobox + streamdown 流式，外加 MUZERO 三形态（FAB / 底部输入条 / Dock 1∕3→移动全屏）|
| 2026-06-07 | MUZERO | 定 Open Q2：折叠态（bar/fab）DJ 回复 = **顶部 Notification toast**（§5.2.1，仿 anysoul `MessageToast`/`NotificationStack` 的 `motion/react` 模式：spring 下滑、一行预览、自动消失、点击展开到 dock）。加 `chat-reply-notification.tsx` 到结构 + Phase 2 |
| 2026-06-07 | MUZERO | 定 Open Q1 + Q3（best practice）：active session id → `AppSettings.lastChatSessionId?`（无 project 概念，免单独 chatPrefs 行）；模型 = 全局默认 + per-session combobox 覆盖（key 不进 session 行）。同步 §3.2/§3.3/§3.4/§6 |
| 2026-06-07 | MUZERO | 收口 Q4/Q5：generate 工具与 autoExtend 都写同一队列、store pump 统一物化（不开第二循环）；接受 streamdown bundle 增量。`track_annotate` 加 **now-playing 感知**（听歌时对话加 tag/note，链 musicgen Q5 的生成自动 Note）。系统浏览器外链改为「要做」（`@tauri-apps/plugin-opener`）|
| 2026-06-07 | MUZERO | **工具集对齐新数据模型**：§4.2 重写——`set_*`(歌单 CRUD+切换)/`queue_*`(加入播放列表/play-next/重排)/`add_memory`(一曲多记忆)/`now_playing_get`；**无 playback transport**；C 方案 propose→确认→generate + 无审批模式开关；**审批=成本驱动**(只 `dj_generate_tracks` 审批)；now-playing 每轮注入 system。**前置依赖**[数据模型 PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md)先落地 |
| 2026-06-07 | MUZERO | 加 §5.9 **State 纪律**（用户强调跨状态解耦）：最小 selector / `useShallow`+标量 / chat-store 分 slice / 模块作用域单例 / diff 守卫高频订阅 / `useLiveQuery` 读列表。模板 `track-identity-row.tsx`；已给 player-store 加 `queueSig` 守卫 |
| 2026-06-07 | Codex | 完成 Phase 1：DB v5 `chatSessions` + `ChatSession`/`DjChatUIMessage` 类型、chat session CRUD/标题派生/快照持久化、懒解析 BYOK `ToolLoopAgent` transport、模块作用域 runtime actor/registry、persisted chat-store、`textarea` 原语、最小 `chat-panel`/composer/Streamdown turns；补 fake-indexeddb 集成测覆盖 send→stream→messagesJson→actor rebuild。`pnpm build` 通过；main JS chunk `1,643.26 kB` min / `491.28 kB` gzip（Vite large-chunk warning）。 |
| 2026-06-07 | Codex | 推进 Phase 2a：新增 `use-chat-breakpoint`、FAB launcher、bottom input bar、responsive dock、folded reply notification，并补 store/hook/shell 组件测试。`App.tsx` 挂载保持 blocked，避免覆盖并行 Now Playing redesign WIP；`make check` 通过（45 files / 330 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 3a：新增 `dj-chat-tools.ts` 工具核心（library/search/tags、set、queue、memory、`dj_generate_tracks`），runtime agent 接入工具集；`dj_generate_tracks` 仅它带 `needsApproval:true`，执行时校验 TrackBrief、创建 pending tracks、写目标 set 并 play-next 入播放列表。补 fake-indexeddb 测试覆盖 schema 拒绝零写入、memory-aware search、pending+queue 写入；`make check` 通过（46 files / 334 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 4a：扩展 chat session repository，支持历史子串搜索（title + user messages only）和 branch（截断 deep-copy messagesJson，记录 parent/fork index）；runtime actor 增加 edit-resend regenerate（复用 user messageId、截断后续并重流）。补 fake-indexeddb/runtime 测试；`make check` 通过（46 files / 337 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 5a：新增 LLM provider preset registry（openrouter/openai/claude/gemini/groq/deepseek/custom）、settings 字段 `defaultLlmProviderPresetId`/`defaultLlmModel`/`apiKeysByPresetId`、legacy openai/anthropic bridge、enabled provider selection；`resolveDjModel` 支持 Anthropic 与 OpenAI-compatible `baseURL`，仍注入 `getAppFetch()`。补 preset selection 测试；`make check` 通过（47 files / 343 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6a：新增 `dj-chat-tokens.ts` 与 `dj-chat-context-budget.ts`，提供保守 token 估算、ok/warn/block budget gate、压缩起点计算（保留最新 user turn，不静默截断）。补纯函数测试；`make check` 通过（48 files / 346 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6b：新增 session-scoped queued prompt runtime 核心（`queuedPromptsJson` parse/enqueue/reorder/remove、runtime meta 计数、actor rebuild 不自动派发、手动派发后移除、interrupt 即发并打 `interruptionMarker`）。补仓库/actor 测试；`make check` 通过（48 files / 349 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 3b：补 `dj_propose_briefs` 非花钱提案工具，复用 `trackBriefSchema` 校验并返回 proposal id + `describeBrief` summaries；无审批、零 DB 写入，确认后再走 `dj_generate_tracks`。补工具测试；`make check` 通过（48 files / 350 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 4b：补多 session runtime actor 隔离测试，覆盖两个 session 并发发送时各自 transport、assistant preview、Dexie `messagesJson` 独立持久化；`make check` 通过（48 files / 351 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6c：补 `contextStartIndex` repository/actor 持久化，actor 用 `nextContextStartIndex` 保留最新 user turn 作为安全起点；runtime meta 暴露压缩指针，重建后旧消息仍完整可见。补 fake-indexeddb/runtime 测试；`make check` 通过（48 files / 353 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6d：补 `ChatComposer` 键盘矩阵，idle Enter 发送，running+draft Enter 入队，Cmd/Ctrl+Enter interrupt，Shift+Enter 保留换行；`ChatPanel` 接 runtime `queuePrompt`/`interruptWithMessage`。补组件测试；`make check` 通过（51 files / 365 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6e：`DjChatRuntimeActor.sendQueuedPrompt` 在 pending tool approval 时暂停派发，保留 queued prompt、返回 false、不触发 transport；补 runtime 测试；`make check` 通过（51 files / 366 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 4c：`saveChatSessionSnapshot` 在默认标题 session 首次持久化 user 消息时派生自动标题，不覆盖手工命名；补 repository/runtime 持久化竞态测试；`make check` 通过（51 files / 368 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 4d：补 runtime 集成测覆盖两个 session 不同 model 配置下并发发送，一个进入 `dj_generate_tracks` 审批态、另一个 provider 报错，meta/history/pending approval/error 互不串；`make check` 通过（51 files / 369 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 5b：新增 `llmSelectionForChatSession`，chat transport 每次 send 按当前 session 的 provider/model 覆盖解析模型；补纯函数与 transport sessionId 测试；`make check` 通过（52 files / 372 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 3c：补 chat tools 核心集成测覆盖 proposal 零写入、`dj_generate_tracks` pending/set/play-next queue 写入、mock `DjEngine.materializeNext` 物化为 ready + media blob；`make check` 通过（52 files / 373 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6f：`DjChatRuntimeActor` 暴露 queued prompt reorder/delete 方法，复用 repository 持久化并更新 runtime meta，不触发 transport dispatch；补 runtime 测试（10 tests passed）。`make check` 在 typecheck 阶段被并行 untracked WIP `src/components/player/visualizer-mode-button.tsx` 阻塞（i18n key 类型错误），本提交 path-scoped 并需 `--no-verify`。 |
| 2026-06-07 | Codex | 推进 Phase 3d：`DjChatRuntimeActor.respondToToolApproval` 桥接 AI SDK `addToolApprovalResponse`，approval response 写入消息后自动续 tool loop；补 runtime 测试；`make check` 通过（52 files / 376 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 3e：新增无内置文案的 `ChatToolCollapsible` presentational 组件，labels 由调用方传入以便后续 i18n 接线；覆盖 approval actions、output、error 渲染；`make check` 通过（53 files / 378 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 3f：`ChatTurns` 在传入 labels 时渲染 tool collapsible，`ChatPanel` 透传 runtime approve/reject callbacks；补 opt-in 组件测试；`make check` 通过（52 files / 375 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6g：新增无内置文案的 `ChatQueueTray` 展示层，支持空态、DnD drop/可访问按钮重排、立即发送/删除回调与默认关闭的 auto-dispatch switch；补组件测试；`make check` 通过（53 files / 379 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6h：runtime snapshot 暴露 queued prompt 详情，`ChatPanel` 传入 `queueLabels` 时渲染 `ChatQueueTray` 并把 send/delete/reorder 回调转给 actor；补 panel/runtime 测试；`make check` 通过（54 files / 380 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 4e：新增无内置文案的 `ChatSessionHome` 展示层，支持 session 列表、标题/user 文本本地搜索、打开、重命名、删除回调；补组件测试；`make check` 通过（55 files / 382 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6i：新增无内置文案的 `ChatEmptyState` 展示层，preset chips 仅触发 insert 回调不发送，上传库/输入 vibe 引导动作只回调给上层；补组件测试；`make check` 通过（56 files / 384 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 6j：新增无内置文案的 `ChatContextBudgetNotice` 展示层，ok 默认隐藏，warn 用 `status`、block 用 `alert`，压缩动作只回调给上层；补组件测试；`make check` 通过（57 files / 387 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 5c：新增 Base UI `dialog` primitive（trigger/content/title/description/close），覆盖打开、a11y title/description、关闭与 `onOpenChange`；`make check` 通过（58 files / 389 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 5d：新增 Base UI `popover` primitive（trigger/content/title/description/close/positioner），覆盖打开、定位内容、关闭与 `onOpenChange`；`make check` 通过（59 files / 391 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 5e：新增 Base UI `scroll-area` primitive（root/viewport/content/scrollbar/thumb/corner），默认 keepMounted scrollbar 便于稳定布局与测试；`make check` 通过（60 files / 392 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 5f：新增无内置文案的 `Command` primitive（items/placeholder/empty 由调用方传入，支持 label+keywords 搜索过滤与 select 回调）；`make check` 通过（61 files / 395 tests）。 |
| 2026-06-07 | Codex | 推进 Phase 5g：新增无内置文案的 `ChatModelPicker` 展示层，基于 Popover+Command 展示 enabled presets/models，支持选中态、搜索过滤、空态与 `{presetId, model}` 选择回调；Settings/App/i18n/DB 接线继续等待并行 WIP 落地。`make check` 通过（62 files / 398 tests）。 |
| 2026-06-11 | Claude | **Phase 2 落地（CHAT-2a/b/c 三个原子 commit）**：① `dj-chat-availability.ts` 纯门控（9 测）；② `ChatMode` 改 icon/chip/expanded + persist v1 迁移（fab→icon、bar→chip、dock/fullscreen→expanded）、删旧四形态壳（launcher-fab/input-bar/dock/breakpoint hook）、reply-notification 改判定（8 测）；③ `dj-chat-entry.tsx` 三态入口挂 player-dock 工具行（memory/nav 左侧 flex-1、空白区 click-through）+ chip 发送自动建 session + expanded 内嵌 ChatPanel + Esc/backdrop 收回 + i18n `chat.*` ×4（8 组件测）。**两个 motion 陷阱记录在案**：跨 portal 共享 layoutId 死锁 projection（widget 改自身 spring）；AnimatePresence 内 fragment 包裹断 exit 追踪（改 keyed 直挂子元素）。preview(:1440) 实测全循环零 console 报错；spring 视觉在隐藏 tab 冻结属沙箱限制。 |
| 2026-06-11 | Claude | **Phase 2 外壳重新设计（owner 定）+ Phase 5 provider 扩展**。① 放弃 FAB / bar / Dock-1∕3 / 全屏四形态，改为**集成进 player-dock 上方工具行**的单一对话入口（落在记忆 + 切 tab icon **左侧**、`flex-1` 吃满剩余宽度），三态 **icon(minimize) → chip(normal，full-rounded 输入条，默认) → expanded(framer-motion `layoutId` morph 成 widget：桌面浮层卡片 / 移动全屏 sheet)**。② 新增**门控** `canUseDjChat`（`hasUsableLlm && hasUsableMusicgen`）：**未配 LLM + musicgen 时连 icon 都不渲染**（纯函数 + TDD）。③ §6.1 扩成**逐项复刻 ClipCombo 动态自定义 provider**（Dexie `llmCustomProviders` 表 + repo + `customLlmProviderConfigToPreset` + Settings provider 面板 enabled grid + `ApiKeyField` + `resolveDjModel` 的 openai-compatible/keyless-local 分支）。重写 §3.3/§5/§6.1 + Phase 2/5 plan + §2.4 结构；旧 `chat-launcher-fab`/`chat-input-bar`/`chat-dock`/`use-chat-breakpoint` 壳作废重做，runtime（`src/chat/*`）+ 展示层组件（composer/turns/session-home/model-picker/queue-tray/empty/notice）全部复用。Now Playing redesign 已并入 main → 本 phase 不再 WIP-blocked。 |

---

> **Note（版本锚）**：实现以 `ai@6` 当前文档为唯一真相源。若 `ToolLoopAgent` / `addToolApprovalResponse` / `sendAutomaticallyWhen` 等 API 名变更，更新本句所在锚点。ClipCombo 对应实现（`packages/clipcombo/src/lib/clip-chat-agent.ts`、`clip-subtitle-chat-runtime-registry.ts`、`components/editor/subtitle-chat/`）是可逐文件对照的成熟参考。
