<div align="center">
  <img src="./public/muzero-logo-dark.png" width="96" alt="MUZERO app icon" />

# MUZERO

**나만의 음악 은행, 비주얼 플레이어, 그리고 AI DJ.**

MUZERO는 로컬 우선 음악 / 비디오 플레이어입니다. 개인 라이브러리, 여러 플랫폼에 흩어진 음악, 동적인 시각 효과, 클라우드 드라이브 동기화, LLM 기반 DJ Agent를 하나의 앱으로 묶습니다.

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja-JP.md) · [한국어](./README.ko-KR.md)

[mu0.app](https://mu0.app) · [Changelog](./CHANGELOG.md) · [Product PRD](./docs/prd/20260612-muzero-product-positioning-readme-prd/20260612-muzero-product-positioning-readme-prd.md)

</div>

---

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

## 하이라이트 기능

### 빠르고, 키보드 중심

- 많은 단축키를 직접 설정할 수 있습니다. 재생, queue, 검색, navigation, 라이브러리 관리의 주요 작업을 키보드만으로 끝낼 수 있습니다.
- `Command/Ctrl + F`로 곡, 앨범, 아티스트, 세트, 가사, 태그, 메모, 온라인 소스를 한 번에 검색합니다.
- MUZERO는 로컬 대규모 라이브러리 검색을 기준으로 설계됩니다. 6,000곡짜리 플레이리스트가 사용 가능해지기까지 30초 가까이 기다리게 해서는 안 됩니다.

### 한 번 설정하고, 모든 기기에서 재생

- 클라우드 드라이브를 한 번 설정한 뒤 trusted setup link를 복사하면 다른 휴대폰이나 컴퓨터도 같은 라이브러리에 빠르게 연결할 수 있습니다.
- 세트, 곡, 커버, 메모, 추억, 가사, 재생 메타데이터를 내 기기 사이에서 동기화합니다. MUZERO가 미디어를 호스팅할 필요는 없습니다.
- 친구에게는 read-only 라이브러리 / 공유 링크로 빠르게 음악을 보낼 수 있습니다. 더 풍부한 `mu0.app` 짧은 링크, 취소 가능한 초대, 권한 관리는 roadmap에서 이어갑니다.

### 깊게 커스터마이즈할 수 있는 비주얼

- 배경 비디오, 배경 이미지, 커버 팔레트 배경, 스펙트럼 배경, waveform 스타일, shader scene, 테마 색상 preset을 선택할 수 있습니다.
- 배경 효과, 비주얼라이저 스타일, palette, 가사 효과, 번역, 로마자 표기, 단어 단위 가사 표시를 듣는 상황에 맞게 조정할 수 있습니다.

### Vibe Coding을 위한 AI DJ

- MUZERO를 보조 모니터에 띄워두면 코딩, 디자인, 글쓰기, 긴 집중 세션에서 DJ / Radio처럼 알아서 음악을 이어줍니다.
- Agent에게 분위기를 말하거나 seed 세트를 주거나, 라이브러리를 검색하게 하면서 queue를 자연스럽게 이어갈 수 있습니다.

## 기능

### 프라이빗 음악 은행

- 오디오 파일, 폴더, MV를 가져와 혼합 세트를 만들 수 있습니다.
- 각 곡에 메모, 태그, 추억 사진, 커스텀 커버를 추가합니다.
- 제목, 아티스트, 앨범, 태그, 메모, 가사, 음역, 소스 메타데이터로 검색합니다.
- 아티스트, 앨범, 세트, 추억, 가사, 재생 기록을 같은 로컬 라이브러리에서 다룹니다.

### 내 클라우드로 동기화

- 사용자가 소유한 클라우드 드라이브로 라이브러리를 publish / pull합니다.
- 현재 production path: Cloudflare R2 / S3 호환 오브젝트 스토리지.
- 스토리지 provider roadmap: Nextcloud, Synology, rclone serve 등을 위한 WebDAV 지원.
- 미디어 bytes는 content-addressed 방식으로 저장되며 가벼운 track row에 들어가지 않아 큰 라이브러리도 빠르게 검색할 수 있습니다.

### 온라인 소스

- 데스크톱에서 다음 소스를 검색하고 resolve합니다.
  - NetEase Cloud Music
  - Bilibili
  - YouTube
- 소스가 요구하는 경우 로그인 상태를 로컬에 저장해 더 높은 음질이나 계정 제한 콘텐츠를 사용할 수 있습니다.
- 스트리밍 곡과 커버를 로컬에 캐시해 오프라인 재생할 수 있습니다.

### 비주얼 플레이어

- 플레이어 우선 bottom dock: 커버 / 제목, 전체 폭 progress, status, navigation이 하나의 표면에 있습니다.
- Now Playing stage는 video, cover art, title fallback, audio-only mode, immersive background를 지원합니다.
- spectrum, waveform, radial, LED reflex, liquid, aurora, cover-palette flow 등 내장 비주얼라이저.
- 데스크톱을 우선으로 만들되 모바일에 대응하는 responsive layout.

### Agent DJ

- DJ는 `TrackBrief`를 작성합니다: caption, lyrics, style, BPM, key, structure, generation hints.
- 음악 생성 provider는 교체 가능합니다: 기본은 offline mock, 실제 생성은 cloud BYOK provider.
- Agent는 라이브러리 검색, 태그와 메모를 활용한 큐레이션, DJ처럼 queue를 이어가는 작업을 할 수 있습니다.
- LLM과 provider는 adapter 뒤에 격리되어 라이브러리가 특정 vendor에 묶이지 않습니다.

## 로컬 실행

Node.js 24.16+와 pnpm이 필요합니다. fnm을 쓰는 경우 저장소의 `.node-version`을 그대로 사용할 수 있습니다:

```bash
fnm install
fnm use
make install
make dev
```

Web dev server는 `http://localhost:41730`입니다.

데스크톱:

```bash
make electron-dev
```

Tauri / 모바일:

```bash
make desktop
make ios-init && make ios
make android-init && make android
```

품질 게이트:

```bash
make check
```

## 배포 / 셀프 호스팅

MUZERO는 Vite 앱이므로 정적 파일로 빌드할 수 있습니다.

```bash
make build
```

`dist/`를 Cloudflare Pages에 배포해 개인 Web build로 사용할 수 있습니다. 온라인 소스 재생처럼 custom request header가 필요한 일부 기능은 Electron 데스크톱 shell에서 가장 안정적으로 동작합니다.

`mu0.app`은 공식 무료 hosted surface입니다. 선택적인 share-link control plane은 Cloudflare Workers + D1 + KV를 기준으로 설계되어 있으며, 해당 phase가 구현되면 셀프 호스팅할 수 있습니다. 로컬 재생, 로컬 라이브러리 관리, 사용자 소유 클라우드 드라이브 동기화에는 MUZERO 계정이 필요 없습니다.

## 프로젝트 맵

| 영역 | Path |
|------|------|
| App shell / routes | [`src/App.tsx`](./src/App.tsx), [`src/pages/`](./src/pages/) |
| Player / media engine | [`src/player/`](./src/player/), [`src/components/player/`](./src/components/player/) |
| AI DJ engine | [`src/dj/`](./src/dj/) |
| Music-generation providers | [`src/musicgen/`](./src/musicgen/) |
| Online source providers | [`src/streamsrc/`](./src/streamsrc/) |
| Local database | [`src/db/`](./src/db/) |
| Cloud sync | [`src/sync/`](./src/sync/) |
| Visualizers | [`src/visualizer/`](./src/visualizer/) |
| Desktop / mobile shell | [`src-tauri/`](./src-tauri/), [`electron/`](./electron/) |
| Product requirements | [`docs/prd/`](./docs/prd/) |

## 기술 스택

Tauri 2, Electron, Vite, React 19, TypeScript, Tailwind CSS v4, COSS UI, Base UI, Dexie, IndexedDB, Zustand, TanStack Query, TanStack Virtual, Vercel AI SDK, Zod, Vitest, Biome, Cloudflare R2, 선택적인 hosted control plane용 Cloudflare Workers.

## Roadmap

- WebDAV storage adapter와 cloud-drive provider abstraction.
- `mu0.app` share links, revocable invites, browser playback page.
- 검색, 큐레이션, 설명, 음악 생성을 위한 Agent tools.
- 모바일 background audio와 touch-first browsing 개선.
- 더 많은 visualizer presets와 cover-driven immersive scenes.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
