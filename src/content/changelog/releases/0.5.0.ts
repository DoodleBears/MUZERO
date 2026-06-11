import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "0.5.0",
  date: "2026-06-10",
  title: {
    en: "A real music library",
    zh: "一个真正的音乐库",
    ja: "本物の音楽ライブラリ",
    ko: "제대로 된 음악 라이브러리",
  },
  summary: {
    en: "Artists, albums, transliteration search, and fully configurable shortcuts.",
    zh: "艺人、专辑、转写搜索，以及可完全自定义的快捷键。",
    ja: "アーティスト、アルバム、読み変換検索、そして自由に設定できるショートカット。",
    ko: "아티스트, 앨범, 음역 검색, 그리고 자유롭게 설정하는 단축키.",
  },
  items: [
    {
      area: "library",
      category: "highlight",
      platform: "all",
      title: {
        en: "Artist & album browsing",
        zh: "按艺人与专辑浏览",
        ja: "アーティストとアルバムで探す",
        ko: "아티스트·앨범으로 둘러보기",
      },
      description: {
        en: "Auto-derived artists and albums with detail pages and cross-linking.",
        zh: "自动归纳出艺人和专辑，配有详情页并相互关联。",
        ja: "アーティストとアルバムを自動で割り出し、詳細ページと相互リンクを用意します。",
        ko: "아티스트와 앨범을 자동으로 정리하고, 상세 페이지와 상호 연결을 제공합니다.",
      },
    },
    {
      area: "search",
      category: "feature",
      platform: "all",
      title: {
        en: "Search in any script",
        zh: "任意文字都能搜",
        ja: "どの文字でも検索",
        ko: "어떤 문자로도 검색",
      },
      description: {
        en: "Pinyin, kana, and romaji transliteration search, run off the main thread.",
        zh: "支持拼音、假名和罗马音的转写搜索，并在后台线程运行。",
        ja: "ピンイン・かな・ローマ字の読み変換検索に対応し、メインスレッドの外で実行します。",
        ko: "병음, 가나, 로마자 음역 검색을 지원하며 메인 스레드 밖에서 동작합니다.",
      },
    },
    {
      area: "app",
      category: "feature",
      platform: "all",
      title: {
        en: "Configurable shortcuts",
        zh: "可自定义快捷键",
        ja: "設定できるショートカット",
        ko: "설정 가능한 단축키",
      },
      description: {
        en: "Rebind keys with a recorder and a built-in cheat sheet.",
        zh: "用录制器重新绑定按键，并附带内置速查表。",
        ja: "レコーダーでキーを割り当て直せて、早見表も内蔵しています。",
        ko: "레코더로 키를 다시 지정하고, 기본 제공되는 치트 시트도 함께 봅니다.",
      },
    },
    {
      area: "settings",
      category: "improvement",
      platform: "all",
      title: {
        en: "Two-column Settings",
        zh: "双栏设置",
        ja: "2 カラムの設定",
        ko: "두 단 구성의 설정",
      },
      description: {
        en: "A master-detail Settings layout with a searchable sidebar.",
        zh: "主从式的设置布局，配上可搜索的侧边栏。",
        ja: "マスター・ディテール型の設定レイアウトに、検索できるサイドバーを添えました。",
        ko: "마스터-디테일 방식의 설정 레이아웃에 검색 가능한 사이드바를 더했습니다.",
      },
    },
    {
      area: "library",
      category: "feature",
      platform: "all",
      title: {
        en: "Editable entity covers",
        zh: "可编辑的封面",
        ja: "編集できるカバー",
        ko: "편집 가능한 커버",
      },
      description: {
        en: "Set custom cover art for artists and albums.",
        zh: "为艺人和专辑设置自定义封面。",
        ja: "アーティストやアルバムに好きなカバーアートを設定できます。",
        ko: "아티스트와 앨범에 원하는 커버 아트를 설정할 수 있습니다.",
      },
    },
  ],
};

export default release;
