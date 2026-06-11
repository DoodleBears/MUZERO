# PRD: MUZERO Product Positioning + Multilingual README

**Status:** Final
**Created:** 2026-06-12
**Author:** MUZERO
**Module:** Product narrative / README / public onboarding - rewrite the project README around MUZERO's product promise: a private music bank, multi-source player, visual playback surface, and Agent DJ, with clear local-first and `mu0.app` service boundaries.

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Product story and public boundary | Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Multilingual README set | Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Cross-link PRD and repo navigation | Completed | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

The existing README presented MUZERO mainly as a local-first AI DJ loop. That was accurate for the earliest product foundation, but the current product story has expanded:

1. **Private music bank / private museum** - every song can carry notes, tags, cover photos, and memory fragments because music carries personal history.
2. **Scattered-platform consolidation** - users have music across NetEase Cloud Music, Bilibili, YouTube, uploaded files, and generated tracks; MUZERO should make them searchable and playable in one local library.
3. **Design-forward visual player** - the product should feel like a rich desktop-first music player, inspired in part by Poweramp, with visualizers and dynamic backgrounds as a first-class surface.
4. **Agent DJ** - LLMs can act as a DJ, librarian, search assistant, and music-generation orchestrator; users can connect local models or online APIs.
5. **Free hosted surface + self-host path** - users can use `mu0.app` for free or self-host/deploy the web build and optional control plane, while library data remains local or on user-owned storage.
6. **Highlight features** - README should call out four differentiators explicitly: keyboard-first speed for large local libraries, one-time cloud-drive setup for multi-device sync and quick sharing, deep visual customization across backgrounds/effects/themes/lyrics, and AI DJ as a side-screen radio for vibe coding.

The README must therefore work as both a public product page and a developer onboarding page. It should be concise enough for GitHub, but clear enough to explain privacy, sync, sharing, cloud storage, and AI boundaries.

Reference inspiration: the [AIDotNet/lobe-chat README](https://github.com/AIDotNet/lobe-chat) uses a centered brand header, language switcher, product description, feature sections, deployment entry points, and repository navigation. MUZERO should use that structure without copying LobeChat's content or visual assets.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Music collector** | Wants a private music bank where songs, MVs, memories, covers, tags, and notes live together. | Can import, annotate, search, play, and sync their local library. |
| **Multi-platform listener** | Has music scattered across NetEase, Bilibili, YouTube, local files, and generated tracks. | Can search online sources on desktop and keep resolved tracks in MUZERO. |
| **Design-forward listener** | Cares about a visual, desktop-quality player experience. | Can use Now Playing, visualizers, dynamic backgrounds, lyrics, and dock controls. |
| **AI music explorer** | Wants an LLM DJ to curate, search, and generate music. | Can connect local or online LLM/music generation providers via BYOK settings. |
| **Self-hoster / privacy-sensitive user** | Wants free hosted access or self-hosting without handing media to MUZERO. | Can use local-only mode, user-owned cloud drives, or future self-hosted `mu0` control plane. |
| **Developer / contributor** | Needs fast context for repo architecture and commands. | Can find project map, stack, commands, PRDs, and local development flow. |

### 1.3 Core Value

1. **Emotional library, not just playback**: README must foreground "music carries memories" as the product's center.
2. **One home for many sources**: upload, stream, sync, and AI-generate should read as one library surface, not four separate tools.
3. **Local-first trust**: users must understand that MUZERO does not host their media library and that cloud storage is user-owned.
4. **AI as an assistant, not a lock-in**: the Agent can use local models or online APIs; the app remains provider-agnostic.
5. **International entry point**: README must support clickable language navigation so non-English users can enter directly.
6. **Speed as product value**: customizable shortcuts and `Command/Ctrl + F` global search should be presented as a core advantage for large personal libraries.
7. **Sync and sharing as product value**: one-time cloud-drive setup plus trusted setup links should explain how users bring phones and computers into the same library, while friend sharing remains read-only or `mu0.app`-mediated.
8. **Visual identity as product value**: background video, background image, spectrum backgrounds, theme color, shader effects, and lyric effects should be framed as customizable surfaces, not decorative extras.
9. **AI DJ as an ambient companion**: the README should make clear that the DJ is useful even when it is "just" a side-screen radio during vibe coding, design, writing, or long focus sessions.

---

## 2. System Architecture

### 2.1 Architecture Overview

```text
README / docs surface
  |
  |-- default English README.md
  |-- README.zh-CN.md
  |-- README.ja-JP.md
  |-- README.ko-KR.md
  |
  v
Product explanation
  |
  |-- private music bank
  |-- online source hub
  |-- visual player
  |-- Agent DJ
  |-- local-first + user-owned cloud sync
  |-- free mu0.app + optional self-hosting
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **README format** | GitHub Markdown + minimal HTML header | Works on GitHub, supports centered logo and language links. |
| **Languages** | English, Simplified Chinese, Japanese, Korean | Matches the app's i18n language set and current catalog direction. |
| **Brand asset** | `public/muzero-logo-dark.png` | Reuses the same new dark logo family used by the web tab / Electron icon system; no new binary asset required. |
| **Links** | Relative Markdown links | Work in GitHub and local markdown viewers. |
| **PRD storage** | `docs/prd/20260612-muzero-product-positioning-readme-prd/` | Follows `.cursor/commands/prd-create.md` naming rules. |

### 2.3 Project Structure

```text
MUZERO/
├── README.md
├── README.zh-CN.md
├── README.ja-JP.md
├── README.ko-KR.md
└── docs/prd/
    └── 20260612-muzero-product-positioning-readme-prd/
        └── 20260612-muzero-product-positioning-readme-prd.md
```

---

## 3. Data Model Design

### 3.1 Core Concepts

This is a documentation/product-positioning PRD. No runtime schema change is required.

```text
Product claim
  |
  |-- must map to existing implementation or an existing PRD
  |-- must label future work as roadmap when not fully shipped
  |-- must preserve local-first / BYOK / no hidden backend rules
```

### 3.2 Database Schema

- **Current Schema:** unchanged. See `src/db/muzero-db.ts` and `src/db/types.ts`.
- **Required Changes:** none.
- **Data Migration:** none.
- **Integration Points:** README links to the relevant implementation directories and PRDs.
- **Privacy & Retention:** README must state that user media, credentials, and settings remain local or in user-owned storage; `mu0.app` is optional for sharing metadata/permissions.

### 3.3 Data Relationship Diagram

```text
Local library data
  ├─ IndexedDB `muzero-db`
  ├─ optional user-owned R2/S3/WebDAV-class storage
  └─ optional mu0 share metadata (only when sharing)
```

---

## 4. API Design

### 4.1 API Endpoints

No new API endpoint is introduced by this PRD.

| Surface | Description |
|---------|-------------|
| `mu0.app` | Free hosted product surface and future share-link viewer/control plane. |
| Cloudflare Pages static build | Optional self-host target for `dist/` after `make build`. |
| Cloudflare Workers + D1 + KV | Future optional `mu0` share-link control plane, tracked by the existing share-links PRD. |

### 4.2 Request/Response Examples

Not applicable.

### 4.3 Error Handling

- Avoid promises the codebase does not support.
- Distinguish current capabilities from roadmap items.
- Do not imply that MUZERO stores user music on its own servers.
- Do not present hidden runtime flags or MUZERO-owned backend requirements as part of the core product.

---

## 5. Frontend Design

### 5.1 Page Structure

README sections:

```text
Header
  ├─ logo
  ├─ MUZERO name
  ├─ tagline
  ├─ language links
  └─ mu0 / changelog / PRD links

Body
  ├─ What is MUZERO?
  ├─ The Promise
  ├─ Product Highlights
  ├─ Features
  ├─ Architecture
  ├─ Run Locally
  ├─ Deploy or Self-Host
  ├─ Project Map
  ├─ Tech Stack
  ├─ Roadmap
  └─ License
```

### 5.2 UI Components

README is documentation, not app UI. Still, it should behave like a product landing surface:

- Use a centered brand header.
- Keep language links above the fold.
- Use tables for trust boundaries and project map.
- Use ASCII diagrams for architecture.
- Avoid screenshots until stable product screenshots are curated; use the default dark logo PNG only.

### 5.3 State Management

Not applicable.

---

## 6. Implementation Plan

### Phase 1: Product Story and Public Boundary

**Goal:** Rewrite README around the actual product thesis and privacy/service boundary.

**Tasks:**
- [x] Replace "AI DJ only" framing with private music bank + multi-source + visual player + Agent DJ.
- [x] Add local-first/BYOK/no-media-backend promise table.
- [x] Explain `mu0.app` as free hosted surface and optional share control plane, not media hosting.
- [x] Mention R2/S3 current sync path and WebDAV as storage-provider roadmap.
- [x] Add product highlights for keyboard-first speed, multi-device sync, visual customization, and side-screen AI DJ usage.

### Phase 1 Checklist

- [x] Product name is exactly `MUZERO`.
- [x] README says music can carry notes, tags, covers, and memories.
- [x] README says NetEase, Bilibili, and YouTube are supported desktop sources.
- [x] README says Agent DJ can search, curate, and generate through local/online providers.
- [x] README says shortcuts and `Command/Ctrl + F` global search are first-class product highlights.
- [x] README says cloud-drive setup links help bring multiple devices into the same library.
- [x] README says friend sharing is read-only today or mediated by the `mu0.app` roadmap.
- [x] README says visual customization includes backgrounds, theme colors, effects, visualizers, and lyrics.
- [x] README says AI DJ can act as a side-screen DJ / radio for vibe coding and long focus sessions.
- [x] README does not claim MUZERO hosts user media.

### Phase 2: Multilingual README Set

**Goal:** Provide clickable language-specific README entry points.

**Tasks:**
- [x] Keep `README.md` as the default English entry.
- [x] Add `README.zh-CN.md`.
- [x] Add `README.ja-JP.md`.
- [x] Add `README.ko-KR.md`.
- [x] Add matching language switcher links to each file.

### Phase 2 Checklist

- [x] Language links are visible at the top of every README file.
- [x] Links are relative and work on GitHub.
- [x] Each localized README covers the same core product story and trust boundary.

### Phase 3: Cross-Link PRD and Repo Navigation

**Goal:** Make README useful for developers and future product work.

**Tasks:**
- [x] Add project map linking to `src/dj`, `src/musicgen`, `src/streamsrc`, `src/sync`, `src/db`, `src/visualizer`, desktop shells, and PRDs.
- [x] Add local commands: `make install`, `make dev`, `make electron-dev`, `make check`.
- [x] Add deploy/self-host notes for static build and future Cloudflare control plane.
- [x] Add this PRD and link it from each README.

### Phase 3 Checklist

- [x] README has a clear developer onboarding path.
- [x] README links to changelog and PRD.
- [x] README avoids duplicating the full architecture manual from `AGENTS.md`/`CLAUDE.md`.

---

## 7. Out of Scope

- New screenshots, demo videos, or generated marketing art.
- New website implementation for `mu0.app`.
- Implementing WebDAV support itself.
- Implementing the `mu0.app` share-link control plane.
- Changing app runtime i18n catalogs.
- Changing the database schema or sync protocol.
- Adding analytics, telemetry, accounts, or hosted media storage.

---

## 8. Security Considerations

- **Authentication:** none for README. Product copy must not imply a MUZERO account is required for local use.
- **Authorization:** sharing permission management belongs to the `mu0.app` control plane PRD, not this README PRD.
- **Data Protection:** README must clearly state that keys and credentials live locally and media is not hosted by MUZERO.
- **Audit Logging:** none.
- **Secrets:** no API key examples, no `.env` instructions for user secrets, and no committed credentials.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [README.md](../../../README.md) | Default English README. |
| [README.zh-CN.md](../../../README.zh-CN.md) | Simplified Chinese README. |
| [README.ja-JP.md](../../../README.ja-JP.md) | Japanese README. |
| [README.ko-KR.md](../../../README.ko-KR.md) | Korean README. |
| [R2 Cloud Drive Sync PRD](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | Current user-owned cloud drive sync path. |
| [External Streaming Sources PRD](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | NetEase, Bilibili, and YouTube desktop source support. |
| [WebDAV Storage Provider PRD](../20260612-muzero-cloud-storage-provider-abstraction-webdav-prd/20260612-muzero-cloud-storage-provider-abstraction-webdav-prd.md) | Storage abstraction and WebDAV roadmap. |
| [mu0 Share Links PRD](../20260612-muzero-mu0-share-links-control-plane-prd/20260612-muzero-mu0-share-links-control-plane-prd.md) | Optional hosted sharing control plane. |
| [AIDotNet/lobe-chat README](https://github.com/AIDotNet/lobe-chat) | Structural inspiration for language links and product README layout. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should the default README be English or Chinese? | Resolved | Use English as default GitHub entry, add Simplified Chinese as first localized link. |
| 2 | Should README claim WebDAV is fully shipped? | Resolved | Describe R2/S3 as current path and WebDAV as storage-provider roadmap until implementation completes. |
| 3 | Should README include screenshots? | Resolved | Not now. Reuse `public/muzero-logo-dark.png`; add screenshots later once curated product captures exist. |
| 4 | Should Cloudflare self-hosting be described as complete? | Resolved | Static `dist/` deployment is documented; optional `mu0` control plane remains future/self-hostable when its phase lands. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | MUZERO | Swapped README branding from the removed legacy `app-icon.png` to `public/muzero-logo-dark.png`. |
| 2026-06-12 | MUZERO | Added highlights for multi-device cloud-drive setup links, friend sharing, and side-screen AI DJ / radio usage. |
| 2026-06-12 | MUZERO | Added highlight section for keyboard-first speed and visual customization. |
| 2026-06-12 | MUZERO | Initial PRD and multilingual README rewrite. |
