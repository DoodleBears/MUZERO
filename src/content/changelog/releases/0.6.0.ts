import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "0.6.0",
  date: "2026-06-11",
  title: {
    en: "Online sources & word-by-word lyrics",
    zh: "在线音源与逐字歌词",
    ja: "オンラインソースと一字ずつの歌詞",
    ko: "온라인 음원과 한 글자씩 가사",
  },
  summary: {
    en: "Stream from popular online sources on desktop, with Apple-Music-style karaoke lyrics everywhere.",
    zh: "在桌面端从热门在线音源播放，并在各处用上 Apple Music 风格的卡拉 OK 歌词。",
    ja: "デスクトップで人気のオンラインソースから再生でき、どこでも Apple Music 風のカラオケ歌詞を楽しめます。",
    ko: "데스크톱에서 인기 온라인 음원으로 재생하고, 어디서나 Apple Music 스타일의 가라오케 가사를 즐깁니다.",
  },
  items: [
    {
      area: "streaming",
      category: "highlight",
      platform: "desktop",
      title: {
        en: "Play from online sources",
        zh: "从在线音源播放",
        ja: "オンラインソースから再生",
        ko: "온라인 음원으로 재생",
      },
      description: {
        en: "Resolve and stream from NetEase, bilibili, and YouTube on desktop.",
        zh: "在桌面端解析并播放网易云、哔哩哔哩和 YouTube 的音源。",
        ja: "デスクトップで、NetEase・bilibili・YouTube のソースを解決してストリーミングします。",
        ko: "데스크톱에서 NetEase, bilibili, YouTube 음원을 해석해 스트리밍합니다.",
      },
    },
    {
      area: "streaming",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Sign in to your sources",
        zh: "登录你的音源",
        ja: "ソースにサインイン",
        ko: "음원에 로그인",
      },
      description: {
        en: "Capture a source login, including QR login, for VIP and higher-quality streams.",
        zh: "保存音源登录（含扫码登录），解锁会员和更高音质的播放。",
        ja: "QR ログインも含めてソースのログインを保存し、VIP や高音質のストリームを利用できます。",
        ko: "QR 로그인을 포함한 음원 로그인을 저장해 VIP와 고음질 스트림을 이용합니다.",
      },
    },
    {
      area: "lyrics",
      category: "highlight",
      platform: "all",
      title: {
        en: "Word-by-word lyrics",
        zh: "逐字歌词",
        ja: "一字ずつ流れる歌詞",
        ko: "한 글자씩 흐르는 가사",
      },
      description: {
        en: "Apple-Music-style synced lyrics with per-syllable karaoke from LRC, yrc, qrc, and TTML.",
        zh: "Apple Music 风格的同步歌词，逐音节卡拉 OK，支持 LRC、yrc、qrc 和 TTML。",
        ja: "LRC・yrc・qrc・TTML に対応した、音節ごとにカラオケで光る Apple Music 風の同期歌詞です。",
        ko: "LRC, yrc, qrc, TTML을 지원하며 음절마다 빛나는 Apple Music 스타일의 동기화 가사입니다.",
      },
    },
    {
      area: "lyrics",
      category: "feature",
      platform: "all",
      title: {
        en: "Translations & romanization",
        zh: "翻译与罗马音",
        ja: "翻訳とローマ字表記",
        ko: "번역과 로마자 표기",
      },
      description: {
        en: "Show translated and romanized sub-lines beneath each lyric line.",
        zh: "在每行歌词下方显示翻译和罗马音的副行。",
        ja: "歌詞の各行の下に、翻訳とローマ字のサブ行を表示します。",
        ko: "가사 각 줄 아래에 번역과 로마자 보조 줄을 표시합니다.",
      },
    },
    {
      area: "streaming",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Cache streams offline",
        zh: "离线缓存音源",
        ja: "ストリームをオフライン保存",
        ko: "스트림 오프라인 저장",
      },
      description: {
        en: "Download streamed media to a local blob for offline playback.",
        zh: "把在线播放的媒体下载为本地数据，供离线播放。",
        ja: "ストリーミングしたメディアをローカルに保存し、オフラインで再生できます。",
        ko: "스트리밍한 미디어를 로컬에 내려받아 오프라인으로 재생합니다.",
      },
    },
  ],
};

export default release;
