<div align="center">
  <img src="./public/muzero-logo-dark.png" width="96" alt="MUZERO 应用图标" />

# MUZERO

**你的私人音乐银行、可视化播放器，以及 AI DJ。**

MUZERO 是一个本地优先的音乐 / 视频播放器。它把私人曲库、散落在各个平台的歌曲、动态视觉体验、云盘同步，以及由 LLM 驱动的 DJ Agent 放进同一个应用里。

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja-JP.md) · [한국어](./README.ko-KR.md)

[mu0.app](https://mu0.app) · [更新日志](./CHANGELOG.md) · [产品 PRD](./docs/prd/20260612-muzero-product-positioning-readme-prd/20260612-muzero-product-positioning-readme-prd.md)

</div>

---

## MUZERO 是什么？

MUZERO 最早来自一个很个人的想法：做一个 private music bank，也像一个 private museum。
每一首歌都可以有笔记、标签、封面照片和回忆片段。歌响起来的时候，你可以回到那一段时间。

现在它由四个部分组成：

- **私人音乐博物馆**：上传音频和 MV，为每首歌写备注、打 tag、放封面和记忆照片。
- **多平台曲库入口**：在桌面端搜索和播放网易云音乐、Bilibili、YouTube，并把这些歌曲纳入 MUZERO。
- **视觉播放器**：受到 Poweramp 启发的播放界面、动态背景、封面取色和音频可视化。
- **Agent DJ**：接入本地模型或线上 LLM API，让它搜索曲库、整理歌单，或调用音乐生成 API 续写下一首歌。

你可以直接使用免费的 [mu0.app](https://mu0.app)，也可以克隆项目后把 Web 版本或可选的分享控制面部署到 Cloudflare。核心数据存储在本地。跨设备同步使用你自己配置的 R2、S3 兼容存储，或后续 WebDAV 类型的私人云盘。

## 我们的承诺

| 原则 | 含义 |
|------|------|
| **本地优先** | 歌曲、歌单、备注、标签、封面、设置、播放统计和媒体元数据都在设备本地的 IndexedDB `muzero-db`。 |
| **不托管你的媒体库** | MUZERO 不保存你的音乐文件。云同步指向你自己拥有和配置的存储。 |
| **BYOK** | LLM key、音乐生成 key、平台登录态、云盘凭据都只保存在你的设备上。 |
| **免费 hosted service** | `mu0.app` 免费提供分发、Web 访问和可选的分享权限管理，不接管你的曲库。 |
| **分享边界清晰** | 只有分享短链和权限元数据需要 `mu0` 服务；音频 / 视频字节仍来自你的本地设备或自有云盘。 |

## 亮点功能

### 快捷，键盘优先

- 支持大量自定义快捷键，常用播放、队列、搜索、导航和曲库管理操作都可以纯键盘完成。
- `Command/Ctrl + F` 全局搜索歌曲、专辑、歌手、歌单、歌词、tag、备注和在线来源。
- MUZERO 为本地大曲库设计：一个 6000 首歌的歌单，不应该等 30 秒还无法开始使用。

### 配置一次，多端同步

- 云盘配置一次之后，其他手机、电脑直接复制 trusted setup link，就能快速接入同一个曲库。
- 歌单、歌曲、封面、备注、记忆、歌词和播放元数据都可以在自己的设备之间同步，不需要 MUZERO 托管媒体。
- 可以把只读曲库 / 分享链接发给朋友快速听歌；更完整的 `mu0.app` 短链、可撤销邀请和权限管理在产品路线里继续推进。

### 高度可自定义的可视化

- 背景视频、背景图片、封面取色背景、背景频谱、波形样式、shader 场景和主题色都有多种预设。
- 背景特效、可视化样式、调色、歌词动效、翻译、罗马音和逐字歌词展示都可以按听歌场景调整。

### Vibe Coding 时的 AI DJ

- 把 MUZERO 放在副屏，它就像一个 DJ / Radio，适合写代码、做设计、写东西或长时间沉浸工作时帮你切歌。
- 你可以告诉 Agent 当前氛围，给它一个 seed 歌单，或者让它搜索你的曲库并持续把队列接上。

## 功能

### 私人音乐银行

- 导入音频文件、文件夹和 MV，组成混合歌单。
- 为每首歌添加备注、tag、记忆照片和自定义封面。
- 按标题、艺人、专辑、tag、备注、歌词、转写和来源元数据搜索。
- 在同一个本地曲库中浏览艺人、专辑、歌单、记忆、歌词和播放历史。

### 同步到你自己的云

- 将曲库发布和拉取到你自己拥有的云盘。
- 当前生产路径：Cloudflare R2 / S3 兼容对象存储。
- 存储 provider 路线：WebDAV 支持 Nextcloud、Synology、rclone serve 等私人云。
- 媒体字节以内容寻址方式保存，不塞进轻量的 track 行，让大曲库仍然可以快速搜索。

### 在线音乐源

- 桌面端搜索和解析：
  - 网易云音乐
  - Bilibili
  - YouTube
- 在来源要求登录时，本地捕获登录态以获得更高音质或账号内容。
- 可将在线歌曲和封面缓存到本地，离线播放。

### 可视化播放器

- 以播放器为核心的底部 dock：封面 / 标题、整宽进度条、状态和导航集中在同一个区域。
- Now Playing 舞台支持视频、封面、标题 fallback、audio-only 模式和沉浸背景。
- 内置 spectrum、waveform、radial、LED reflex、liquid、aurora、cover-palette flow 等可视化样式。
- 先做好桌面端，同时保持响应式移动布局。

### Agent DJ

- DJ 写出 `TrackBrief`：caption、歌词、风格、BPM、调性、结构和生成提示。
- 可插拔音乐生成 provider：默认离线 mock，可配置云端 BYOK 音乐生成 API。
- Agent 可以搜索你的曲库，把 tag 和备注作为上下文，整理歌单，或像 DJ 一样继续播放队列。
- LLM 和 provider 都封装在 adapter 后面，曲库不绑定某个模型或厂商。

## 架构

```text
本地文件 / 在线来源 / AI 生成
              |
              v
        Track + MediaBlob
              |
              v
 IndexedDB `muzero-db`  <---->  可选的用户自有云盘
              |
              v
        播放器 + 可视化
              |
              v
        Agent DJ / 搜索 / 分享
```

DJ 续歌循环：

```text
回忆 + 氛围 + 最近播放
          |
          v
    LLM Agent 写 TrackBrief
          |
          v
    音乐生成 provider 渲染音频
          |
          v
 pending track -> ready track -> 队列续写
```

## 本地运行

```bash
make install
make dev
```

Web 开发地址是 `http://localhost:1420`。

桌面端：

```bash
make electron-dev
```

Tauri / 移动端：

```bash
make desktop
make ios-init && make ios
make android-init && make android
```

本地门禁：

```bash
make check
```

## 部署与自托管

MUZERO 是 Vite 应用，可以构建为静态文件：

```bash
make build
```

你可以把 `dist/` 部署到 Cloudflare Pages 做个人 Web 版本。某些桌面能力，尤其是需要自定义请求头的在线来源播放，在 Electron 桌面壳里体验最好。

`mu0.app` 是官方免费 hosted surface。可选的分享短链控制面按 Cloudflare Workers + D1 + KV 设计，相关阶段落地后也可以自托管。普通播放、本地曲库管理、用户自有云盘同步都不需要 MUZERO 账号。

## 项目地图

| 模块 | 路径 |
|------|------|
| 应用壳与页面 | [`src/App.tsx`](./src/App.tsx), [`src/pages/`](./src/pages/) |
| 播放器与媒体引擎 | [`src/player/`](./src/player/), [`src/components/player/`](./src/components/player/) |
| AI DJ 引擎 | [`src/dj/`](./src/dj/) |
| 音乐生成 provider | [`src/musicgen/`](./src/musicgen/) |
| 在线来源 provider | [`src/streamsrc/`](./src/streamsrc/) |
| 本地数据库 | [`src/db/`](./src/db/) |
| 云同步 | [`src/sync/`](./src/sync/) |
| 可视化 | [`src/visualizer/`](./src/visualizer/) |
| 桌面与移动壳 | [`src-tauri/`](./src-tauri/), [`electron/`](./electron/) |
| 产品需求文档 | [`docs/prd/`](./docs/prd/) |

## 技术栈

Tauri 2、Electron、Vite、React 19、TypeScript、Tailwind CSS v4、COSS UI、Base UI、Dexie、IndexedDB、Zustand、TanStack Query、TanStack Virtual、Vercel AI SDK、Zod、Vitest、Biome、Cloudflare R2，以及可选 hosted 控制面的 Cloudflare Workers。

## Roadmap

- WebDAV 存储 adapter 和云盘 provider 抽象。
- `mu0.app` 分享短链、可撤销邀请和浏览器播放页。
- 更多 Agent tools：搜索、策展、解释和生成音乐。
- 移动端后台音频和触摸体验打磨。
- 更多可视化 preset 和封面驱动的沉浸场景。

## License

Apache-2.0. 见 [`LICENSE`](./LICENSE)。
