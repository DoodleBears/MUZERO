import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.5.0",
  date: "2026-06-25",
  title: {
    en: "Live song requests land where they should",
    zh: "弹幕点歌，稳稳排进下一首",
    ja: "ライブ視聴者のリクエストが正しく並ぶ",
    ko: "라이브 신청곡이 제자리에 들어갑니다",
  },
  summary: {
    en: "Live chat song requests (弹幕点歌) now route reliably no matter what you are playing. In online playlists (like NetEase imports) and other non-DJ playlists, a viewer's 'play next' request finds the song and queues it right after the current track — under shuffle, repeat-all, and when you switch playlists mid-stream. Songs matched online always land in one dedicated request playlist (with the cover cached for offline) instead of drifting into whichever set was playing; songs you already own are reused instead of re-downloaded; and a request that arrives while nothing is playing now starts playback immediately. Single-track repeat intentionally keeps looping the current song and holds requests until you move on.",
    zh: "弹幕点歌现在无论你在放什么都能稳定路由。在线歌单（如网易云导入）和其它非 DJ 歌单下，观众的「下一首」点歌都能命中并排到当前曲之后——随机播放、列表循环，以及播放途中切换歌单都成立。在线命中的曲子统一进入一个专用「点歌歌单」（封面会缓存以便离线显示），不再漂进当时正在播放的歌单；点你已有的歌会复用本地副本、不重复下载；点歌到来时若什么都没在放，会立即起播。单曲循环按设计仍循环当前曲、把点歌保留到你切换为止。",
    ja: "ライブチャットの楽曲リクエスト（弾幕点歌）が、何を再生中でも確実に処理されるようになりました。オンラインプレイリスト（NetEase インポートなど）やその他の非 DJ プレイリストでも、視聴者の「次に再生」リクエストが曲を見つけて現在の曲の直後に並びます — シャッフル、全曲リピート、再生中のプレイリスト切り替えでも同様です。オンラインで一致した曲は、その時再生中のセットに紛れ込むのではなく、常に専用の「リクエストプレイリスト」に入り（カバーはオフライン用にキャッシュ）、すでに持っている曲はローカルを再利用して再ダウンロードしません。何も再生していないときに来たリクエストはすぐに再生を始めます。1 曲リピートは設計どおり現在の曲をループし続け、切り替えるまでリクエストを保留します。",
    ko: "라이브 채팅 신청곡(탄막 신청)이 무엇을 재생하든 안정적으로 처리됩니다. 온라인 재생목록(NetEase 가져오기 등)이나 기타 비 DJ 재생목록에서도 시청자의 '다음 곡' 요청이 곡을 찾아 현재 곡 바로 뒤에 넣습니다 — 셔플, 전체 반복, 재생 중 재생목록 전환에서도 동일합니다. 온라인에서 일치한 곡은 그때 재생 중이던 세트로 흘러들지 않고 항상 전용 '신청 재생목록'에 들어가며(커버는 오프라인용으로 캐시), 이미 가지고 있는 곡은 로컬 사본을 재사용해 다시 내려받지 않습니다. 아무것도 재생되지 않을 때 들어온 요청은 즉시 재생을 시작합니다. 한 곡 반복은 의도대로 현재 곡을 계속 반복하며 전환할 때까지 요청을 보류합니다.",
  },
  items: [
    {
      area: "player",
      category: "highlight",
      platform: "desktop",
      title: {
        en: "Live requests queue correctly in online & other playlists",
        zh: "在线歌单与各类歌单下，点歌都能正确排队",
        ja: "オンラインなど各種プレイリストでリクエストが正しく並ぶ",
        ko: "온라인 등 여러 재생목록에서 신청곡이 정확히 대기열에 들어감",
      },
      description: {
        en: "When you are listening to an online playlist (e.g. imported from NetEase) or any non-DJ playlist, a viewer's 'play next' request now reliably finds the song and queues it right after the current track — including while shuffle or repeat-all is on, and when you switch playlists mid-stream. Previously, a request made while playing certain playlists could silently match nothing and never play.",
        zh: "在收听在线歌单（如网易云导入）或各类非 DJ 歌单时，观众的「下一首」点歌现在能稳定命中并排到当前曲之后——包括随机播放、列表循环，以及播放途中切换歌单。此前在某些歌单下点歌可能悄无声息地搜不到、永远不会播。",
        ja: "オンラインプレイリスト（NetEase インポートなど）やその他の非 DJ プレイリストを聴いているとき、視聴者の「次に再生」リクエストが確実に曲を見つけて現在の曲の直後に並ぶようになりました — シャッフルや全曲リピート中、再生中のプレイリスト切り替え時も含みます。以前は特定のプレイリスト再生中のリクエストが静かに何も一致せず、再生されないことがありました。",
        ko: "온라인 재생목록(NetEase 가져오기 등)이나 비 DJ 재생목록을 들을 때, 시청자의 '다음 곡' 요청이 이제 곡을 안정적으로 찾아 현재 곡 바로 뒤에 넣습니다 — 셔플이나 전체 반복 중, 재생 중 재생목록 전환 시에도 마찬가지입니다. 이전에는 특정 재생목록 재생 중의 요청이 조용히 아무것도 일치하지 않아 재생되지 않을 수 있었습니다.",
      },
    },
    {
      area: "streaming",
      category: "fix",
      platform: "desktop",
      title: {
        en: "Online-matched requests land in one dedicated request playlist",
        zh: "在线命中的点歌统一进入专用「点歌歌单」",
        ja: "オンライン一致のリクエストは専用のリクエストプレイリストへ",
        ko: "온라인으로 찾은 신청곡은 전용 신청 재생목록으로",
      },
      description: {
        en: "When a requested song is not in your library and is matched online, it now always goes into one dedicated request playlist (with its cover cached for offline), instead of drifting into whichever set happened to be playing. Requests for songs you already have reuse your local copy — no duplicate downloads or second versions.",
        zh: "当点的歌不在本地库、靠在线搜索命中时，现在统一进入一个专用「点歌歌单」（封面会缓存以便离线显示），不再漂进当时正好在播放的歌单。点的是你已有的歌时，会复用本地副本——不重复下载、不产生第二个版本。",
        ja: "リクエストされた曲がライブラリになくオンラインで一致した場合、その時たまたま再生中だったセットに紛れ込むのではなく、常に専用のリクエストプレイリストに入ります（カバーはオフライン用にキャッシュ）。すでに持っている曲のリクエストはローカルを再利用し、重複ダウンロードや別バージョンを作りません。",
        ko: "신청한 곡이 라이브러리에 없어 온라인으로 찾은 경우, 그때 재생 중이던 세트로 흘러들지 않고 항상 전용 신청 재생목록에 들어갑니다(커버는 오프라인용으로 캐시). 이미 가진 곡의 신청은 로컬 사본을 재사용해 중복 다운로드나 다른 버전을 만들지 않습니다.",
      },
    },
    {
      area: "player",
      category: "improvement",
      platform: "desktop",
      title: {
        en: "Requests start playing when nothing is on",
        zh: "没在放时点歌会立即起播",
        ja: "何も再生していないときのリクエストはすぐ再生",
        ko: "아무것도 재생 중이 아닐 때 신청곡은 즉시 재생",
      },
      description: {
        en: "If nothing is playing when a 'play next' request comes in, MUZERO now starts playing it right away, instead of quietly adding it to an idle queue that never advances.",
        zh: "如果「下一首」点歌到来时没有在放任何东西，MUZERO 现在会立即开始播放，而不是悄悄塞进一个空闲、永不推进的队列。",
        ja: "「次に再生」リクエストが来たときに何も再生していなければ、MUZERO は進まないアイドルキューに静かに追加するのではなく、すぐに再生を始めます。",
        ko: "'다음 곡' 요청이 왔을 때 아무것도 재생 중이 아니면, MUZERO가 진행되지 않는 유휴 대기열에 조용히 추가하는 대신 즉시 재생을 시작합니다.",
      },
    },
  ],
};

export default release;
