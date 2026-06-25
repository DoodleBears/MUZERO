import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.5.2",
  date: "2026-06-26",
  title: {
    en: "Background effects now apply to your videos",
    zh: "背景特效现在也作用于视频",
    ja: "背景エフェクトが動画にも反映",
    ko: "배경 효과가 이제 영상에도 적용",
  },
  summary: {
    en: "When a video plays as your Now Playing background, the selected background effect — pixel, CRT, dot, ASCII, cross-hatch, noise, or blur — now renders over the moving picture, not just cover art. It samples the video you're already watching (no extra decode), so there's no added battery or memory cost. Keep a clean video backdrop with the existing 'Show background effects on video tracks' toggle.",
    zh: "当视频作为「正在播放」背景时，你选择的背景特效——像素、CRT、网点、ASCII、交叉线、噪点或模糊——现在会渲染在动态画面上，而不只是封面。它直接采样你正在观看的视频（不额外解码），所以不增加耗电和内存。想要干净的视频背景，仍可用现有的「视频 track 显示背景特效」开关关闭。",
    ja: "動画が「再生中」の背景になっているとき、選んだ背景エフェクト（ピクセル・CRT・ドット・ASCII・クロスハッチ・ノイズ・ぼかし）が、ジャケットだけでなく動いている映像にも描画されるようになりました。再生中の動画をそのままサンプリングするため（追加デコードなし）、電力やメモリの負担は増えません。きれいな動画背景にしたいときは、既存の「動画トラックに背景エフェクトを表示」トグルでオフにできます。",
    ko: "영상이 '재생 중' 배경으로 나올 때, 선택한 배경 효과(픽셀·CRT·도트·ASCII·크로스해치·노이즈·블러)가 커버 아트뿐 아니라 움직이는 영상에도 적용됩니다. 이미 재생 중인 영상을 그대로 샘플링하므로(추가 디코딩 없음) 배터리·메모리 부담이 늘지 않습니다. 깔끔한 영상 배경을 원하면 기존 '영상 트랙에 배경 효과 표시' 토글로 끌 수 있습니다.",
  },
  items: [
    {
      area: "player",
      category: "highlight",
      platform: "all",
      title: {
        en: "Background effects apply to live video",
        zh: "背景特效作用于动态视频",
        ja: "背景エフェクトが動画に反映",
        ko: "배경 효과가 영상에 적용",
      },
      description: {
        en: "Previously the moving video background always showed raw, ignoring your chosen effect. Now pixel / CRT / dot / ASCII / cross-hatch / noise / blur render over the live video itself. It reuses the same video you're playing as the texture source — one decode, no extra GPU video cost — and falls back to the plain video if the effect can't initialize. Controlled by the existing per-mode toggles (effects on for normal playback by default; immersive stays clean).",
        zh: "以前动态视频背景始终是原始画面，忽略你选择的特效。现在像素 / CRT / 网点 / ASCII / 交叉线 / 噪点 / 模糊会渲染在动态视频本身上。它复用你正在播放的同一份视频作为纹理源——只解码一次、不增加 GPU 视频开销——若特效无法初始化则回退到原始视频。由现有的分模式开关控制（普通播放默认开启特效；沉浸式保持干净）。",
        ja: "これまで動画の背景は常に元のままで、選んだエフェクトが無視されていました。今後はピクセル / CRT / ドット / ASCII / クロスハッチ / ノイズ / ぼかしが、動いている動画そのものに描画されます。再生中の同じ動画をテクスチャ源として再利用するため（デコードは 1 回、GPU 動画コストの増加なし）、エフェクトを初期化できない場合は素の動画にフォールバックします。既存のモード別トグルで制御します（通常再生は既定でエフェクトオン、没入時はクリーンのまま）。",
        ko: "이전에는 움직이는 영상 배경이 항상 원본으로 표시되어 선택한 효과가 무시되었습니다. 이제 픽셀 / CRT / 도트 / ASCII / 크로스해치 / 노이즈 / 블러가 영상 자체 위에 렌더링됩니다. 재생 중인 같은 영상을 텍스처 소스로 재사용하므로(디코딩 1회, GPU 영상 비용 증가 없음) 효과를 초기화할 수 없으면 원본 영상으로 대체됩니다. 기존 모드별 토글로 제어합니다(일반 재생은 기본적으로 효과 켜짐, 몰입 모드는 깔끔하게 유지).",
      },
    },
  ],
};

export default release;
