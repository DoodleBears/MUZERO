<div align="center">
  <img src="./public/muzero-logo-dark.png" width="96" alt="MUZERO app icon" />

# MUZERO

**나만의 음악 은행, 비주얼 플레이어, 그리고 AI DJ.**

MUZERO는 로컬 우선 음악 / 비디오 플레이어입니다. 개인 라이브러리, 여러 플랫폼에 흩어진 음악, 동적인 시각 효과, 클라우드 드라이브 동기화, LLM 기반 DJ Agent를 하나의 앱으로 묶습니다.

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja-JP.md) · [한국어](./README.ko-KR.md)

[mu0.app](https://mu0.app) · [Docs](https://mu0.app/docs) · [Changelog](./CHANGELOG.md) · [Product PRD](./docs/prd/20260612-muzero-product-positioning-readme-prd/20260612-muzero-product-positioning-readme-prd.md)

<br/>

<img src="./docs/media/now-playing.gif" width="760" alt="MUZERO 몰입형 재생 화면 — 커버 팔레트, 플로우 배경, 실시간 스펙트럼" />

</div>

---

## 스크린샷

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/media/visualizer.gif" alt="실시간 비주얼라이저와 가사" /><br/>
      <sub><b>실시간 비주얼라이저 &amp; 가사</b> — 스펙트럼 스타일을 전환하고 가사 모드로.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/media/switch-song.gif" alt="스와이프로 곡 전환" /><br/>
      <sub><b>스와이프로 곡 전환</b> — 터치로 넘기는 3D 커버 플로우.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/media/search.png" alt="전역 검색" /><br/>
      <sub><b>전역 ⌘F 검색</b> — 트랙, 태그, 가사, 온라인 소스를 아우르는 검색.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/media/library.png" alt="세트 갤러리" /><br/>
      <sub><b>세트 갤러리</b> — 세트, 앨범, 아티스트, 스마트 플레이리스트를 한곳에서.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/media/dj.png" alt="에이전트 DJ 설정" /><br/>
      <sub><b>에이전트 DJ</b> — LLM을 연결해 DJ처럼 세트를 큐레이션하고 요청을 받기.</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/media/settings.png" alt="커스터마이즈 가능한 비주얼" /><br/>
      <sub><b>커스터마이즈 가능한 비주얼</b> — 플로우 배경, 팔레트, 이펙트, 테마.</sub>
    </td>
  </tr>
</table>

## MUZERO란?

MUZERO는 private music bank, 또는 private museum이라는 생각에서 시작했습니다.
각 곡에 메모, 태그, 커버 사진, 기억 조각을 남길 수 있습니다. 어떤 노래가 재생되는 순간, 그 시절로 다시 돌아갈 수 있도록요.

지금의 MUZERO는 네 가지 경험을 연결합니다.

- **프라이빗 음악 박물관**: 오디오와 MV를 업로드하고, 곡마다 메모, 태그, 커버, 추억 사진을 추가합니다.
- **멀티 소스 음악 허브**: 데스크톱에서 NetEase Cloud Music, Bilibili, YouTube를 검색하고 재생한 뒤 MUZERO 라이브러리에 보관합니다.
- **비주얼 플레이어**: Poweramp에서 영감을 받은 플레이어 UI, 반응형 배경, 커버 기반 색상, 오디오 비주얼라이저.
- **Agent DJ**: 로컬 모델 또는 온라인 LLM API를 연결해 라이브러리 검색, 세트 큐레이션, 음악 생성 API를 통한 다음 곡 생성을 맡길 수 있습니다.

무료 [mu0.app](https://mu0.app)을 사용할 수도 있고, 프로젝트를 clone한 뒤 Web build 또는 선택적인 공유 control plane을 Cloudflare에 직접 배포할 수도 있습니다. 핵심 데이터는 로컬에 남습니다. 기기 간 동기화는 사용자가 직접 설정한 R2, S3 호환 스토리지, 또는 향후 WebDAV 계열 프라이빗 클라우드를 사용합니다.

## 약속

| 원칙 | 의미 |
|------|------|
| **로컬 우선** | 곡, 세트, 메모, 태그, 커버, 설정, 재생 통계, 미디어 메타데이터는 기기 로컬 IndexedDB `muzero-db`에 저장됩니다. |
| **MUZERO는 미디어를 호스팅하지 않음** | MUZERO는 사용자의 음악 파일을 보관하지 않습니다. 클라우드 동기화는 사용자가 소유하고 설정한 스토리지를 사용합니다. |
| **BYOK** | LLM key, 음악 생성 key, 소스 로그인 세션, 클라우드 자격 증명은 기기에 로컬 저장됩니다. |
| **무료 hosted service** | `mu0.app`은 배포, Web 접근, 선택적인 공유 권한 관리를 위한 무료 서비스입니다. 라이브러리를 맡아 보관하지 않습니다. |
| **명확한 공유 경계** | 공유 짧은 링크와 권한 메타데이터만 `mu0` 서비스를 필요로 합니다. 오디오 / 비디오 bytes는 로컬 기기 또는 사용자의 클라우드에서 옵니다. |

## 문서

전체 가이드, 하이라이트, 아키텍처는 **[mu0.app/docs](https://mu0.app/docs)** 에 있습니다:

- [시작하기](https://mu0.app/docs/getting-started/) — 앱을 열고 첫 곡을 가져오기
- [소스 & 가져오기](https://mu0.app/docs/sources/) — 업로드 + NetEase·Bilibili·YouTube
- [클라우드 동기화](https://mu0.app/docs/sync/) — 모든 기기를 같은 라이브러리로
- [Agent DJ](https://mu0.app/docs/agent-dj/) — 모델을 연결해 큐를 맡기기
- [셀프 호스팅 / 배포](https://mu0.app/docs/self-host/) — Web 빌드를 직접 실행
- [아키텍처](https://mu0.app/docs/architecture/) — 데이터 모델, DJ 루프, 프로젝트 맵, 기술 스택

바로 쓰고 싶다면 [my.mu0.app](https://my.mu0.app)을 열거나 [다운로드 페이지](https://mu0.app/download)에서 데스크톱 빌드를 받으세요.

## 로컬 실행

Node.js 24.16+, pnpm, 그리고 (데스크톱 / 모바일 빌드용) Rust + Tauri 전제, Xcode, Android SDK/NDK가 필요합니다.

```bash
fnm install
fnm use
make install
make dev            # Web dev server → http://localhost:41730
make electron-dev   # Electron 데스크톱 shell
make check          # 타입 체크 + lint + 테스트
```

전체 빌드 / 배포와 Tauri / 모바일 명령은 [셀프 호스팅 가이드](https://mu0.app/docs/self-host/)에 있습니다.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
