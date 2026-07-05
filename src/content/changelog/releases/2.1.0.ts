import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "2.1.0",
  date: "2026-07-05",
  title: {
    en: "Requests, ratings, and memories over lyrics",
    zh: "点歌分流、评分评论、歌词上的记忆",
    ja: "リクエストの振り分け、評価とコメント、歌詞の上のメモリー",
    ko: "신청곡 분기, 평점·댓글, 가사 위 추억",
  },
  summary: {
    en: "The live-request channel now routes by keyword: 点歌 does a quick library search — no more forcing every request through the AI DJ — while AI点歌 goes to the AI DJ, and each command's keyword is yours to set. Viewers can also react to the song that's playing: 评分 5 casts a vote into a crowd rating shown as a persistent 1–5 chip (each person counts once, the host can tap too), and 评论 leaves a signed memory on the track — pinned to a lyric moment when they type a timestamp like 3:14. And while you read the lyrics, this song's memories now carousel across the top, just like immersive mode.",
    zh: "点歌通道现在按关键词分流：点歌 走库内快速搜索——不再把每条点歌都塞给 AI DJ——AI点歌 才交给 AI DJ，每个关键词都可自定义。观众也能对正在放的歌做出反应：评分 5 会投一票进众评均分、以顶部常驻的 1–5 分 chip 展示（每人只算一票，主播也能点），评论 会给这首歌留下一条署名记忆——当他们写下 3:14 这样的时间点时，记忆会钉到那句歌词上。而当你在看歌词时，这首歌的记忆会像沉浸模式一样在顶部轮播。",
    ja: "リクエストチャンネルがキーワードで振り分けられるようになりました：点歌 はライブラリ内クイック検索——すべてのリクエストを AI DJ に回すことはもうありません——AI点歌 は AI DJ へ、キーワードは個別に設定できます。視聴者は再生中の曲に反応もできます：評分 5 は衆評の平均に一票を投じ、上部に常駐する 1–5 のチップで表示（一人一票、ホストもタップ可）、評論 は曲に署名付きメモリーを残します——3:14 のような時刻を書けば、その歌詞の瞬間に固定されます。そして歌詞を読んでいるとき、この曲のメモリーが没入モードのように上部を流れます。",
    ko: "신청곡 채널이 이제 키워드로 분기됩니다: 点歌는 라이브러리 빠른 검색——모든 신청곡을 AI DJ로 넘기지 않습니다——AI点歌는 AI DJ로, 키워드는 각각 설정할 수 있습니다. 시청자는 재생 중인 곡에 반응할 수도 있습니다: 评分 5는 대중 평점에 한 표를 던져 상단에 상주하는 1–5 칩으로 표시되고(1인 1표, 호스트도 탭 가능), 评论은 곡에 서명된 추억을 남깁니다——3:14 같은 시각을 쓰면 그 가사 순간에 고정됩니다. 그리고 가사를 볼 때, 이 곡의 추억이 몰입 모드처럼 상단을 흐릅니다.",
  },
  items: [
    {
      area: "dj",
      category: "highlight",
      platform: "all",
      title: {
        en: "Song requests search first — the AI DJ only when you ask for it",
        zh: "点歌先搜库——只有你点名时才走 AI DJ",
        ja: "リクエストはまず検索——AI DJ は指名したときだけ",
        ko: "신청곡은 먼저 검색——AI DJ는 지목할 때만",
      },
      description: {
        en: "The live-request channel is now a keyword router. `点歌 <name>` does a quick library search (with an online fallback) instead of forcing every request through the heavy AI DJ, and a separate keyword like `AI点歌` sends it to the AI DJ to curate or generate. Each command's trigger keyword is configurable under Settings → Live requests.",
        zh: "点歌通道现在是一个关键词路由。`点歌 <歌名>` 走库内快速搜索（配联网兜底），而不是把每条点歌都塞进又重又慢的 AI DJ；另配一个关键词如 `AI点歌` 才交给 AI DJ 策展或生成。每个命令的触发关键词都可在 设置 → 观众点歌 里自定义。",
        ja: "リクエストチャンネルがキーワードルーターになりました。`点歌 <曲名>` は（オンラインフォールバック付きの）ライブラリ内クイック検索を行い、すべてのリクエストを重い AI DJ に回すことはありません。`AI点歌` のような別のキーワードで AI DJ に選曲・生成させます。各コマンドのトリガーキーワードは 設定 → 観客リクエスト で設定できます。",
        ko: "신청곡 채널이 이제 키워드 라우터입니다. `点歌 <곡명>`은 (온라인 폴백이 있는) 라이브러리 빠른 검색을 하며, 모든 신청곡을 무거운 AI DJ로 넘기지 않습니다. `AI点歌` 같은 별도 키워드로 AI DJ에게 큐레이션·생성을 맡깁니다. 각 명령의 트리거 키워드는 설정 → 관객 신청곡에서 설정할 수 있습니다.",
      },
    },
    {
      area: "memory",
      category: "feature",
      platform: "all",
      title: {
        en: "Viewers can rate and comment on the current song",
        zh: "观众可以给正在放的歌评分和评论",
        ja: "視聴者が再生中の曲を評価・コメントできる",
        ko: "시청자가 재생 중인 곡에 평점과 댓글을 남길 수 있습니다",
      },
      description: {
        en: "Two new chat commands act on whatever is playing. `评分 5` casts a vote into the song's crowd rating — shown as a persistent 1–5 star chip at the top of Now Playing, where every voter counts once and the host can tap to rate too. `评论 …` leaves a signed memory on the track; comments float in the memory carousel by default, or add a timestamp like `评论 3:14 …` to pin one to that lyric moment. Both keywords are configurable, and ratings stay on your device.",
        zh: "两个新的聊天命令作用于正在播放的歌。`评分 5` 会投一票进这首歌的众评均分——以 Now Playing 顶部常驻的 1–5 星 chip 展示，每人只算一票，主播也能点星评分。`评论 …` 会给这首歌留下一条署名记忆；评论默认在记忆轮播里浮动，或写上 `评论 3:14 …` 这样的时间点把它钉到那句歌词上。两个关键词都可自定义，评分只留在你的设备上。",
        ja: "2 つの新しいチャットコマンドが再生中の曲に作用します。`評分 5` は曲の衆評の平均に一票を投じ、Now Playing の上部に常駐する 1–5 の星チップで表示されます。一人一票で、ホストも星をタップして評価できます。`評論 …` は曲に署名付きメモリーを残します。コメントは既定でメモリーカルーセルに浮かび、`評論 3:14 …` のように時刻を付ければその歌詞の瞬間に固定されます。どちらのキーワードも設定でき、評価はこの端末に留まります。",
        ko: "두 개의 새 채팅 명령이 재생 중인 곡에 작용합니다. `评分 5`는 곡의 대중 평점에 한 표를 던지고, Now Playing 상단에 상주하는 1–5 별 칩으로 표시됩니다. 1인 1표이며 호스트도 별을 탭해 평가할 수 있습니다. `评论 …`은 곡에 서명된 추억을 남깁니다. 댓글은 기본적으로 추억 캐러셀에 떠 있고, `评论 3:14 …`처럼 시각을 붙이면 그 가사 순간에 고정됩니다. 두 키워드 모두 설정할 수 있고, 평점은 이 기기에만 남습니다.",
      },
    },
    {
      area: "dj",
      category: "improvement",
      platform: "all",
      title: {
        en: "The DJ replies faster on big libraries — no more full rescan every turn",
        zh: "大曲库下 DJ 回复更快——不再每回合全库重扫",
        ja: "大きなライブラリでも DJ の返事が速く——毎ターンの全スキャンを廃止",
        ko: "큰 라이브러리에서도 DJ 응답이 빨라졌습니다——매 턴 전체 재스캔 제거",
      },
      description: {
        en: "Every chat or voice turn used to rebuild the DJ's genre/tag palette by scanning your whole library. The palette is now cached and kept fresh incrementally: editing a track's tags patches just the changed tags, and adding or removing songs is detected by a cheap in-memory fingerprint — no database reads at all on a warm turn. On a 6,000-track library that means one scan on first use, then effectively instant (~0 ms) for every turn after.",
        zh: "过去每个聊天 / 语音回合都要全库扫描来重建 DJ 的风格 / tag 面板。现在这份面板会被缓存并增量保鲜：编辑某首歌的 tag 只修补变动的那几个 tag，增删歌曲由一个廉价的内存指纹感知——热回合完全不读数据库。在 6000 首的曲库上，首次使用扫一次，之后每个回合都近乎即时（约 0 毫秒）。",
        ja: "これまではチャット / 音声のターンごとにライブラリ全体をスキャンして DJ のジャンル / タグパレットを作り直していました。パレットはキャッシュされ、増分で最新に保たれます：トラックのタグ編集は変わったタグだけを修正し、曲の追加・削除は軽量なメモリ内フィンガープリントで検知——ウォームなターンではデータベースを一切読みません。6,000 曲のライブラリでも初回に一度スキャンするだけで、以降のターンはほぼ即時（約 0 ms）です。",
        ko: "이전에는 채팅 / 음성 턴마다 라이브러리 전체를 스캔해 DJ의 장르 / 태그 팔레트를 다시 만들었습니다. 이제 팔레트는 캐시되고 증분으로 갱신됩니다: 트랙의 태그를 편집하면 바뀐 태그만 수정하고, 곡 추가·삭제는 저렴한 메모리 지문으로 감지합니다——웜 턴에서는 데이터베이스를 전혀 읽지 않습니다. 6,000곡 라이브러리에서도 첫 사용 시 한 번만 스캔하고, 이후 모든 턴은 사실상 즉시(~0 ms)입니다.",
      },
    },
    {
      area: "player",
      category: "improvement",
      platform: "all",
      title: {
        en: "Hours-long live sessions stay lean on memory",
        zh: "连播数小时的直播点歌，内存不再越吃越多",
        ja: "何時間ものライブ連続再生でもメモリを溜め込まない",
        ko: "몇 시간짜리 라이브 연속 재생에도 메모리가 계속 늘지 않습니다",
      },
      description: {
        en: "A long live-request stream used to accumulate a little memory with every song — fetched covers, extracted palette colors, and per-request bookkeeping were all kept forever. Those session caches are now bounded (least-recently-used entries make room for new ones), dedupe/cooldown records expire with their decision windows, and skipping songs quickly now cancels the abandoned download instead of letting it finish in the background. Verified with an end-to-end long-run harness against a real 5,700-track library.",
        zh: "过去直播点歌连播久了，每放一首都会多留一点内存——拉取过的封面、取色出的调色板、每条点歌的登记都被永久留着。现在这些会话缓存全部有界（最久未用的条目让位给新条目），去重 / 冷却记录随判定窗口过期，快速跳歌也会中止被放弃的下载而不是让它在后台跑完。已用端到端长跑 harness 在 5700 首的真实曲库上验证。",
        ja: "これまで長時間のリクエスト配信では、曲を流すたびにメモリが少しずつ増えていました——取得したカバー、抽出したパレット色、リクエストごとの記録がすべて残り続けていたためです。これらのセッションキャッシュは上限付きになり（最も使われていないものから席を譲る）、重複排除 / クールダウンの記録は判定ウィンドウとともに期限切れになり、素早い曲送りは放棄されたダウンロードを裏で走らせず中断します。5,700 曲の実ライブラリに対する E2E 長時間ハーネスで検証済みです。",
        ko: "이전에는 긴 신청곡 방송에서 곡을 틀 때마다 메모리가 조금씩 쌓였습니다——가져온 커버, 추출한 팔레트 색, 신청곡별 기록이 모두 영구히 남았기 때문입니다. 이제 이런 세션 캐시는 모두 상한이 있고(가장 오래 안 쓴 항목이 자리를 내줍니다), 중복 제거 / 쿨다운 기록은 판정 윈도와 함께 만료되며, 빠른 곡 넘기기는 버려진 다운로드를 백그라운드에서 끝까지 돌리지 않고 중단합니다. 5,700곡 실제 라이브러리 대상 E2E 장시간 하니스로 검증했습니다.",
      },
    },
    {
      area: "lyrics",
      category: "feature",
      platform: "all",
      title: {
        en: "Memories carousel over the lyrics",
        zh: "歌词上方轮播记忆",
        ja: "歌詞の上にメモリーを流す",
        ko: "가사 위로 추억이 흐릅니다",
      },
      description: {
        en: "While you're reading the lyrics, this song's memories now surface as a strip across the top — the same gentle carousel as full-immersive mode, with timestamped ones appearing at their moment (tap the time to jump there). Toggle it under Settings → Visualizer ('Show memories over lyrics').",
        zh: "当你在看歌词时，这首歌的记忆现在会以浮层在顶部轮播——和全沉浸模式一样的柔和轮播，钉了秒的记忆会在对应时刻浮现（点时间即可跳到那一秒）。可在 设置 → 可视化（「歌词上浮现记忆」）里开关。",
        ja: "歌詞を読んでいるとき、この曲のメモリーが上部に帯として流れるようになりました——フル没入モードと同じ穏やかなカルーセルで、時刻付きのものはその瞬間に現れます（時刻をタップするとそこへジャンプ）。設定 → ビジュアライザー（「歌詞上にメモリーを表示」）で切り替えられます。",
        ko: "가사를 볼 때, 이 곡의 추억이 이제 상단에 띠 형태로 흐릅니다——풀 몰입 모드와 같은 부드러운 캐러셀이며, 시각이 붙은 추억은 그 순간에 나타납니다(시각을 탭하면 그곳으로 이동). 설정 → 비주얼라이저('가사 위에 추억 표시')에서 켜고 끌 수 있습니다.",
      },
    },
  ],
};

export default release;
