import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "2.0.0",
  date: "2026-07-04",
  title: {
    en: "Talk to your DJ",
    zh: "开口，和你的 DJ 对话",
    ja: "話しかけて、あなたの DJ と会話",
    ko: "말을 걸어, 당신의 DJ와 대화",
  },
  summary: {
    en: "MUZERO 2.0 turns the AI DJ into someone you talk to. Hold a shortcut and just say what you want — 'play something more chill, no vocals' — and the DJ switches songs, searches your library, and curates on the spot, then answers you in the top-left (and reads it aloud if you set up a voice). Imported songs now get genre and style tags filled in automatically, so the DJ — and search — can finally filter your uploads and streaming imports by 'city pop' or 'lo-fi'. Plus the music crossfades on pause and song changes, the DJ curates with real taste and reuses your existing sets instead of making empty ones, and you can filter your sets by AI / made by you / imported.",
    zh: "MUZERO 2.0 让 AI DJ 变成一个你可以「对话」的人。按住快捷键，直接说出你想要的——「放点更 chill 的，别要人声」——DJ 就当场帮你切歌、搜库、策展，并在左上角回你一句（若配了音色还会念出来）。导入的歌现在会自动补上风格 / 流派标签，于是 DJ 和搜索终于能按「city pop」「lo-fi」这类风格过滤你上传和从流媒体导入的歌。此外，暂停与切歌时音乐会淡入淡出；DJ 会用真正的品味来策展、并复用你已有的歌单而不是新建一堆空集；你还能按「AI / 自己建 / 导入」来筛选歌单。",
    ja: "MUZERO 2.0 は AI DJ を「話しかけられる相手」に変えます。ショートカットを押しながら、欲しいものをそのまま言うだけ——「もっと chill な感じで、ボーカルなしで」——すると DJ はその場で曲を切り替え、ライブラリを検索し、選曲し、左上で返事をします（音色を設定すれば読み上げも）。インポートした曲には今、ジャンル / スタイルのタグが自動で補われるので、DJ と検索がついにアップロードやストリーミング取り込みの曲を「city pop」「lo-fi」といったスタイルで絞り込めます。さらに一時停止や曲の切り替えで音楽がフェードし、DJ は本物のセンスで選曲して空のセットを量産せず既存のセットを再利用し、セットを「AI / 自作 / インポート」で絞り込めます。",
    ko: "MUZERO 2.0은 AI DJ를 '말을 걸 수 있는 상대'로 바꿉니다. 단축키를 누른 채 원하는 것을 그냥 말하면——'더 chill한 걸로, 보컬 없이'——DJ가 그 자리에서 곡을 바꾸고, 라이브러리를 검색하고, 큐레이션한 뒤 왼쪽 상단에서 대답합니다(음색을 설정하면 소리 내어 읽어 주기도 합니다). 이제 가져온 곡에 장르 / 스타일 태그가 자동으로 채워져, DJ와 검색이 마침내 업로드·스트리밍으로 가져온 곡을 'city pop'이나 'lo-fi' 같은 스타일로 필터링할 수 있습니다. 또한 일시정지와 곡 전환 시 음악이 페이드되고, DJ가 진짜 안목으로 큐레이션하며 빈 세트를 양산하지 않고 기존 세트를 재사용하고, 세트를 'AI / 직접 만듦 / 가져옴'으로 필터링할 수 있습니다.",
  },
  items: [
    {
      area: "dj",
      category: "highlight",
      platform: "desktop",
      title: {
        en: "Talk to your DJ — hold a key and just say it",
        zh: "和你的 DJ 对话——按住快捷键，说出来就行",
        ja: "DJ と会話 — キーを押して、言うだけ",
        ko: "DJ와 대화 — 키를 누르고, 말만 하면 됩니다",
      },
      description: {
        en: "Set a push-to-talk shortcut, hold it, and speak. Groq (your key) transcribes what you said and hands it to the AI DJ, which switches songs, searches your library, curates a set, or generates — then replies with a line in the top-left ('switched to lo-fi instrumentals, no vocals here'). It picks up your current conversation, so you can steer it hands-free: 'a bit more chill', 'keep this one', 'now something with vocals'. Your mic is only on while you hold the key; audio and transcripts are never stored or uploaded.",
        zh: "设一个「按住说话」的快捷键，按住，然后说。Groq（你的 key）把你说的话转成文字，交给 AI DJ——它会切歌、搜库、建歌单或生成，然后在左上角回你一句（「切到 lo-fi 器乐，这几首都没人声」）。它顺着你当前的对话走，所以你可以完全免手操控：「再 chill 一点」「这首留着」「换成有人声的」。麦克风只在你按住快捷键时开启；音频和转写文本永不存储、永不上传。",
        ja: "「押しながら話す」ショートカットを設定し、押しながら話します。Groq（あなたのキー）が話した内容を文字に起こして AI DJ に渡し、DJ は曲を切り替え、ライブラリを検索し、セットを作り、または生成して、左上に一言返します（「lo-fi のインスト曲に切り替えました、どれもボーカルなしです」）。今の会話を引き継ぐので、ハンズフリーで誘導できます——「もう少し chill に」「これは残して」「次はボーカルありで」。マイクはキーを押している間だけオン。音声も文字起こしも保存・アップロードは一切しません。",
        ko: "'누르고 말하기' 단축키를 설정하고, 누른 채 말하세요. Groq(내 키)가 말한 내용을 받아써 AI DJ에게 넘기면, DJ가 곡을 바꾸고, 라이브러리를 검색하고, 세트를 만들거나 생성한 뒤 왼쪽 상단에 한마디로 답합니다('lo-fi 연주곡으로 바꿨어요, 다 보컬 없는 곡이에요'). 지금 대화를 이어받으므로 손을 쓰지 않고 조종할 수 있습니다——'좀 더 chill하게', '이건 남겨 둬', '이제 보컬 있는 걸로'. 마이크는 키를 누르는 동안에만 켜지고, 오디오와 받아쓴 텍스트는 저장하거나 업로드하지 않습니다.",
      },
    },
    {
      area: "library",
      category: "highlight",
      platform: "all",
      title: {
        en: "Imported songs get genre and style tags — automatically",
        zh: "导入的歌自动补上风格 / 流派标签",
        ja: "インポートした曲にジャンル / スタイルのタグが自動で付く",
        ko: "가져온 곡에 장르 / 스타일 태그가 자동으로 채워집니다",
      },
      description: {
        en: "Until now the DJ could only judge an imported song by its title and artist. MUZERO now looks up genre, style, and mood for your uploads and streaming imports in the background — from MusicBrainz (keyless, works on web too), plus Last.fm and Discogs if you add a key, and QQ Music's own genre for Chinese tracks — and writes them onto the track. The DJ's picks, its 'library_search' tool, and your own search all start filtering by style, so 'play some city pop' or '#lo-fi' actually finds them. Turn it on under Settings → Genre tags; each track is looked up once.",
        zh: "以前 DJ 只能靠歌名和歌手来判断一首导入的歌。现在 MUZERO 会在后台为你上传和从流媒体导入的歌查风格、流派和情绪——来源包括 MusicBrainz（无需 key，web 也能用），以及配了 key 的 Last.fm 和 Discogs，华语歌还会用 QQ 音乐自带的流派——并写回到歌曲上。DJ 的选曲、它的 library_search 工具、以及你自己的搜索都开始能按风格过滤，于是「放点 city pop」或「#lo-fi」真的能找到它们。在 设置 → 风格标签 里开启；每首歌只查一次。",
        ja: "これまで DJ はインポートした曲をタイトルとアーティストでしか判断できませんでした。MUZERO はアップロードやストリーミング取り込みの曲について、ジャンル・スタイル・ムードをバックグラウンドで調べるようになりました——MusicBrainz（キー不要、web でも動作）に加え、キーを設定すれば Last.fm と Discogs、中国語曲には QQ 音楽自身のジャンルも——そして曲に書き込みます。DJ の選曲、その library_search ツール、そしてあなた自身の検索がスタイルで絞り込めるようになり、「city pop を流して」や「#lo-fi」で本当に見つかります。設定 → ジャンルタグ で有効化。各曲は一度だけ調べます。",
        ko: "지금까지 DJ는 가져온 곡을 제목과 아티스트로만 판단할 수 있었습니다. 이제 MUZERO는 업로드·스트리밍으로 가져온 곡의 장르, 스타일, 무드를 백그라운드에서 조회합니다——MusicBrainz(키 불필요, 웹에서도 작동)에 더해 키를 설정하면 Last.fm과 Discogs, 중국어 곡에는 QQ 뮤직 자체 장르까지——그리고 곡에 기록합니다. DJ의 선곡, library_search 도구, 그리고 직접 검색이 스타일로 필터링되기 시작해 'city pop 틀어 줘'나 '#lo-fi'로 실제로 찾을 수 있습니다. 설정 → 장르 태그에서 켜세요. 각 곡은 한 번만 조회합니다.",
      },
    },
    {
      area: "dj",
      category: "feature",
      platform: "desktop",
      title: {
        en: "The DJ can talk back — read replies aloud with Fish Audio",
        zh: "DJ 会开口回话——用 Fish Audio 朗读回复",
        ja: "DJ が声で返す — Fish Audio で返事を読み上げ",
        ko: "DJ가 목소리로 답합니다 — Fish Audio로 답장 읽어 주기",
      },
      description: {
        en: "Add a Fish Audio key (BYOK) and pick a voice — search Fish's library, preview samples, or paste any public voice ID. Turn on 'Speak replies aloud' and the DJ reads each reply out loud, gently ducking the music while it talks and restoring the volume when it's done. Great alongside push-to-talk for a fully hands-free DJ; leave it off to keep the DJ's replies as quiet top-left notifications.",
        zh: "填入 Fish Audio 的 key（BYOK）并选一个音色——可以搜索 Fish 的音色库、试听样本，或粘贴任意公开音色 ID。打开「自动朗读回复」，DJ 就会把每条回复念出来，念的时候轻轻压低音乐、念完再恢复音量。配合「按住说话」就是完全免手的 DJ；不想要就关掉，DJ 的回复只作为左上角的安静通知。",
        ja: "Fish Audio のキー（BYOK）を入れて音色を選びます——Fish の音色ライブラリを検索し、サンプルを試聴し、または任意の公開音色 ID を貼り付け。「返事を読み上げる」をオンにすると、DJ は返事を読み上げ、話す間は音楽をそっと下げ、終わると音量を戻します。「押しながら話す」と組み合わせれば完全ハンズフリーの DJ に。オフにすれば、DJ の返事は左上の静かな通知のままです。",
        ko: "Fish Audio 키(BYOK)를 넣고 음색을 고르세요——Fish 음색 라이브러리를 검색하고, 샘플을 미리 듣고, 또는 아무 공개 음색 ID나 붙여 넣을 수 있습니다. '답장 소리 내어 읽기'를 켜면 DJ가 각 답장을 읽어 주며, 말하는 동안 음악을 살짝 줄였다가 끝나면 볼륨을 되돌립니다. '누르고 말하기'와 함께 쓰면 완전한 핸즈프리 DJ가 됩니다. 꺼 두면 DJ의 답장은 왼쪽 상단의 조용한 알림으로만 남습니다.",
      },
    },
    {
      area: "player",
      category: "feature",
      platform: "all",
      title: {
        en: "Fade in / out when pausing and switching songs",
        zh: "暂停与切歌时淡入淡出",
        ja: "一時停止や曲の切り替えでフェードイン / アウト",
        ko: "일시정지·곡 전환 시 페이드 인 / 아웃",
      },
      description: {
        en: "Playback now fades smoothly instead of cutting abruptly — when you pause or resume, and across track changes. On by default; turn it off under Settings → Playback ('Fade in / out').",
        zh: "现在播放会平滑淡变，而不是硬切——暂停 / 恢复时，以及切歌时都会。默认开启；可在 设置 → 播放（「淡入 / 淡出」）里关闭。",
        ja: "再生が急に途切れず滑らかにフェードするようになりました——一時停止・再開時、そして曲の切り替え時に。デフォルトでオン。設定 → 再生（「フェードイン / アウト」）でオフにできます。",
        ko: "이제 재생이 갑자기 끊기지 않고 부드럽게 페이드됩니다——일시정지·재개할 때, 그리고 곡을 바꿀 때. 기본값은 켜짐이며, 설정 → 재생('페이드 인 / 아웃')에서 끌 수 있습니다.",
      },
    },
    {
      area: "sets",
      category: "feature",
      platform: "all",
      title: {
        en: "Filter your sets by origin: AI, made by you, or imported",
        zh: "按来源筛选歌单：AI、自己建、导入",
        ja: "セットを出所で絞り込み：AI・自作・インポート",
        ko: "세트를 출처로 필터링: AI, 직접 만듦, 가져옴",
      },
      description: {
        en: "The Sets tab now has an origin filter, so you can quickly narrow to the sets the AI DJ built, the ones you made yourself, or the ones you imported from a playlist — instead of scrolling everything together.",
        zh: "歌单标签现在带来源筛选，可以快速只看 AI DJ 建的、你自己建的、或从歌单导入的——不必把所有歌单混在一起翻。",
        ja: "セットタブに出所フィルターが付き、AI DJ が作ったセット・自分で作ったセット・プレイリストから取り込んだセットへ素早く絞り込めます——すべてを混ぜてスクロールする必要はありません。",
        ko: "세트 탭에 출처 필터가 추가되어, AI DJ가 만든 세트, 직접 만든 세트, 재생목록에서 가져온 세트로 빠르게 좁힐 수 있습니다——전부 섞어 스크롤할 필요가 없습니다.",
      },
    },
    {
      area: "dj",
      category: "improvement",
      platform: "all",
      title: {
        en: "The DJ curates with taste and reuses your sets",
        zh: "DJ 用品味来策展，并复用你的歌单",
        ja: "DJ がセンスで選曲し、既存のセットを再利用",
        ko: "DJ가 안목으로 큐레이션하고 기존 세트를 재사용합니다",
      },
      description: {
        en: "When you ask the chat DJ to build a set, it now judges each candidate with real music knowledge instead of dumping a whole search result in, and it adds to a fitting set you already have rather than creating empty duplicates. Fewer stray tracks, fewer half-empty sets.",
        zh: "当你让 chat DJ 建歌单时，它现在会用真正的音乐知识逐一判断候选歌，而不是把整页搜索结果一股脑塞进去；而且它会加进你已有的、合适的歌单，而不是新建一堆空的重复集。跑题的歌更少，半空的歌单也更少。",
        ja: "チャット DJ にセットを作らせると、検索結果を丸ごと放り込むのではなく、本物の音楽知識で候補を一曲ずつ吟味するようになりました。さらに、空の重複を作らず、すでにある合うセットに追加します。的外れな曲が減り、半分空のセットも減ります。",
        ko: "채팅 DJ에게 세트를 만들게 하면, 이제 검색 결과를 통째로 쏟아붓는 대신 진짜 음악 지식으로 후보를 하나씩 판단하고, 빈 중복 세트를 만드는 대신 이미 있는 알맞은 세트에 추가합니다. 엉뚱한 곡도, 반쯤 빈 세트도 줄었습니다.",
      },
    },
    {
      area: "dj",
      category: "improvement",
      platform: "all",
      title: {
        en: "The DJ speaks your language",
        zh: "DJ 说你的语言",
        ja: "DJ があなたの言語で話す",
        ko: "DJ가 당신의 언어로 말합니다",
      },
      description: {
        en: "The DJ's instructions and tools are now localized to your app language, and its replies come back in that language too — even when you speak to it in another. Set your language once and the DJ matches it.",
        zh: "DJ 的系统提示和工具现在会本地化成你的界面语言，它的回复也会用这门语言——即便你用另一种语言跟它说话。设一次语言，DJ 就跟着你。",
        ja: "DJ の指示とツールがアプリの言語にローカライズされ、返事もその言語で返るようになりました——別の言語で話しかけても同じです。言語を一度設定すれば、DJ はそれに合わせます。",
        ko: "DJ의 지시와 도구가 이제 앱 언어로 현지화되고, 답장도 그 언어로 돌아옵니다——다른 언어로 말을 걸어도 마찬가지입니다. 언어를 한 번 설정하면 DJ가 맞춰 줍니다.",
      },
    },
    {
      area: "dj",
      category: "improvement",
      platform: "all",
      title: {
        en: "See every step the DJ takes",
        zh: "看清 DJ 的每一步",
        ja: "DJ の一手一手が見える",
        ko: "DJ의 모든 단계를 확인하세요",
      },
      description: {
        en: "Each action the DJ runs — search, curate, switch, generate — now shows an icon, a label, and the query it used, both in the chat and mirrored to the top-left notifications, so you can follow along. The chat also sticks to the newest message and adds a jump-to-bottom button when you scroll up.",
        zh: "DJ 执行的每个动作——搜索、策展、切歌、生成——现在都会显示图标、名称和它用的查询词，既在对话里，也镜像到左上角通知，方便你跟进。对话还会自动贴住最新消息，往上滚时会出现「回到底部」按钮。",
        ja: "DJ が実行する各アクション——検索・選曲・切り替え・生成——にアイコン、ラベル、使ったクエリが表示されるようになりました。チャット内と左上の通知の両方に映るので、流れを追えます。チャットは最新のメッセージに追従し、上へスクロールすると「最下部へ」ボタンが出ます。",
        ko: "DJ가 실행하는 각 동작——검색, 큐레이션, 전환, 생성——에 이제 아이콘, 레이블, 사용한 검색어가 표시됩니다. 채팅 안과 왼쪽 상단 알림에 함께 나타나 흐름을 따라갈 수 있습니다. 채팅은 최신 메시지에 붙어 있고, 위로 스크롤하면 '맨 아래로' 버튼이 나타납니다.",
      },
    },
    {
      area: "streaming",
      category: "fix",
      platform: "desktop",
      title: {
        en: "Accurate progress for background playlist imports",
        zh: "后台歌单导入的进度更准确",
        ja: "バックグラウンドのプレイリストインポートの進捗が正確に",
        ko: "백그라운드 재생목록 가져오기 진행률이 정확해졌습니다",
      },
      description: {
        en: "After playlist writes became instant in 1.6.0, the background import notification could jump straight to done; its progress now tracks the actual fetch of each track's details, so the bar fills in accurately as a big list imports.",
        zh: "1.6.0 让歌单写入变成瞬时之后，后台导入通知可能会直接跳到「完成」；现在它的进度跟随每首歌详情的实际抓取，因此大列表导入时进度条会准确地一点点填满。",
        ja: "1.6.0 でプレイリストの書き込みが瞬時になった後、バックグラウンドのインポート通知が一気に「完了」まで飛ぶことがありました。進捗が各曲の詳細の実際の取得に追従するようになり、大きなリストのインポート中もバーが正確に伸びます。",
        ko: "1.6.0에서 재생목록 쓰기가 즉시 처리되면서 백그라운드 가져오기 알림이 곧바로 '완료'로 건너뛸 수 있었습니다. 이제 진행률이 각 곡 상세 정보의 실제 가져오기를 따라가므로, 큰 목록을 가져오는 동안 막대가 정확하게 채워집니다.",
      },
    },
  ],
};

export default release;
