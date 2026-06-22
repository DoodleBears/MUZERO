---
title: 自托管与部署
description: 在本地运行项目、构建为静态文件、把你自己的 Web 版本部署到 Cloudflare Pages。本地使用不需要 MUZERO 账号。
sidebar:
  order: 5
---

MUZERO 是一个 Vite 应用。你可以在本地运行、构建为静态文件，并部署你自己的 Web 版本。普通播放、本地曲库管理、用户自有云盘同步都不需要 MUZERO 账号。

## 本地运行

需要：

- Node.js 24.16+ 和 pnpm
- 桌面 / 移动 Tauri 构建的 Rust + Tauri 前置
- iOS 需 Xcode，Android 需 SDK/NDK

```bash
fnm install
fnm use
make install
make dev          # Web 开发服务器 → http://localhost:41730
```

桌面壳：

```bash
make electron-dev   # Electron（主力桌面壳）
make desktop        # Tauri 对等
```

本地门禁：

```bash
make check          # 类型检查 + lint + 测试
```

## 构建与部署

```bash
make build          # tsc + vite build → dist/
```

把 `dist/` 部署到 **Cloudflare Pages** 做个人 Web 版本。某些桌面专有能力——尤其是需要自定义请求头的在线源播放——在 Electron 桌面壳里最稳。

## 托管 vs 自托管

- **`mu0.app`** 是官方免费 hosted surface（营销 + 文档 + 下载）。app 本体在 **`my.mu0.app`**。
- 可选的**分享短链控制面**按 Cloudflare Workers + D1 + KV 设计，相关阶段落地后可以自托管。
- 核心数据留在本地；跨设备同步用**你自己的** R2 / S3 兼容存储（或后续 WebDAV）。

## 下一步

- [架构](/zh/docs/architecture/)
