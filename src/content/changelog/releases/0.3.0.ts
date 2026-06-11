import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "0.3.0",
  date: "2026-06-08",
  title: {
    en: "Music carries memories",
    zh: "音乐承载回忆",
    ja: "音楽は思い出を運ぶ",
    ko: "음악은 추억을 싣는다",
  },
  summary: {
    en: "A richer Now Playing and a memory wall that ties photos and notes to your songs.",
    zh: "更丰富的「正在播放」，加上一面把照片和文字系在歌曲上的回忆墙。",
    ja: "より豊かな「再生中」画面と、写真やメモを曲に結びつける思い出のウォール。",
    ko: "더 풍성해진 '재생 중' 화면과, 사진과 메모를 노래에 엮어 두는 추억의 벽.",
  },
  items: [
    {
      area: "memory",
      category: "highlight",
      platform: "all",
      title: {
        en: "Sticky-note memories",
        zh: "便签式回忆",
        ja: "付箋のような思い出",
        ko: "포스트잇 같은 추억",
      },
      description: {
        en: "A masonry wall of photo-and-text notes attached to your songs.",
        zh: "一面瀑布流的便签墙，把照片和文字附在你的歌曲上。",
        ja: "写真と文章のメモを曲に貼り付けた、石積み状のウォールです。",
        ko: "사진과 글로 된 메모를 노래에 붙여 둔, 벽돌처럼 쌓인 보드입니다.",
      },
    },
    {
      area: "player",
      category: "feature",
      platform: "all",
      title: {
        en: "Swipeable Now Playing",
        zh: "可滑动的「正在播放」",
        ja: "スワイプできる「再生中」",
        ko: "넘길 수 있는 '재생 중'",
      },
      description: {
        en: "Swipe between covers with fluid transitions on the Now Playing stage.",
        zh: "在「正在播放」舞台上滑动切换封面，过渡顺滑流畅。",
        ja: "「再生中」のステージで、なめらかなトランジションとともにカバーをスワイプして切り替えられます。",
        ko: "'재생 중' 무대에서 부드러운 전환과 함께 커버를 쓸어 넘길 수 있습니다.",
      },
    },
    {
      area: "memory",
      category: "feature",
      platform: "all",
      title: {
        en: "Memory rail",
        zh: "回忆侧栏",
        ja: "思い出レール",
        ko: "추억 레일",
      },
      description: {
        en: "A collapsible timeline of a track's memories beside Now Playing.",
        zh: "在「正在播放」一侧，展开一条可收起的歌曲回忆时间线。",
        ja: "「再生中」の隣に、曲の思い出を並べた折りたためるタイムラインが現れます。",
        ko: "'재생 중' 옆에 접을 수 있는 곡의 추억 타임라인이 펼쳐집니다.",
      },
    },
    {
      area: "sets",
      category: "improvement",
      platform: "all",
      title: {
        en: "Cover from a memory",
        zh: "用回忆当封面",
        ja: "思い出をカバーに",
        ko: "추억으로 커버를",
      },
      description: {
        en: "Promote any memory photo to be the set cover.",
        zh: "把任意一张回忆照片提升为整个歌单的封面。",
        ja: "どの思い出の写真でも、セットのカバーに昇格させられます。",
        ko: "어떤 추억 사진이든 세트의 커버로 올릴 수 있습니다.",
      },
    },
  ],
};

export default release;
