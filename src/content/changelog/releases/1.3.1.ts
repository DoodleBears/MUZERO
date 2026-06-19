import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.3.1",
  date: "2026-06-20",
  title: {
    en: "Background update checks now show up on their own",
    zh: "后台更新检查现在会自动显示",
    ja: "バックグラウンドの更新チェックが自動で表示されるように",
    ko: "백그라운드 업데이트 확인이 이제 자동으로 표시",
  },
  summary: {
    en: "The desktop app already checked for updates on its own shortly after launch, but the About screen only reflected an update after you pressed Check for updates — so the automatic check looked like it wasn't working. About now reads the latest known status when it opens, so a background check or download shows up without a manual nudge.",
    zh: "桌面端在启动后其实早就会自动检查更新，但「关于」页面只有在你点击「检查更新」后才会显示结果——于是自动检查看起来像没生效。现在「关于」页面打开时会读取最新的已知状态，后台的检查或下载无需手动点击即可显示。",
    ja: "デスクトップ版は起動直後に自動で更新を確認していましたが、「バージョン情報」画面は「更新を確認」を押すまで結果を反映しなかったため、自動チェックが効いていないように見えていました。これからは画面を開いたときに最新の既知ステータスを読み込むので、バックグラウンドの確認やダウンロードが手動操作なしで表示されます。",
    ko: "데스크톱 앱은 실행 직후 이미 자동으로 업데이트를 확인하고 있었지만, 정보 화면은 업데이트 확인을 누른 뒤에야 결과를 반영해 자동 확인이 작동하지 않는 것처럼 보였습니다. 이제 정보 화면을 열 때 최신 상태를 읽어오므로, 백그라운드 확인이나 다운로드가 수동 조작 없이 표시됩니다.",
  },
  items: [
    {
      area: "app",
      category: "fix",
      platform: "desktop",
      title: {
        en: "Automatic update checks surface without a manual click",
        zh: "自动更新检查无需手动点击即可显示",
        ja: "自動更新チェックが手動クリックなしで表示",
        ko: "자동 업데이트 확인이 수동 클릭 없이 표시",
      },
      description: {
        en: "The startup auto-check runs a few seconds after launch, before the About screen is usually open, so its result used to be missed and About opened looking up to date until you pressed Check for updates. About now seeds from the last known update status when it mounts, so a found, downloading, or ready-to-install update appears on its own.",
        zh: "启动自动检查会在启动几秒后运行，而那时「关于」页面通常还没打开，因此结果会被错过，页面打开时显示为已是最新，直到你点击「检查更新」。现在「关于」页面在挂载时会读取最近一次的更新状态，于是「发现更新 / 正在下载 / 可安装」会自行显示。",
        ja: "起動時の自動チェックは起動から数秒後、まだ「バージョン情報」画面が開いていないことが多いタイミングで実行されるため、結果が見逃され、「更新を確認」を押すまで最新と表示されていました。これからは画面表示時に直近の更新ステータスを読み込むので、「更新あり／ダウンロード中／インストール可能」が自動的に表示されます。",
        ko: "시작 시 자동 확인은 실행 몇 초 뒤, 보통 정보 화면이 아직 열리지 않은 시점에 실행되어 결과가 누락되었고 업데이트 확인을 누를 때까지 최신으로 표시되었습니다. 이제 정보 화면이 마운트될 때 마지막 업데이트 상태를 읽어와 발견·다운로드 중·설치 준비 완료가 스스로 표시됩니다.",
      },
    },
  ],
};

export default release;
