---
title: Agent DJ
description: 接入本地模型或在线 LLM，让它整理歌单、接受点歌、生成下一首歌——像一位专属于你曲库的 DJ。
sidebar:
  order: 4
---

Agent DJ 把一个 LLM 变成你曲库的图书管理员、策展人和音乐生成编排者。把 MUZERO 放在副屏当电台，写代码、做设计、写东西或长时间沉浸时让它陪着你。

## 它能做什么

- **搜索与策展** —— Agent 可以搜索你的曲库，把标签和备注当上下文，建立或续上一个集。
- **接受点歌** —— 告诉它一个氛围，给它一个 seed 集，让它持续把队列接上，不用盯着播放器。
- **生成** —— 想要一首全新的歌时，DJ 写出 `TrackBrief`（caption、歌词、风格、BPM、调性、结构、生成提示），交给音乐生成 provider。

## Provider

音乐生成是可插拔的：

- **Mock** —— 离线占位 provider（默认），所以这套循环在没有网络或 key 时也能跑。
- **Cloud（BYOK）** —— 你配置的真实生成 API。DJ 从不直接对某个厂商说话；adapter 翻译 brief，所以曲库不绑定任何一家。

## BYOK

LLM 和音乐生成的 API key 都是**自带密钥**：你在设置里录入，只保存在你的设备上。MUZERO 不持有任何服务端 key，除了你配置的第三方 API，不发任何出站请求。

> Key 从不写进应用 bundle、提交的 `.env`、URL、日志或遥测。

## 下一步

- [音乐源与导入](/zh/docs/sources/) —— 给 DJ 更多素材。
- [架构](/zh/docs/architecture/) —— DJ → 生成 → 队列 这套循环如何运作。
