---
title: 셀프 호스팅 / 배포
description: 프로젝트를 로컬에서 실행하고, 정적 파일로 빌드하고, 자신의 Web 빌드를 Cloudflare Pages에 배포하세요. 로컬 사용에는 MUZERO 계정이 필요 없습니다.
sidebar:
  order: 5
---

MUZERO는 Vite 앱입니다. 로컬에서 실행하고, 정적 파일로 빌드하고, 자신의 Web 빌드를 배포할 수 있습니다. 로컬 재생, 로컬 라이브러리 관리, 사용자 소유 클라우드 동기화에는 MUZERO 계정이 필요 없습니다.

## 로컬 실행

요구 사항:

- Node.js 24.16+ 와 pnpm
- 데스크톱 / 모바일 Tauri 빌드를 위한 Rust + Tauri 전제
- iOS는 Xcode, Android는 SDK/NDK

```bash
fnm install
fnm use
make install
make dev          # Web dev server → http://localhost:41730
```

데스크톱 shell:

```bash
make electron-dev   # Electron(주력 데스크톱 shell)
make desktop        # Tauri 동등
```

품질 게이트:

```bash
make check          # 타입 체크 + lint + 테스트
```

## 빌드와 배포

```bash
make build          # tsc + vite build → dist/
```

`dist/`를 **Cloudflare Pages**에 배포해 개인 Web 버전으로 사용하세요. 커스텀 요청 헤더가 필요한 온라인 소스 재생 등 데스크톱 전용 기능은 Electron shell에서 가장 안정적입니다.

## 호스팅 vs 셀프 호스팅

- **`mu0.app`**은 공식 무료 hosted surface(마케팅 + 문서 + 다운로드)입니다. 앱 본체는 **`my.mu0.app`**.
- 선택적인 **공유 링크 control plane**은 Cloudflare Workers + D1 + KV를 기준으로 설계되어, 해당 phase가 오면 셀프 호스팅할 수 있습니다.
- 핵심 데이터는 로컬에 남고, 기기 간 동기화는 **자신의** R2 / S3 호환 스토리지(또는 향후 WebDAV)를 사용합니다.

## 다음

- [아키텍처](/ko/docs/architecture/)
