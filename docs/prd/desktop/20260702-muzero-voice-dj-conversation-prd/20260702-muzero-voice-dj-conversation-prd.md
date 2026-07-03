# PRD: Conversational Voice DJ — Fish Audio TTS + Groq ASR + Push-to-Talk 语音对话

**Status:** Implemented（Phase 1–4 全部落地 2026-07-03，TDD；VAD 静音自动停 deferred。真机 mic/key/后台键为手测项）
**Created:** 2026-07-02
**Author:** DoodleBear
**Module:** 新增 `src/asr/`（ASR provider registry + Groq）· 新增 `src/tts/`（TTS provider registry + Fish Audio）· 新增 `src/voice/`（麦克风录制编排 + TTS 播放）· `src/chat/dj-chat-tools.ts`（新增 `dj_say` reply 工具）· `src/shortcuts/`（新增 `voice.talkToDj` 动作）· `src/components/settings/`（Text-to-Speech / Speech-to-Text 两个面板）· `src/stores/notification-store.ts`（DJ reply 消费者，复用不改）· `electron/global-shortcuts.cjs`（push-to-talk 全局键，复用）

> **一句话**：让用户按一个（可自定义的）全局快捷键对着 MUZERO 说话——Groq 把语音转成文字，喂给**已经存在的**工具调用式 AI DJ（`DjChatRuntimeActor` + `createDjChatTools`），DJ 一边切歌/搜歌/生成，一边通过新增的 `dj_say` 工具在**左上角通知栈**回你一句话，若开启「自动朗读」且配置了 Fish Audio TTS，就把这句话念出来。
>
> 参考实现：anysoul（`D:\code\project\anysoul`）的 `packages/web/src/lib/tts/fish-audio-tts.ts`、`hooks/use-voice-models.ts`、`lib/voice/groq-client.ts`、`hooks/use-groq-transcribe.ts`、`hooks/use-voice-input.ts`、`stores/voice-config.ts`。**关键差异**：anysoul 走服务端代理（它有后端），MUZERO 无后端，所有 Fish Audio / Groq 调用**直连**并走 [`getAppFetch()`](../../../../src/lib/platform.ts) 绕 CORS（规则 5/10）。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | ASR 基础设施：`src/asr` provider registry + Groq + 麦克风录制编排 + Settings「Speech-to-Text」面板 | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | TTS 基础设施：`src/tts` provider registry + Fish Audio + 音色拉取/搜索/添加 + Settings「Text-to-Speech」面板 + 试听播放 | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 语音对话闭环：`voice.talkToDj`（默认 hold/不绑定）→ ASR → **当前活跃**会话 `DjChatRuntimeActor` + **动态滑动窗口** → `dj_say` reply 工具 → 左上角通知 + 自动朗读（渐变 ducking）+ 付费确认 | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 平台 QA / 权限边界 / i18n×4 校对 / VAD 静音自动停 (可选增强) | ✅ Completed（VAD deferred） | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Round-2 优化：DJ 工具活动展示打磨（dock 活动气泡 per-tool 图标 + query 明细，**不在顶部重复**） | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |
| 6 | Round-2 优化：播放淡入淡出 / crossfade（`crossfadeEnabled` 默认开；切歌 + 暂停/恢复淡变） | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |
| 7 | Round-2 优化：Composer 录音按钮（快捷键之外手动点录音）+ tool-call 执行性能核查 | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |
| 8 | Round-3 优化：LLM-facing system prompt + 23 工具 description 按界面语言 i18n（英文 canonical + fallback） | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |
| 9 | Round-3 优化：DJ 策展纪律——用世界知识判断候选歌曲、避免一股脑塞歌单 | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |
| 10 | Round-3 修复（手测/E2E 反馈）：dj_say 有时把 `AgentWriteResult` JSON 当回话显示/朗读 + Fish 选中音色持久化（记入「用过的音色」列表，不用每次搜） | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |
| 11 | Round-3 优化：DJ 复用已有歌单——每回合注入已有歌单名列表 + prompt 引导，避免重复建（空）集 | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |
| 12 | Round-3 优化：歌单来源 UI 过滤（AI 创建 / human 创建 / 导入） | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |
| 13 | Round-3 E2E harness：控制端点读活跃会话 tool-call trace（观测 DJ 实际工具序列，找不合理设计） | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |
| 14 | Round-3 优化：基于 trace 观测优化不合理的 tool-call 设计（dj_say 刷屏去重 + 策展不脚踏两条船） | ✅ Completed | [§12 Follow-up](#12-follow-up-enhancementsround-2用户反馈) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **Phase 顺序（prd-create.md §3「基础设施先于覆盖广度」）**：ASR（输入）与 TTS（输出）是两块独立、各自可单测/可试听的基础设施；Phase 3 才把它们与「已经存在的工具调用式 DJ」接成闭环。这样 Phase 1/2 各自能独立 ship，Phase 3 的集成 PR 不必反复 rebase 等基础设施合并。

---

## 1. Overview

### 1.1 Background

MUZERO 已经有一个**工具调用式 AI DJ chat**（Vercel AI SDK `ToolLoopAgent`，见 [`src/chat/dj-chat-agent.ts`](../../../../src/chat/dj-chat-agent.ts) + [`src/chat/dj-chat-tools.ts`](../../../../src/chat/dj-chat-tools.ts)）：它能 `library_search` / `play_track` / `set_switch` / `queue_add` / `dj_generate_tracks` / `online_search_tracks` …，通过 [`DjChatRuntimeActor.sendMessage(text)`](../../../../src/chat/dj-chat-runtime-actor.ts) 接收一段**文本**请求就能编排整套动作。目前唯一的输入方式是**打字**。

产品要新增一种**输入方式：说话**。目标场景——

> 我在写代码 / 打游戏 / 做饭，MUZERO 在后台放歌。我按一下全局快捷键，说「放点更 chill 的，别要有人声的」，DJ 就帮我切歌 / 续歌单，并在左上角回我一句「好，切到 lofi 器乐，这几首都没人声」，如果我开了自动朗读，它还会把这句话念出来。

拆成三块能力，其中前两块是可独立复用的基础设施：

1. **TTS（文字转语音）** — 接入 **Fish Audio**（BYOK）。输入 API key 后能**拉取该 key 拥有的音色**（`self_only=true`）、**按名字搜索**、**粘贴 model id 添加其它公开音色**、试听。
2. **ASR / STT（语音转文字）** — 接入 **Groq** Whisper（BYOK，`whisper-large-v3-turbo`）。麦克风录音 → 转写文本。
3. **语音对话闭环** — 全局快捷键触发录音 → ASR → 喂给现有 DJ chat runtime → DJ 用新增的 `dj_say` 工具在左上角通知回话（可选朗读）。

### 1.2 为什么现在做 / 现有可复用的地基

这个功能能「小」，是因为它**几乎全部踩在已建好的地基上**（prd-create.md「保持简单：聚焦核心需求，利用已有代码」）：

| 已存在的能力 | 位置 | 本 PRD 如何复用 |
|---|---|---|
| 工具调用式 AI DJ（多步 tool loop、流式、审批、每回合刷新 now-playing） | [`dj-chat-agent.ts`](../../../../src/chat/dj-chat-agent.ts) / [`dj-chat-tools.ts`](../../../../src/chat/dj-chat-tools.ts) / [`dj-chat-runtime-actor.ts`](../../../../src/chat/dj-chat-runtime-actor.ts) | 语音转写后的文本直接喂 `actor.sendMessage()`；**只新增一个 `dj_say` reply 工具** |
| 左上角统一通知栈（`notify.info/loading/…` + `actions` + `progress`，持久/瞬时） | [`notification-store.ts`](../../../../src/stores/notification-store.ts) / [`notification-stack.tsx`](../../../../src/components/shell/notification-stack.tsx) | DJ 的 `dj_say` 回话 = `notify.info(text, { actions:[replay] })`，**零新增 UI 体系** |
| 系统全局快捷键（Electron `globalShortcut`、action 白名单、`runShortcutAction`、Settings 录制器、per-action 冲突/状态） | [`system-global.ts`](../../../../src/shortcuts/system-global.ts) / [`use-system-shortcuts.ts`](../../../../src/hooks/use-system-shortcuts.ts) / [`electron/global-shortcuts.cjs`](../../../../electron/global-shortcuts.cjs) | 新增一个 action id `voice.talkToDj`，其余复用 |
| 可插拔 provider registry 纪律（DI、纯映射函数、无散落分支） | [`src/musicgen/registry.ts`](../../../../src/musicgen/registry.ts) + [`cloud-provider.ts`](../../../../src/musicgen/cloud-provider.ts) + [`cloud-job.ts`](../../../../src/musicgen/cloud-job.ts) | ASR/TTS 各建一个 registry，镜像同一形状 |
| CORS-free 出站请求 | [`getAppFetch()`](../../../../src/lib/platform.ts) → [`resolveDesktopBridge()`](../../../../src/lib/desktop/bridge.ts) | Fish Audio / Groq 全走它 |
| BYOK 模型解析（已含 **Groq preset**：`api.groq.com/openai/v1`） | [`resolveDjModel`](../../../../src/ai/model.ts) / [`LLM_PROVIDER_PRESETS.groq`](../../../../src/ai/llm-providers.ts) | ASR 的 Groq key 默认可复用已配置的 `apiKeysByPresetId.groq` |
| 持久 `<video>`/`<audio>` 播放引擎（`setVolume` / `getAnalyser`） | [`media-engine.ts`](../../../../src/player/media-engine.ts) | 朗读时 duck 音乐音量，念完恢复 |

### 1.3 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地用户（owner，桌面）** | 手忙 / 不想切窗口，想「按一下、说一句、DJ 帮我切歌并回应」。可能已配置 DJ LLM。 | 全功能；BYOK 录入 Fish Audio / Groq key；自定义 push-to-talk 快捷键；开关自动朗读 |
| **无 TTS 的用户** | 只想语音**输入**（切歌），不需要 DJ 出声。 | 只配 Groq；DJ reply 走文字通知，不朗读 |
| **注重隐私 / 权限** | 不想 App 随便开麦、不想 key 外泄。 | 麦克风逐次授权；功能默认关；key 只在本地；无遥测 |

### 1.4 Core Value

1. **多一种、更快的 DJ 输入方式**：说话比打字快，尤其在 App 不在前台时（全局快捷键 + Electron 后台录音）。
2. **DJ 会「回话」**：不再是沉默切歌——`dj_say` 让它在左上角简短回应「切到什么、为什么」，可朗读，像真的有个 DJ。
3. **纯 BYOK、无后端、无遥测**：Fish Audio + Groq 都是用户自己的 key、只存本地、直连第三方（规则 1/2）。转写文本、回话文本、音频**永不上报**。
4. **踩现成地基**：复用工具 DJ、通知栈、全局快捷键、provider registry 纪律——新增代码集中在两个 provider + 一个录制/播放编排 + 一个 reply 工具 + 两个 Settings 面板。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                          ┌─────────────────────────── Phase 3：语音对话闭环 ───────────────────────────┐
                          │                                                                              │
 全局快捷键(Electron)      │   麦克风                     ASR provider                   现有 DJ runtime  │
 voice.talkToDj  ──────────▶  VoiceInputController  ──▶  resolveAsrProvider(settings)  ──▶  DjChatRuntimeActor
 (system-global.ts +      │   MediaRecorder            .transcribe(blob) → text          .sendMessage(text)
  runShortcutAction)      │   录音→blob                 (Groq Whisper, 直连)              │  (复用工具 loop：
                          │      ▲ 切换开/停                                              │   search/play/switch/
                          │      │                                                        │   generate/…)
                          │   录音状态 → 左上角 loading toast(可选)                        ▼
                          │                                                        ToolLoopAgent 多步执行
                          │   ┌──────────────────────────────────────────────────────────┤
                          │   │                                                            ▼
 左上角通知栈               │   │                                              新增工具 dj_say({text})
 notification-store  ◀─────┼───┘  notify.info(replyText, {actions:[replay]})  ◀────────────┤
 (复用，不改)               │                    │                                          │
                          │                    ▼ 若 djReplyAutoSpeak && isTtsReady        │
                          │            resolveTtsProvider(settings).synthesize(text)  ◀─────┘
                          │            (Fish Audio POST /v1/tts, 直连) → audio blob
                          │                    │
                          │                    ▼  TtsPlayback：单独 <audio> 播放；
                          │            MediaEngine.setVolume(duck) → 念完恢复
                          └──────────────────────────────────────────────────────────────┘

 Phase 1 (ASR infra):  src/asr/registry.ts + groq-provider.ts + src/voice/voice-input-controller.ts + Settings「Speech-to-Text」
 Phase 2 (TTS infra):  src/tts/registry.ts + fish-provider.ts + fish 音色列表/搜索/添加(TanStack Query) + Settings「Text-to-Speech」+ 试听

 出站 HTTP 一律 getAppFetch() → 桌面 bridge(muzfetch/tauri-http/web)  ；  keys 只存 AppSettings(IndexedDB)
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **TTS provider** | Fish Audio HTTP API（`GET /model` 列表/搜索、`GET /model/{id}` 取单个、`POST /v1/tts` 合成），BYOK `Authorization: Bearer` + `model` header（默认 `s2.1-pro-free` 免费） | 官方直连；`self_only=true` 天然满足「拉取 key 拥有的音色」，`title=` 满足「搜索」，`GET /model/{id}` 满足「添加其它音色」 |
| **ASR provider** | Groq Whisper（`POST https://api.groq.com/openai/v1/audio/transcriptions`，`multipart/form-data`，`model=whisper-large-v3-turbo`） | anysoul 已验证的直连路径；50ms/10s、准确、便宜（$0.04/h turbo）；MUZERO 已有 Groq LLM preset，key 可复用 |
| **出站 HTTP** | [`getAppFetch()`](../../../../src/lib/platform.ts) → Electron `muzfetch://` / Tauri http / web | 绕 CORS / mixed-content（规则 5/10）；**禁止**直接 `window.fetch` 调 Fish/Groq |
| **麦克风采集** | `navigator.mediaDevices.getUserMedia` + `MediaRecorder`（`audio/webm;codecs=opus` 优先，回退 ogg/mp4） | 浏览器原生；镜像 anysoul [`use-voice-input.ts`](file:///D:/code/project/anysoul/packages/web/src/hooks/use-voice-input.ts) 的 MIME 选择 + 时长 + 焦点丢失取消 |
| **provider 选择** | 新增 `src/asr/registry.ts`、`src/tts/registry.ts`，镜像 [`musicgen/registry.ts`](../../../../src/musicgen/registry.ts) 的 `resolveXxxProvider(settings)` | 一处裁决、DI、可单测；**不**在 UI/store 散落 `if (provider==="fish")`（规则 5） |
| **vendor 映射隔离** | Fish：`mapReplyToTtsBody` / `parseVoiceModel`；Groq：`buildTranscribeForm` / `parseTranscript` 纯函数 | 镜像 [`cloud-provider.ts`](../../../../src/musicgen/cloud-provider.ts) 三纯函数；换 vendor 只改这几个函数 |
| **DJ 接入** | 复用 [`DjChatRuntimeActor`](../../../../src/chat/dj-chat-runtime-actor.ts) `sendMessage` / `interruptWithMessage`（喂**当前活跃** chat 会话，继承上下文）；新增 `dj_say` 工具进 [`createDjChatTools`](../../../../src/chat/dj-chat-tools.ts) | 语音只是「另一个文本 producer」；工具 loop 完全复用；**不开专用会话**——顺着当前对话继续（PM 决策 §10 Q4） |
| **上下文管理** | 把现有 `contextStartIndex`（forward-only 起点 / compaction）改为**动态滑动窗口** `selectContextWindow(messages, budget)`（见 §3.4） | 连续语音对话 hands-free，不能像 compaction 那样涨到 `block` 就卡住要用户手动裁剪；滑窗自动只保留最近若干轮 token 预算内的消息 |
| **通知** | 复用 [`notify.info`](../../../../src/stores/notification-store.ts) + [`NotificationStack`](../../../../src/components/shell/notification-stack.tsx)（左上角） | `dj_say` 是唯一 producer；`actions` 挂「重播 / 展开到 chat」 |
| **全局快捷键** | 复用 [`SYSTEM_GLOBAL_SHORTCUT_ACTIONS`](../../../../src/shortcuts/system-global.ts) + [`electron/global-shortcuts.cjs`](../../../../electron/global-shortcuts.cjs) + [`runShortcutAction`](../../../../src/hooks/use-shortcut-dispatch.ts) | 新增一个 action id；**默认不绑定**（PM 决策 §10 Q7，最安全）；Electron 后台录音；Tauri/web 优雅降级（in-app 快捷键仍可用） |
| **朗读播放 / ducking** | 单独 `HTMLAudioElement`；朗读时用**渐变过渡**压低音乐音量（fade down `djVoiceDuckRampMs`≈200ms → 念完 fade up 恢复），优先 WebAudio `GainNode.linearRampToValueAtTime`，无 gain 图时退化为短 rAF/interval 分步逼近 [`MediaEngine.setVolume`](../../../../src/player/media-engine.ts) | 不占用音乐主元素；音量平滑不突兀（PM 决策 §10 Q3）；object-URL revoke-before-replace（规则 9） |
| **输入模式** | `voiceInputMode`（Settings 可选）**默认 `hold`**（按住说、松开转写），可切 `toggle` | PM 决策 §10 Q2 |
| **持久化** | [`AppSettings`](../../../../src/db/types.ts)（optional 字段，**不 bump DB version**，与 system-global-shortcuts PRD 同做法） | 本地优先；key/偏好都在 `settings` 行 |
| **测试** | Vitest + fake `MediaRecorder` / 注入 `now`/`fetch` | 纯映射 + 状态机 + reply 工具 posting 通知都可确定性单测（规则 7） |

### 2.3 Project Structure

```
src/
├── asr/                                  # 新增：ASR provider registry（镜像 musicgen）
│   ├── provider.ts                       #   AsrProvider 接口 { id; transcribe(input): Promise<AsrResult> }
│   ├── registry.ts                       #   resolveAsrProvider(settings) — 唯一裁决点
│   ├── groq-provider.ts                  #   Groq 实现（直连 getAppFetch）
│   ├── groq-mapping.ts                   #   纯函数：buildTranscribeForm / parseTranscript / classifyGroqError
│   └── *.test.ts
├── tts/                                  # 新增：TTS provider registry（镜像 musicgen）
│   ├── provider.ts                       #   TtsProvider 接口 { id; synthesize(input): Promise<TtsResult>; listVoices?; getVoice? }
│   ├── registry.ts                       #   resolveTtsProvider(settings) — 唯一裁决点
│   ├── fish-provider.ts                  #   Fish Audio 实现（列表/取单/合成，直连 getAppFetch）
│   ├── fish-mapping.ts                   #   纯函数：mapReplyToTtsBody / parseVoiceModel / parseVoiceModelList
│   └── *.test.ts
├── voice/                                # 新增：麦克风采集 + 朗读播放编排（模块作用域单例，不进 store）
│   ├── voice-input-controller.ts         #   录音状态机：start/stop/cancel → blob → ASR → onTranscript
│   ├── voice-input-controller.test.ts    #   注入 fake MediaRecorder + fake ASR，确定性
│   ├── tts-playback.ts                   #   reply 朗读队列 + 音乐 ducking + object-URL 生命周期
│   └── tts-playback.test.ts
├── chat/
│   ├── dj-chat-tools.ts                  # 改：新增 dj_say 工具（always-on）；executeDjSay 纯逻辑
│   ├── dj-chat-prompt.ts                 # 改：系统提示补「语音场景：动作后用 dj_say 简短回应」
│   ├── dj-chat-context-budget.ts         # 改：新增 selectContextWindow()（动态滑动窗口，替代 forward-only contextStartIndex/compaction）
│   ├── dj-chat-agent.ts                  # 改：sendMessages 发送前套滑动窗口
│   └── dj-chat-tools.test.ts             # 改：dj_say 单测（posting 到注入的 notify sink）
├── shortcuts/
│   ├── registry.ts                       # 改：新增 in-app action def "voice.talkToDj"
│   └── system-global.ts                  # 改：把 "voice.talkToDj" 加进 SYSTEM_GLOBAL_SHORTCUT_ACTIONS
├── hooks/
│   ├── use-shortcut-dispatch.ts          # 改：runShortcutAction 里 "voice.talkToDj" → voiceInputController.toggle()
│   └── use-voice-dj.ts                   # 新增：wiring hook（controller ↔ DjChatRuntimeActor ↔ notify ↔ tts）
├── components/settings/
│   ├── settings-nav.ts                   # 改：在 settings.navSecAi 下加 voice-tts / voice-asr 两项
│   ├── voice-tts-settings.tsx            # 新增：Fish Audio key + 音色列表/搜索/添加/试听 + 自动朗读开关 + ducking
│   └── voice-asr-settings.tsx            # 新增：Groq key + 模型 + 语言 + push-to-talk 模式 + 麦克风测试
├── db/
│   └── types.ts                          # 改：AppSettings 增加 voice / tts / asr optional 字段
├── stores/
│   └── notification-store.ts             # 不改（dj_say 复用 notify.info）
└── i18n/locales/{en,zh,ja,ko}/common.json # 改：settings.voice.* / voice.* 文案（en 源 + zh/ja/ko）

electron/
├── global-shortcuts.cjs                  # 不改逻辑（新 action id 自动生效）；仅确认后台窗口能录音
├── main.cjs / preload.cjs                # 不改（bridge 已到位）
```

> **净新增文件的理由（prd-create.md「Exception Policy」）**：`src/asr`、`src/tts`、`src/voice` 是与 DJ/播放器不同的 runtime 边界（第三方 vendor bridge + 麦克风/音频编排），与 `src/musicgen`、`src/visualizer` 同纪律——新 vendor bridge / provider 源允许新建；registry/adapter 只 append。Settings 面板镜像已有 [`llm-provider-settings.tsx`](../../../../src/components/settings/llm-provider-settings.tsx)。**不**新建 store、**不**新建通知/快捷键体系。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
AppSettings（已有单行，扩 optional 字段——不 bump DB version）
  ├─ tts（文字转语音）
  │   ├─ (无独立母开关)                    ★TTS「就绪」= 有 key + 选中音色；朗读由单一 djReplyAutoSpeak 开关驱动（合并原 ttsEnabled，见 changelog 2026-07-03）
  │   ├─ ttsProvider?: TtsProviderId     "fish-audio"（union，未来可扩）
  │   ├─ fishAudioApiKey?: string        BYOK；只存本地；show/hide；永不入 bundle/log
  │   ├─ ttsVoiceId?: string             选中的 Fish model id（reference_id）
  │   ├─ ttsModel?: FishTtsBackend      "s2.1-pro-free"(默认) | "s2.1-pro" | "s2-pro" | "s1"（TTS `model` header）
  │   ├─ ttsSpeed?: number               prosody.speed 0.5–2.0，默认 1
  │   ├─ ttsFormat?: "mp3" | "opus"      默认 mp3（解码兼容最好）
  │   └─ ttsAddedVoiceIds?: string[]     手动粘贴添加的公开 model id（镜像 anysoul publicModelIds）
  ├─ asr（语音转文字）
  │   ├─ asrEnabled?: boolean            默认 false
  │   ├─ asrProvider?: AsrProviderId     "groq"（union，未来可扩）
  │   ├─ groqApiKey?: string             BYOK；缺省时回退已配置的 apiKeysByPresetId.groq
  │   ├─ asrModel?: GroqWhisperModel     "whisper-large-v3-turbo"(默认) | "whisper-large-v3"
  │   ├─ asrLanguage?: string            ISO-639-1 或 "auto"（默认 auto）
  │   └─ asrInputDeviceId?: string       麦克风设备（可选）
  └─ voice（语音对话闭环）
      ├─ voiceInputMode?: "hold" | "toggle"   ★默认 "hold"（按住说、松开转写）；toggle=按一下开/再按停。Settings 可选（PM Q2）
      ├─ voiceSilenceAutoStopMs?: number      静音自动停阈值（Phase 4 VAD；默认关=0）
      ├─ djReplyAutoSpeak?: boolean           默认 false；开启且 tts 就绪才朗读
      ├─ djVoiceDuckMusic?: boolean           朗读时压低音乐；默认 true
      ├─ djVoiceDuckVolume?: number           duck 目标音量 0–1，默认 0.25
      ├─ djVoiceDuckRampMs?: number           ★渐变过渡时长，默认 200（fade down/up，非瞬切）（PM Q3）
      ├─ voiceAutoApproveGenerate?: boolean   默认 false；语音里付费生成是否免确认（显式、可见，非 hidden flag）（PM Q5=要确认）
      └─ (无专用会话字段)                       ★语音喂【当前活跃】DJ chat 会话，继承上下文（PM Q4）；无 voiceChatSessionId

// 上下文预算（改造 dj-chat-context-budget.ts，见 §3.4）：
chatContextWindowTokens?: number    // 滑动窗口 token 预算，默认取 DEFAULT_CHAT_CONTEXT_BUDGET.maxTokens 的一个安全比例

// 全局快捷键沿用现有模型（system-global-shortcuts PRD）：
AppSettings.systemShortcutBindings["voice.talkToDj"]?: SystemShortcutBinding  // { enabled; gesture? }；★默认不绑定（PM Q7）
AppSettings.shortcutOverrides["voice.talkToDj"]?: ScopedShortcutBinding[]      // in-app 兜底绑定
```

> **codename 稳定（规则 4）**：provider id `"fish-audio"` / `"groq"`、`ttsVoiceId`(=Fish reference_id)、字段名跨品牌 pivot 不变。

### 3.2 Database Schema

- **Current Schema:** [`src/db/types.ts`](../../../../src/db/types.ts) `AppSettings`（单例 `id:"app"` 行）+ 仓库 [`getSettings`/`updateSettings`](../../../../src/db/repositories.ts) + 响应式读 [`useAppSettings`](../../../../src/hooks/use-app-data.ts)。
- **Required Changes:** 仅**新增 optional 字段**（§3.1）。写入走既有 `updateSettings(partial)`，读走 `useAppSettings()`。
- **Data Migration:** **不需要 bump DB version**——全是 optional、默认值在读取点用 `??` 兜底（与 [`20260613-muzero-system-global-shortcuts-prd`](../../20260613-muzero-system-global-shortcuts-prd/20260613-muzero-system-global-shortcuts-prd.md) §3.2 相同做法）。旧版本忽略未知字段。
- **Cached voice models（可选）**：为避免每次进 Settings 都网络拉，Fish 音色可像 anysoul 一样把「已添加公开音色」的精简信息缓存进 `ttsAddedVoiceCache?: CachedVoiceModel[]`（id/title/coverImage/samples）。owned 列表用 TanStack Query `staleTime` 内存缓存即可，不落库。
- **Privacy & Retention:** key = 敏感，只存本地、show/hide、不写 log/bundle/URL（规则 2）。**不存**任何转写文本 / reply 文本 / 音频 blob 到库（语音是瞬时的；DJ chat 消息本身按现有 chat 会话持久化机制走，属既有行为）。
- **Rollback:** `git revert` + 重新发版；无 runtime kill switch（规则 3/8）。

### 3.3 Data Relationship Diagram

```
按键(voice.talkToDj) ──▶ VoiceInputController ──(blob)──▶ AsrProvider.transcribe ──(text)──▶ DjChatRuntimeActor.sendMessage
                                                                                                        │
                                          ToolLoopAgent 多步(现有工具 + 新 dj_say) ◀──────────────────────┘
                                                                                                        │
                                                              dj_say({text}) ──▶ notify.info(text)  ─────┤ 左上角
                                                                                     │                   │
                                                          (djReplyAutoSpeak && ttsReady?) ──▶ TtsProvider.synthesize
                                                                                     │                   │
                                                                          TtsPlayback（<audio> + duck）───┘
```

### 3.4 Chat 上下文：动态滑动窗口（替代 compaction）— PM Q4

语音是**连续、hands-free** 的对话：用户会一句接一句地顺着上文说（「再 chill 一点」「这首留着」「换成有女声的」），且喂的是**当前活跃会话**（不开专用会话，继承上下文）。现有上下文机制不适配这个场景：

- **现状**：[`dj-chat-context-budget.ts`](../../../../src/chat/dj-chat-context-budget.ts) 的 `contextStartIndex` 是一个**只前进的起点指针**（`nextContextStartIndex`：早于它的消息被排除，且只会往后推、clamp 到最近一条 user 消息），配合 `evaluateChatContextBudget` 只做 **ok/warn/block** 报告（对 128k 上限），**不自动裁剪**。会话涨到 `block` 就需要用户/UI 介入手动裁——打字场景可接受，语音场景会**卡住**（没有 UI 让用户手动 compact）。

- **目标**：改为**动态滑动窗口**——每回合发送前，自动只保留「最近的、token 预算内的」一段消息，随对话增长**丢弃最旧的整轮**，永远不 block、不需人工介入。

```ts
// dj-chat-context-budget.ts 新增（纯函数，可穷举单测）
export function selectContextWindow(
  messages: readonly DjChatUIMessage[],
  opts: { maxTokens: number },
): DjChatUIMessage[];
//  规则：
//  1) 从最新往回累加 estimateChatTokens，保留不超过 maxTokens 的后缀。
//  2) 一定包含最新的 user 轮（当前这句话）。
//  3) 只在【整轮/回合边界】切，绝不拆开 assistant tool-call 与其 tool-result
//     （Vercel AI SDK 要求二者成对，否则报错）——沿用 isToolUIPart 判定成对边界。
//  4) 系统提示 DJ_CHAT_SYSTEM_PROMPT + 每回合的 now-playing 快照（buildNowPlayingContext）
//     由 createDjChatTransport 单独拼、始终保留，不进滑窗计数。
```

- **接入点**：在 [`createDjChatTransport.sendMessages`](../../../../src/chat/dj-chat-agent.ts)（或 actor 发送前）对 `options.messages` 套 `selectContextWindow`。`contextStartIndex` 保留为**用户手动的下限**（「从这里开始新话题」仍可用），滑窗在其之上再自动收敛——两者兼容：`effectiveStart = max(userContextStartIndex, slidingWindowStart)`。
- **影响面**：这是共享 chat 行为的改动（打字 chat 同样受益：不再撞 block）。因此放在 Phase 3 的独立任务组，单独单测 + 回归既有 chat 测试。
- **不引入摘要式 compaction**（把旧消息 LLM 总结成一段）——那是更重的独立特性，本期用「丢弃最旧整轮」的滑窗即可（prd-create.md「保持简单」）。若日后要摘要式记忆，另开 PRD。

---

## 4. API Design

> 无 MUZERO 后端。下面是**第三方 API 契约**（Fish Audio / Groq，均直连 `getAppFetch()`）与**内部 provider 接口**。

### 4.1 第三方 API — Fish Audio (TTS)

认证：`Authorization: Bearer <fishAudioApiKey>`。所有请求走 `getAppFetch()`。

| 用途 | Endpoint | 说明 |
|---|---|---|
| **列出音色（拥有的 + 搜索）** | `GET https://api.fish.audio/model` | query：`self_only=true`（key 拥有的）、`title=<搜索词>`、`page_size`、`page_number`、`sort_by`（`task_count`\|`created_at`）、`language`。响应 `PaginatedResponse<ModelEntity>`（`items[]` + `total`） |
| **取单个音色（添加公开音色）** | `GET https://api.fish.audio/model/{model_id}` | 用户粘贴 model id → 拉全量信息缓存进 `ttsAddedVoiceCache` |
| **合成（朗读 reply）** | `POST https://api.fish.audio/v1/tts` | header 额外带 `model: s2.1-pro-free`（默认，免费）/ `s2.1-pro` / `s2-pro` / `s1`；body 见下；响应是**流式音频字节**（`Transfer-Encoding: chunked`） |

**`ModelEntity`（音色，映射到内部 `VoiceModel`）**：`_id`/`id`、`title`、`description`、`cover_image`、`state`、`tags[]`、`languages[]`、`samples[]`（含 `audio` 试听 url、`text`）、`visibility`、`author`、`like_count`、`created_at`。→ 由纯函数 `parseVoiceModel` 归一。

**TTS 请求体（`mapReplyToTtsBody`）**：
```jsonc
{
  "text": "好，切到 lofi 器乐，这几首都没人声。",
  "reference_id": "<ttsVoiceId>",       // 选中音色
  "format": "mp3",                       // ttsFormat（mp3 解码最稳）
  "mp3_bitrate": 128,
  "chunk_length": 300,
  "normalize": true,
  "latency": "normal",
  "prosody": { "speed": 1.0, "volume": 0 }, // ttsSpeed
  "temperature": 0.7,
  "top_p": 0.7
}
```
> 与 anysoul `fish-audio-tts.ts` 的差异：**不经服务端代理**，直接 `appFetch("https://api.fish.audio/v1/tts", …)`；返回字节用一个共享 `AudioContext` 解码（或直接喂 `<audio>` 的 object-URL，见 §5.2 播放）。

### 4.2 第三方 API — Groq (ASR/STT)

`POST https://api.groq.com/openai/v1/audio/transcriptions`，`multipart/form-data`，`Authorization: Bearer <groqApiKey>`（走 `getAppFetch()`）。

**表单（`buildTranscribeForm`，纯函数）**：`file`（录音 blob，扩展名由 MIME 推断：webm/ogg/mp4/mp3/wav）、`model`（`asrModel`）、`response_format=json`、`temperature=0`、`language`（`asrLanguage!=="auto"` 时才带）。
**响应**：`{ text }`；速率信息在 header（`x-ratelimit-remaining-audio-seconds` / `-requests`）→ 由 `parseTranscript` 提取。
**限制**：free tier 25 MB / 请求（远超一次语音指令）；自动降采到 16kHz mono；错误分类 `classifyGroqError`（401=key 无效、429=限流、其它）。

### 4.3 内部 provider 接口（镜像 [`MusicGenProvider`](../../../../src/musicgen/provider.ts)）

```ts
// src/asr/provider.ts
export interface AsrTranscribeInput { blob: Blob; language?: string; signal?: AbortSignal }
export interface AsrResult { text: string; remainingAudioSeconds?: number; remainingRequests?: number }
export interface AsrProvider {
  readonly id: AsrProviderId;             // "groq"
  transcribe(input: AsrTranscribeInput): Promise<AsrResult>;
}
// src/asr/registry.ts
export type AsrProviderId = "groq";
export function resolveAsrProvider(settings: AppSettings): AsrProvider | null; // 未配置 key → null（唯一裁决点）
export function isAsrConfigured(settings: AppSettings): boolean;

// src/tts/provider.ts
export interface TtsSynthesizeInput { text: string; voiceId: string; speed?: number; signal?: AbortSignal }
export interface TtsResult { blob: Blob; mime: string }
export interface VoiceModel { id: string; title: string; description?: string; coverImage?: string;
  samples: Array<{ audio: string; text?: string }>; tags: string[]; languages: string[] }
export interface TtsProvider {
  readonly id: TtsProviderId;             // "fish-audio"
  synthesize(input: TtsSynthesizeInput): Promise<TtsResult>;
  listVoices(opts: { query?: string; ownedOnly?: boolean; signal?: AbortSignal }): Promise<VoiceModel[]>;
  getVoice(id: string): Promise<VoiceModel | null>;
}
// src/tts/registry.ts
export type TtsProviderId = "fish-audio";
export function resolveTtsProvider(settings: AppSettings): TtsProvider | null;
export function isTtsReady(settings: AppSettings): boolean; // key && voiceId（无独立母开关）
```

### 4.4 新增 DJ 工具 — `dj_say`（reply）

在 [`createDjChatTools`](../../../../src/chat/dj-chat-tools.ts) 里**始终注册**（不 gate），紧跟现有 `tool({...})` 形状：

```ts
dj_say: tool({
  description:
    "Speak a SHORT, natural reply to the listener (one or two sentences) — what you did or are about to do, in the DJ's voice. Call this whenever you act on a spoken/voice request so the user gets a visible + optionally spoken response. Do NOT narrate tool mechanics or ids; keep it conversational.",
  inputSchema: z.object({
    text: z.string().min(1).max(400),
    /** Optional mood tag for future voice/tone selection; ignored for now. */
    tone: z.enum(["neutral", "hype", "chill", "apologetic"]).optional(),
  }),
  execute: (input) => executeDjSay(input, { notify: deps.notify /* injectable sink */ }),
}),
```
`executeDjSay` 是纯逻辑：把 `{ text }` 交给注入的 `notify` sink（默认 `notify.info`），返回 `{ status:"ok", commandId:"muzero.dj.say", summary:"Replied to the listener." }`（`AgentWriteResult` 形状，和其它工具一致）。**朗读不在工具里做**——工具只产出 reply 事件；朗读由 wiring hook（`use-voice-dj.ts`）监听 reply 事件后按设置决定（保持工具纯、可单测、UI 无关）。

> **为什么用工具而不是直接拿 assistant 文本？**（PM 已定 §10 Q1：用 `dj_say`）assistant 的流式文本常夹杂推理/工具叙述，不适合直接念；`dj_say` 给一句**面向听众、可朗读、简短**的话，且是通知 + 朗读的**唯一、确定的触发点**，还能中途触发（先「稍等，找一下你的库…」再动作）。**兜底**：若某回合模型没调用 `dj_say`，wiring 用 `runtime.meta.lastAssistantPreview`（[已存在](../../../../src/chat/dj-chat-runtime-actor.ts)）作为 reply 文本，保证总有回应。

### 4.5 内部编排接口

| Symbol | 签名 | 说明 |
|---|---|---|
| `VoiceInputController.toggle()` | `(): Promise<void>` | push-to-talk 主入口：idle→录音；录音→停并转写。`hold` 模式下 down=start / up=stop |
| `VoiceInputController.start()/stop()/cancel()` | `(): Promise<...>` | 状态机；`onTranscript(text)` / `onError(err)` / `onStateChange(state)` 回调 |
| `resolveAsrProvider(settings)` | `→ AsrProvider \| null` | Phase 1 |
| `resolveTtsProvider(settings)` | `→ TtsProvider \| null` | Phase 2 |
| `runShortcutAction("voice.talkToDj", ctx)` | 复用 | 调 `voiceInputController.toggle()` |
| `getActiveDjChatRuntime()` | `→ DjChatRuntimeActor` | 取**当前活跃** chat 会话的 actor（继承上下文，顺着上文继续，PM Q4）；无活跃会话时懒建一个普通会话。复用 [`dj-chat-runtime-registry.ts`](../../../../src/chat/dj-chat-runtime-registry.ts) |
| `selectContextWindow(messages, {maxTokens})` | `→ DjChatUIMessage[]` | 动态滑动窗口（§3.4），发送前套用 |
| `speakReply(text, settings)` | `(): Promise<void>` | `tts-playback.ts`：合成 + duck + 队列 + revoke |

### 4.6 Error Handling

- **无麦克风权限 / `NotAllowedError`**：`notify.error(t("voice.asr.micDenied"))` + 引导到系统权限；不反复弹。
- **ASR 失败**（401/429/网络）：`classifyGroqError` → 明确文案（key 无效 / 限流稍后再试 / 网络）。转写空（太短 <~0.5s / <1KB）→ 静默丢弃（镜像 anysoul）。
- **TTS 失败**：`notify.warning(t("voice.tts.synthFailed"))`——**降级为纯文字通知**，绝不因为念不出来就吞掉 DJ 的动作/回应。
- **DJ 付费生成审批**：语音是 hands-free，`dj_generate_tracks` 仍 `needsApproval:true`。默认：DJ 先 `dj_say` 口头确认，并把审批做成通知的 **Approve/Deny 动作按钮**（`actions` → `actor.respondToToolApproval(id, approved)`）。用户显式开 `voiceAutoApproveGenerate` 才免确认（可见开关，非 hidden flag）。
- **快捷键并发**：录音中再次触发 = 停止并转写（toggle）；多次快速触发去抖。App 前台时 in-app 与 system-global 不重复触发（沿用 system-global PRD 的去重）。
- **Abort**：切换/取消传 `AbortSignal` 给 `transcribe`/`synthesize`（镜像 cloud-job abort）。
- **Telemetry & Logging（白名单）**：只经 [`createDiagnosticLogger("voice")`](../../../../src/lib/logger.ts) 记 `provider` / 阶段 / 耗时 / blob 字节数 / 错误类型；**永不**记转写文本、reply 文本、音频字节、key、音色 id（对齐 prd-create.md §3 telemetry 白名单 + 规则 2/8）。

---

## 5. Frontend Design

### 5.1 Page Structure

无新增页面。变化在：
1. **Settings**：[`SETTINGS_NAV`](../../../../src/components/settings/settings-nav.ts) 的 `settings.navSecAi` 分组下加两项 —— `voice-tts`（Text-to-Speech，icon `volume-2`）、`voice-asr`（Speech-to-Text，icon `mic`）。渲染 `voice-tts-settings.tsx` / `voice-asr-settings.tsx`（镜像 [`llm-provider-settings.tsx`](../../../../src/components/settings/llm-provider-settings.tsx) 的 key 表单 + Save/Test/Clear）。
2. **Settings → Keyboard Shortcuts**：`voice.talkToDj` 自动出现在 in-app 列表 + System Global 列表（复用现有录制器/冲突校验）。
3. **全局浮层**：左上角 [`NotificationStack`](../../../../src/components/shell/notification-stack.tsx) 显示 DJ 的 `dj_say` 回话（+ 录音时可选一条 loading toast「Listening…」）。

### 5.2 UI Components

- **`voice-asr-settings.tsx`（Phase 1）**：
  - Groq API key（show/hide，占位提示；默认值：若 `apiKeysByPresetId.groq` 已配置，显示「复用已配置的 Groq key」开关）；Save / Test（用一小段静音或 `GET models` 校验 key）/ Clear。
  - 模型下拉（turbo / large-v3）、语言下拉（Auto + 常用 ISO）、麦克风设备选择、`asrEnabled` 开关。
  - **麦克风测试**：一个「按住说话 → 显示转写」的小测试块（复用 `VoiceInputController`）。
  - push-to-talk 模式（**默认 hold** / toggle）单选 + 「去 Keyboard Shortcuts 绑定 `voice.talkToDj`」跳转（**默认未绑定**，须用户显式绑定；未绑定时此处提示）。
- **`voice-tts-settings.tsx`（Phase 2）**（结构镜像 anysoul `VoiceProviderTab` + `VoiceModelListTab`，但**直连**）：
  - Fish Audio API key（show/hide）+ Save/Test/Clear（Test = `GET /model?self_only=true&page_size=1`）。
  - **My Voices**：TanStack Query 拉 `self_only=true`，卡片显示 title + id + 试听（`samples[0].audio` 用临时 `<audio>` 播放，镜像 anysoul `VoiceModelCard`）；顶部**搜索框**（`title=` query，防抖）。
  - **Add a voice**：粘贴一个/多个 model id（逗号/空格/换行分隔）→ `getVoice(id)` 解析 → 存 `ttsAddedVoiceIds` + 缓存；可移除。
  - **选中音色** = `ttsVoiceId`（radio / 高亮）；「Preview reply」用当前音色合成一句示例并播放。
  - `djReplyAutoSpeak`（单一开关：开=DJ 出声，无独立母开关）、`ttsModel`(s2.1-pro-free 默认 / s2.1-pro / s2-pro / s1)、`ttsSpeed`(slider)、`djVoiceDuckMusic` + `djVoiceDuckVolume`(slider) + `djVoiceDuckRampMs`(渐变时长，默认 200ms)。
- **DJ reply 通知**：`notify.info(replyText, { duration: 8000, dismissible: true, actions: [{ label: t("voice.reply.replay"), onClick: replay, keepOpen: true }, { label: t("voice.reply.open"), onClick: openDjChat }] })`。朗读中可用 `notify.loading` 起手、念完 `update` 成 info（可选）。
- **录音指示**：录音时左上角一条 `notify.loading(t("voice.listening"))`（阈值门控，避免瞬时闪现），停止即 dismiss——沿用 [`20260622-unified-background-progress-notification`](../20260622-muzero-unified-background-progress-notification-prd/20260622-muzero-unified-background-progress-notification-prd.md) 的 indicator 模式。可选：Now Playing / dock 一个微弱的「mic 脉冲」发光。

### 5.3 State Management

- **录音/播放编排是模块作用域单例**（`VoiceInputController`、`TtsPlayback`），**不进 Zustand state**——与 `AudioEngine`、liveQuery 订阅、`DjEngine`、各 indicator 同纪律（规则 6）。UI 用一个极小的订阅（`onStateChange` → local state）显示录音态，避免整树重渲染。
- **provider 无状态**：`resolveAsrProvider/resolveTtsProvider` 每次从 `settings` 解析（或按 key 记忆化），不塞 store。
- **音色列表用 TanStack Query**（provider 健康/远端列表，正是 TanStack Query 的用途），不塞 Zustand（规则 6）。
- **设置读写**：`useAppSettings()` 响应式读 + `updateSettings()` 写。

---

## 6. Implementation Plan

### Phase 1: ASR 基础设施（Groq）+ 麦克风录制编排 + Settings 面板

**Goal:** 能在 Settings 里录一段话、看到转写文本——语音**输入**能力独立可用、可单测。

**Tasks:**
- [x] `AppSettings` 增加 asr / voice 相关 optional 字段（§3.1；`asrEnabled`/`asrProvider`/`groqApiKey`/`asrModel`/`asrLanguage`/`asrInputDeviceId`/`voiceInputMode` + `VoiceInputMode` 类型）；`saveSettings` 无需改；`useSettings` 直接可读。
- [x] `src/asr/provider.ts`（`AsrProvider` 接口 + `AsrError`/`AsrErrorKind`）+ `groq-mapping.ts`（`extensionFromMime` / `buildTranscribeForm` / `parseTranscript` / `classifyGroqError`，纯函数，穷举单测）+ `groq-provider.ts`（直连 `getAppFetch()`，注入 fetch 可测）+ `registry.ts`（`resolveAsrProvider` / `isAsrConfigured` / `resolveGroqApiKey` 复用 DJ Groq key）。
- [x] `src/voice/voice-input-controller.ts`：录音状态机（`idle→recording→transcribing→idle`，注入 `getMedia`/`createRecorder`/`pickMimeType`/`transcribe`/`onBlur`，MIME 选择 + `MIN_BLOB_BYTES` 丢弃过短 + 焦点丢失取消 + 并发去抖），`toggle/start/stop/cancel` + 回调；`voice-input-runtime.ts` 生产 wiring（真 `getUserMedia`/`MediaRecorder` + `transcribeWithSettings` + 全局单例）。
- [x] `src/components/settings/voice-asr-settings.tsx` + `SETTINGS_NAV`（`voice-asr`, icon `mic`）+ settings-page 渲染；Groq key 表单（show/hide + reuse 提示）+ 模型/语言/设备 + 麦克风测试块（hold-to-talk 真跑 controller）+ push-to-talk 模式单选 + 绑定提示。
- [x] i18n×4：`settings.navVoiceAsr` + `voice.asr.*`（en 源 → zh/ja/ko）。

### Phase 1 Checklist

- [x] Settings「Speech-to-Text」录一段话 → 显示转写文本（Groq turbo）。（麦克风测试块 hold-to-talk 跑真 `VoiceInputController`；真实转写需 key + 硬件，逻辑由注入-fake 测试覆盖。）
- [x] 无 key / key 无效 / 限流 / 无麦克风权限 → 各自明确文案（`voice.asr.notConfigured` / `errAuth` / `errRateLimit` / `micDenied`），不崩、不吞。
- [x] 太短录音（<~0.5s / <1KB）静默丢弃（`MIN_BLOB_BYTES`，单测覆盖）。
- [x] 单测：`extensionFromMime`/`buildTranscribeForm`（MIME→扩展名、language 省略逻辑）、`parseTranscript`（含 header 配额）、`classifyGroqError`（401/403/429/other）、`groq-provider`（bearer/表单/401/429/network/无 key）、`registry`（key 回退）、`voice-input-controller` 状态机（start→stop→transcript、too-short、cancel、焦点丢失取消、并发去抖、权限错误、转写失败、静音空文本）。共 32 测。
- [x] Groq 调用走 `getAppFetch()`（无直接 `window.fetch`）；无 `console.*`（走 `createDiagnosticLogger("voice.*")`，只记 provider/bytes/quota，不记文本/key）。
- [x] `make check` 通过（typecheck + biome + 3455 测试全绿）。

### Phase 2: TTS 基础设施（Fish Audio）+ 音色拉取/搜索/添加 + 试听

**Goal:** 输入 Fish key → 拉到自己的音色、能搜、能粘 id 添加、能选中并试听一句——语音**输出**能力独立可用。

**Tasks:**
- [x] `AppSettings` 增加 tts 相关 optional 字段（§3.1；`ttsEnabled`/`ttsProvider`/`fishAudioApiKey`/`ttsVoiceId`/`ttsModel`/`ttsSpeed`/`ttsFormat`/`ttsAddedVoiceIds`/`ttsAddedVoiceCache` + `djVoiceDuckMusic`/`djVoiceDuckVolume` + `CachedVoiceModel` 类型）。
- [x] `src/tts/provider.ts`（接口 + `TtsError`/`VoiceModel`）+ `fish-mapping.ts`（`mapReplyToTtsBody` / `parseVoiceModel` / `parseVoiceModelList` / `classifyFishError`，纯函数穷举单测）+ `fish-provider.ts`（`listVoices(self_only/title)`/`getVoice(404→null)`/`synthesize`，直连 `getAppFetch()`，`Authorization: Bearer` + `model` header，注入 fetch 可测）+ `registry.ts`（`resolveTtsProvider` / `isTtsReady`）。
- [x] `src/voice/tts-playback.ts`：注入式引擎——合成 → object-URL → sink 播放；reply 串行队列（synth→play 不重叠）；批级 duck（进队降、清空恢复）；revoke-before-replace（规则 9）；synth 失败降级不抛。`tts-playback-runtime.ts` 生产 wiring（`synthesizeReply` + `createAudioSink` 独立 `<audio>` + `createMediaEngineDucker` 写元素音量不覆盖持久 volume）。
- [x] `src/components/settings/voice-tts-settings.tsx` + `SETTINGS_NAV`（`voice-tts`, icon `volume-2`）+ settings-page 渲染 + sidebar 图标：key 表单 + My Voices（TanStack Query，`self_only=true`）+ 搜索框（`title=` 防抖）+ Add-by-id（缓存 `ttsAddedVoiceCache`）+ 样例试听 + 「Preview reply」合成试听 + 选中 + 后端/语速/ducking 控件。
- [x] i18n×4：`settings.navVoiceTts` + `voice.tts.*`（en 源 → zh/ja/ko）。

### Phase 2 Checklist

- [x] 输入有效 Fish key → 显示「My Voices」列表；搜索框按名字过滤（防抖 300ms）；空态/加载态友好（`needKey`/`loading`/`noVoices`）。
- [x] 粘贴一个/多个公开 model id → `getVoice` 解析并出现在「Added」，可移除（移除即清选中）；选中任一音色 → 「Preview reply」`synthesizeReply` 念出示例句。
- [x] TTS 失败 → 降级文字（`ttsErrorKey` 映射 auth/rate-limit/network/generic，不吞）；`ttsFormat=mp3` 默认（`<audio>`/解码最稳）。
- [x] 朗读时音乐音量被 duck、念完恢复；连续两条 reply 串行不重叠；object-URL 全部 revoke（无泄漏，单测断言 created===revoked）。
- [x] 单测：`mapReplyToTtsBody`（speed/format/mp3_bitrate 映射）、`parseVoiceModel(List)`（`_id`→`id`、cover_image、samples 去无 audio、缺字段容错）、`classifyFishError`、`fish-provider`（self_only/title/bearer/model header/401/network/无 key/404）、`registry`、`tts-playback`（串行、批级 duck/restore、revoke、失败降级、stop）。共 32 测。
- [x] Fish 调用走 `getAppFetch()`；无散落 `if (provider==="fish-audio")`（registry 唯一裁决）；无 `console.*`（走 `createDiagnosticLogger("voice.tts")`，只记 bytes）。
- [x] `make check` 通过（typecheck + biome + 3477 测试全绿）。

### Phase 3: 语音对话闭环（快捷键 → ASR → DJ → dj_say → 通知 + 朗读）

**Goal:** 按 `voice.talkToDj` 说话 → DJ **顺着当前会话** 切歌/续歌单并在左上角回话（可朗读，音量渐变 duck）。

**Tasks:**
- [x] `src/shortcuts/registry.ts` 加 in-app action def `voice.talkToDj`（**默认 `defaultBindings: []` 不绑定**，PM Q7；registry.test 加 `UNBOUND_BY_DEFAULT` 例外）；`src/shortcuts/system-global.ts` 把它加进 `SYSTEM_GLOBAL_SHORTCUT_ACTIONS`（system-global.test 同步）。
- [x] **输入模式（PM Q2，默认 hold）**：
  - in-app：`use-shortcut-dispatch.ts` 对 `voice.talkToDj` DOM **keydown→start / keyup→stop**（hold），toggle 模式 keydown 切换；`blur` 中途丢焦点 → `controller.cancel()`。
  - system-global（后台无 key-up）：`actions.ts` `SHORTCUT_ACTION_HANDLERS["voice.talkToDj"]` → `controller.toggle()`（press 退化）。
- [x] `src/hooks/use-voice-dj.ts`（wiring，App 幂等挂载）：`onTranscript` → `routeVoiceTranscript`（streaming 则 `interruptWithMessage`，否则 `sendMessage`）；订阅 `dj-reply-bus` → `postReply`（notify.info + replay action）；**兜底 `lastAssistantPreview`**（voice 轮结束未调 dj_say 时投递）；录音指示 toast（loading→transcribing→dismiss）。
- [x] **会话继承（PM Q4）**：`getActiveDjChatRuntimeActor()`（新增于 runtime-registry）取 `lastChatSessionId` 活跃会话，无则懒建普通会话——顺着上文继续。
- [x] **动态滑动窗口（PM Q4，§3.4）**：`dj-chat-context-budget.ts` 加 `selectContextWindow`（含最新 user 轮、user-turn 边界起点不拆 tool-call/result、系统提示+now-playing 不计入、`minStartIndex` 手动下限）；`dj-chat-agent.ts` 发送前套用（`contextStartIndex` 取 `max`，budget = `chatContextWindowTokens ?? 半个 context ceiling`）。回归既有 chat 测试全绿。
- [x] `src/chat/dj-chat-tools.ts` 加 always-on `dj_say` 工具 + `executeDjSay`（注入 emit → `dj-reply-bus`）；`dj-chat-tool-metadata` + i18n×4 `chat.tools.dj_say`；`dj-chat-prompt.ts` 系统提示补语音场景 dj_say 规则。
- [x] **朗读 + 渐变 duck（PM Q3）**：`tts-playback-runtime.createGradientDucker(getRampMs)` fade down/up（`djVoiceDuckRampMs`≈200ms 分步 `setVolume`，读元素音量不覆盖持久 volume；`MediaEngine.getVolume()` 新增）；`use-voice-dj` 的 `TtsPlayback` 单例注入它 + settings-ref 的 `getConfig`。
- [x] **付费生成审批（PM Q5=要确认）**：`use-voice-dj` 订阅活跃 actor，`pendingApprovalIds` + `decideApproval` → 默认 Approve/Deny 通知动作（`respondToToolApproval`），`voiceAutoApproveGenerate` 开则自动批准。
- [x] 录音指示 toast（阈值门控）。（dock mic 脉冲留后续打磨。）
- [x] i18n×4：`voice.listening`/`voice.transcribing`/`voice.reply.*`/`voice.approval.*`/`voice.tts.synthFailed`/`voice.tts.autoSpeak*`/`voice.tts.duckRamp`/`voice.asr.autoApprove*` + `shortcuts.action.voiceTalkToDj(+Desc)`。

> ⚠️ **hold 的平台约束（务必在 Settings 文案说清）**：OS 级全局热键（Electron `globalShortcut`）**只有按下事件、没有松开事件**，无法在 App 后台实现「按住说、松开停」。真 hold 只在 **App 前台（DOM keyup 可用）** 成立；**后台/全局**的 hold 退化为「按下开始 + 静音/超时自动停 或 再按停」。**不**引入原生底层键盘钩子（那等于全局 keylogger，违反 system-global PRD 的安全立场）。toggle 模式在前台/后台行为一致，作为「后台也想要确定性」的用户的推荐替代。

### Phase 3 Checklist

- [x] 绑定 `voice.talkToDj` 后，App **前台** hold（keydown→start / keyup→stop）成立；**后台** press → toggle 退化（`actions.ts` handler）。（键分发逻辑就位；真实录音需 mic + 绑定，手测项。）
- [x] toggle 模式前台/后台一致（keydown→toggle）。
- [x] 「放点更 chill 的」→ DJ **顺着当前会话**（`getActiveDjChatRuntimeActor`）执行 + `dj_say` → 左上角回话；开自动朗读则 `postReply` 念出，音乐**渐变** duck 再恢复。（闭环接线 + 纯逻辑测试覆盖；端到端需 key/mic，手测项。）
- [x] 连续多轮语音顺着上文继续；会话很长也不 block（`selectContextWindow` 自动收敛，穷举单测）。
- [x] 模型未调 `dj_say` 也有兜底回话（`use-voice-dj` 监测 voice 轮 busy→settled + `lastAssistantPreview`）。
- [x] 付费生成默认弹 Approve/Deny（`decideApproval` → 通知按钮 `respondToToolApproval`）；`voiceAutoApproveGenerate` 开后免确认。
- [x] Tauri/web：全局快捷键不可用时优雅降级（in-app 快捷键仍可触发；system-global 仅 Electron，沿用既有 `hasFolderAccess`/bridge 纪律 + Settings unsupported 标注）。
- [x] 单测：`selectContextWindow`（6 测：token 边界、user-turn 起点、含最新 user 轮、`minStartIndex`）；`dj_say`/`dj-reply-bus`（5 测：注入 emit、默认 bus、AgentWriteResult、订阅隔离）；`voice-dj-logic`（10 测：send vs interrupt、reply 投递门控、审批决策）；`tts-playback` 队列/duck（Phase 2）。共 21 个新 Phase-3 单测。
- [x] `make check` 通过（typecheck + biome + 3498 测试全绿）。

### Phase 4: 平台 QA / 权限边界 / i18n 校对 / VAD（可选增强）

**Goal:** 上线前把跨壳、权限、边界、翻译收口；可选加静音自动停。

**Tasks:**
- [x] Electron 麦克风权限：`electron/main.cjs` `app.whenReady` 加 `session.defaultSession.setPermissionRequestHandler`（grant，保持默认许可、不回归其它权限）；macOS 打包 `build.mac.extendInfo.NSMicrophoneUsageDescription`（用途文案，明说不存储）。
- [x] 权限被拒/撤销恢复引导：`NotAllowedError` → `voice.asr.micDenied`（引导系统设置）；无 key / provider 未就绪 → `voice.asr.notConfigured` / `synthesizeReply` 抛 `TtsError("auth")` 降级文字；mic 测试块 disabled + 提示。
- [x] i18n×4 全量校对：脚本核对 `voice.*` 四语言各 81 键完全一致 + `chat.tools.dj_say` + `settings.navVoice*` + `shortcuts.action.voiceTalkToDj(+Desc)` 齐全，无死 key。
- [x] log 扫描：`rg` 确认 `src/asr`·`src/tts`·`src/voice`·`use-voice-dj` 无 `console.*`，日志仅 provider/bytes/error-name/quota——**无**转写文本/reply/key/raw audio（规则 2/8）。
- [ ] **可选（deferred）**：VAD 静音自动停（`voiceSilenceAutoStopMs` 字段已预留）——本期不做，避免尾部引入未穷测的新路径；后续可注入简单能量阈值。
- [x] 移动端：明确本期不做全局快捷键（OS 限制），语音输入按钮留后续 in-app 触发（§7 Out of Scope 已记）。

### Phase 4 Checklist

- [x] Electron 打包态：麦克风权限已接线（request handler + macOS Info.plist 用途）；全局键沿用 system-global 地基（默认 disabled + 逐键授权）；`node --check electron/main.cjs` 通过。（三平台真机录音/后台键为手测项。）
- [x] 无 key / 无权限 / provider 未就绪 → 全部有可读 i18n 引导（micDenied/notConfigured/errAuth/errRateLimit/errNetwork/synthFailed），不崩、不吞。
- [x] `rg` 扫描确认无转写文本/reply/key/raw audio 入 log。
- [x] i18n 四语言齐全，无死 key（脚本核对 81×4 voice 键一致）。
- [x] `make check`（typecheck+biome+3498 测试）+ `vite build`（✓ 5.48s）+ `node --check electron/main.cjs` 通过。

---

## 7. Out of Scope

- **MUZERO 自有后端 / 语音代理**：坚持直连 BYOK（规则 1）。anysoul 的服务端代理路径**不移植**。
- **语音克隆 / 上传训练音色**：anysoul 有 `CloneVoiceDialog`；本期只**使用**已有音色（拉取/搜索/添加/选中），不做克隆上传。
- **唤醒词 / 常驻监听 / 实时对话**：本期是**明确的 push-to-talk**（按键触发）。不做 always-listening / wake-word（隐私 + 复杂度）。anysoul 的 `WakeWord` / realtime voice 不移植。
- **本地 / 浏览器内 ASR/TTS**（Whisper WASM、SenseVoice、MeloTTS、Supertone、Web Speech）：本期只云 BYOK（Groq / Fish）。registry 已为未来本地引擎留接口，但不实现。
- **多 provider（ElevenLabs / OpenAI TTS / Deepgram 等）**：registry 支持扩展，但本期各只一个 provider（Fish / Groq）。
- **DJ 情绪↔音色映射**：anysoul 的 emotion→voice mapping 不做；本期单一选中音色。
- **移动端全局快捷键**：OS 不允许；移动语音输入按钮留后续。
- **语音专属的独立 UI 会话线**：语音复用**当前活跃**的 DJ chat 会话（继承上下文，PM Q4）；不为语音单开一条 UI 会话线。语音说的话会出现在同一个 chat 历史里（现有 chat panel 可查看），这是预期行为，不做额外隔离。
- **hidden flags**：任何开关都在可见 Settings；回退 = `git revert`（规则 3/8）。

---

## 8. Security Considerations

- **BYOK 密钥纪律（规则 2）**：`fishAudioApiKey` / `groqApiKey` 只存 `AppSettings`（IndexedDB，设备本地），show/hide 输入；**禁止**进 bundle / committed `.env` / URL / 日志 / 遥测。key 从 settings 直达 provider（`getAppFetch`），无中转。
- **麦克风权限**：`getUserMedia` 逐次/系统级授权；被拒有引导；不常驻监听、不做后台 keylogger（沿用 system-global PRD 的「只用 OS accelerator，不做 raw key listener」纪律）。macOS 打包需声明麦克风用途。
- **数据最小化 / 无遥测（规则 1）**：转写文本、reply 文本、音频 blob **不落库、不上报**；诊断日志只记阶段/耗时/字节数/错误类型（白名单，§4.6）。
- **出站边界**：唯一新增出站 = 用户配置的 Fish Audio + Groq；均走 `getAppFetch()`（CORS/mixed-content 安全）。
- **付费动作确认**：语音里付费生成默认需确认（通知按钮）；免确认是显式可见开关，默认关。
- **回退**：`git revert` + 重新发版；无 runtime kill switch（规则 3/8）。

### 第三方依赖 / License 清单（prd-create.md §3）

| 依赖 | 类型 | License / 性质 | ship 影响 |
|---|---|---|---|
| Fish Audio API | 外部 BYOK 云服务 | 用户自带账号/额度；无捆绑代码/资产 | 无 bundle / license 负担；仅出站请求 |
| Groq API | 外部 BYOK 云服务 | 同上 | 同上 |
| `MediaRecorder` / `getUserMedia` / `AudioContext` | 浏览器原生 Web API | 平台内置 | 无新增第三方依赖 |

> **不引入新第三方 runtime 库**：录音/播放/映射全用平台 API + 自研纯函数（VAD 若做，先自研能量阈值，不引 `@ricky0123/vad` 等重依赖——对齐「优先 home-grown」）。若未来确需 VAD 库，另开 dependency manifest review。**Bundle 预算**：本期无大依赖，目标增量 < 100KB gzipped（Settings 面板 + 两个 provider + 编排）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260613-muzero-system-global-shortcuts-prd`](../../20260613-muzero-system-global-shortcuts-prd/20260613-muzero-system-global-shortcuts-prd.md) | 全局快捷键地基（`voice.talkToDj` 复用其 action 白名单 + Electron 适配 + Settings 录制器） |
| [`20260622-muzero-unified-background-progress-notification-prd`](../20260622-muzero-unified-background-progress-notification-prd/20260622-muzero-unified-background-progress-notification-prd.md) | 左上角通知栈 + indicator 模式（`dj_say` 回话 + 录音 toast 复用） |
| [`20260607-muzero-ai-dj-chat-agent-panel-prd`](../../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md) | 工具调用式 DJ chat（语音喂给它；`dj_say` 加进其工具集） |
| [`20260613-muzero-live-chat-request-intake-prd`](../../20260613-muzero-live-chat-request-intake-prd/20260613-muzero-live-chat-request-intake-prd.md) | 文本请求 intake（语音是另一种 intake，同样喂 runtime） |
| [`20260607-muzero-cloud-musicgen-provider-selection-prd`](../../20260607-muzero-cloud-musicgen-provider-selection-prd/20260607-muzero-cloud-musicgen-provider-selection-prd.md) | 可插拔 provider registry + 纯映射函数范式（ASR/TTS registry 镜像它） |
| [`src/chat/dj-chat-tools.ts`](../../../../src/chat/dj-chat-tools.ts) | DJ 工具集（新增 `dj_say`） |
| [`src/chat/dj-chat-runtime-actor.ts`](../../../../src/chat/dj-chat-runtime-actor.ts) | `sendMessage`/`interruptWithMessage`（语音注入点） |
| [`src/lib/platform.ts`](../../../../src/lib/platform.ts) / [`src/lib/desktop/bridge.ts`](../../../../src/lib/desktop/bridge.ts) | `getAppFetch()` CORS-free 出站 |
| anysoul（`D:\code\project\anysoul`） | 参考实现：`lib/tts/fish-audio-tts.ts`、`hooks/use-voice-models.ts`、`lib/voice/groq-client.ts`、`hooks/use-groq-transcribe.ts`、`hooks/use-voice-input.ts`、`stores/voice-config.ts`、`components/settings/voice/*` |

外部 API 文档：Fish Audio TTS `https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech`；Groq STT `https://console.groq.com/docs/speech-to-text`。

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | reply 用**工具 `dj_say`** 还是直接取 assistant 文本？ | ✅ Resolved | **用 `dj_say` 工具**（PM 2026-07-02），`lastAssistantPreview` 兜底（§4.4）。 |
| 2 | push-to-talk = **toggle** 还是 **hold**？ | ✅ Resolved | **Settings 可选，默认 `hold`**（PM 2026-07-02）。⚠️ hold 真值仅前台成立；后台/全局无 key-up → 退化为「按下开始 + 静音/超时停 或 再按停」（§6 Phase 3 约束）。 |
| 3 | 朗读时音乐 duck / pause / 并行？ | ✅ Resolved | **duck，且音量渐变过渡**（`djVoiceDuckRampMs`≈200ms fade，PM 2026-07-02）；默认 duck 到 0.25，可关。 |
| 4 | 语音喂专用会话还是当前会话？上下文怎么管？ | ✅ Resolved | **不开专用会话，继承当前活跃会话**（顺着上文继续）；上下文从 compaction 改为**动态滑动窗口**（§3.4，PM 2026-07-02）。 |
| 5 | 语音里付费生成是否要确认？ | ✅ Resolved | **要确认**（通知 Approve/Deny，PM 2026-07-02）；`voiceAutoApproveGenerate` 显式开关（默认关）才免确认。 |
| 7 | 默认 `voice.talkToDj` 快捷键？ | ✅ Resolved | **默认不绑定**（PM 2026-07-02）；用户在 Settings 显式绑定（最安全，对齐 system-global 默认不启用）。 |
| 6 | ASR 的 Groq key 是否复用已配置的 DJ Groq key（`apiKeysByPresetId.groq`）？ | 🔲 Open（采用默认） | 提供「复用」开关，默认复用（若已存在），也允许单独填 `groqApiKey`。未收到反对，暂按此实现。 |
| 8 | Fish TTS backend 默认哪个 model？ | ✅ Resolved | **默认 `s2.1-pro-free`**（2026-07-03 用户拍板）——与 `s2.1-pro` 同模型、同质量/83 语言，$0 供开发测试（fair-use，无 TTFA/DPA 保证），最适合 BYOK 个人自用。可选 `s2.1-pro`(付费) / `s2-pro` / `s1`。`FishTtsBackend` union 扩为四项，`DEFAULT_FISH_BACKEND` 集中定义。 |

---

## 12. Follow-up Enhancements（round-2，用户反馈）

> 2026-07-03 用户在 Electron 手测后补充的四点优化 + 一条性能红线。按 phase 推进、原子化 commit、每次改完先更 PRD 再 commit、TDD + E2E harness（复用 `POST /voice/transcript` + `GET /notifications` + `GET /state` 控制端点）。

### Phase 5：DJ 工具活动展示打磨（dock 活动气泡）

**背景**：dock 上的 [`ChatActivityPopover`](../../../../src/components/chat/chat-activity-popover.tsx)（`deriveChatActivity` 从 runtime snapshot 派生「当前在调哪个工具」）**已经**在底部显示工具活动。所以：

- **不在顶部通知栈重复**工具活动（用户：「既然底部这里会显示，其实顶部的就不需要显示了」）——放弃 round-1 起过的 tool-activity **bus + instrument 每个 tool execute** 方案（那会给每次 tool-call 加副作用，撞性能红线），改为纯读 snapshot。
- **不同 toolcall 用不同 lucide 图标**：`ChatActivityPopover` 的 `ActivityIcon` 现按 tone（running/error/idle）出图标，改为**按工具**（`toolIconName(toolName)`）——search→🔍、play→▶、generate→🪄…（[`dj-tool-display.ts`](../../../../src/chat/dj-tool-display.ts) 纯映射）。
- **明细行 = tool-call 核心参数**：气泡当前的副行是 assistant 文本；running 工具时改显 `summarizeToolInput(toolName, latestTool.input)`（search 的 query、set 的 name、generate 的 title 等；≤80 字裁剪）。
- **性能**：只读 snapshot 里已有的 tool part，**零**新增 tool-call 开销（对齐性能红线）。

**Phase 5 Checklist**
- [x] dock 活动气泡：running 工具显示 per-tool 图标（`ChatActivityPopover.ActivityIcon` 按 `iconKey` 出图，16 个 DJ 工具图标）+ 工具 label + query/param 明细（`summarizeToolInput` 优先于 assistant 文本）；idle/error/thinking tone 兜底。
- [x] 顶部通知栈**不再**出现工具活动卡（从未加，撤掉 round-1 起过的 bus/instrument）；dj_say 从 dock 气泡 `latestToolPart` **排除**（回话仍在顶部，携 replay/TTS，不双显）。
- [x] 单测：`toolIconName`/`summarizeToolInput`（6 测）+ `deriveChatActivity`（query 明细 + iconKey + 无摘要时回退 assistant 文本）。共 8 新测 + 既有 popover 测更新。
- [x] `make check`（typecheck + biome + chat 119 测）通过。**零 tool-call 开销**：纯读 snapshot，无 bus/instrument（对齐性能红线）。

### Phase 6：播放淡入淡出 / crossfade

**背景**：用户觉得 DJ 说话时的音量 ducking 渐变很好，希望**切歌**和**暂停/恢复**也有淡变。

- 新增 `AppSettings.crossfadeEnabled`（「淡入淡出」）——**默认开**（additive optional，不 bump DB）。可加 `crossfadeMs`（默认 ~400ms）。
- **切歌**：新曲淡入 + 旧曲淡出（`MediaEngine`/`AudioEngine` 单 `<audio>`/`<video>` 元素——真 crossfade 需两条轨或 WebAudio gain；单元素退化为「快速 fade-out 旧 → 切源 → fade-in 新」，复用 ducker 的分步 `setVolume` ramp）。
- **暂停/恢复**：暂停前 fade-out 到 0 再 pause；恢复时 play 后 fade-in 到用户音量。
- **性能**：ramp 用现成分步 `setVolume`（30ms 步进），不新建 WebAudio 图除非必要；不在 rAF 每帧做重活。
- Settings→播放 加「淡入淡出」开关 + 时长（i18n×4）。

**Phase 6 Checklist**
- [x] `crossfadeEnabled` **默认开**（`?? true`）；关掉 = `setCrossfade(false)` 立即恢复 element 音量、走原立即切/暂停路径（零行为差）。
- [x] 切歌/恢复：`MediaEngine.play()` 淡入（crossfade 时先把 element 音量置 0，play 后 `fader.fadeTo(0→targetVolume)`），覆盖切歌 + resume 同一路径（新曲/续播不爆音）。单元素模型不做真 overlap crossfade（需双轨/WebAudio，记为后续）。
- [x] 暂停：`MediaEngine.pause()` 淡出到 0 再 `audioEl.pause()`；resume mid-fade 由 `fadeTo`/`setVolume` 取消旧 ramp（不残留 onDone）。
- [x] 单测：`AudioFader`（5 测：均匀 ramp、onDone、0/1 步即时、新 fade 取消旧、cancel）；`MediaEngine` 集成走既有 149 player 测（无回归）。
- [x] `make check`（typecheck + biome + player 149 测）通过。**性能**：ramp 用 30ms setTimeout 步进（一轮 fade ~13 个 timer），无 rAF/无每帧重活；`setVolume` 只改 element 属性（无重渲染，规则 6）。Settings→播放 加「淡入淡出」开关 + i18n×4。

### Phase 7：Composer 录音按钮 + tool-call 执行性能核查

- **录音按钮**：[`dj-chat-entry.tsx`](../../../../src/components/chat/dj-chat-entry.tsx) 的 chip 里、输入框旁加一个 mic 按钮——点击 = `getVoiceInputController().toggle()`（与快捷键同一路径），录音态显示（脉冲/停止图标）。ASR 未配置时 disabled + 提示去设置。i18n×4。
- **性能红线（贯穿 5/6/7）**：核查 LLM 调 tool-call 时底层执行有无性能问题——内存占用、掉帧、主线程卡顿。手段：控制端点 `POST /voice/transcript` 触发多步 tool 运行，配合 `GET /processes`（进程内存/CPU）、`perf/trace`、`perf/sampler`、`renderTrace`（每表面 commit 计数）观察一轮多 tool-call 期间有无异常渲染/内存增长；tool execute 是异步 Dexie 查询（非 UI 阻塞），确认 snapshot 更新不触发全树重渲染（Zustand selector 纪律，规则 6）。

**Phase 7 Checklist**
- [x] Composer chip 输入框旁加 mic 按钮（`asrReady && !draft` 时显示）：点击 = `getVoiceInputController().toggle()`；录音态图标（idle mic / recording 脉冲环 / transcribing spinner）来自 controller 新增的**多监听** `subscribeState`（不夺 use-voice-dj 的单 callbacks）；`useVoiceRecordingState` hook。未配 ASR 时不显示（配好即出现）。i18n×4（`chat.voiceRecord`/`voiceStop`）。
- [x] **性能核查（端点 E2E）**：注入多-tool 请求（找歌+建歌单+切歌+dj_say）一轮——`/processes` 总 private 内存 761→780MB（+19MB，无泄漏/无失控，一轮播放列表编排的正常量）；`renderTrace` 显示**仅 `dock`** 表面提交（10 commits / 44ms 总，非全树），证实工具活动只读 snapshot、经 dock 既有订阅重渲染，不撞其它 tab（规则 6）；tool execute 是异步 Dexie 查询，无主线程阻塞、无每帧重活。**印证撤掉 bus/instrument 的决定**（零 tool-call 副作用）。
- [x] 单测：`subscribeState`（多监听 + unsubscribe，不夺 callbacks）；controller.toggle 既有测覆盖点击路径。共 1 新测（controller 达 14 测）。
- [x] `make check`（typecheck + biome + voice 测）通过 + 端点 E2E 性能核查如上。

### Phase 8：LLM-facing system prompt + tool description 的界面语言 i18n（Round-3，用户反馈）

**背景（用户提问 + PM 拍板）**：用户问「system prompt 和 tool call description 等是否也按界面语言本地化」。现状：**回话语言**已本地化（`listenerLanguageDirective(uiLocale())`，commit 9cd94ba9）、**Settings「DJ 能做什么」的工具说明**已本地化（`DjToolCapabilities` 渲染 `chat.tools.*` ×4）；但**喂给 LLM** 的 system prompt + 23 工具 `description` 是英文。工程上不建议翻译（英文指令/工具 schema 工具选择最稳、维护/token 成本高、可能降准确率），但 PM 选择**翻译成界面语言**——本 phase 以**低风险方式**实现。

- **英文 canonical + fallback**：`dj-chat-prompt.ts` 保留 `SYSTEM_EN` 为源 + `djChatSystemPrompt(locale)`（未知/缺失 → 英文）；`dj-chat-tool-descriptions.ts` **只加** zh/ja/ko override map（英文内联串仍是源+兜底），`toolDescription(id, locale)` 缺译返回 `""` → 保英文。
- **不改 23 个 `tool({description})`**：`createDjChatTools({locale})` 在 return 前**后处理**——遍历 tools，有 override 才覆盖 `description`（含条件加的 online/generation 工具）。零改动主体、零回归。
- **保留字面 token 不译**：`#T/#S/#R/#Q/#M`、工具名（`set_add_by_search`…）、参数（`queries/types/fields`、`cursor/nextCursor`、`"any"/"all"`、`"track"/"set"/"lyrics"`）、`TrackBriefs`。
- **接线**：`dj-chat-agent.sendMessages` 用 `djChatSystemPrompt(locale)` + `createDjChatTools({..., locale})`，`locale = uiLocale()`（`i18n.language`）。

**Phase 8 Checklist**
- [x] `djChatSystemPrompt(locale)` 四语言各不同、未知/`zh-CN` 主子标签→zh、缺失→英文；字面 token（`#T`/`set_add_by_search`/`dj_say`）四语言均保留。
- [x] `toolDescription`：zh/ja/ko 有译、en/未知/undefined 返回 `""`；主子标签解析；**23 工具 id 与 `createDjChatTools` 全集 1:1 parity**（三语言全覆盖）；字面 token 保留。
- [x] `createDjChatTools({locale:"zh"})` 覆盖 `description`（含 online_*/dj_*）；无 locale / `en` 保英文内联串不变。
- [x] 单测：`dj-chat-i18n.test.ts` 9 测（prompt 四语言 + fallback + token；toolDescription 覆盖/fallback/parity/token；createDjChatTools 本地化 + 默认英文）。
- [x] `make check`（typecheck + biome + 3524 测试）全绿。

### Phase 9：DJ 策展纪律——世界知识判断、避免一股脑塞歌单（Round-3，用户反馈）

**背景**：用户观察「现在有点过于一股脑塞进歌单了」——DJ 用 jazz/instrumental 等词过滤时，直接把 `set_add_by_search` 的整批命中塞进歌单，而没用**世界知识**按歌名/歌手判断哪些真的符合。

- 在（Phase 8 已本地化的）system prompt「策展」段后、「回忆」段前，加一段**策展纪律**指引（四语言同步）：流派/心情/氛围类请求**不要**整批 `set_add_by_search`；标签/标题有噪声（搜 jazz 会带出贴错或不对味的歌）；应先 `library_search` 取候选（fields ["id","title","artist"]），用**世界知识**按歌/歌手**只留**真正符合的，`set_add_tracks` 只加这些；`set_add_by_search` 保留给用户自维护标签（如 "#gym"）等无歧义场景。**宁精勿滥**。
- 字面 token（`set_add_tracks`/`set_add_by_search`/`library_search`/`fields`）保留不译。

**Phase 9 Checklist**
- [x] 四语言 system prompt 均含策展纪律段（en「quality over quantity」/ zh「宁精勿滥」/ ja「量より質」/ ko「양보다 질」），且都引导优先 `set_add_tracks`（判断后）而非整批 `set_add_by_search`。
- [x] 单测：`dj-chat-i18n.test.ts` 新增策展纪律断言（各语言特征短语 + `set_add_tracks` 出现）。共 10 测。
- [x] `make check`（typecheck + biome + chat 123 测）通过。
- 备注：行为质量（是否真的少塞、判断更准）需**活 LLM** 手测/端点 E2E 验证；单测只保证指引已注入 prompt。

### Phase 10：Round-3 修复（手测/E2E 反馈）

**Fix A — dj_say 有时把 `AgentWriteResult` JSON 当回话显示/朗读**：用户手测发现左上角通知**偶尔**显示整段 `{"status":"ok","commandId":"muzero.dj.say","summary":...,"diff":{"text":"…"},"warnings":[]}`，且 dj_say **朗读的声音也不对**（把 JSON 念出来）。排查：`lastAssistantText` 只取 `type:"text"` part，不含 tool 结果——故根因是**模型偶尔把 dj_say 的结果 JSON 当作 assistant 文本吐出**（多轮里 history 有过该形状后更易复现），`use-voice-dj` 的回话路径（fallback 或 dj_say 文本参数）原样透传 → 通知 + TTS 同一 `text` 双双出错。**修复**：在唯一 choke point `deliverDjReply` 前加纯函数 `sanitizeReplyText`——纯文本透传；识别到 dj_say 结果 JSON 则解包 `diff.text`/顶层 `text`；其它 JSON 对象/数组直接丢弃（宁静默勿吐 JSON）。同时修好通知与朗读。

**Fix B — Fish 选中音色持久化到「用过的音色」列表**：用户希望选中一个 Fish voice model 后**记住、下次继续用**，并进入「用过的音色」列表，不必每次搜索。现状 `ttsVoiceId` 已持久（选择本身记住），但选中音色的**元数据未缓存**——不重新拉 `self_only` 列表就看不到它。**修复**：纯函数 `selectVoicePatch(settings, voice)` → 选中即写 `ttsVoiceId` + 把该音色并入 `ttsAddedVoiceIds` + 缓存元数据到 `ttsAddedVoiceCache`（去重/刷新），使其下次无需搜索即显示在「已添加/用过」区并高亮；`voice-tts-settings` 选中按钮改调它。

**Phase 10 Checklist**
- [x] Fix A：`sanitizeReplyText`——纯文本透传 / dj_say 结果 JSON 解包 `diff.text` / 顶层 `text` / 其它 JSON 丢弃；`deliverDjReply` 接入（通知 + TTS 同源修复）。单测 `voice-dj-logic.test.ts` +8（含中文 dj_say JSON 解包、未知 JSON 丢弃、brace-开头非 JSON 当文本）。
- [x] Fix B：`src/tts/voice-selection.ts` `selectVoicePatch(settings, voice)`——选中即 `ttsVoiceId` + 并入 `ttsAddedVoiceIds`（去重）+ 缓存/刷新 `ttsAddedVoiceCache`（幂等）；`voice-tts-settings` 选中按钮改调它，使音色进「用过/已添加」列表、下次无需搜索即高亮。纯函数单测 3 测。
- [x] `make check`（typecheck + biome + voice/tts 测）通过。端点 E2E 复验 dj_say 通知/朗读为纯文本 = 下一步在 Electron 上跑。

### Phase 11：DJ 复用已有歌单，避免重复建空集（Round-3，接 Phase 10 反馈）

**背景**：E2E 里模型建了个空「专注」集后又重复建「专注工作」——它不知道已有哪些歌单、也没先查就新建。

- **上下文注入**（主机制）：`dj-chat-context.buildSetsContext(db, localIds, limit=40)` 每回合列出已有歌单（名字 + #S id + 曲数，`updatedAt` 新到旧、上限 40，超出提示用 `set_list`），`dj-chat-agent.sendMessages` 与 now-playing 一并注入（顺序执行避免 localId registry 竞争）。这样模型**每回合都看到已有歌单**，自然复用。
- **prompt 引导**（四语言）：「先复用再新建——已有合适的就往里加、别建近乎重复的；确需新建就同一步填好（`set_create` 接 trackIds）、绝不留空集」。

**Phase 11 Checklist**
- [x] `buildSetsContext`：空库→`""`；列出名字/#S ref/曲数、newest-first；上限 + 「…and N more / use set_list」。5 测（context 测文件）。
- [x] `dj-chat-agent` 注入 setsContext（顺序、filter(Boolean) 拼接）。
- [x] 四语言 prompt 加「先复用再新建」引导（en「Reuse before creating」/ zh「先复用再新建」/ ja「作る前に再利用」/ ko「만들기 전에 재사용」），`dj-chat-i18n.test.ts` +1。
- [x] `make check`（typecheck + biome + chat 127 测）通过。

### Phase 12：歌单来源 UI 过滤（AI / human / 导入）（Round-3，用户建议）

**背景**：用户希望在库里能按来源过滤歌单——AI 创建 / 自己建 / 导入。

- **数据**：`DjSession.origin?: SetOrigin("ai"|"human"|"imported")`（additive、非索引、不 bump DB）；`createSession` 接 `origin`；DJ 工具 `executeCreateSet` 打 `origin:"ai"`（消歧最模糊的"AI 建"情形）。
- **分类器**（纯函数）：`src/lib/set-origin.ts` `resolveSetOrigin(session)` = 显式 `origin` 优先，否则推断——`streamPlaylistRef`/`cloudSource`→imported、`seedPrompt` 非空→ai、否则 human。**`config.autoExtend` 不作信号**（默认 true 会误判手建集）。`filterSetsByOrigin` 辅助。
- **UI**：库「歌单」墙工具栏在排序 chip 后加 3 个 `FilterChip`（AI / 自建 / 导入，单选可切回全部）；`shown` 管线在 `filterSets`/`sortSets` 前按 `resolveSetOrigin(item.session)` 过滤。i18n×4 `gallery.origin.{ai,human,imported}`。

**Phase 12 Checklist**
- [x] `resolveSetOrigin`：显式优先 + 推断（imported/ai/human，忽略 autoExtend）；`filterSetsByOrigin`（all/undefined 全通过、按来源过滤）。6 测。
- [x] `DjSession.origin` + `createSession` 接线 + DJ `set_create` 打 `origin:"ai"`。
- [x] search-page「歌单」墙 3 个来源 `FilterChip` + `shown` 过滤；i18n×4。
- [x] `make check`（typecheck + biome + 3548 测试）全绿。（UI 随 HMR 在运行的 Electron 实例上即见。）

### Phase 11.1：把「已有歌单」从每回合上下文注入改为可搜索/分页的 `set_list` 工具（Round-3，用户反馈）

**背景**：用户指出——每回合把 40 个歌单名塞进上下文不 scale、也浪费 token，更适合做成一个**可搜索、可分页**的工具（keywords 可留空，留空=按 updated 倒序）。

- **`set_list` 增强为搜索/分页工具**：`setListInputSchema { query?, limit=30, cursor=0 }` —— `query` 匹配歌单名（`freeTextMatches`，留空=全部 updated 倒序），`cursor`/`limit` 分页、返回 `nextCursor`（null=末页）+ `total`。工具描述（en + zh/ja/ko override）更新。
- **`buildSetsContext` 瘦身为一行 count 提示**（不再 dump 名字）：`db.sessions.count()` → 「你有 N 个歌单；新建前先用 set_list（可带名字 query）找可复用的、别建重复、别留空集」。scale 到大库、token 恒定。
- **prompt 引导**（四语言）改为「用 set_list（可带名字 query）找已有歌单来复用」（不再说"列在下方"）。

**Phase 11.1 Checklist**
- [x] `executeSetList(input, deps)`：query 名字过滤 / cursor+limit 分页 / nextCursor / total；空 query = 全部。`dj-chat-tools.test.ts` +3（全量/查询/分页），既有 `set_list` 测（空 input）仍过。
- [x] `set_list` 工具 schema + 描述（含 query/分页）+ 四语言 override 更新。
- [x] `buildSetsContext` → count 提示（`db.sessions.count()`，无 dump/localIds）；context 测改为断言 count 提示、不含名字。
- [x] 四语言 prompt 引导改指向 `set_list`；`dj-chat-i18n.test.ts` 特征短语不变仍过。
- [x] `make check`（typecheck + biome + 3547 测试）全绿。

### Phase 13：E2E harness——控制端点读 tool-call trace（Round-3，观测工具设计）

**背景**：之前只能读通知/歌单计数，**看不到 DJ 内部 tool-call 序列**，无法程序化验证「有没有先 set_list 再复用」这类行为、也难发现不合理的工具设计。

- 纯函数 `dj-chat-trace.extractToolCalls(messages)`（用 `isToolUIPart`/`getToolName` 展平所有 tool-call：名字/state/input/output，按顺序）+ `summarizeToolCalls`（per-tool 计数）。
- 控制端点 `GET /chat/trace`（`perf-control.cjs` route + `perf-control-bridge.readChatTrace` 读活跃会话 `messagesJson` → 展平 + input/output 截断 300 字，非密）。dev-only、打包态永不启用。

**Phase 13 Checklist**
- [x] `extractToolCalls`：展平 tool-call（名字/state/input/output、忽略 text/user、保留 in-flight）；`summarizeToolCalls` 计数。4 测。
- [x] `GET /chat/trace` 端点接线（route + bridge dep + 截断）。`node --check electron/perf-control.cjs` + typecheck 通过。
- [x] `make check` 通过。（下一步用它跑 E2E 观测、找不合理工具设计 → Phase 14。）

### Phase 14：基于 trace 观测优化不合理 tool-call（Round-3）

**用 Phase 13 的 `/chat/trace` 实测**（活跃会话 128 次 tool-call）暴露两个明确问题：

1. **`dj_say` 刷屏**：trace 尾部出现**连续 4 次完全相同**的回话「好的，已经为你切换到更安静的音乐，希望它能帮助你更好专注。」——模型一回合多次调 dj_say 同一句，刷爆通知栈 + TTS 重复念。
2. **策展脚踏两条船**：同一个集 `#S6` 先 `set_add_tracks[5 判断曲]` **又** `set_add_by_search{limit:1000}`——判断+整批 dump 都做，正是「专注工作」膨胀到 100 首的原因，架空了 Phase 9 的策展纪律。

**修复**：
- `dj-reply-bus.emitDjReply` 加**连续去重**（back-to-back 相同文本丢弃；"a,b,a" 仍全投）+ `resetDjReplyDedup` 测试 seam——通知/TTS 双修，与 Fix A 的 `sanitizeReplyText` 叠加成回话净化层。
- prompt 引导（四语言）：① **dj_say 每回合最多一次**（en「ONCE per turn」）；② **别脚踏两条船**——同一集只用 set_add_tracks **或** set_add_by_search 之一（en「Don't hedge」）。

**Phase 14 Checklist**
- [x] `emitDjReply` 连续去重（`dj-say.test.ts` +1：a,a→1 投；a,b,a→3 投）；`resetDjReplyDedup`。
- [x] 四语言 prompt 加 dj_say-once + no-hedge 引导；`dj-chat-i18n.test.ts` +1（8 断言）。
- [x] `make check`（chat+voice 172 测）通过。行为改善需活 LLM 复验（去重是确定性兜底，prompt 是软引导）。

### Phase 15：删除 `set_add_by_search`，强制判断式策展路径（Round-3）

**问题**：即便 Phase 9/14 的 prompt 引导「宁精勿滥、别脚踏两条船」，活 LLM 端点 E2E 仍反复观测到模型**偏爱 `set_add_by_search{limit:1000}` 整批 dump**——因为「搜索即加入」这条工具本身就是一步到位的捷径，软引导压不住。用户拍板：**删掉这个工具**，让模型只能从 `library_search` 的结果里按 local `#T` id 判断式地加入歌单（`set_add_tracks`）。移除捷径 = 用工具形状（而非 prompt 措辞）强制「先判断后加入」。

**改动**（唯一策展路径收敛为 `library_search`（拿 `#T` id）→ 世界知识判断 → `set_add_tracks`）：
- `dj-chat-tools.ts`：删 `setAddBySearchInputSchema`/`SetAddBySearchInput`/`executeSetAddBySearch`/`set_add_by_search` 工具注册；`library_search` 描述改指向 set_add_tracks。（`searchMultiTerm`/`listAllTracks`/`memoryNotesByTrack`/`prependTrackIds` 仍被 `executeSearchTracks` 等复用，非孤儿。）
- 同步清理：`dj-tool-display.ts`（图标+switch）、`dj-chat-tool-metadata.ts`（parity 数组 23→22）、`dj-chat-tool-descriptions.ts`（zh/ja/ko 三 override + header + 三处 library_search 描述改指向 set_add_tracks）、四语言 system prompt（EN/zh/ja/ko 策展段重写为「library_search 拿候选 → set_add_tracks 加」形状，删「脚踏两条船」句）、四语言 `chat.tools.set_add_by_search` i18n 键。
- 测试：`dj-chat-tools.test.ts` 删 2 个 executeSetAddBySearch 测；`dj-chat-i18n.test.ts` 改 parity（22 工具）+ 3 处字面 token 断言（library_search → set_add_tracks）+ 去 no-hedge 断言。

**Phase 15 Checklist**
- [x] 删 `set_add_by_search` 工具 + schema + execute + 图标 + metadata + 三语 override + i18n 键。
- [x] 四语言 prompt 策展段重写为判断式路径（`library_search` #T → `set_add_tracks`）。
- [x] 测试更新（tools.test −2、i18n.test parity+token）；`make check`（typecheck + biome + chat 133 测）全绿。行为改善需活 LLM 复验（现在无捷径可走）。

### Phase 16：`dj_say` 多 part 回话 + 每 part 情绪 → Fish 情绪标记（Round-3）

**动机**（用户反馈）：一次 `dj_say` 出多条不同进度消息「没关系，可以拆分多个 part 来说」，并进一步结合 **Fish Audio 情绪控制**——让 `say` 数组里每个 part 带一个可选 `emotion`，映射到 Fish 情绪标记，声音就能在一句回话里切换情绪。**通知/去重仍用纯文本**（无标记），只有喂给 TTS 的文本带标记。

**Fish 情绪语法**（[docs](https://docs.fish.audio)）：
- **S2 家族**（`s2.1-pro-free`/`s2.1-pro`/`s2-pro`）→ `[emotion]` 方括号，允许自然语言描述。
- **S1** → `(emotion)` 圆括号，固定情绪集。
- 标记置于所影响文本之前：`[happy] 太好了！`。

**改动**：
- 新增纯函数模块 [`src/tts/emotion-markup.ts`](src/tts/emotion-markup.ts)：`ReplyPart {text, emotion?}`；`normalizeReplyParts`（say 数组优先，legacy `text` 回退，去空）；`plainReplyText`（拼接、去情绪，用于显示/去重）；`usesParenEmotion`（仅 s1 用圆括号）；`emotionMarker`（按 backend 加 `[]`/`()`、剥离模型已加的括号防双重包裹）；`buildEmotionText`（每 part 前置标记，无情绪则等同纯文本）。**15 单测**。
- `dj-reply-bus.DjReplyEvent` 加 `parts?: ReplyPart[]`（去重仍看纯 `text`，Phase 14 防刷屏不变）。
- `executeDjSay` 改吃 `{say?, text?, tone?}`：归一化成 parts、`text` = 纯文本 join、emit `{text, parts, tone}`；`dj_say` 工具 inputSchema 改为 `say: [{text, emotion?}]`（min1 max5 + 总字数 ≤ `DJ_SAY_MAX_CHARS` 的 refine）。
- `voice-dj-logic.deliverDjReply` 加 `speakText?`——通知显示纯文本，朗读用带情绪标记的文本（缺省回退纯文本）；`use-voice-dj.postReply({text, parts?})` 按 `settings.ttsModel`（Fish backend）用 `buildEmotionText` 构造 speakText，auto-speak 与「重播」按钮都朗读它。
- LLM-facing：四语言 system prompt dj_say 段 + zh/ja/ko 工具描述加「`say` 传 parts 数组、每 part 可带 `emotion`、多数一 part、语气真的变才拆」引导。
- 测试更新：`dj-say.test.ts` 改断言（event 带 parts）+ 加多-part/情绪 emit 测；`voice-dj-logic.test.ts` 加 speakText 朗读带标记/通知纯文本 测。

**Phase 16 Checklist**
- [x] `emotion-markup.ts`（6 纯函数）+ 15 单测；`DjReplyEvent.parts`；`executeDjSay`/`dj_say` schema 改 say 数组 + 情绪；`deliverDjReply.speakText` + `postReply` 按 backend 构造。
- [x] 四语言 prompt + zh/ja/ko 工具描述加 say-array/emotion 引导；`make check`（typecheck + biome + tts/chat/voice 208 测）全绿。
- [x] **emotion→Fish 请求形式核验**（用户「确保 emotion 正确以合理的形式请求到 fish」）：① 对照 Fish 官方文档确认 S2=`[emotion]` 方括号（自由文本、可任意位置）、S1=`(emotion)` 圆括号（固定集、句首），标记内联在 `/v1/tts` 的 `text` 字段、`normalize` 不影响标记（保留 `normalize:true`）；② **确定性集成测**（`fish-provider.test.ts` +3）：parts→`buildEmotionText`→`provider.synthesize`→捕获真实请求体，断言 `body.text` 逐字带标记、`normalize:true`、`model` 头与 backend 一致（4 backend 全覆盖，S2↔方括号 / S1↔圆括号 永不错配）；③ **活 Fish 请求**（新增 dev 控制端点 `POST /tts/preview {text}`→真 `synthesizeReply` 直连 Fish，绕开 chat-runtime 死区，只回 bytes/mime/backend 不回 key）：`[happy] Great pick! [gentle] Cueing it up.`→200 + 35KB mp3；中文 `[happy] 太棒了，恭喜你考完试！[gentle] …`→200 + 96KB mp3；无标记基线→200 + 45KB——**Fish 实际接受带情绪标记文本并返回真音频**。
- [~] **模型行为仍待活跃面板手测**：模型是否真用 `say`+`emotion`（而非单 text）需在活跃 chat 面板下复验（强制重启会清空内存 active chat runtime、语音注入需面板活跃才路由，见 harness 记录）。

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-03 | Claude (round-3) | **Phase 16 emotion→Fish 请求核验**（用户「确保 emotion 正确以合理的形式请求到 fish」）：对照 Fish 官方文档确认标记形式（S2 `[emotion]`／S1 `(emotion)`、内联于 `text`、`normalize` 无碍）；加 3 个确定性集成测（`fish-provider.test.ts`：parts→buildEmotionText→synthesize→捕获真实 `/v1/tts` 请求体，断言逐字标记 + `normalize:true` + model 头↔backend 一致，4 backend 全覆盖）；新增 dev 控制端点 `POST /tts/preview`（真 `synthesizeReply` 直连 Fish、绕开 chat-runtime 死区、不回 key），**活测**：`[happy]…[gentle]…`（EN 35KB / 中文 96KB mp3）+ 无标记基线 45KB 均 200——Fish 实接受带情绪标记文本。`make check` 全绿。 |
| 2026-07-03 | Claude (round-3) | **Phase 16 完成（代码）**：`dj_say` 多 part 回话 + 每 part 情绪 → Fish 情绪标记（用户反馈：一次回话可拆多 part，结合 Fish emotion control）。新增纯函数 `src/tts/emotion-markup.ts`（normalizeReplyParts/plainReplyText/usesParenEmotion/emotionMarker/buildEmotionText——S2 `[emotion]`、S1 `(emotion)`，15 单测）；`DjReplyEvent.parts`；`executeDjSay`/`dj_say` schema 改 `say:[{text,emotion?}]`（去重仍看纯文本）；`deliverDjReply.speakText`（通知纯文本、朗读带标记）+ `postReply` 按 `ttsModel` backend 构造；四语言 prompt + zh/ja/ko 工具描述加引导。`make check`（tts/chat/voice 208 测）全绿。**活 E2E 受限**：强制 Electron 重启后语音注入不再路由（内存 active chat runtime 被清、需 chat 面板活跃），`say`+`emotion` 的模型行为需活跃面板下手测复验。 |
| 2026-07-03 | Claude (round-3) | **Phase 15 完成**：删除 `set_add_by_search` 工具（用户拍板）。软引导（Phase 9/14）压不住模型偏爱「搜索即整批加入」的捷径——移除工具本身，把策展唯一路径收敛为 `library_search`（拿 `#T` id）→ 世界知识判断 → `set_add_tracks`。删 schema/execute/工具注册/图标/metadata（parity 23→22）/三语 override/四语言 i18n 键 + 四语言 prompt 策展段重写（删「脚踏两条船」句）；测试 tools.test −2、i18n.test 改 parity+字面 token。`make check`（typecheck + biome + chat 133 测）全绿。用工具形状而非 prompt 措辞强制判断式策展。 |
| 2026-07-03 | Claude (round-3) | **Phase 14 完成**：用 Phase 13 `/chat/trace` 实测（128 tool-call）找到并修两个不合理设计——① **dj_say 刷屏**（连续 4 次同句）→ `emitDjReply` 连续去重（+`resetDjReplyDedup`）；② **策展脚踏两条船**（同集 set_add_tracks + set_add_by_search 都做→膨胀 100 首）→ 四语言 prompt 加「dj_say 每回合一次」+「别脚踏两条船（二选一）」。2 新测，`make check`（chat+voice 172 测）全绿。 |
| 2026-07-03 | Claude (round-3) | **Phase 13 完成**：E2E harness——`GET /chat/trace` 控制端点读活跃会话 tool-call trace（纯函数 `extractToolCalls`/`summarizeToolCalls` + bridge `readChatTrace` 截断非密载荷）。让 E2E 能程序化观测 DJ 实际调了哪些工具、传了什么，用于发现不合理设计。4 新测，`make check` + `node --check` 通过。 |
| 2026-07-03 | Claude (round-3) | **Phase 11.1**：按用户反馈把 Phase 11 的"每回合注入 40 个歌单名"改为**可搜索/分页的 `set_list` 工具**（`query` 名字过滤+留空=updated 倒序、`cursor`/`limit`+`nextCursor`+`total`），`buildSetsContext` 瘦身为一行 count 提示（`db.sessions.count()`、不 dump），四语言 prompt/工具描述改指向 set_list。适配大量歌单、token 恒定。`executeSetList` +3 测，`make check`（3547 测试）全绿。 |
| 2026-07-03 | Claude (round-3) | **Phase 12 完成**：歌单来源 UI 过滤（AI/human/导入）。加 `DjSession.origin?`（additive）+ `createSession` 接线 + DJ `set_create` 打 `origin:"ai"`；纯分类器 `src/lib/set-origin.ts` `resolveSetOrigin`（显式优先，否则 imported/ai/human 推断，忽略默认为 true 的 autoExtend）+ `filterSetsByOrigin`，6 测；search-page「歌单」墙加 3 个来源 `FilterChip` + `shown` 过滤，i18n×4 `gallery.origin.*`。`make check`（3548 测试）全绿。 |
| 2026-07-03 | Claude (round-3) | **Phase 11 完成**：DJ 复用已有歌单、避免重复建空集（接 Phase 10 里模型重复建「专注」空集的反馈）。`buildSetsContext` 每回合注入已有歌单名/#S id/曲数（newest-first、上限 40、超出指向 `set_list`），`dj-chat-agent` 与 now-playing 顺序注入；四语言 prompt 加「先复用再新建、别留空集」引导。`buildSetsContext` 5 测 + i18n 断言，`make check`（chat 127 测）全绿。 |
| 2026-07-03 | Claude (round-3) | **Phase 10 完成（手测/E2E 反馈两修复）**：**Fix A** — dj_say 偶尔把 `AgentWriteResult` JSON 当回话显示/朗读（根因：模型偶把结果 JSON 当 assistant 文本，回话路径原样透传，通知+TTS 同 `text` 双错）→ `sanitizeReplyText`（`deliverDjReply` choke point：纯文本透传/解包 dj_say `diff.text`/丢弃其它 JSON），8 新测。**Fix B** — Fish 选中音色持久化 → `selectVoicePatch` 选中即缓存元数据+并入用过列表（`ttsAddedVoiceIds`/`ttsAddedVoiceCache` 去重幂等），下次无需搜索即显示高亮，3 新测；`voice-tts-settings` 接线。`make check` 全绿。 |
| 2026-07-03 | Claude (round-3) | **Phase 8/9 活 LLM 端点 E2E 验证**（Electron + 真 DJ LLM + 中文 UI，控制端点 `POST /voice/transcript` 注入 + `GET /notifications`/`GET /sessions` 读回）：注入①「放点更 chill 的，从我的库里挑」→ dj_say **中文**回话「…正在为你找一些轻松的 chill 曲目，并准备创建歌单…」+ 建「Chill Vibes」10 首；注入②「挑适合专注工作、安静不吵的歌建歌单」（无对应标签→**必须世界知识判断**）→ 中文回话「…挑选适合专注工作的安静音乐…」+ 建**「专注工作」100 首**（有界、命名贴切、非 5731 全量 dump）。**证实 Phase 8**：中文 system prompt + 中文工具描述下模型工具选择正常、dj_say 正常、回话随 UI 语言。**Phase 9**：无标签的氛围请求走了搜索+判断路径、产出有界策展集（非整批塞入）。**已知**：`/sessions` 只暴露计数不暴露 tool-call 序列，判断"质量"（100 首是否都安静）需人工听感；留下一个空「专注」(0) 集（模型一次弃用的重复创建，minor）；5731 大库判断式策展多步、~60s、贴近 12-step 预算。 |
| 2026-07-03 | Claude (round-3) | **Phase 9 完成**：DJ 策展纪律。用户反馈「一股脑塞歌单」——在四语言 system prompt 加「策展纪律—宁精勿滥」段：流派/心情/氛围请求不整批 `set_add_by_search`，先 `library_search` 取候选按 title/artist 用**世界知识**筛选、`set_add_tracks` 只加符合的；`set_add_by_search` 留给用户自维护标签等无歧义场景。`dj-chat-i18n.test.ts` 加各语言特征短语 + `set_add_tracks` 断言（10 测）。`make check` 全绿。行为质量需活 LLM 手测。 |
| 2026-07-03 | Claude (round-3) | **Phase 8 完成**：LLM-facing system prompt + 23 工具 description 按界面语言 i18n（PM 覆写默认建议、拍板翻译）。低风险实现：英文 canonical + fallback——`djChatSystemPrompt(locale)`（zh/ja/ko + 未知→英文）+ `dj-chat-tool-descriptions.ts` 只加 override map（缺译→`""`→保英文），`createDjChatTools({locale})` 在 return 前后处理覆盖 `description`（不改 23 个 `tool()` 主体）；字面 token（`#T/#S/#R`、工具名、`cursor/nextCursor`、`TrackBriefs`）不译。`dj-chat-agent` 用 `uiLocale()` 接线。9 新单测（含 23 工具 parity），`make check`（typecheck+biome+3524 测试）全绿。回话语言（Phase 3 补丁）+ Settings 工具说明（`chat.tools.*`）此前已本地化，本 phase 补齐喂给模型的那层。 |
| 2026-07-03 | Claude (round-2) | **Phase 7 完成 + round-2 收尾**：Composer 录音按钮（chip 输入框旁 mic，点击 toggle 录音，录音态经 controller 新增多监听 `subscribeState` + `useVoiceRecordingState`，不夺 use-voice-dj callbacks；`chat.voiceRecord/voiceStop` i18n×4）。**tool-call 性能核查（端点 E2E 实测）**：多-tool 一轮内存 +19MB（无泄漏）、`renderTrace` 仅 dock 10 commits/44ms（非全树，规则 6 隔离成立），印证撤 bus/instrument 的零副作用设计。另：DJ 回话语言随 UI（Phase 3 补丁，`i18n.language`）+ dock 气泡语言正常。`make check` 全绿。 |
| 2026-07-03 | Claude (round-2) | **Phase 6 完成**：播放淡入淡出 / crossfade。新增 `src/player/audio-fade.ts`（`createAudioFader` 分步 ramp，注入 timer 可测，5 单测）；`MediaEngine` 集成——`targetVolume`/`crossfadeEnabled`/`crossfadeMs` + `setCrossfade()`，`play()` 淡入（先置 0 再 ramp 到 target）、`pause()` 淡出再暂停、`setVolume()` 设 target+取消 fade、`stop()` 取消 fade。`AppSettings.crossfadeEnabled`（默认 true）/`crossfadeMs`；`hydratePlaybackSettings` 启动应用 + App effect 实时应用；Settings→播放「淡入淡出」开关 + i18n×4。性能：30ms setTimeout 步进、无 rAF、只改 element 音量属性。`make check`（149 player 测）全绿。 |
| 2026-07-03 | Claude (round-2) | **§12 Follow-up 记录 + Phase 5 完成**：用户 Electron 手测反馈 4 优化 + 性能红线，记入新 §12（Phase 5/6/7）。**Phase 5**：DJ 工具活动展示打磨——`ChatActivityPopover`/`deriveChatActivity` 加 per-tool lucide 图标（`dj-tool-display.toolIconName`，16 图标）+ running 工具显示 `summarizeToolInput` 的核心参数（query/name/title）作明细行；dj_say 从 dock 气泡排除（顶部回话不双显）；**撤掉** round-1 起过的 tool-activity bus + instrument-every-execute（零 tool-call 开销，对齐性能红线）。8 新单测，`make check` 全绿。 |
| 2026-07-02 | DoodleBear | Initial draft：Fish Audio TTS（拉取/搜索/添加音色）+ Groq ASR + push-to-talk 全局快捷键 → 现有工具 DJ → 新增 `dj_say` reply 工具 → 左上角通知 + 可选朗读（音乐 ducking）。参考 anysoul 客户端实现，改直连 BYOK（无后端）。踩现有地基：DJ chat runtime / 通知栈 / 全局快捷键 / provider registry。四阶段：ASR 基础设施 → TTS 基础设施 → 语音对话闭环 → QA/i18n/VAD。8 个 open question 待 PM 拍板。 |
| 2026-07-02 | DoodleBear | PM 拍板 Q1-Q5/Q7：用 `dj_say` 工具；push-to-talk **默认 hold**（Settings 可选，暴露后台无 key-up 的退化约束）；朗读 duck **渐变过渡**（`djVoiceDuckRampMs`）；**不开专用会话、继承当前活跃会话** + 上下文改**动态滑动窗口**（新增 §3.4 `selectContextWindow`，替代 `contextStartIndex`/compaction）；付费生成**要确认**；快捷键**默认不绑定**。Q6/Q8 采用默认。相应更新 §2.2/§2.3/§3.1/§3.4/§4.4/§4.5/§5.2/§6 Phase 3/§10。 |
| 2026-07-03 | Claude | **Fish 模型更新 + 默认改免费（用户补充）**：`FishTtsBackend` union 扩为 `s2.1-pro-free`/`s2.1-pro`/`s2-pro`/`s1`；新增 `FISH_TTS_BACKENDS` + `DEFAULT_FISH_BACKEND = "s2.1-pro-free"`（免费开发模型，同 S2.1-Pro 质量/83 语言，最适合 BYOK 个人自用）。provider/registry/Settings 默认全部改走 `DEFAULT_FISH_BACKEND`；Settings backend 下拉列全 4 项（i18n×4 加 `backendS21Free`/`backendS21`）；加 fish-provider 默认-backend 单测。Q8 Resolved。 |
| 2026-07-03 | Claude | **TTS 双开关合并（用户反馈）**：原「启用文字转语音」(`ttsEnabled` 母开关) 与「自动朗读回话」(`djReplyAutoSpeak`) 对主用例重复——两个都得开才出声。合并为**单一** `djReplyAutoSpeak`：删除 `ttsEnabled` 字段 + UI 开关 + `voice.tts.enable/enableHint` i18n×4；`isTtsReady` 改为 `key && voiceId`（配好即就绪，Preview/重播只看 key+音色）。registry 测试更新，`make check` 全绿。 |
| 2026-07-03 | Claude (TDD) | **Phase 4 完成**：QA / 权限 / i18n 收口。Electron 麦克风权限接线（`main.cjs` `setPermissionRequestHandler` grant + `package.json` `build.mac.extendInfo.NSMicrophoneUsageDescription`）；log 扫描确认新模块无 `console.*`、日志无文本/key/audio（仅 provider/bytes/quota）；i18n×4 脚本核对 `voice.*` 81 键 + `chat.tools.dj_say` + nav/shortcut 键完全一致；`vite build`（✓ 5.48s）+ `node --check electron/main.cjs` 通过。VAD 静音自动停 deferred（字段预留）。PRD 状态转 Implemented。 |
| 2026-07-03 | Claude (TDD) | **Phase 3 完成**：语音对话闭环接线。`voice.talkToDj` 快捷键（in-app hold keydown/keyup + 后台 toggle 退化；默认不绑定）→ `VoiceInputController` → `use-voice-dj` wiring（`getActiveDjChatRuntimeActor` 继承当前会话；`routeVoiceTranscript` send/interrupt；`dj-reply-bus` + `dj_say` 工具/`executeDjSay` → `notify.info` + `postReply`；`lastAssistantPreview` 兜底；`decideApproval` 付费审批通知/`voiceAutoApproveGenerate`）+ `selectContextWindow` 动态滑动窗口（接入 `dj-chat-agent.sendMessages`，`contextStartIndex` 取 max）+ `createGradientDucker`（`MediaEngine.getVolume()` 新增）+ Settings 加 autoSpeak/duckRamp/autoApprove/inputMode 控件 + AppSettings Phase-3 字段 + i18n×4。TDD：21 个新单测（`selectContextWindow`/`dj_say`/`voice-dj-logic`），`make check`（typecheck+biome+3498 测试）全绿。 |
| 2026-07-03 | Claude (TDD) | **Phase 2 完成**：TTS 基础设施落地。新增 `src/tts/`（`provider.ts` 接口 + `TtsError`/`VoiceModel`；`fish-mapping.ts` 四纯函数；`fish-provider.ts` `listVoices`/`getVoice`/`synthesize` 直连 `getAppFetch()`；`registry.ts` `resolveTtsProvider`/`isTtsReady`）+ `src/voice/`（`tts-playback.ts` 注入式串行队列+批级 duck+URL 生命周期 + `tts-playback-runtime.ts` `synthesizeReply`/`createAudioSink`/`createMediaEngineDucker`）+ `voice-tts-settings.tsx`（Settings「Text-to-Speech」+ My Voices/搜索/Add-by-id/试听/Preview reply/后端·语速·ducking + `SETTINGS_NAV` `voice-tts`/volume-2 + sidebar 图标）+ `AppSettings` tts/duck optional 字段 + `CachedVoiceModel` + i18n×4（`settings.navVoiceTts` + `voice.tts.*`）。TDD：32 个新 Phase-2 单测，`make check`（typecheck+biome+3477 测试）全绿。 |
| 2026-07-03 | Claude (TDD) | **Phase 1 完成**：ASR 基础设施落地。新增 `src/asr/`（`provider.ts` 接口 + `AsrError`；`groq-mapping.ts` 四纯函数；`groq-provider.ts` 直连 `getAppFetch()`；`registry.ts` `resolveAsrProvider`/`isAsrConfigured`/`resolveGroqApiKey` 复用 DJ Groq key）+ `src/voice/`（`voice-input-controller.ts` 注入式录音状态机 + `voice-input-runtime.ts` 生产 wiring/单例）+ `voice-asr-settings.tsx`（Settings「Speech-to-Text」面板 + `SETTINGS_NAV` `voice-asr`/mic + settings-page 渲染 + sidebar mic 图标）+ `AppSettings` asr/voice optional 字段（不 bump DB）+ i18n×4（`settings.navVoiceAsr` + `voice.asr.*`）。TDD：32 个新单测（映射/provider/registry/controller），`make check`（typecheck+biome+3455 测试）全绿。 |
