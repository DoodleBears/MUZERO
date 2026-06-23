import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.4.2",
  date: "2026-06-23",
  title: {
    en: "Cooler playback for big local libraries",
    zh: "大本地库播放更轻、更稳",
    ja: "大きなローカルライブラリでも軽い再生",
    ko: "큰 로컬 라이브러리에서도 더 가벼운 재생",
  },
  summary: {
    en: "A performance and release-polish update for desktop listening. MUZERO now treats lazy .ncm metadata work as a gentle background trickle instead of a disk storm, backs it off further while music is playing, and remembers files that cannot be decoded so they are not re-read on every launch. Video playback is lighter too: the cover stays in the foreground, live video moves to the immersive background, cover mode stops decoding the hidden video stream, and occluded Pixi layers are skipped. Desktop auto-updates now appear in the same notification stack as downloads, with progress and a restart action, and release feeds point at the correct versioned installer paths.",
    zh: "一次面向桌面播放的性能与发布打磨更新。MUZERO 现在会把 .ncm 元数据懒加载当作温和的后台涓流，而不是启动时的磁盘风暴；播放中还会进一步退让，并记住无法解码的文件，避免每次启动都重新读取。视频播放也更轻：封面固定在前台，实时视频移到沉浸背景；封面模式会停止解码隐藏的视频流，被视频完全遮住的 Pixi 层也会跳过。桌面自动更新现在接入与下载相同的通知栈，带进度和「重启更新」操作；发布 feed 也会指向正确的版本化安装包路径。",
    ja: "デスクトップ再生に向けたパフォーマンスとリリースまわりの調整です。MUZERO は .ncm メタデータの遅延処理を、起動時のディスクストームではなく穏やかなバックグラウンド処理として進めるようになりました。再生中はさらに控えめに動き、デコードできないファイルは記録して毎回読み直しません。動画再生も軽くなりました。カバーは前面に残り、ライブ動画は没入背景へ移動。カバーモードでは隠れた動画ストリームをデコードせず、動画に完全に隠れる Pixi レイヤーもスキップします。デスクトップ自動更新はダウンロードと同じ通知スタックに表示され、進捗と再起動アクションが付きます。リリース feed も正しいバージョン別インストーラーパスを指すようになりました。",
    ko: "데스크톱 감상을 위한 성능 및 릴리스 다듬기 업데이트입니다. MUZERO는 이제 .ncm 메타데이터 지연 작업을 시작 시 디스크 폭주가 아니라 부드러운 백그라운드 흐름으로 처리합니다. 음악 재생 중에는 더 물러나고, 디코드할 수 없는 파일은 기록해 매번 실행할 때 다시 읽지 않습니다. 영상 재생도 더 가벼워졌습니다. 커버는 전경에 유지되고 라이브 영상은 몰입형 배경으로 이동하며, 커버 모드에서는 숨겨진 영상 스트림 디코드를 멈추고 영상에 완전히 가려진 Pixi 레이어도 건너뜁니다. 데스크톱 자동 업데이트는 다운로드와 같은 알림 스택에 진행률과 재시작 동작으로 표시되고, 릴리스 feed도 올바른 버전별 설치 파일 경로를 가리킵니다.",
  },
  items: [
    {
      area: "player",
      category: "highlight",
      platform: "desktop",
      title: {
        en: "Playback no longer fights background .ncm scanning",
        zh: "播放不再和后台 .ncm 扫描抢磁盘",
        ja: "再生がバックグラウンド .ncm スキャンと競合しない",
        ko: "재생이 백그라운드 .ncm 스캔과 더 이상 충돌하지 않음",
      },
      description: {
        en: "Large libraries with many referenced NetEase .ncm files no longer hammer the disk at launch or while a song is playing. Metadata hydration is paced, slowed further during playback, and failed decodes are marked durably so the same unreadable file is not re-opened on every start.",
        zh: "拥有大量引用式网易 .ncm 文件的资料库，启动或播放时不再把磁盘打满。元数据补全现在会限速执行，播放中进一步放慢；解码失败的文件会被持久标记，避免下次启动继续反复打开同一个不可读文件。",
        ja: "参照型の NetEase .ncm ファイルが多い大きなライブラリでも、起動時や再生中にディスクを叩き続けなくなりました。メタデータ補完はペース制御され、再生中はさらに遅くなり、デコード失敗は永続的に記録されるため同じ読めないファイルを毎回開き直しません。",
        ko: "참조 방식의 NetEase .ncm 파일이 많은 큰 라이브러리에서도 실행 시나 재생 중에 디스크를 몰아치지 않습니다. 메타데이터 보강은 속도를 조절하고, 재생 중에는 더 느리게 진행하며, 디코드 실패는 지속적으로 표시해 같은 읽을 수 없는 파일을 매번 다시 열지 않습니다.",
      },
    },
    {
      area: "app",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Desktop updates join the notification stack",
        zh: "桌面更新接入统一通知栈",
        ja: "デスクトップ更新が通知スタックに統合",
        ko: "데스크톱 업데이트가 알림 스택에 통합",
      },
      description: {
        en: "When an auto-update is found or downloading, MUZERO now shows it beside download and playback activity with a real progress bar. Once the installer is ready, the notification stays visible and offers a restart-to-update action.",
        zh: "自动更新发现新版本或正在下载时，现在会和下载、播放加载一起显示在同一个通知栈里，并带真实进度条。安装包准备好后，通知会常驻并提供「重启以更新」操作。",
        ja: "自動更新が見つかったりダウンロード中になったりすると、ダウンロードや再生読み込みと同じ通知スタックに実進捗バー付きで表示されます。インストーラーの準備ができると通知は残り、再起動して更新するアクションを出します。",
        ko: "자동 업데이트가 발견되거나 다운로드 중이면 다운로드 및 재생 로딩과 같은 알림 스택에 실제 진행 막대와 함께 표시됩니다. 설치 파일이 준비되면 알림이 유지되고 재시작하여 업데이트하는 동작을 제공합니다.",
      },
    },
    {
      area: "player",
      category: "improvement",
      platform: "all",
      title: {
        en: "Video tracks use one live video path",
        zh: "视频曲目只保留一条实时视频路径",
        ja: "動画トラックのライブ動画経路を 1 本に",
        ko: "영상 트랙의 라이브 영상 경로를 하나로",
      },
      description: {
        en: "Now Playing keeps the cover card in the foreground and moves the live video into the immersive background. The Pixi cover-effect background no longer samples the full video as a texture, and fully covered background layers are skipped, cutting duplicate video work without changing the look.",
        zh: "Now Playing 现在让封面卡片固定在前台，把实时视频放进沉浸背景。Pixi 封面特效背景不再把完整视频当纹理采样，被视频完全遮住的背景层也会跳过，在不改变观感的前提下砍掉重复视频工作。",
        ja: "Now Playing はカバーカードを前面に保ち、ライブ動画を没入背景へ移しました。Pixi のカバーエフェクト背景はフル動画をテクスチャとしてサンプリングしなくなり、動画に完全に覆われる背景レイヤーもスキップします。見た目を変えずに重複した動画処理を減らしました。",
        ko: "Now Playing은 커버 카드를 전경에 유지하고 라이브 영상을 몰입형 배경으로 옮겼습니다. Pixi 커버 효과 배경은 더 이상 전체 영상을 텍스처로 샘플링하지 않으며, 영상에 완전히 가려지는 배경 레이어도 건너뜁니다. 모습은 유지하면서 중복 영상 작업을 줄였습니다.",
      },
    },
    {
      area: "player",
      category: "improvement",
      platform: "all",
      title: {
        en: "Cover mode stops hidden video decoding",
        zh: "封面模式停止隐藏视频解码",
        ja: "カバーモードでは隠れた動画をデコードしない",
        ko: "커버 모드에서 숨겨진 영상 디코드 중지",
      },
      description: {
        en: "A video track shown as a cover now plays audio through the audio driver while the muted visual video element is detached. That frees decode surfaces and VRAM immediately, then resumes the visual layer when you switch back to video mode.",
        zh: "视频曲目以封面模式显示时，现在由音频驱动继续出声，同时卸载静音的视频画面元素。这样会立即释放解码表面和显存；切回视频模式时再恢复画面层。",
        ja: "動画トラックをカバーとして表示している間は、音声ドライバーで音だけを再生し、ミュートされた動画表示要素は切り離します。これによりデコード面と VRAM をすぐ解放し、動画モードに戻したときだけ表示レイヤーを復帰させます。",
        ko: "영상 트랙을 커버로 표시할 때는 오디오 드라이버로 소리만 재생하고, 음소거된 영상 표시 요소는 분리합니다. 디코드 표면과 VRAM을 즉시 해제하고, 영상 모드로 돌아갈 때 시각 레이어를 다시 연결합니다.",
      },
    },
    {
      area: "visualizer",
      category: "improvement",
      platform: "all",
      title: {
        en: "Sharper ambient cover backgrounds",
        zh: "更锐利的氛围封面背景",
        ja: "よりシャープなアンビエントカバー背景",
        ko: "더 선명한 앰비언트 커버 배경",
      },
      description: {
        en: "The ambient Pixi background now uses the original cover image instead of a small downscaled derivative, so pixel, noise, CRT, and related cover effects stay sharper and avoid an extra thumbnail-generation pass.",
        zh: "氛围 Pixi 背景现在使用原始封面图，而不是较小的降采样派生图；pixel、noise、CRT 等封面特效会更清晰，也省掉一次额外的缩略图生成。",
        ja: "アンビエント Pixi 背景は、小さく縮小した派生画像ではなく元のカバー画像を使うようになりました。pixel / noise / CRT などのカバーエフェクトがよりシャープになり、追加のサムネイル生成も避けられます。",
        ko: "앰비언트 Pixi 배경은 이제 작은 다운스케일 파생 이미지 대신 원본 커버 이미지를 사용합니다. pixel, noise, CRT 같은 커버 효과가 더 선명해지고 추가 썸네일 생성도 피합니다.",
      },
    },
    {
      area: "app",
      category: "fix",
      platform: "desktop",
      title: {
        en: "Updater feeds point at the right installers",
        zh: "更新 feed 指向正确安装包",
        ja: "更新 feed が正しいインストーラーを指す",
        ko: "업데이트 feed가 올바른 설치 파일을 가리킴",
      },
      description: {
        en: "Release publishing now rewrites electron-builder update feeds so their file references include the version folder. Auto-update downloads no longer 404 after a correctly published release.",
        zh: "发布脚本现在会重写 electron-builder 的更新 feed，让文件引用带上版本目录。正确发布后，自动更新下载不再因为路径缺少版本号而 404。",
        ja: "リリース公開時に electron-builder の更新 feed を書き換え、ファイル参照にバージョンフォルダーを含めるようにしました。正しく公開されたリリースで、自動更新のダウンロードが 404 になる問題を解消しました。",
        ko: "릴리스 게시 시 electron-builder 업데이트 feed를 다시 작성해 파일 참조에 버전 폴더를 포함합니다. 정상적으로 게시된 릴리스에서 자동 업데이트 다운로드가 404로 실패하지 않습니다.",
      },
    },
  ],
};

export default release;
