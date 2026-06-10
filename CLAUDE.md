# MUZERO

**本地优先的 AI DJ 音乐 / 视频播放器。** 一个 LLM 充当 DJ，不断编写 prompt（`TrackBrief`）调用音乐生成 API 生成歌曲，以「续上歌单」的方式无限延展播放列表。**也是一个像 YouTube Music 的播放器**：用户可上传自己的音频 / 视频（MV）做混合「歌单 / 视频单」，每首歌可加 tag + 备注 + 封面（"音乐承载回忆"），可搜索、可喂给 DJ。无后端、无云服务——所有数据都存在设备本地的 IndexedDB。通过 Tauri 2 分发到桌面端（macOS / Windows / Linux）和移动端（iOS / Android）。

> 本仓库的工作流命令复用 doodlekuma.com 的 `.cursor/commands/`（`commit` / `implement` / `prd-create` / `pr-create` / `issue-create` / `switch-branch`），PRD 模板见 [`docs/prd/prd-template.md`](docs/prd/prd-template.md)。

## 技术栈

- **壳层**：**Electron（桌面主力）+ Tauri 2（保留可跑 + 移动）**。因 WebView 在不同平台不稳定（WKWebView/WebView2 UI 问题），桌面已转向 Electron；Tauri 暂留。两者都藏在 [`src/lib/desktop`](src/lib/desktop/bridge.ts) 平台抽象层后（`resolveDesktopBridge()` 按运行时选 electron/tauri/web）。整个 App 就是前端。Electron 主进程见 [`electron/`](electron/main.cjs)（preload + IPC + `muzfetch://` CORS 代理）。
- **构建**：Vite 8 + React 19 + TypeScript（不是 Astro/Next）
- **样式**：Tailwind CSS v4（`@tailwindcss/vite`，CSS-first `@theme`，无 `tailwind.config`）
- **UI 库**：COSS UI（基于 Base UI，shadcn 风格 registry）+ LiveKit audio visualizer
- **数据请求**：TanStack Query（请求/响应式异步：provider 健康检查、未来托管 provider）
- **本地响应式读**：Dexie `useLiveQuery`（IndexedDB 数据流进 UI）
- **本地状态**：Zustand（播放 transport + DJ 编排循环）
- **虚拟化**：TanStack Virtual（无限歌单/队列只挂载可见行）
- **持久化**：Dexie 4（IndexedDB），DB 名 `muzero-db`
- **AI**：Vercel AI SDK（`ai` v6 + `@ai-sdk/openai` / `@ai-sdk/anthropic`），BYOK
- **音乐生成**：可插拔 `MusicGenProvider`（默认离线 `mock`；`cloud` 是 BYOK 云 API——submit→poll→download 异步任务流，vendor 未定，mapping 隔离在 `cloud-provider.ts` 三个纯函数里）
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
           DjEngine.materializeNext ──▶ MusicGenProvider.generate ──▶ 音频 Blob
                   │                         (cloud BYOK API / mock)
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

**本地优先 = 存储层无后端无云**：所有持久化都在 IndexedDB `muzero-db`，没有 MUZERO 服务器、没有遥测上报、没有账号系统。但**音乐生成和 LLM DJ 是 BYOK 云 API 调用**——这不违反本地优先，因为 (a) key 和 endpoint 由用户配置、只存设备本地，(b) MUZERO 自己不持有任何服务端。唯一的出站请求就是这两个用户配置的第三方 API。新功能默认不引入 MUZERO 自有后端。

### 2. BYOK / 密钥纪律

LLM 与托管 provider 的 API key 只存在 IndexedDB 的 `settings` 行（设备本地），由用户在 Settings 录入。**禁止**把任何密钥写进 bundle、`.env`（committed）、URL、日志或遥测。`.env.example` 只放非密的默认值（用于首次填表）。密钥从 settings 直达 provider，不经任何中转。

### 3. 不引入 hidden backend flags

不要把行为门控藏在 `localStorage` / URL flag / `window.*` global / 隐藏环境变量后。需要 runtime toggle 就建可见的 Settings 控件。回滚 = `git revert` + 重新发版，不是 runtime kill switch。（沿用 doodlekuma `feedback_no_hidden_backend_flags`。）

### 4. Brand / codename 分层

只重命名品牌层（UI 文案、产品名）。**codename 层保持稳定**：IndexedDB 名 `muzero-db`、表名、id 前缀（`trk_` / `ses_` / `blb_`）、`TrackBrief` 字段名、provider id（`cloud` / `mock`）跨品牌 pivot 不变——否则用户本地数据读不出来。

### 5. MusicGenProvider 边界

- **当前方向是 cloud BYOK API**（vendor 待定，可能 Replicate / ElevenLabs Music / Suno-style / …）。**本地 ACE-Step 已下线**（不再用本地模型）。
- 接入具体云 vendor = 只改 [`src/musicgen/cloud-provider.ts`](src/musicgen/cloud-provider.ts) 的三个纯函数 `mapBriefToBody` / `parseCreate` / `parseStatus`（vendor-specific 请求/响应映射）；submit→poll→download 流程、abort、DB 写入都不动。异步轮询引擎在 [`cloud-job.ts`](src/musicgen/cloud-job.ts)（注入 `now`/`sleep`，可确定性单测）。
- 若要再加一个独立 provider = 实现 [`MusicGenProvider`](src/musicgen/provider.ts) 接口 + 在 [`registry.ts`](src/musicgen/registry.ts) 注册 + 在 `AppSettings.musicGenProvider` union 加 id。**不要**在 DJ/store/UI 里 `if (provider === "cloud")` 散落分支。
- provider 必须返回 `{ blob, mime, durationSec }`；音频字节进 `mediaBlobs` 表，**永远不进** `tracks` 行（保持列表查询轻量，虚拟化才有意义）。
- provider 实现里凡是 HTTP 都走 [`getAppFetch()`](src/lib/platform.ts)（→ 桌面 bridge：Electron `muzfetch://` 代理 / Tauri http 插件 / web global，绕过 CORS / mixed-content），不要直接 `window.fetch` 调外部 API。

### 6. Zustand selector 纪律

- 组件用最小 selector 订阅（`usePlayerStore((s) => s.isPlaying)`），**禁止**整 store 订阅导致播放进度每帧刷新全树。
- 非响应式单例（`AudioEngine`、liveQuery 订阅、`DjEngine`、pump 标志）放模块作用域，**不进 store state**，避免被组件 select 触发重渲染。
- 列表/集合用 Dexie `useLiveQuery` 读，不要把可由 DB 派生的远端数据塞进 Zustand。

### 7. Vitest 不止纯函数

DJ 续歌是这个 App 的命脉。必须有 integration test 覆盖：draft→pending→materialize→ready→refill 的连续流程（用 `fake-indexeddb` + 注入 canned brain + mock provider），确保一次改动不会悄悄破坏队列顺序、续歌触发（`shouldAutoExtend`）、schema 校验或 blob 落地。纯队列数学（[`src/player/queue.ts`](src/player/queue.ts)）单独穷举单测。

### 8. Console / 日志

`src/**` 不直连 `console.*`，一律走 [`src/lib/logger.ts`](src/lib/logger.ts)（`debug`/`info` 在 prod 静默，`warn`/`error` 保留）。Biome 已 warn `noConsole`。

### 9. 桌面优先 + 响应式

- **当前优先级：先把桌面端做好，再调移动端**——但布局从一开始就按 responsive design 写，不要堆砌只在某一端成立的写法。
- **导航 = 底部 `PlayerDock` 簇的第 3 行**（[`player-dock.tsx`](src/components/shell/player-dock.tsx)）：一个**单一 rounded 容器、player-first 三行结构**（Poweramp 风）——行1 封面+标题+单一播放/暂停（点封面/标题进 Now Playing：桌面切 `now` tab、移动开全屏 sheet）、行2 整宽进度条 + 状态行、行3 [`nav-row.tsx`](src/components/nav/nav-row.tsx) 扁平等距导航（**queue / search / sets / settings 四项，去掉 now**）。**不引入 sidebar**，导航不再是独立浮动 dock。Magic UI 放大 dock（[`dock-nav.tsx`](src/components/nav/dock-nav.tsx) / [`ui/dock.tsx`](src/components/ui/dock.tsx)）已降级（`dock-nav` 仅留 `Tab` 类型导出，组件不再渲染）；nav-row 桌面用 CSS `hover:scale` 微放大、触摸是 ≥44px tap 区。页面/共享元素过渡见 [`view-transition.ts`](src/lib/view-transition.ts)（原生 VT + reduced-motion 兜底）与 motion `layoutId`。
- **断点纪律**：`md` 是内容布局的桌面/移动分界。页面内容用响应式容器（表单 `mx-auto max-w-2xl`、Now Playing 在 `lg+` 变双栏 + 常驻队列），不要在桌面宽窗里把内容拉满或留大片空白。Tauri 默认窗口是桌面尺寸（1180×780，见 `tauri.conf.json`）。
- 移动端细节（已埋好，后续打磨）：安全区 inset（`styles.css` 的 `env(safe-area-inset-*)`）、触摸友好控件、后台音频。
- 音频用单个 `HTMLAudioElement`（[`AudioEngine`](src/player/audio-engine.ts)），object-URL revoke-before-replace，不泄漏 Blob URL；WebAudio graph 在首次 play（用户手势）时懒建。
- 出站 HTTP 走 `getAppFetch()` → 桌面 bridge（见规则 10），避免 WebView 的 CORS / mixed-content。

### 10. 桌面壳层抽象（Electron / Tauri / web）

- **所有 native 访问一律走 [`resolveDesktopBridge()`](src/lib/desktop/bridge.ts)**（CORS-free fetch / pickFolder / readDir / readFile / saveFile / openExternal）。**禁止** `src/**` 直接 `import('@tauri-apps/...')`、读 `window.muzero`、或散落 `if (isTauri())` 行为分支（与 provider / visualizer registry 同纪律）。加能力 = 扩 `DesktopBridge` 接口 + 三个实现（[`tauri.ts`](src/lib/desktop/tauri.ts) / [`electron.ts`](src/lib/desktop/electron.ts) / [`web.ts`](src/lib/desktop/web.ts)）。判定「能否读本地文件夹」用 `hasFolderAccess()`，不要 `isTauri()`。
- **Electron 安全**：`contextIsolation:true + sandbox:true + nodeIntegration:false`；preload 只经 `contextBridge` 暴露最小 IPC（[`electron/preload.cjs`](electron/preload.cjs)）。CORS 绕过用特权 `muzfetch://` 流式协议（`net.fetch` 主进程，[`electron/fetch-proxy.cjs`](electron/fetch-proxy.cjs)），**不**用 `webSecurity:false`。fs 用主进程内存 allowlist + realpath 校验（[`electron/ipc.cjs`](electron/ipc.cjs)），镜像 Tauri「运行时逐文件夹授权」，每次启动从 `importFolders` 重授。
- **codename 层不变**：Electron 与 Tauri 是不同 origin/userData，各自独立 IndexedDB——切壳不迁移数据（已知限制）。但 db 名 `muzero-db` / id 前缀 / provider id 跨壳保持一致。
- 重活不卡主线程：见 [`src/workers`](src/workers/)（解析 + 写库 + R2 hash/sign 进 Web Worker），bridge 的网络/fs 调用留主线程（worker 里没有 Tauri internals / Electron preload）。

## 项目结构

```
MUZERO/
├── src/
│   ├── main.tsx / App.tsx / styles.css     # 入口 + 壳（顶 header + main + PlayerDock 三行底栏）+ Tailwind v4 + view-transition CSS
│   ├── pages/                              # now-playing / queue / search / sessions / settings
│   ├── components/
│   │   ├── shell/                          # player-dock（统一三行底栏：信息+播放 / 进度 / 导航）
│   │   ├── nav/                            # nav-row（扁平等距导航，PlayerDock 第3行）；dock-nav/dock 已降级
│   │   ├── player/                         # track-identity-row / progress-scrubber / player-status-line（dock 行）+ now-playing-sheet（移动全屏）+ media-stage（video→cover→title）+ aura-visualizer（VisualizerHost 薄壳）
│   │   ├── dj/                             # dj-console
│   │   ├── track/                          # annotation-editor（tags + note + cover）
│   │   ├── library/                        # track-row, virtual-track-list（TanStack Virtual）
│   │   └── ui/                             # 本地 COSS/shadcn 兼容 primitives + dock（Magic UI, motion，已降级）
│   ├── db/                                 # Dexie：muzero-db(v2), types, repositories
│   ├── dj/                                 # DJ 引擎：brief-schema, prompt, engine, brain-ai
│   ├── musicgen/                           # provider 接口 + cloud(BYOK) + cloud-job(轮询) + mock + wav
│   ├── visualizer/                         # 可视化 registry（复刻 musicgen）：types/registry/host + spectrum(自研 canvas) + scene(twgl shader, 懒加载)
│   ├── player/                             # queue + transport（纯：进度/状态/repeat）+ media-engine（<video>，音视频通吃）
│   ├── stores/                             # player-store（编排循环 + 上传 + 显示模式）+ ui-store（sheet 开合，ephemeral）
│   ├── ai/                                 # Vercel AI SDK model 解析（BYOK）
│   ├── hooks/ lib/                         # use-media / track-search / track-display / media-probe / view-transition(+react) / ...
│   ├── lib/desktop/                        # 桌面壳层抽象：bridge(resolveDesktopBridge) + tauri/electron/web 三实现
│   ├── workers/                            # 重活 Web Worker（解析+写库+R2 hash/sign，主线程不卡）
│   └── i18n/locales/{en,zh,ja,ko}/         # 文案 catalog（en 默认）
├── electron/                               # Electron 主进程（主力桌面壳）：main.cjs + preload.cjs + ipc.cjs(fs allowlist) + fetch-proxy.cjs(muzfetch)
├── src-tauri/                              # Tauri 2 壳（保留可跑 + 移动）
│   ├── Cargo.toml / tauri.conf.json / build.rs
│   ├── src/lib.rs（mobile_entry_point + allow_read_path）/ main.rs
│   └── capabilities/default.json           # http/os/fs/dialog 权限
├── docs/prd/                               # PRD（命名 YYYYMMDD-<topic>-prd/）
├── .cursor/commands/                       # 复用自 doodlekuma 的工作流命令
├── components.json                         # shadcn/COSS registry（@coss, @agents-ui）
├── Makefile                                # 快捷命令入口（make help）
├── biome.json / lefthook.yml / vitest.config.ts / vite.config.ts
```

**导航口径**：
- 「DJ 怎么决定下一首」→ [`src/dj/dj-engine.ts`](src/dj/dj-engine.ts) + [`src/dj/dj-prompt.ts`](src/dj/dj-prompt.ts)
- 「续歌何时触发」→ [`src/player/queue.ts`](src/player/queue.ts) `shouldAutoExtend` + store `maybeRefill`（仅 `config.autoExtend` 的 DJ 集）
- 「歌曲数据形状 / brief 字段」→ [`src/dj/dj-brief-schema.ts`](src/dj/dj-brief-schema.ts) + [`src/db/types.ts`](src/db/types.ts)
- 「音频怎么生成」→ [`src/musicgen/`](src/musicgen/)（`cloud-provider.ts` 是 BYOK 云 adapter，vendor mapping 在三个纯函数里）
- 「播放 transport / 队列编排 / 上传」→ [`src/stores/player-store.ts`](src/stores/player-store.ts)
- 「stage 显示什么（video→cover→title 回退）」→ [`src/lib/track-display.ts`](src/lib/track-display.ts) `resolveStageContent` + [`media-stage.tsx`](src/components/player/media-stage.tsx)
- 「上传的视频/音频怎么进库」→ store `addUploads` + [`src/lib/media-probe.ts`](src/lib/media-probe.ts) + repo `createUploadedTrack`
- 「tag/备注/封面（注释）」→ [`src/components/track/annotation-editor.tsx`](src/components/track/annotation-editor.tsx) + repo `setTrackTags/Note/Cover`
- 「搜索」→ [`src/lib/track-search.ts`](src/lib/track-search.ts)（纯函数）+ [`src/pages/search-page.tsx`](src/pages/search-page.tsx)
- 「单个媒体元素」→ [`media-engine.ts`](src/player/media-engine.ts)（持久 `<video>`，`getMediaEngine().getAnalyser()`）
- 「可视化样式（频谱 / shader 场景）」→ [`src/visualizer/`](src/visualizer/)：可插拔 registry（复刻 musicgen），`VisualizerHost` 按 `AppSettings.visualizerStyle` 选样式 + 单 rAF + 可见性暂停 + reduced-motion；spectrum 自研 canvas（[`spectrum/bands.ts`](src/visualizer/spectrum/bands.ts) 八度对数分带，跟随 `--primary`），scene 用 [twgl.js](src/visualizer/scene/reactive-scene.tsx) WebGL shader（懒加载、无 WebGL 回退 aura）。改样式只动 registry，**别在 UI/store 散落 `if (style===…)`**
- 「流光背景（封面取色多色流光）」→ scene 样式 `scene-flow`（[`scene-shaders.ts`](src/visualizer/scene/scene-shaders.ts) `FLOW_FRAG` 多色 mesh-gradient + `uEffect` 3 变体 + 轻度音频）。取色多色化在 [`image-palette.ts`](src/lib/image-palette.ts) `extractImagePalette`（零依赖 canvas 量化，top-N 去重），存 [`visualizer-color-store.ts`](src/stores/visualizer-color-store.ts) `palette`。取色源回退（跟随封面 / 无封面→自定义多色，二者同设）唯一裁决在 [`flow-config.ts`](src/lib/flow-config.ts) `resolveFlowColors`/`resolveFlowConfig`。配置走 Settings「流光背景」面板（[`flow-settings.tsx`](src/components/settings/flow-settings.tsx)）。**不引入 color4bg/ogl/node-vibrant**——全自研（PRD `20260611-muzero-immersive-flow-background-prd`）

## 数据模型（v2）与混合集 / 注释 / 视频规则

- **Track 现在有 `kind`（audio/video）+ `origin`（generated/uploaded）**。生成的有 `brief`，上传的没有（`brief?` 可选——读 caption 一律走 [`trackSubtitle`](src/lib/track-display.ts)，别 `track.brief.caption` 裸读）。音频/视频/封面字节都进 `mediaBlobs`（`role: "media" | "cover"`），**永不进** `tracks` 行。
- **集（DjSession）是混合的**：一个集里可同时有 AI 生成音频 + 用户上传的音视频。是否让 DJ 自动续歌由 `config.autoExtend` 决定（带 seed 创建的 DJ 集为 true；上传集为 false）。**禁止**用 `if (kind === ...)` 散落判断 DJ 行为，统一看 `autoExtend`。
- **显示模式 per-set**：`displayMode: "video" | "cover" | "title"`，回退链 **video → cover → title**（[`resolveStageContent`](src/lib/track-display.ts) 是唯一裁决，已穷举单测）。`audioOnly` 是播放期临时开关（看视频集时只想听声音），强制不显示 video。
- **音视频用同一个持久 `<video>` 元素**（[`MediaEngine`](src/player/media-engine.ts)）：它常驻 app 生命周期，Now Playing stage 用 `mount()/unmount()` 收养/释放，切 tab 不打断播放（detach 不停播）。`audioOnly` 只是隐藏画面，不抽离音轨——**mediabunny 音轨抽取是后续增强**（做独立音频/波形时再上），当前原生 `<video>` 直接出声即可。
- **注释 = tag + note + cover**（"音乐承载回忆"）：tag 规范化（trim/lowercase/去重），note 自由文本，cover 是 memory 照片。三者都可搜（[`track-search.ts`](src/lib/track-search.ts) 的 `matchesQuery`，支持 `#tag`），且会喂进 DJ 上下文（`RecentTrack.tags/note`）影响生成。
- **Schema 迁移**：[`muzero-db.ts`](src/db/muzero-db.ts) v1→v2 有 `.upgrade()` 回填（kind/origin/tags、blob role、displayMode/autoExtend）。改数据形状必须 bump version + 写 upgrade，不要原地改 v2 stores。
- **下一阶段（未做）**：tag→歌单的「关联」用 Vercel AI SDK 的 **对话式助手 + tool calls**（search / create / curate / propose / generate）。本期先把它依赖的注释 + 搜索 + 混合集 + 视频 地基做好；chat 助手是下一个独立 phase。

## 常用命令

入口是根目录 [`Makefile`](Makefile)（沿用 doodlekuma 约定，`make` / `make help` 看全部）。底层都是 pnpm script，可直接调。

```bash
make install              # 安装依赖 + git hooks
make dev                  # Web 浏览器开发，最快迭代（localhost:1420，配 mock provider 即可跑）
make desktop              # Tauri 桌面端 hot reload（Vite HMR + Rust 壳，主力桌面开发命令）
make ios / make android   # 移动端（先 make ios-init / android-init 一次；需 Xcode / Android SDK）

make check                # 本地完整门禁：typecheck + lint + test
make test / test-watch    # Vitest
make build                # tsc + vite build → dist/
make desktop-build        # 打当前 OS 桌面安装包；make mac / win / linux 指定平台
make ui C=button          # 拉一个 COSS 组件；make ui-coss 全量；make icons 重生成图标
```

> **桌面优先**：日常用 `make desktop`（桌面 hot reload）或 `make dev`（纯浏览器，最快）。用户通常已经在跑 dev server，HMR 实时构建——开发中**不要**重复起 `make dev` / `make build`，直接改代码即可。

## UI 库接入（COSS UI + LiveKit visualizer）

`src/components/ui/*` 目前是本地 shadcn/COSS 兼容 primitives（Button/Card/Input/Slider），API 与官方一致，是 registry 拉取前的种子。要换成官方 COSS 组件：

```bash
pnpm dlx shadcn@latest init @coss/style        # 全量主题（neutral 色 + sidebar + 字体 + 组件）
pnpm dlx shadcn@latest add @coss/ui            # 仅组件
pnpm dlx shadcn@latest add @coss/<component>   # 单个组件，API 不变，调用处无需改
```

音频可视化是**自研的可插拔 registry**（[`src/visualizer/`](src/visualizer/)）：`VisualizerHost` 按 `AppSettings.visualizerStyle` 选样式——spectrum（aura / bars / radial / led-reflex / waveform）是自研 canvas（八度对数分带 + 感知 tilt + 跟随 `--primary`），scene（liquid / aurora）是 **twgl.js**(MIT) 的 WebGL fragment shader（懒加载、WebGL 探测失败回退 aura）。[`aura-visualizer.tsx`](src/components/player/aura-visualizer.tsx) 现为 host 薄壳。**不引入 LiveKit Aura** 是刻意选择：它 shader-based、为 LiveKit WebRTC *agent audio track* 设计，需要 LiveKit room + `livekit-client`，与 MUZERO「本地优先、无云」不匹配。registry 已在 `components.json` 配好（`@agents-ui` → `https://livekit.com/ui/r/{name}.json`），未来若引入 LiveKit 音频源可直接：

```bash
pnpm dlx shadcn@latest add @agents-ui/agent-audio-visualizer-aura
```

COSS UI 文档：https://coss.com/ui/llms.txt

## i18n

四语言 en（默认）/ zh / ja / ko，用 **i18next + react-i18next**（沿用 doodlekuma 约定）。catalog 在 `src/i18n/locales/{locale}/common.json`，init 在 [`src/i18n/i18n.ts`](src/i18n/i18n.ts)（`main.tsx` 副作用导入），语言/检测/持久化在 [`config.ts`](src/i18n/config.ts)，类型增强在 `i18next.d.ts`（`t()` key 全量类型安全）。

- **所有 UI 文案走 `useTranslation()` 的 `t("ns.key")`**，禁止在组件里内联用户可见字符串或写按 locale 分支的大对象。新字符串先加进 **en** catalog（类型源），再补 zh/ja/ko。
- 复数用 i18next 后缀（en 有 `_one`/`_other`，CJK 只需 `_other`）；插值用 `{{var}}`。纯逻辑/lib 不持有文案——空态等 fallback 文案在调用点本地化（见 `trackSubtitle`）。
- 语言切换在 Settings「外观」：`i18n.changeLanguage` + `persistLocale`（写 `muzero-locale` localStorage + `<html lang>`）+ 镜像到 `AppSettings.locale`。启动 locale = localStorage → 浏览器语言 → en。
