import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "0.7.0",
  date: "2026-06-11",
  title: {
    en: "Immersive, fluid, and self-updating",
    zh: "沉浸、流畅、自我更新",
    ja: "没入感、なめらかさ、自動更新",
    ko: "몰입감, 부드러움, 자동 업데이트",
  },
  summary: {
    en: "A cover-painted flow background, smooth scrolling, drag-to-reorder, and built-in updates with a version-history download center.",
    zh: "由封面取色绘出的流光背景、顺滑滚动、拖拽排序，以及内置更新和版本历史下载中心。",
    ja: "カバーから色を取った流光の背景、なめらかなスクロール、ドラッグ並べ替え、そしてバージョン履歴のダウンロードセンターを備えた自動更新。",
    ko: "커버에서 색을 뽑아 그린 흐르는 배경, 부드러운 스크롤, 끌어서 정렬, 그리고 버전 기록 다운로드 센터를 갖춘 내장 업데이트.",
  },
  items: [
    {
      area: "visualizer",
      category: "highlight",
      platform: "all",
      title: {
        en: "Cover-palette flow background",
        zh: "封面取色流光背景",
        ja: "カバー配色の流光背景",
        ko: "커버 색감 흐름 배경",
      },
      description: {
        en: "A multi-color aurora that paints itself from your cover art, with 14 styles.",
        zh: "一片从封面取色而成的多彩流光，共有 14 种样式。",
        ja: "カバーアートから色を取って描かれる多彩なオーロラ。14 種類のスタイルを用意しました。",
        ko: "커버 아트에서 색을 가져와 그려지는 다채로운 오로라. 14가지 스타일을 담았습니다.",
      },
    },
    {
      area: "library",
      category: "feature",
      platform: "all",
      title: {
        en: "Drag to reorder",
        zh: "拖拽即可排序",
        ja: "ドラッグで並べ替え",
        ko: "끌어서 순서 바꾸기",
      },
      description: {
        en: "Multi-select drag-and-drop reordering that merges cleanly across devices.",
        zh: "支持多选的拖放排序，跨设备也能干净地合并。",
        ja: "複数選択のドラッグ＆ドロップ並べ替えに対応し、端末をまたいでもきれいにマージされます。",
        ko: "여러 곡을 선택해 끌어다 놓는 정렬을 지원하며, 기기 간에도 깔끔하게 병합됩니다.",
      },
    },
    {
      area: "app",
      category: "improvement",
      platform: "all",
      title: {
        en: "Smooth scrolling",
        zh: "顺滑滚动",
        ja: "なめらかなスクロール",
        ko: "부드러운 스크롤",
      },
      description: {
        en: "Fluid, inertial scrolling across lists, grids, and pages.",
        zh: "在列表、网格和页面间带惯性的流畅滚动。",
        ja: "リストもグリッドもページも、慣性のあるなめらかなスクロールで動きます。",
        ko: "목록과 그리드, 페이지 어디서나 관성이 실린 부드러운 스크롤로 움직입니다.",
      },
    },
    {
      area: "app",
      category: "feature",
      platform: "all",
      title: {
        en: "In-app updates & version history",
        zh: "应用内更新与版本历史",
        ja: "アプリ内更新とバージョン履歴",
        ko: "앱 내 업데이트와 버전 기록",
      },
      description: {
        en: "Automatic desktop updates, plus a Settings download center for every past release.",
        zh: "桌面端自动更新，并在设置里提供下载历代版本的中心。",
        ja: "デスクトップは自動更新に対応し、設定には過去のすべてのリリースをそろえたダウンロードセンターを用意しました。",
        ko: "데스크톱은 자동으로 업데이트되고, 설정에는 지난 모든 릴리스를 모아 둔 다운로드 센터를 마련했습니다.",
      },
    },
  ],
};

export default release;
