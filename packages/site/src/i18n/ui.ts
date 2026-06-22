/**
 * Site UI string catalog for route-based i18n (/, /zh/, /ja/, /ko/).
 * en is the source of truth; zh/ja/ko are DRAFTS (owner to review) — aligned with
 * the product voice in the app's i18n catalogs + the translated READMEs
 * (私人音乐博物馆 / プライベート音楽博物館 / 개인 음악 박물관 ; 本地优先 / ローカルファースト / 로컬 우선).
 *
 * Locale-independent assets (cover photos, showcase media URLs) stay in the page;
 * this catalog holds only translatable text. The page zips showcases[] by index.
 */
export const LOCALES = ["en", "zh", "ja", "ko"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  zh: "简体中文",
  ja: "日本語",
  ko: "한국어",
};

/** Short chip label for the switcher. */
export const LOCALE_SHORT: Record<Locale, string> = {
  en: "EN",
  zh: "中",
  ja: "あ",
  ko: "한",
};

/** <html lang> value per locale. */
export const LOCALE_HTML_LANG: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
  ja: "ja",
  ko: "ko",
};

interface Showcase {
  label: string;
  title: string;
  body: string;
}

interface Strings {
  nav: { docs: string; download: string; github: string; openApp: string };
  hero: { eyebrow: string; title: string; lede: string };
  cta: { openApp: string; download: string; readDocs: string };
  showcases: Showcase[];
  closer: { title: string };
  footer: { tagline: string };
  download: { title: string; sub: string };
}

export const ui = {
  en: {
    nav: { docs: "Docs", download: "Download", github: "GitHub", openApp: "Open MUZERO" },
    hero: {
      eyebrow: "Local-first · No account · No cloud",
      title: "Your private music museum.",
      lede: "Upload, annotate, and remember every song. Play from every source. Let an AI DJ keep the queue moving. Everything stays on your device.",
    },
    cta: { openApp: "Open MUZERO", download: "Download", readDocs: "Read the docs →" },
    showcases: [
      { label: "Now Playing", title: "Immersive Now Playing", body: "Cover-driven palette, flow background, and a live spectrum." },
      { label: "Visualize", title: "Visualizers & lyrics", body: "Cycle spectrum styles, then flip into word-by-word lyrics." },
      { label: "Coverflow", title: "Swipe to switch", body: "A 3D coverflow you flick through by touch." },
      { label: "Search", title: "Find anything, fast", body: "⌘F across tracks, tags, lyrics, notes, and online sources." },
      { label: "Library", title: "Your whole library", body: "Sets, albums, artists, and smart playlists in one place." },
      { label: "Agent DJ", title: "An AI DJ on the side", body: "Connect an LLM to curate sets and take requests, like a DJ." },
      { label: "Personalize", title: "Make it yours", body: "Flow backgrounds, palettes, effects, lyrics, and themes." },
    ],
    closer: { title: "Bring your music home." },
    footer: { tagline: "Local-first. Your music stays on your device." },
    download: {
      title: "Downloads & changelog",
      sub: "Every MUZERO desktop release for macOS, Windows, and Linux. The app auto-updates itself — this page is for manual installs, older versions, and seeing what changed.",
    },
  },

  zh: {
    nav: { docs: "文档", download: "下载", github: "GitHub", openApp: "打开 MUZERO" },
    hero: {
      eyebrow: "本地优先 · 无需账号 · 无需云端",
      title: "你的私人音乐博物馆。",
      lede: "上传、标注、记住每一首歌。播放来自任意来源的音乐,让 AI DJ 不断续上队列。一切都留在你的设备上。",
    },
    cta: { openApp: "打开 MUZERO", download: "下载", readDocs: "查看文档 →" },
    showcases: [
      { label: "正在播放", title: "沉浸式播放界面", body: "封面取色、流光背景,配合实时频谱。" },
      { label: "可视化", title: "可视化与歌词", body: "切换频谱样式,再翻到逐字歌词。" },
      { label: "封面流", title: "滑动切歌", body: "用手指拨动的 3D 封面流。" },
      { label: "搜索", title: "快速找到任何内容", body: "⌘F 搜遍曲目、标签、歌词、备注与在线来源。" },
      { label: "曲库", title: "你的整个曲库", body: "歌单、专辑、艺人与智能歌单,集于一处。" },
      { label: "AI DJ", title: "随侧的 AI DJ", body: "接入大模型来编排歌单、接受点歌,就像一位 DJ。" },
      { label: "个性化", title: "随心定制", body: "流光背景、配色、特效、歌词与主题。" },
    ],
    closer: { title: "把你的音乐带回家。" },
    footer: { tagline: "本地优先。你的音乐留在你的设备上。" },
    download: {
      title: "下载与更新日志",
      sub: "MUZERO 桌面端的每个版本(macOS、Windows、Linux)。应用会自动更新——本页用于手动安装、历史版本,以及查看更新内容。",
    },
  },

  ja: {
    nav: { docs: "ドキュメント", download: "ダウンロード", github: "GitHub", openApp: "MUZERO を開く" },
    hero: {
      eyebrow: "ローカルファースト · アカウント不要 · クラウド不要",
      title: "あなただけの音楽博物館。",
      lede: "すべての曲をアップロードし、メモを添え、記憶する。あらゆるソースから再生し、AI DJ がキューをつなぎ続ける。すべては手元のデバイスに。",
    },
    cta: { openApp: "MUZERO を開く", download: "ダウンロード", readDocs: "ドキュメントを見る →" },
    showcases: [
      { label: "再生中", title: "没入感のある再生画面", body: "カバー由来のパレット、フロー背景、ライブスペクトラム。" },
      { label: "ビジュアライザー", title: "ビジュアライザーと歌詞", body: "スペクトラムを切り替え、ワード単位の歌詞へ反転。" },
      { label: "カバーフロー", title: "スワイプで曲を切替", body: "指で弾く 3D カバーフロー。" },
      { label: "検索", title: "なんでも素早く検索", body: "⌘F で曲・タグ・歌詞・メモ・オンラインソースを横断検索。" },
      { label: "ライブラリ", title: "ライブラリのすべて", body: "セット、アルバム、アーティスト、スマートプレイリストを一か所に。" },
      { label: "Agent DJ", title: "そばにいる AI DJ", body: "LLM をつないでセットを編成し、リクエストも受け付ける——まるで DJ。" },
      { label: "カスタマイズ", title: "あなた好みに", body: "フロー背景、パレット、エフェクト、歌詞、テーマ。" },
    ],
    closer: { title: "あなたの音楽を、手元に。" },
    footer: { tagline: "ローカルファースト。音楽はあなたのデバイスに。" },
    download: {
      title: "ダウンロードと変更履歴",
      sub: "MUZERO デスクトップの全リリース(macOS・Windows・Linux)。アプリは自動更新されます——このページは手動インストール、旧バージョン、変更点の確認用です。",
    },
  },

  ko: {
    nav: { docs: "문서", download: "다운로드", github: "GitHub", openApp: "MUZERO 열기" },
    hero: {
      eyebrow: "로컬 우선 · 계정 불필요 · 클라우드 불필요",
      title: "나만의 음악 박물관.",
      lede: "모든 곡을 업로드하고, 메모를 달고, 기억하세요. 모든 소스에서 재생하고, AI DJ가 큐를 계속 이어갑니다. 모든 것은 기기에 남습니다.",
    },
    cta: { openApp: "MUZERO 열기", download: "다운로드", readDocs: "문서 보기 →" },
    showcases: [
      { label: "재생 중", title: "몰입형 재생 화면", body: "커버 기반 팔레트, 플로우 배경, 라이브 스펙트럼." },
      { label: "시각화", title: "비주얼라이저 & 가사", body: "스펙트럼 스타일을 바꾸고, 한 단어씩 가사로 전환." },
      { label: "커버플로우", title: "스와이프로 곡 전환", body: "손가락으로 넘기는 3D 커버플로우." },
      { label: "검색", title: "무엇이든 빠르게 검색", body: "⌘F로 트랙·태그·가사·메모·온라인 소스를 통합 검색." },
      { label: "라이브러리", title: "라이브러리 전체", body: "세트, 앨범, 아티스트, 스마트 재생목록을 한곳에." },
      { label: "Agent DJ", title: "곁에 있는 AI DJ", body: "LLM을 연결해 세트를 큐레이션하고 신청도 받습니다 — DJ처럼." },
      { label: "개인화", title: "내 취향대로", body: "플로우 배경, 팔레트, 효과, 가사, 테마." },
    ],
    closer: { title: "당신의 음악을 집으로." },
    footer: { tagline: "로컬 우선. 음악은 당신의 기기에 남습니다." },
    download: {
      title: "다운로드 & 변경 이력",
      sub: "macOS·Windows·Linux용 모든 MUZERO 데스크톱 릴리스. 앱은 자동 업데이트됩니다 — 이 페이지는 수동 설치, 이전 버전, 변경 내용 확인용입니다.",
    },
  },
} satisfies Record<Locale, Strings>;
