# MUZERO 介绍贴（中文 · 多条 reply 串）

> 第一人称口吻，参考 README。每条 post 单独成段，配图见标注。
> 🌐 https://mu0.app/ ｜ ⭐ https://github.com/DoodleBears/MUZERO

---

## ① 主楼

📷 配图：`now-playing.gif`

![Now Playing](./media/now-playing.gif)

我花了很久，做了一个自己每天都在用的东西——**MUZERO**，一个本地优先的 AI DJ 音乐 / 视频播放器。

它的起点很私人：我想要一个「私人音乐银行」，也像一座「私人博物馆」。每一首歌都能加上笔记、标签、封面照片和回忆碎片——歌一响起来，就能回到那一段时间。

而且所有数据都只存在你自己设备本地（IndexedDB），**没有后端、没有账号、没有遥测**。

🌐 在线体验：https://mu0.app/
⭐ 开源（Apache-2.0）：https://github.com/DoodleBears/MUZERO

下面拆成几条慢慢讲 👇

---

## ② 一个装回忆的私人曲库

📷 配图：`library.png`

![歌单画廊](./media/library.png)

它首先是一个像 YouTube Music 那样的播放器：你可以把自己的音频、视频（MV）、甚至整个文件夹拖进来，混在同一个「歌单 / 视频单」里。

每首歌都能加 **tag、备注、封面**（"音乐承载回忆"），这些 tag、备注、歌词全都能搜。歌单、专辑、艺人、智能歌单，都在同一个本地曲库里浏览。

我自己的库有 6000 多首——它从一开始的设计目标就是：**本地大库也要秒开**，而不是卡上半分钟才能用。

---

## ③ 全局搜索 + 多个在线音乐源

📷 配图：`search.png`

![全局搜索](./media/search.png)

按一下 `⌘ / Ctrl + F`，就能全局搜索：横跨曲目、专辑、艺人、歌单、歌词、标签、备注，还有在线音乐源。

桌面端还能直接搜并播放 **网易云、B 站、YouTube、QQ 音乐**，登录后拿更高音质，把流和封面缓存到本地离线听——然后把它们留在你自己的 MUZERO 曲库里。

---

## ④ 它也是个「视觉播放器」

📷 配图：`visualizer.gif`

![可视化与歌词](./media/visualizer.gif)

可视化频谱有好几种风格（bars / radial / led-reflex / waveform，还有 shader 场景），背景可以是**封面取色的多色流光**，每个细节都能调。

歌词是**逐字 synced** 的，带翻译和罗马音，颜色跟着封面走。一个键就能翻进沉浸的歌词模式——很适合单曲循环、跟着唱。

---

## ⑤ 我很在意「手感」

📷 配图：`switch-song.gif`

![滑动切歌](./media/switch-song.gif)

Now Playing 是一个可以**用手指滑动的 3D 封面流**：左滑切下一首，松手有软着陆的动画；桌面也能用键盘、滚轮、拖拽来切。

（这条 GIF 其实是我用 CDP 模拟触屏滑动录出来的，顺手还做了一套自动截图 / 录屏的小工具 😄）

---

## ⑥ 最好玩的部分：让 LLM 当 DJ

📷 配图：`dj.png`

![Agent DJ](./media/dj.png)

你接入自己的模型 API（**BYOK**，key 只存在本地），它就能：搜你的库、用你的 tag 和备注当上下文、帮你编歌单、像电台一样不停「续上」下一首；甚至调用音乐生成 API **写新歌**接着放。

我经常把它开在副屏当电台，一边写代码一边让它放——拿来 vibe coding 真的很爽。

---

## ⑦ 三条原则，和一句话

📷 配图：`settings.png`

![高度可定制](./media/settings.png)

它就守三条原则：

- **本地优先** —— 曲库、歌单、备注、封面、播放记录都只在你设备上。
- **没有 MUZERO 后端** —— 云同步指向**你自己的** R2 / S3 / 私有云。
- **BYOK** —— LLM、音乐生成、音乐源登录、存储凭证，所有 key 都在本地。

桌面端用 Electron（macOS / Windows / Linux），移动端保留 Tauri；整个 App 就是前端，开源、Apache-2.0。

如果你也觉得「歌是用来承载回忆的」，欢迎来玩 🎵

🌐 https://mu0.app/
⭐ https://github.com/DoodleBears/MUZERO
