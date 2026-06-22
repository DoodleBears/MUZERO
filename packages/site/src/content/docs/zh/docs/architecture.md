---
title: 架构
description: MUZERO 如何组合在一起——数据模型、DJ → 生成 → 队列循环、桌面壳层、项目地图。给贡献者。
sidebar:
  order: 6
---

给贡献者和好奇者的一张高层地图，看看 MUZERO 怎么搭起来的。

## 数据流

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

曲目是轻量的行；音频、视频、封面的**字节存在独立的 `mediaBlobs` 表**，永不进曲目行——所以列表查询保持快，虚拟化才有意义。

## DJ 循环

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

`TrackBrief` 是 DJ、音乐生成 provider 和数据库之间的唯一契约。DJ 写的是 provider 无关的 brief；adapter 来翻译，所以没有任何厂商概念泄漏进 DJ 或 DB。

## 壳层

整个 app 就是前端，跑在桌面壳层抽象后面：

- **Electron** —— 主力桌面壳（CORS-free fetch、本地文件访问）。
- **Tauri 2** —— 保留可跑，用于移动端。
- **Web** —— 浏览器版本。

所有 native 访问都走同一个 bridge，所以 provider、播放器和 UI 都不需要判断自己在哪个壳里。

## 技术栈

Tauri 2、Electron、Vite、React 19、TypeScript、Tailwind CSS v4、COSS UI、Base UI、Dexie、IndexedDB、Zustand、TanStack Query、TanStack Virtual、Vercel AI SDK、Zod、Vitest、Biome、Cloudflare R2，以及可选 hosted 控制面的 Cloudflare Workers。

## 源码地图

代码在 [MUZERO 仓库](https://github.com/DoodleBears/MUZERO)。主要区域：AI DJ 引擎、音乐生成 provider、在线源 provider、本地数据库、云同步、可视化、Electron / Tauri 壳。

> 想贡献？看仓库里的 `CLAUDE.md` / `AGENTS.md`，那是完整的架构手册和约定。
