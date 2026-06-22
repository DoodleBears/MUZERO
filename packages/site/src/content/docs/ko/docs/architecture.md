---
title: 아키텍처
description: MUZERO가 어떻게 맞물리는지 — 데이터 모델, DJ → 생성 → 큐 루프, 데스크톱 shell, 프로젝트 맵. 기여자용.
sidebar:
  order: 6
---

기여자와 궁금한 분들을 위한, MUZERO가 어떻게 구성되는지에 대한 큰 그림.

## 데이터 흐름

```text
로컬 파일 / 온라인 소스 / AI 생성
              |
              v
        Track + MediaBlob
              |
              v
 IndexedDB `muzero-db`  <---->  선택적 사용자 소유 클라우드
              |
              v
        플레이어 + 비주얼라이저
              |
              v
        Agent DJ / 검색 / 공유
```

track은 가벼운 행이고, 오디오·영상·커버의 **bytes는 별도의 `mediaBlobs` 스토어**에 있으며 track 행에는 절대 들어가지 않습니다 — 그래서 목록 쿼리가 빠르고 가상화가 의미를 가집니다.

## DJ 루프

```text
추억 + 무드 + 최근 곡
          |
          v
    LLM Agent가 TrackBrief 작성
          |
          v
    음악 생성 provider가 오디오 렌더링
          |
          v
 pending track -> ready track -> 큐 보충
```

`TrackBrief`는 DJ, 음악 생성 provider, 데이터베이스 사이의 유일한 계약입니다. DJ는 provider 비종속적인 brief를 작성하고 adapter가 번역하므로, vendor 개념이 DJ나 DB로 새지 않습니다.

## Shell

앱 전체가 프런트엔드이며, 데스크톱 shell 추상화 뒤에서 동작합니다:

- **Electron** — 주력 데스크톱 shell(CORS-free fetch, 로컬 파일 접근).
- **Tauri 2** — 실행 가능 상태를 유지하며 모바일에 사용.
- **Web** — 브라우저 빌드.

모든 native 접근은 하나의 bridge를 거치므로, provider·플레이어·UI는 어느 shell에 있는지로 분기하지 않습니다.

## 기술 스택

Tauri 2, Electron, Vite, React 19, TypeScript, Tailwind CSS v4, COSS UI, Base UI, Dexie, IndexedDB, Zustand, TanStack Query, TanStack Virtual, Vercel AI SDK, Zod, Vitest, Biome, Cloudflare R2, 선택적 hosted control plane용 Cloudflare Workers.

## 소스 맵

코드는 [MUZERO 저장소](https://github.com/DoodleBears/MUZERO)에 있습니다. 주요 영역: AI DJ 엔진, 음악 생성 provider, 온라인 소스 provider, 로컬 데이터베이스, 클라우드 동기화, 비주얼라이저, Electron / Tauri shell.

> 기여하고 싶다면 저장소의 `CLAUDE.md` / `AGENTS.md`에 전체 아키텍처 안내와 규칙이 있습니다.
