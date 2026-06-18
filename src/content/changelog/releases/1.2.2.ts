import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.2.2",
  date: "2026-06-18",
  title: {
    en: "Jump back to source, clearer imports, and smarter video covers",
    zh: "跳回来源、更清晰的导入与更聪明的视频封面",
    ja: "ソースへ戻る導線、わかりやすい取り込み、賢い動画カバー",
    ko: "원본 위치로 돌아가기, 더 선명한 가져오기, 더 똑똑한 비디오 커버",
  },
  summary: {
    en: "Now Playing can take you straight back to the song's source list, complete with a smooth cover-to-row transition and a current-track marker. Dropped media now asks which set to join, desktop imports can reference files in place with visible progress and recovery tools, and uploaded videos get automatic poster covers. Video tracks also gained separate background, visualizer, flow, dim, and immersive controls. Online tracks are downloaded before playback so seeking works, and volume shortcuts behave cleanly.",
    zh: "正在播放现在可以把你直接带回歌曲所在的来源列表，并带有顺滑的封面到列表行过渡和当前曲目标记。拖放媒体时会询问要加入哪个歌单；桌面导入可原地引用文件，并显示进度与恢复工具；上传视频会自动生成封面。视频 track 也新增了独立的背景、可视化、流光、压暗与沉浸式控制。在线歌曲会先下载再播放，因此拖动进度条可正常生效，音量快捷键也更干净。",
    ja: "再生中の曲から、その曲があるソース一覧へ直接戻れるようになりました。カバーから行への滑らかな遷移と現在曲マーカーも付きます。ドロップしたメディアは追加先セットを選べるようになり、デスクトップ取り込みはファイルをその場で参照しつつ進捗と復旧ツールを表示できます。アップロード動画には自動でポスターカバーが付きます。動画トラックには、背景、ビジュアライザー、フロー、暗さ、没入時の個別コントロールも追加されました。オンライン曲は再生前にダウンロードされるためシークが効き、音量ショートカットもすっきり動作します。",
    ko: "Now Playing에서 곡이 있는 원본 목록으로 바로 돌아갈 수 있으며, 커버에서 행으로 이어지는 부드러운 전환과 현재 곡 표시가 함께 제공됩니다. 드롭한 미디어는 추가할 세트를 묻고, 데스크톱 가져오기는 파일을 제자리 참조하면서 진행률과 복구 도구를 보여줍니다. 업로드한 비디오는 자동 포스터 커버를 얻습니다. 동영상 트랙에는 배경, 비주얼라이저, 플로우, 어둡게, 몰입 상태를 따로 제어하는 설정도 추가되었습니다. 온라인 트랙은 재생 전에 다운로드되어 탐색이 동작하고, 볼륨 단축키도 깔끔해졌습니다.",
  },
  items: [
    {
      area: "player",
      category: "highlight",
      platform: "all",
      title: {
        en: "Jump from Now Playing back to the source list",
        zh: "从正在播放跳回来源列表",
        ja: "再生中からソース一覧へ戻る",
        ko: "Now Playing에서 원본 목록으로 이동",
      },
      description: {
        en: "Use the title row, context menu, or cover swipe to return to the exact library or search list that started the current track. MUZERO scrolls to the right row, marks the current song, and morphs the cover into place so the jump feels connected instead of disorienting.",
        zh: "可通过标题行、右键菜单或封面滑动回到开启当前歌曲的曲库 / 搜索列表。MUZERO 会滚到对应行、标记当前歌曲，并把封面顺滑过渡到列表位置，让跳转有连续感而不是突然迷路。",
        ja: "タイトル行、コンテキストメニュー、カバースワイプから、現在の曲を開始したライブラリ／検索リストの正確な場所へ戻れます。MUZERO は該当行へスクロールし、現在曲を示し、カバーをその位置へモーフさせるので、迷子にならずつながった移動になります。",
        ko: "제목 행, 컨텍스트 메뉴, 커버 스와이프로 현재 트랙을 시작한 라이브러리나 검색 목록의 정확한 위치로 돌아갈 수 있습니다. MUZERO는 해당 행으로 스크롤하고 현재 곡을 표시하며 커버를 그 자리로 자연스럽게 전환해 이동이 끊기지 않게 느껴집니다.",
      },
    },
    {
      area: "sets",
      category: "feature",
      platform: "all",
      title: {
        en: "Dropped media asks which set to join",
        zh: "拖放媒体时选择加入哪个歌单",
        ja: "ドロップしたメディアの追加先セットを選択",
        ko: "드롭한 미디어가 들어갈 세트 선택",
      },
      description: {
        en: "Dropping or pasting audio and video outside a set now opens the set picker instead of silently choosing for you. The currently playing set is shown first with a current badge, so mixing new songs and videos into the set you are hearing takes one deliberate click.",
        zh: "在歌单外拖放或粘贴音频 / 视频时，现在会打开歌单选择器，不再静默替你选目标。当前正在播放的歌单会带“当前”标记排在最前，让你只需明确点一下就能把新歌或视频混入正在听的歌单。",
        ja: "セット外で音声や動画をドロップ／貼り付けすると、勝手に追加先を決めずセットピッカーを開くようになりました。再生中のセットは「現在」バッジ付きで先頭に出るため、聴いているセットへ新しい曲や動画を混ぜる操作が明確な 1 クリックになります。",
        ko: "세트 밖에서 오디오나 비디오를 드롭하거나 붙여 넣으면 이제 자동으로 대상을 고르지 않고 세트 선택기가 열립니다. 현재 재생 중인 세트가 현재 배지와 함께 맨 위에 표시되어, 듣고 있는 세트에 새 곡이나 비디오를 명확한 한 번의 클릭으로 섞을 수 있습니다.",
      },
    },
    {
      area: "library",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Reference desktop files in place, with progress and recovery",
        zh: "桌面端原地引用文件，并提供进度与恢复",
        ja: "デスクトップのファイルをその場で参照し、進捗と復旧も表示",
        ko: "데스크톱 파일 제자리 참조, 진행률과 복구 제공",
      },
      description: {
        en: "Desktop drag-and-drop can now keep media referenced from its original disk path instead of copying bytes into IndexedDB. Imports show real byte-level progress when copying is needed, and Settings / track inspection expose recovery actions for referenced media that moved or went missing.",
        zh: "桌面端拖放现在可从原始磁盘路径引用媒体，不必总把字节复制进 IndexedDB。必须复制时会显示真实字节级进度；当引用媒体被移动或丢失时，Settings 与曲目检查面板会提供恢复操作。",
        ja: "デスクトップのドラッグ＆ドロップは、常に IndexedDB へコピーするのではなく、元のディスクパスを参照できるようになりました。コピーが必要な場合は実際のバイト単位の進捗を表示し、参照メディアが移動・消失した場合は Settings とトラック検査パネルから復旧できます。",
        ko: "데스크톱 드래그 앤 드롭은 이제 항상 IndexedDB로 복사하지 않고 원래 디스크 경로를 참조할 수 있습니다. 복사가 필요할 때는 실제 바이트 단위 진행률을 보여주며, 참조 미디어가 이동되거나 사라진 경우 Settings와 트랙 검사 패널에서 복구 작업을 제공합니다.",
      },
    },
    {
      area: "library",
      category: "feature",
      platform: "all",
      title: {
        en: "Uploaded videos get automatic poster covers",
        zh: "上传视频自动获得封面",
        ja: "アップロード動画に自動ポスターカバー",
        ko: "업로드한 비디오에 자동 포스터 커버",
      },
      description: {
        en: "MUZERO now samples uploaded videos and scores candidate frames for a useful cover instead of leaving the track title as the fallback. Native browser capture handles common files, with a Mediabunny fallback for formats that need deeper probing.",
        zh: "MUZERO 现在会采样上传视频并为候选帧打分，选出更可用的封面，而不是只回退到曲目标题。常见文件走浏览器原生捕获，遇到需要更深解析的格式则回退到 Mediabunny。",
        ja: "MUZERO はアップロード動画をサンプリングし、候補フレームを採点して実用的なカバーを選ぶようになりました。タイトルだけのフォールバックに頼りません。一般的なファイルはブラウザのネイティブ取得で処理し、より深い解析が必要な形式は Mediabunny にフォールバックします。",
        ko: "MUZERO는 업로드한 비디오를 샘플링하고 후보 프레임을 점수화해 제목만 보여주는 대신 유용한 커버를 고릅니다. 일반 파일은 브라우저 네이티브 캡처로 처리하고, 더 깊은 분석이 필요한 형식은 Mediabunny로 대체합니다.",
      },
    },
    {
      area: "visualizer",
      category: "improvement",
      platform: "all",
      title: {
        en: "Video tracks get their own visual layers",
        zh: "视频 track 有了独立视觉层设置",
        ja: "動画トラック専用のビジュアルレイヤー設定",
        ko: "동영상 트랙 전용 시각 레이어 설정",
      },
      description: {
        en: "Settings and the Now Playing effect panel now include video-specific controls for the background effect, visualizer, flow layer, dim amount, and dim-layer blur. Normal video playback keeps the rich layers on by default, while immersive video defaults to a cleaner view that you can opt back into.",
        zh: "Settings 与正在播放的效果悬浮面板现在都有视频专属控制：背景特效、可视化、流光层、压暗强度与压暗层模糊。普通视频播放默认保留丰富层级；进入沉浸式后默认更干净，也可以手动重新打开。",
        ja: "Settings と再生中のエフェクトパネルに、動画専用の背景エフェクト、ビジュアライザー、フローレイヤー、暗さ、暗化レイヤーぼかしの設定が入りました。通常の動画再生ではリッチなレイヤーを既定で残し、没入中の動画はよりクリーンな表示を既定にしつつ、必要なら再度オンにできます。",
        ko: "Settings와 Now Playing 효과 패널에 동영상 전용 배경 효과, 비주얼라이저, 플로우 레이어, 어둡게 강도, 어둡게 레이어 블러 설정이 추가되었습니다. 일반 동영상 재생은 풍부한 레이어를 기본으로 유지하고, 몰입 중 동영상은 더 깔끔한 화면을 기본으로 하되 필요하면 다시 켤 수 있습니다.",
      },
    },
    {
      area: "streaming",
      category: "fix",
      platform: "desktop",
      title: {
        en: "Online tracks can seek from the first play",
        zh: "在线歌曲首次播放即可拖动进度",
        ja: "オンライン曲を初回再生からシーク可能に",
        ko: "온라인 트랙을 첫 재생부터 탐색 가능",
      },
      description: {
        en: "QQ Music and other proxied online sources are downloaded to a local blob before playback when needed, so the scrubber, Dock drag, and lyric clicks can seek reliably. If the download fails, MUZERO falls back to streaming so the song still starts.",
        zh: "QQ 音乐等经代理播放的在线来源现在会在需要时先下载为本地 blob 再播放，因此进度条、Dock 拖动和歌词点击都能可靠跳转。若下载失败，MUZERO 会回退到直接串流，保证歌曲仍可开始播放。",
        ja: "QQ Music などプロキシ経由のオンラインソースは、必要に応じて再生前にローカル blob へダウンロードされます。これによりスクラバー、Dock のドラッグ、歌詞クリックで確実にシークできます。ダウンロードに失敗した場合はストリーミングへ戻るため、曲の再生は始められます。",
        ko: "QQ Music 등 프록시를 거치는 온라인 소스는 필요할 때 재생 전에 로컬 blob으로 다운로드됩니다. 그래서 스크러버, Dock 드래그, 가사 클릭 탐색이 안정적으로 동작합니다. 다운로드가 실패하면 MUZERO는 스트리밍으로 돌아가 곡이 계속 시작되도록 합니다.",
      },
    },
    {
      area: "player",
      category: "fix",
      platform: "all",
      title: {
        en: "Video effects recover when leaving immersive mode",
        zh: "退出沉浸式后视频效果会恢复",
        ja: "没入モード解除後に動画エフェクトが復帰",
        ko: "몰입 모드를 벗어나면 동영상 효과 복구",
      },
      description: {
        en: "Video background effects no longer stay in their immersive profile just because the desktop Dock is still waiting for the bottom hot zone. Moving the pointer or interacting with Now Playing exits the immersive effect state immediately, so visualizer, flow, background effects, and video dim settings return reliably.",
        zh: "桌面 Dock 仍在等待底部热区时，视频背景效果不再误以为还处于沉浸式配置。移动鼠标或与正在播放交互后，会立即退出沉浸式效果状态，因此可视化、流光、背景特效与视频压暗设置都会可靠恢复。",
        ja: "デスクトップ Dock が下端ホットゾーン待ちのままでも、動画背景エフェクトが没入プロファイルに残り続けることはなくなりました。ポインター移動や再生中画面の操作で没入エフェクト状態をすぐ抜けるため、ビジュアライザー、フロー、背景エフェクト、動画の暗さ設定が確実に戻ります。",
        ko: "데스크톱 Dock이 아직 하단 핫존을 기다리는 상태여도 동영상 배경 효과가 몰입 프로필에 남아 있지 않습니다. 포인터를 움직이거나 Now Playing과 상호작용하면 몰입 효과 상태를 즉시 빠져나와 비주얼라이저, 플로우, 배경 효과, 동영상 어둡게 설정이 안정적으로 복구됩니다.",
      },
    },
    {
      area: "library",
      category: "fix",
      platform: "desktop",
      title: {
        en: "Referenced-media checks are lighter and clearer",
        zh: "引用媒体检查更轻、更清晰",
        ja: "参照メディアのチェックを軽く明確に",
        ko: "참조 미디어 검사가 더 가볍고 명확하게",
      },
      description: {
        en: "Storage health checks now use provider file stats when available instead of reading the whole media file. Missing referenced files are reported as recoverable missing media instead of failing the scan, making Settings recovery tools more dependable for large desktop libraries.",
        zh: "存储健康检查现在会优先使用 provider 的文件 stat，不再为了校验把整个媒体文件读出来。引用文件丢失时会被报告为可恢复的缺失媒体，而不是让扫描失败，让大型桌面曲库的 Settings 恢复工具更可靠。",
        ja: "ストレージのヘルスチェックは、可能な場合にメディア全体を読む代わりに provider のファイル stat を使うようになりました。参照ファイルが見つからない場合もスキャン失敗ではなく復旧可能な欠落メディアとして報告され、大きなデスクトップライブラリでも Settings の復旧ツールがより安定します。",
        ko: "스토리지 상태 검사는 가능할 때 전체 미디어 파일을 읽지 않고 provider 파일 stat을 사용합니다. 참조 파일이 사라진 경우에도 스캔 실패 대신 복구 가능한 누락 미디어로 보고되어, 큰 데스크톱 라이브러리에서 Settings 복구 도구가 더 안정적으로 동작합니다.",
      },
    },
    {
      area: "player",
      category: "fix",
      platform: "all",
      title: {
        en: "Cleaner volume shortcuts and mute toggle",
        zh: "更干净的音量快捷键与静音切换",
        ja: "音量ショートカットとミュート切り替えを整理",
        ko: "더 깔끔한 볼륨 단축키와 음소거 토글",
      },
      description: {
        en: "On Now Playing, up and down arrows are reserved for volume instead of being swallowed by progress sliders. The volume button also remembers your last audible level, so unmuting restores where you were instead of jumping back to the default.",
        zh: "在正在播放页，上 / 下方向键会保留给音量控制，不再被进度条滑块吞掉。音量按钮也会记住上一次非静音音量，因此取消静音会回到原来的位置，而不是跳回默认值。",
        ja: "再生中画面では、上下矢印が進捗スライダーに奪われず音量用に確保されます。音量ボタンは最後の聞こえる音量も記憶するため、ミュート解除時に既定値へ飛ばず元の音量へ戻ります。",
        ko: "Now Playing에서 위/아래 화살표는 진행 슬라이더에 가로채이지 않고 볼륨에 예약됩니다. 볼륨 버튼도 마지막으로 들리던 음량을 기억해, 음소거 해제 시 기본값으로 튀지 않고 이전 위치로 돌아갑니다.",
      },
    },
  ],
};

export default release;
