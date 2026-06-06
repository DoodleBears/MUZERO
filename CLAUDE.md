# MUZERO

**本地优先的 AI DJ 音乐播放器。** 一个 LLM 充当 DJ，不断编写 prompt（`TrackBrief`）调用音乐生成 API 生成歌曲，以「续上歌单」的方式无限延展播放列表。无后端、无云服务——所有数据（歌曲、音频、会话、设置）都存在设备本地的 IndexedDB。通过 Tauri 2 分发到桌面端（macOS / Windows / Linux）和移动端（iOS / Android）。

> 本仓库的工作流命令复用 doodlekuma.com 的 `.cursor/commands/`（`commit` / `implement` / `prd-create` / `pr-create` / `issue-create` / `switch-branch`），PRD 模板见 [`docs/prd/prd-template.md`](docs/prd/prd-template.md)。

## 技术栈

- **壳层**：Tauri 2（桌面 + 移动）。Rust 侧只托管 WebView，并提供 `http` / `fs` / `os` / `dialog` 插件。整个 App 就是前端。
- **构建**：Vite 8 + React 19 + TypeScript（不是 Astro/Next）
- **样式**：Tailwind CSS v4（`@tailwindcss/vite`，CSS-first `@theme`，无 `tailwind.config`）
- **UI 库**：COSS UI（基于 Base UI，shadcn 风格 registry）+ LiveKit audio visualizer
- **数据请求**：TanStack Query（请求/响应式异步：provider 健康检查、未来托管 provider）
- **本地响应式读**：Dexie `useLiveQuery`（IndexedDB 数据流进 UI）
- **本地状态**：Zustand（播放 transport + DJ 编排循环）
- **虚拟化**：TanStack Virtual（无限歌单/队列只挂载可见行）
- **持久化**：Dexie 4（IndexedDB），DB 名 `muzero-db`
- **AI**：Vercel AI SDK（`ai` v6 + `@ai-sdk/openai` / `@ai-sdk/anthropic`），BYOK
- **音乐生成**：可插拔 `MusicGenProvider`（默认离线 `mock`；`acestep-local` 接 [`../acestep-local`](../acestep-local) 的 ACE-Step 本地服务）
- **测试**：Vitest 4 + Testing Library + `fake-indexeddb`
- **Lint/format**：Biome 2 + lefthook 提交门禁
- **校验**：Zod 4（`TrackBrief` schema 是 DJ↔musicgen↔DB 的唯一契约）

## 核心循环（DJ 续歌）

```
seed/vibe ──▶ DjBrain (LLM, generateObject)
                   │  写出 TrackBrief[]（caption + lyrics + bpm/key/...）
                   ▼
           DjEngine.draft ──▶ 创建 pending Track，追加进 session.trackIds（队列）
                   │
                   ▼
           DjEngine.materializeNext ──▶ MusicGenProvider.generate ──▶ WAV Blob
                   │                         (ACE-Step :8085 / mock)
                   ▼
           markTrackReady：Blob 存入 mediaBlobs，Track→ready
                   │
        播放器消费队列；当 upcoming ≤ refillThreshold 时
                   ▼
           DjEngine.refillIfNeeded ──▶ 回到 draft（续上歌单）
```

- **`TrackBrief` 是唯一契约**（[`src/dj/dj-brief-schema.ts`](src/dj/dj-brief-schema.ts)）。DJ 写它、provider 消费它、DB 存它。改字段先改这个 Zod schema，三处自动对齐。
- **DJ 永远不知道在跟哪个 provider 说话**。它只写 provider-agnostic 的 brief；adapter 负责翻译（`toAceStepPayload`），不让 provider 概念泄漏进 DJ/DB。
- **`DjBrain` / `MusicGenProvider` 都是接口，依赖注入**。`createDjEngine({ db, brain, provider })` 让整个 draft→generate→enqueue 循环能在没有网络/API key/模型的情况下被单测覆盖（见 [`src/dj/dj-engine.test.ts`](src/dj/dj-engine.test.ts)）。

## 硬规则

### 1. 本地优先，无后端，无云

所有持久化都在 IndexedDB `muzero-db`。没有服务器、没有遥测上报、没有账号系统。新功能默认不引入网络依赖；唯一的出站请求是 (a) 用户配置的 LLM API（BYOK）和 (b) 用户配置的音乐生成 endpoint（默认 localhost ACE-Step）。

### 2. BYOK / 密钥纪律

LLM 与托管 provider 的 API key 只存在 IndexedDB 的 `settings` 行（设备本地），由用户在 Settings 录入。**禁止**把任何密钥写进 bundle、`.env`（committed）、URL、日志或遥测。`.env.example` 只放非密的默认值（用于首次填表）。密钥从 settings 直达 provider，不经任何中转。

### 3. 不引入 hidden backend flags

不要把行为门控藏在 `localStorage` / URL flag / `window.*` global / 隐藏环境变量后。需要 runtime toggle 就建可见的 Settings 控件。回滚 = `git revert` + 重新发版，不是 runtime kill switch。（沿用 doodlekuma `feedback_no_hidden_backend_flags`。）

### 4. Brand / codename 分层

只重命名品牌层（UI 文案、产品名）。**codename 层保持稳定**：IndexedDB 名 `muzero-db`、表名、id 前缀（`trk_` / `ses_` / `blb_`）、`TrackBrief` 字段名、provider id（`acestep-local` / `mock`）跨品牌 pivot 不变——否则用户本地数据读不出来。

### 5. MusicGenProvider 边界

- 新增音乐源（Replicate / ElevenLabs Music / Suno / 自建）= 实现 [`MusicGenProvider`](src/musicgen/provider.ts) 接口 + 在 [`src/musicgen/registry.ts`](src/musicgen/registry.ts) 注册 + 在 `AppSettings.musicGenProvider` union 加 id。**不要**在 DJ/store/UI 里 `if (provider === "acestep")` 散落分支。
- provider 必须返回 `{ blob, mime, durationSec }`；音频字节进 `mediaBlobs` 表，**永远不进** `tracks` 行（保持列表查询轻量，虚拟化才有意义）。
- provider 实现里凡是 HTTP 都走 [`getAppFetch()`](src/lib/platform.ts)（Tauri 内绕过 CORS），不要直接 `window.fetch` 调外部/localhost。
- 实现 ACE-Step adapter 前先看 [`../acestep-local/README.md`](../acestep-local/README.md) 和 `examples/request.json`——请求字段（`caption` / `lyrics` / `duration` / `bpm` / `keyscale` / `inference_steps` …）凭记忆几乎必错。

### 6. Zustand selector 纪律

- 组件用最小 selector 订阅（`usePlayerStore((s) => s.isPlaying)`），**禁止**整 store 订阅导致播放进度每帧刷新全树。
- 非响应式单例（`AudioEngine`、liveQuery 订阅、`DjEngine`、pump 标志）放模块作用域，**不进 store state**，避免被组件 select 触发重渲染。
- 列表/集合用 Dexie `useLiveQuery` 读，不要把可由 DB 派生的远端数据塞进 Zustand。

### 7. Vitest 不止纯函数

DJ 续歌是这个 App 的命脉。必须有 integration test 覆盖：draft→pending→materialize→ready→refill 的连续流程（用 `fake-indexeddb` + 注入 canned brain + mock provider），确保一次改动不会悄悄破坏队列顺序、续歌触发（`shouldAutoExtend`）、schema 校验或 blob 落地。纯队列数学（[`src/player/queue.ts`](src/player/queue.ts)）单独穷举单测。

### 8. Console / 日志

`src/**` 不直连 `console.*`，一律走 [`src/lib/logger.ts`](src/lib/logger.ts)（`debug`/`info` 在 prod 静默，`warn`/`error` 保留）。Biome 已 warn `noConsole`。

### 9. 移动端约束

- 布局移动优先（底部 tab + 安全区 inset，见 `styles.css` 的 `env(safe-area-inset-*)`）。
- 音频用单个 `HTMLAudioElement`（[`AudioEngine`](src/player/audio-engine.ts)），object-URL revoke-before-replace，不泄漏 Blob URL；WebAudio graph 在首次 play（用户手势）时懒建。
- 出站 HTTP 走 Tauri `http` 插件，避免移动 WebView 的 CORS / mixed-content。

## 项目结构

```
MUZERO/
├── src/
│   ├── main.tsx / App.tsx / styles.css     # 入口 + 壳 + Tailwind v4 主题
│   ├── pages/                              # now-playing / queue / sessions / settings
│   ├── components/
│   │   ├── player/                         # player-bar, aura-visualizer
│   │   ├── dj/                             # dj-console
│   │   ├── library/                        # track-row, virtual-track-list（TanStack Virtual）
│   │   └── ui/                             # 本地 COSS/shadcn 兼容 primitives
│   ├── db/                                 # Dexie：muzero-db, types, repositories
│   ├── dj/                                 # DJ 引擎：brief-schema, prompt, engine, brain-ai
│   ├── musicgen/                           # provider 接口 + acestep-local + mock + wav
│   ├── player/                             # queue（纯数学）+ audio-engine
│   ├── stores/                             # player-store（Zustand，编排循环）
│   ├── ai/                                 # Vercel AI SDK model 解析（BYOK）
│   ├── hooks/ lib/                         # useLiveQuery 包装 / utils / logger / platform
│   └── i18n/locales/{en,zh,ja,ko}/         # 文案 catalog（en 默认）
├── src-tauri/                              # Tauri 2 壳（desktop + mobile）
│   ├── Cargo.toml / tauri.conf.json / build.rs
│   ├── src/lib.rs（mobile_entry_point）/ main.rs
│   └── capabilities/default.json           # http/os/fs/dialog 权限
├── docs/prd/                               # PRD（命名 YYYYMMDD-<topic>-prd/）
├── .cursor/commands/                       # 复用自 doodlekuma 的工作流命令
├── components.json                         # shadcn/COSS registry（@coss, @livekit）
├── biome.json / lefthook.yml / vitest.config.ts / vite.config.ts
```

**导航口径**：
- 「DJ 怎么决定下一首」→ [`src/dj/dj-engine.ts`](src/dj/dj-engine.ts) + [`src/dj/dj-prompt.ts`](src/dj/dj-prompt.ts)
- 「续歌何时触发」→ [`src/player/queue.ts`](src/player/queue.ts) `shouldAutoExtend` + store `maybeRefill`
- 「歌曲数据形状 / brief 字段」→ [`src/dj/dj-brief-schema.ts`](src/dj/dj-brief-schema.ts) + [`src/db/types.ts`](src/db/types.ts)
- 「音频怎么生成」→ [`src/musicgen/`](src/musicgen/)（`acestep-local.ts` 是参考 adapter）
- 「播放 transport / 队列编排」→ [`src/stores/player-store.ts`](src/stores/player-store.ts)
- 「可视化」→ [`src/components/player/aura-visualizer.tsx`](src/components/player/aura-visualizer.tsx)（接 `AudioEngine.getAnalyser()`）

## 常用命令

```bash
pnpm install              # 安装依赖
pnpm dev                  # Vite 浏览器开发（localhost:1420）
pnpm test                 # Vitest 全量
pnpm test:watch           # Vitest watch
pnpm typecheck            # tsc --noEmit
pnpm lint                 # Biome
pnpm build                # tsc + vite build → dist/

pnpm desktop:dev          # Tauri 桌面开发（需要 Rust 工具链）
pnpm desktop:build        # 打桌面安装包
pnpm ios:init / ios:dev   # iOS（需 Xcode）
pnpm android:init / android:dev   # Android（需 Android SDK/NDK）
```

> 本地开发时用户通常已经 `pnpm dev` 在跑，HMR 实时构建——开发中**不要**重复 `pnpm dev` / `pnpm build`，直接改代码即可。

## UI 库接入（COSS UI + LiveKit visualizer）

`src/components/ui/*` 目前是本地 shadcn/COSS 兼容 primitives（Button/Card/Input/Slider），API 与官方一致，是 registry 拉取前的种子。要换成官方 COSS 组件：

```bash
pnpm dlx shadcn@latest init @coss/style        # 全量主题（neutral 色 + sidebar + 字体 + 组件）
pnpm dlx shadcn@latest add @coss/ui            # 仅组件
pnpm dlx shadcn@latest add @coss/<component>   # 单个组件，API 不变，调用处无需改
```

音频可视化目前用自研的 [`aura-visualizer.tsx`](src/components/player/aura-visualizer.tsx)（canvas + WebAudio AnalyserNode，直接 tap 正在播放的本地音频）。这是**刻意选择**：LiveKit 官方 Aura 组件是 shader-based、为 LiveKit WebRTC *agent audio track* 设计的，需要 LiveKit room + `livekit-client`，与 MUZERO「本地生成 WAV、无云」的架构不匹配。registry 已在 `components.json` 配好（`@agents-ui` → `https://livekit.com/ui/r/{name}.json`），未来若引入 LiveKit 音频源可直接：

```bash
pnpm dlx shadcn@latest add @agents-ui/agent-audio-visualizer-aura
```

COSS UI 文档：https://coss.com/ui/llms.txt

## i18n

四语言 en（默认）/ zh / ja / ko，catalog 在 `src/i18n/locales/{locale}/common.json`。**当前 UI 字符串仍内联在组件里**（v0.1 scaffold 状态）——后续把它们迁进 catalog 并接 `react-i18next`，禁止在组件里新增按 locale 分支的大对象。
