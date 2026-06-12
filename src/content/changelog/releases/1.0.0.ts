import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.0.0",
  date: "2026-06-12",
  title: {
    en: "Faster imports and a cleaner desktop shell",
    zh: "更快的导入，更清爽的桌面壳",
    ja: "高速なインポートと整ったデスクトップシェル",
    ko: "더 빠른 가져오기와 깔끔한 데스크톱 셸",
  },
  summary: {
    en: "Large imports now become playable while they are still running, Windows gets native-feeling frameless controls, and player identity updates stay in sync.",
    zh: "大批量导入现在会边导入边变得可播放，Windows 获得更像原生应用的无边框窗口控件，播放器曲目信息也会稳定跟随当前播放项。",
    ja: "大量インポートは処理中でも再生できるようになり、Windows にはネイティブ感のあるフレームレス操作を追加。プレイヤーの曲情報も現在の再生位置に確実に追従します。",
    ko: "대량 가져오기는 진행 중에도 바로 재생할 수 있고, Windows에는 네이티브처럼 느껴지는 프레임리스 창 컨트롤이 추가되었으며, 플레이어의 곡 정보도 현재 재생 항목과 안정적으로 동기화됩니다.",
  },
  items: [
    {
      area: "library",
      category: "highlight",
      platform: "all",
      title: {
        en: "Progressive bulk imports",
        zh: "批量导入渐进可见",
        ja: "段階的に表示される一括インポート",
        ko: "점진적으로 보이는 대량 가져오기",
      },
      description: {
        en: "Large uploads and folder syncs publish tracks in chunks, so the first songs appear and can play before the whole import finishes, without reversing file order.",
        zh: "大型上传和文件夹同步会分批发布曲目，前面的歌曲无需等全部完成就能出现在列表里并开始播放，同时保持文件顺序不反转。",
        ja: "大きなアップロードやフォルダ同期は曲を小分けに公開するため、全体の完了を待たずに先頭の曲が表示され再生できます。ファイル順も逆転しません。",
        ko: "큰 업로드와 폴더 동기화가 곡을 묶음 단위로 공개하므로, 전체 가져오기가 끝나기 전에도 앞쪽 곡이 나타나고 재생됩니다. 파일 순서도 뒤집히지 않습니다.",
      },
    },
    {
      area: "app",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Frameless Windows desktop chrome",
        zh: "Windows 无边框桌面窗口",
        ja: "Windows のフレームレスデスクトップ表示",
        ko: "Windows 프레임리스 데스크톱 창",
      },
      description: {
        en: "Electron on Windows now uses a rounded transparent shell with custom minimize, maximize, restore, and close controls.",
        zh: "Windows 上的 Electron 现在使用圆角透明窗口，并提供自定义的最小化、最大化、还原和关闭控件。",
        ja: "Windows 版 Electron は角丸の透過シェルを使い、最小化、最大化、復元、閉じる操作をカスタムコントロールで扱えます。",
        ko: "Windows의 Electron 앱은 둥근 투명 셸을 사용하며, 최소화, 최대화, 복원, 닫기 컨트롤을 직접 제공합니다.",
      },
    },
    {
      area: "visualizer",
      category: "improvement",
      platform: "all",
      title: {
        en: "Cleaner visualizer tuning",
        zh: "更统一的可视化调节",
        ja: "より整ったビジュアライザー調整",
        ko: "더 깔끔한 비주얼라이저 조정",
      },
      description: {
        en: "The FFT size control now uses the shared select component, matching the rest of the settings UI.",
        zh: "FFT size 控件改用共享 Select 组件，和其余设置界面的交互与样式保持一致。",
        ja: "FFT size の操作は共通 Select コンポーネントに移り、設定画面全体と同じ操作感と見た目になりました。",
        ko: "FFT size 조절이 공통 Select 컴포넌트를 사용해, 나머지 설정 UI와 같은 조작감과 모양을 갖추었습니다.",
      },
    },
    {
      area: "player",
      category: "fix",
      platform: "all",
      title: {
        en: "Current track identity stays current",
        zh: "当前曲目信息稳定刷新",
        ja: "現在の曲情報が正しく更新",
        ko: "현재 곡 정보가 정확히 갱신",
      },
      description: {
        en: "The dock title and artist line now update immediately when the queue cursor changes, and long stage titles fit without forced scrolling.",
        zh: "队列游标切换时，底栏标题与艺人行会立刻更新；舞台上的长标题也能更自然地适配，不再强制滚动。",
        ja: "キューのカーソルが変わると、ドックのタイトルとアーティスト行がすぐ更新されます。ステージ上の長いタイトルも強制スクロールなしで収まりやすくなりました。",
        ko: "큐 커서가 바뀌면 도크 제목과 아티스트 줄이 즉시 갱신됩니다. 스테이지의 긴 제목도 강제 스크롤 없이 더 자연스럽게 맞춰집니다.",
      },
    },
    {
      area: "app",
      category: "fix",
      platform: "desktop",
      title: {
        en: "Safer desktop updater startup",
        zh: "更安全的桌面更新器启动",
        ja: "より安全なデスクトップ更新の起動",
        ko: "더 안전한 데스크톱 업데이트 시작",
      },
      description: {
        en: "The Electron updater only loads when a packaged semver build can apply updates, avoiding noisy checks in development or invalid-version builds.",
        zh: "Electron 更新器只会在可应用更新的打包 semver 版本中加载，避免开发环境或无效版本构建产生多余检查。",
        ja: "Electron の更新機能は、更新を適用できるパッケージ済み semver ビルドでのみ読み込まれます。開発中や無効なバージョンのビルドで不要なチェックが走りません。",
        ko: "Electron 업데이트는 업데이트를 적용할 수 있는 패키징된 semver 빌드에서만 로드되어, 개발 환경이나 잘못된 버전 빌드의 불필요한 확인을 피합니다.",
      },
    },
  ],
};

export default release;
