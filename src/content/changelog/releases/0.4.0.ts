import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "0.4.0",
  date: "2026-06-09",
  title: {
    en: "Sync to your own cloud",
    zh: "同步到你自己的云",
    ja: "あなた自身のクラウドへ同期",
    ko: "내 클라우드로 동기화",
  },
  summary: {
    en: "Publish and pull your whole library to a cloud drive you own — still no backend, no account.",
    zh: "把整个曲库发布并拉取到你自己拥有的云盘——依然没有后端，也无需账号。",
    ja: "ライブラリ全体を、あなた自身が所有するクラウドへ発行・取得できます。バックエンドもアカウントも不要なまま。",
    ko: "라이브러리 전체를 내가 소유한 클라우드 드라이브로 올리고 내려받습니다. 여전히 백엔드도 계정도 없습니다.",
  },
  items: [
    {
      area: "sync",
      category: "highlight",
      platform: "all",
      title: {
        en: "Your own cloud drive",
        zh: "你自己的云盘",
        ja: "あなた自身のクラウドドライブ",
        ko: "내 소유의 클라우드 드라이브",
      },
      description: {
        en: "Publish and pull your library to a bring-your-own Cloudflare R2 bucket — no MUZERO account.",
        zh: "把曲库发布并拉取到你自带的 Cloudflare R2 存储桶——无需 MUZERO 账号。",
        ja: "ライブラリを、自分で用意した Cloudflare R2 バケットへ発行・取得できます。MUZERO のアカウントは不要です。",
        ko: "라이브러리를 직접 마련한 Cloudflare R2 버킷에 올리고 내려받습니다. MUZERO 계정이 필요 없습니다.",
      },
    },
    {
      area: "sync",
      category: "feature",
      platform: "all",
      title: {
        en: "Stream shared libraries",
        zh: "在线播放共享曲库",
        ja: "共有ライブラリをストリーミング",
        ko: "공유 라이브러리 스트리밍",
      },
      description: {
        en: "Import and stream sets from a shared library manifest.",
        zh: "从共享曲库清单导入歌单并在线播放。",
        ja: "共有ライブラリのマニフェストからセットを取り込み、ストリーミング再生できます。",
        ko: "공유 라이브러리 매니페스트에서 세트를 가져와 스트리밍할 수 있습니다.",
      },
    },
    {
      area: "library",
      category: "feature",
      platform: "all",
      title: {
        en: "Playback stats & presence",
        zh: "播放统计与在线状态",
        ja: "再生統計とプレゼンス",
        ko: "재생 통계와 접속 상태",
      },
      description: {
        en: "Per-device listening stats and an optional 'listening now' presence.",
        zh: "按设备统计聆听数据，并可选开启「正在收听」的在线状态。",
        ja: "端末ごとの再生統計に加え、「いま聴いている」プレゼンスを任意で表示できます。",
        ko: "기기별 청취 통계와 함께, 원한다면 '지금 듣는 중' 상태를 표시할 수 있습니다.",
      },
    },
    {
      area: "sync",
      category: "feature",
      platform: "all",
      title: {
        en: "Conflict-aware merge",
        zh: "感知冲突的合并",
        ja: "競合を見極めるマージ",
        ko: "충돌을 헤아리는 병합",
      },
      description: {
        en: "Additive merges, with an explicit panel to resolve any conflicts.",
        zh: "采用增量式合并，并提供专门面板来解决任何冲突。",
        ja: "追加方式でマージし、競合が出たら専用パネルで明示的に解消できます。",
        ko: "추가 방식으로 병합하고, 충돌이 생기면 전용 패널에서 분명하게 해결합니다.",
      },
    },
    {
      area: "library",
      category: "feature",
      platform: "all",
      title: {
        en: "Metadata import/export",
        zh: "元数据导入导出",
        ja: "メタデータの読み書き",
        ko: "메타데이터 가져오기·내보내기",
      },
      description: {
        en: "Read and write MP3, FLAC, and M4A tags.",
        zh: "读写 MP3、FLAC 和 M4A 的标签。",
        ja: "MP3・FLAC・M4A のタグを読み書きします。",
        ko: "MP3, FLAC, M4A 태그를 읽고 씁니다.",
      },
    },
  ],
};

export default release;
