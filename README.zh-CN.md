<div align="center">
  <img src="./public/muzero-logo-dark.png" width="96" alt="MUZERO 应用图标" />

# MUZERO

**你的私人音乐银行、可视化播放器，以及 AI DJ。**

MUZERO 是一个本地优先的音乐 / 视频播放器。它把私人曲库、散落在各个平台的歌曲、动态视觉体验、云盘同步，以及由 LLM 驱动的 DJ Agent 放进同一个应用里。

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja-JP.md) · [한국어](./README.ko-KR.md)

[mu0.app](https://mu0.app) · [文档](https://mu0.app/docs) · [更新日志](./CHANGELOG.md) · [产品 PRD](./docs/prd/20260612-muzero-product-positioning-readme-prd/20260612-muzero-product-positioning-readme-prd.md)

<br/>

<img src="./docs/media/now-playing.gif" width="760" alt="MUZERO 沉浸式 Now Playing —— 封面取色、流光背景与实时频谱" />

</div>

---

## 截图

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/media/visualizer.gif" alt="实时可视化与歌词" /><br/>
      <sub><b>实时可视化 &amp; 歌词</b> —— 切换频谱样式，再翻到歌词模式。</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/media/switch-song.gif" alt="滑动切歌" /><br/>
      <sub><b>滑动切歌</b> —— 触屏滑动 3D 封面流切换歌曲。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/media/search.png" alt="全局搜索" /><br/>
      <sub><b>全局 ⌘F 搜索</b> —— 横跨曲目、标签、歌词与在线音乐源。</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/media/library.png" alt="歌单画廊" /><br/>
      <sub><b>歌单画廊</b> —— 歌单、专辑、艺人与智能歌单一处浏览。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/media/dj.png" alt="Agent DJ 配置" /><br/>
      <sub><b>Agent DJ</b> —— 接入 LLM，让它帮你整理歌单、接受点歌（像个 DJ）。</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/media/settings.png" alt="可定制视觉" /><br/>
      <sub><b>高度可定制的视觉</b> —— 流光背景、调色板、特效与主题。</sub>
    </td>
  </tr>
</table>

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

## 文档

完整指南、亮点与架构都在 **[mu0.app/docs](https://mu0.app/docs)**：

- [快速开始](https://mu0.app/docs/getting-started/) —— 打开 app，导入第一批歌曲
- [音乐源与导入](https://mu0.app/docs/sources/) —— 上传 + 网易云、Bilibili、YouTube
- [云同步](https://mu0.app/docs/sync/) —— 让每台设备同处一个曲库
- [Agent DJ](https://mu0.app/docs/agent-dj/) —— 接入模型，让它接管队列
- [自托管与部署](https://mu0.app/docs/self-host/) —— 自己跑 Web 版本
- [架构](https://mu0.app/docs/architecture/) —— 数据模型、DJ 循环、项目地图、技术栈

想直接用？打开 [my.mu0.app](https://my.mu0.app)，或从[下载页](https://mu0.app/download)获取桌面版。

## 本地运行

需要 Node.js 24.16+、pnpm，以及（桌面 / 移动构建用）Rust + Tauri 前置、Xcode 或 Android SDK/NDK。

```bash
fnm install
fnm use
make install
make dev            # Web 开发服务器 → http://localhost:41730
make electron-dev   # Electron 桌面壳
make check          # 类型检查 + lint + 测试
```

完整构建 / 部署与 Tauri / 移动端命令见[自托管指南](https://mu0.app/docs/self-host/)。

## License

Apache-2.0. 见 [`LICENSE`](./LICENSE)。
