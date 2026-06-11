import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "0.1.0",
  date: "2026-06-07",
  title: {
    en: "An AI DJ and a player in one",
    zh: "AI DJ 与播放器，合二为一",
    ja: "AI DJ とプレーヤーをひとつに",
    ko: "AI DJ와 플레이어를 하나로",
  },
  summary: {
    en: "The foundation: an LLM DJ that endlessly extends your playlist, plus a YouTube-Music-style player for your own audio and video.",
    zh: "一切的起点：由大模型担纲的 DJ 无限续写你的歌单，再加上一个 YouTube Music 风格的播放器，播放你自己的音频和视频。",
    ja: "すべての土台。LLM が務める DJ がプレイリストを無限に書き継ぎ、さらに自分の音声や動画を再生できる YouTube Music スタイルのプレーヤーも備えました。",
    ko: "모든 것의 토대. LLM이 맡은 DJ가 플레이리스트를 끝없이 이어 쓰고, 내 오디오와 영상을 재생하는 YouTube Music 스타일의 플레이어까지 더했습니다.",
  },
  items: [
    {
      area: "dj",
      category: "highlight",
      platform: "all",
      title: {
        en: "An AI DJ that never stops",
        zh: "永不停歇的 AI DJ",
        ja: "止まらない AI DJ",
        ko: "멈추지 않는 AI DJ",
      },
      description: {
        en: "An LLM writes track briefs and an endless playlist materializes as you listen.",
        zh: "大模型不断写出歌曲构思，歌单在你聆听的同时无限生成。",
        ja: "LLM が曲の構想を書き続け、聴いているそばから無限のプレイリストが形になります。",
        ko: "LLM이 곡 구상을 계속 써 내려가고, 듣는 사이에 끝없는 플레이리스트가 만들어집니다.",
      },
    },
    {
      area: "sets",
      category: "feature",
      platform: "all",
      title: {
        en: "Mixed music + video sets",
        zh: "音乐与视频混合歌单",
        ja: "音楽と動画の混合セット",
        ko: "음악과 영상이 섞인 세트",
      },
      description: {
        en: "Build sets that mix AI-generated audio with your own uploaded songs and music videos.",
        zh: "把 AI 生成的音频和你上传的歌曲、MV 混编进同一个歌单。",
        ja: "AI 生成の音声と、自分でアップロードした曲やミュージックビデオをひとつのセットに混ぜられます。",
        ko: "AI가 생성한 오디오와 직접 올린 노래, 뮤직비디오를 한 세트에 섞을 수 있습니다.",
      },
    },
    {
      area: "player",
      category: "feature",
      platform: "all",
      title: {
        en: "Player-first dock",
        zh: "以播放为先的底栏",
        ja: "再生を中心に据えたドック",
        ko: "재생 중심의 도크",
      },
      description: {
        en: "A unified bottom dock: cover and title, full-width progress, and flat navigation.",
        zh: "统一的底部控制栏：封面与标题、整宽进度条，以及扁平导航。",
        ja: "ひとつにまとまった下部ドック。カバーとタイトル、全幅のプログレス、フラットなナビゲーションを備えます。",
        ko: "하나로 통합된 하단 도크. 커버와 제목, 전체 너비 진행 바, 그리고 평평한 내비게이션을 담았습니다.",
      },
    },
    {
      area: "memory",
      category: "feature",
      platform: "all",
      title: {
        en: "Songs carry memories",
        zh: "歌曲承载回忆",
        ja: "曲が思い出を宿す",
        ko: "노래에 추억을 담다",
      },
      description: {
        en: "Tag a track, add a note, and set a cover photo so each song holds a moment.",
        zh: "为歌曲打标签、写备注、设一张封面照，让每首歌都留住一个瞬间。",
        ja: "曲にタグを付け、メモを添え、カバー写真を設定すれば、一曲ごとに思い出の瞬間が宿ります。",
        ko: "곡에 태그를 달고 메모를 적고 커버 사진을 정하면, 노래마다 한순간이 깃듭니다.",
      },
    },
    {
      area: "visualizer",
      category: "improvement",
      platform: "all",
      title: {
        en: "Built-in visualizers",
        zh: "内置可视化",
        ja: "ビルトインのビジュアライザー",
        ko: "기본 제공 비주얼라이저",
      },
      description: {
        en: "Octave-band canvas spectrum styles that follow your theme color.",
        zh: "基于八度分带的 canvas 频谱样式，随你的主题色变化。",
        ja: "オクターブ分割のキャンバス・スペクトラム表現が、テーマカラーに合わせて色づきます。",
        ko: "옥타브 분할 캔버스 스펙트럼 스타일이 테마 색을 따라 물듭니다.",
      },
    },
  ],
};

export default release;
