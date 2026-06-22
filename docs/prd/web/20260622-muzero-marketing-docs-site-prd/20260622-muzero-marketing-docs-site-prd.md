# PRD: MUZERO Marketing + Docs Site (Astro / Starlight) & App Domain Split

**Status:** Draft (key decisions locked 2026-06-22 — ready for Phase 1)
**Created:** 2026-06-22
**Author:** DoodleBear / Product
**Module:** Public web surface — stand up an Astro + Starlight marketing-and-docs site on the `mu0.app` apex for SEO, onboarding, tutorials, and the download center; move the React SPA to `my.mu0.app` ("我的", the private library). This is a new public surface, not an app feature.

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Site foundation (Astro + Starlight scaffold + landing) | 🔄 In Progress | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Docs content as single source (port README, i18n) | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Domain split + cutover (`mu0.app` → site, app → `my.mu0.app`) | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | SEO hardening (sitemap / hreflang / OG / structured data) | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

Today `mu0.app` boots **straight into the React SPA** (Cloudflare Pages project `mu0-app` → `dist/`). The `<body>` is a single `<div id="root">` ([`index.html`](../../../../index.html)), so there is **no crawlable body text and no long-tail content**. The SEO `<meta>` / Open Graph / canonical / Twitter tags are already in place and good for social unfurls — but social cards are not organic search. Search engines can render a SPA, but they rank it poorly for content/tutorial queries because the meaningful content sits behind interaction, IndexedDB, and BYOK setup.

The product story is now rich (private music museum, multi-source hub, visual player, Agent DJ) and the [README](../../../../README.md) is already a high-quality, **four-language** (en / zh / ja / ko) product narrative. None of that SEO value is being captured by a SPA at the apex.

The fix is a **dedicated content surface**:

1. **Landing page** wins brand queries and conversion (search "MUZERO" → find it → click "Open MUZERO" / "Download").
2. **Docs / tutorials win the long-tail organic traffic** — "how to import a NetEase playlist into a local player", "local-first music library R2 sync", "AI DJ that continues the queue", etc. For a developer-leaning product this is the single biggest organic-search lever, and the multilingual content is a large untapped asset for the zh / ja / ko markets.
3. **Download center + future share viewer** belong on the apex too: the Electron updater already points users at [`https://mu0.app/download`](../../../../electron/updater.cjs), and the share-links roadmap reserves `mu0.app/s/<slug>`.

**Domain decision (resolved with product owner, 2026-06-22):** the apex `mu0.app` is the highest-authority page and should serve **content**, not the app. The React SPA moves to **`my.mu0.app`** — "我的", reinforcing the "your private music museum" positioning. This is the standard marketing-at-apex / app-at-subdomain pattern (Linear / Notion style).

### 1.2 Target Users

| Role | Description | What the site gives them |
|------|-------------|--------------------------|
| **Search visitor (new)** | Lands from a Google/Bing query about local music players, AI DJ, NetEase/Bilibili import, etc. | Indexable landing + docs that answer the query and convert to "Open MUZERO" / "Download". |
| **Evaluator** | Heard of MUZERO, wants to understand promise, privacy boundary, and platforms before installing. | Landing (promise + highlights), screenshots, download center, FAQ. |
| **New user onboarding** | Installed/opened the app, needs setup help (BYOK keys, cloud sync, sources, AI DJ). | Tutorials / how-to docs with deep-linkable anchors. |
| **Self-hoster / developer** | Wants to deploy the web build or understand architecture. | Self-host + architecture + project-map docs (sourced from README). |
| **Non-English user (zh / ja / ko)** | Prefers localized content. | Localized landing + docs via Starlight i18n + `hreflang`. |
| **Returning web-app user** | Bookmarked `mu0.app`, expects the app. | Prominent "Open MUZERO" CTA → `my.mu0.app`, plus a `mu0.app/app` convenience redirect. |

### 1.3 Core Value

1. **Capture organic search** the SPA cannot: static, crawlable landing + long-tail docs at the highest-authority page.
2. **Single source of truth for docs**: README content becomes Starlight docs; README shrinks to a pointer. No fork-and-drift.
3. **Multilingual SEO**: en/zh/ja/ko with correct `hreflang`, matching the app's i18n set.
4. **Clean surface separation**: `mu0.app` = content + download + (future) share; `my.mu0.app` = the app; `assets.mu0.app` = desktop artifacts (unchanged).
5. **Stays on-ethos**: static-first, no MUZERO media backend, no tracking required, no account. Search is a static index (Pagefind), not a server.

---

## 2. System Architecture

### 2.1 Architecture Overview

```text
                         Cloudflare account (mu0.app zone)
                         │
  ┌──────────────────────┼───────────────────────────────────────┐
  │                      │                                        │
  ▼                      ▼                                        ▼
mu0.app                my.mu0.app                          assets.mu0.app
(apex)                 (subdomain)                         (subdomain, R2)
Pages: mu0-site        Pages: mu0-app                      bucket: muzero-releases
Astro + Starlight      React SPA (dist/)                   desktop installers +
  ├─ /              landing  the existing app, unchanged       updater feeds
  ├─ /docs/...      tutorials  "我的" private library         (UNCHANGED by this PRD)
  ├─ /download      center  └─ origin-scoped IndexedDB
  ├─ /s/<slug>      (future share viewer — reserve route)     `muzero-db`
  └─ sitemap/robots/OG

SEO content + onboarding live at the apex.
The app is one click away. Desktop distribution is untouched.
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Site framework** | **Astro 6** (installed `^6.4.8`) | Static-first, islands; best-in-class SEO/perf (zero JS by default, fast LCP). Can reuse React components as islands if a section needs the app's UI. |
| **Docs** | **Starlight** (Astro official docs theme) | Turnkey: i18n routing + `hreflang`, sidebar, search, dark mode, edit links. README ports straight into content collections. |
| **Search** | **Pagefind** (Starlight default) | Static, build-time index — no backend. Matches local-first / no-MUZERO-backend ethos. |
| **i18n** | Starlight built-in i18n | en (default) + zh / ja / ko, mirroring the app's locale set and the four READMEs. |
| **Styling / visual language** | Tailwind v4 for the custom landing + Starlight theme tokens for docs | **Replicate the [untitled.stream](https://untitled.stream/) aesthetic** (see §5.2): minimal/editorial, generous whitespace, quiet type hierarchy, understated label-first CTAs, thematic feature blocks — **adapted to MUZERO's established dark brand** (`#09090b`) with cover-palette/flow accents as the only splash of color. |
| **Landing animation** | **GSAP** (+ ScrollTrigger) | Hero centerpiece is a 3D cascade of generated album "covers" (fanned record crate, spectrum-tinted → echoes cover-palette identity; inspired by photon.codes / Spectrum). Entrance fan-out animates a registered `@property --spread` (CSS computes per-card transform), + pointer parallax + scroll drift. **No-JS / reduced-motion fallback** shows the full cascade via CSS. Covers are generated (copyright-safe) and data-driven — swap in licensed cover images by editing the `covers` array. |
| **Hosting** | **Cloudflare Pages** project `mu0-site` | Same account/tooling as `mu0-app`; apex bound here. |
| **Analytics** | **None** (owner decision 2026-06-22, §10 Q2) | Keeps the site on-ethos (no tracking). Revisit later only with a visible, cookieless choice. |
| **Repo layout** | pnpm workspace package `packages/site/` (new `packages/` convention) | One repo keeps docs next to code (less drift); separate package + separate Pages project keeps the two builds decoupled. Establishes a `packages/` dir for future shared/extra packages; the app stays at the repo root for now (full `apps/` restructure is out of scope, §2.3 note). |

### 2.3 Project Structure

```text
MUZERO/
├── src/  electron/  src-tauri/  public/  scripts/   # app — repo-root package "muzero", UNCHANGED
├── packages/                          # NEW packages/ convention (first member: site)
│   └── site/                          # Astro + Starlight workspace package
│       ├── package.json               # name: @muzero/site
│       ├── astro.config.mjs           # Starlight integration, i18n (en/zh/ja/ko), site: https://mu0.app
│       ├── src/
│       │   ├── content/docs/          # docs single-source (Starlight content collection)
│       │   │   ├── en/ (index, getting-started, sync, sources, ai-dj, self-host, ...)
│       │   │   ├── zh/  ja/  ko/
│       │   ├── pages/                 # custom marketing routes (landing index, download)
│       │   ├── components/            # hero, feature blocks, screenshot gallery
│       │   └── assets/                # logo, screenshots (reuse docs/media/*)
│       └── public/                    # robots.txt, og images, favicons
├── pnpm-workspace.yaml                # add: packages: ["packages/*"]   (currently only allowBuilds)
├── index.html                         # app: update canonical/OG mu0.app → my.mu0.app (Phase 3)
├── README.md / README.{zh-CN,ja-JP,ko-KR}.md   # shorten; point to /docs (Phase 2)
└── docs/prd/web/20260622-muzero-marketing-docs-site-prd/
```

> **Note (convention):** this PRD introduces the `packages/` directory with `packages/site/` as its first member. The main app stays at the repo root (root package `muzero`) — a full monorepo restructure that moves the app under `apps/` is **out of scope** here, but `packages: ["packages/*"]` is compatible with doing it later.

---

## 3. Data Model Design

### 3.1 Core Concepts

This PRD introduces **no runtime DB schema change**. The "data" concern is the **web origin change**, which is the top risk.

```text
Content single-source
  └─ docs live in site/src/content/docs (one source) → README points here, never forks

Web origin & local data (THE risk)
  └─ IndexedDB `muzero-db` is ORIGIN-scoped (same rule as Electron vs Tauri, CLAUDE.md §10)
  └─ moving the app mu0.app → my.mu0.app is a DIFFERENT ORIGIN
  └─ existing hosted-web users' local libraries on the mu0.app origin are NOT visible at my.mu0.app
```

### 3.2 Database Schema

- **Current Schema:** unchanged. See [`src/db/muzero-db.ts`](../../../../src/db/muzero-db.ts) and [`src/db/types.ts`](../../../../src/db/types.ts). **No version bump, no migration.**
- **Required Changes:** none to the schema.
- **Origin / local-data impact (the real migration):** the hosted web app's `muzero-db` (and any OPFS media) is scoped to the `mu0.app` origin. After the app moves to `my.mu0.app`, those users start with an **empty** library at the new origin. Recovery paths:
  - **Cloud-drive re-pull** — users who synced to their own R2/S3 re-pull on the new origin ([R2 Cloud Drive Sync PRD](../../../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md)).
  - **Export / import** — metadata export from the old origin, import on the new ([Media Metadata Import/Export PRD](../../../20260609-muzero-media-metadata-import-export-prd/20260609-muzero-media-metadata-import-export-prd.md)).
  - **Acceptance (owner-approved 2026-06-22, §10 Q1)** — MUZERO has not had its public launch / first desktop release yet (see [Release Pipeline PRD](../../../20260611-muzero-release-pipeline-changelog-prd/20260611-muzero-release-pipeline-changelog-prd.md)), so the hosted-web base is small. The decision is to **accept the origin reset** with a one-time in-app notice + the two recovery paths (cloud re-pull / export-import), rather than build a cross-origin migration.
- **Desktop / Tauri shells:** unaffected — they have their own origins and never used `mu0.app`.

### 3.3 Data Relationship Diagram

```text
mu0.app (Astro site)                    my.mu0.app (app, new origin)
  └─ no user data, static content         └─ IndexedDB muzero-db (fresh at new origin)
                                              ├─ recover via user-owned R2/S3 sync
                                              └─ recover via export/import
assets.mu0.app (R2) ── desktop installers + updater feeds (unchanged)
```

---

## 4. API Design

### 4.1 Endpoints / Routes

No application API is introduced. Surfaces and routes:

| Surface | Route / host | Owner | Notes |
|---------|-------------|-------|-------|
| Landing | `mu0.app/` | `mu0-site` (Astro) | Hero, highlights, screenshots, CTA → `my.mu0.app`. |
| Docs | `mu0.app/docs/...` (+ `/zh`, `/ja`, `/ko`) | `mu0-site` (Starlight) | Tutorials/onboarding; single-source content. |
| Download center | `mu0.app/download` | `mu0-site` | Must keep this path — Electron updater links here ([`electron/updater.cjs`](../../../../electron/updater.cjs)). Lists installers from `assets.mu0.app/desktop`. |
| App convenience redirect | `mu0.app/app` → 302 `my.mu0.app` | `mu0-site` (`_redirects`) | For returning users / muscle memory. |
| Share viewer (future) | `mu0.app/s/<slug>` | reserved | Do **not** squat this route; [share-links control plane PRD](../../../20260612-muzero-mu0-share-links-control-plane-prd/20260612-muzero-mu0-share-links-control-plane-prd.md) (Workers) will own it. |
| App | `my.mu0.app/*` | `mu0-app` (SPA) | The existing app, unchanged except canonical/OG host. |
| Desktop artifacts | `assets.mu0.app/desktop/*` | R2 `muzero-releases` | **Unchanged by this PRD.** |

### 4.2 Request/Response Examples

Not applicable (static site). Build/deploy commands instead:

```bash
# new site package
pnpm --filter @muzero/site dev      # local Astro dev
pnpm --filter @muzero/site build    # → packages/site/dist
wrangler pages deploy packages/site/dist --project-name=mu0-site --branch=main
```

### 4.3 Error Handling

- **404s / broken deep links:** Starlight 404 page; verify no doc anchors break inbound links.
- **Cutover downtime:** stage `my.mu0.app` and the site on preview URLs and verify **before** flipping the apex (§6 Phase 3 order).
- **Stale OG cache:** after changing the app's `og:url` to `my.mu0.app`, re-scrape via social debuggers.
- **Telemetry & Logging:** none required; if Cloudflare Web Analytics is adopted, it is cookieless and carries no app data.

---

## 5. Frontend Design

### 5.1 Page Structure

```text
mu0.app (Astro)
├─ / (landing)
│   ├─ Hero: logo + tagline + "Open MUZERO" (→ my.mu0.app) + "Download"
│   ├─ Highlights (keyboard-first, multi-device sync, visual customization, AI DJ)
│   ├─ Screenshot / GIF gallery (reuse docs/media/*)
│   ├─ Promise / trust boundary (local-first, BYOK, no media backend)
│   └─ Footer: docs, GitHub, changelog, language switcher
├─ /docs/... (Starlight)
│   ├─ Getting started / install
│   ├─ Importing & sources (NetEase / Bilibili / YouTube)
│   ├─ Cloud sync (R2 / S3)
│   ├─ Agent DJ & BYOK
│   ├─ Self-host / deploy
│   └─ Architecture / project map (from README)
└─ /download (installers from assets.mu0.app)
```

**Routing architecture (Q8, resolved 2026-06-22):** the landing is a **plain Astro page** (`packages/site/src/pages/index.astro`) for maximum design freedom (untitled.stream replication); **docs are Starlight** served under `/docs/*`. Both live in the **same** Astro project (`@muzero/site`) — Starlight is an Astro integration, not a separate app — so they share build, i18n, search, and brand tokens. The custom `index.astro` owns `/`; Starlight owns the `/docs` subtree.

### 5.2 UI Components & Visual Direction

**Reference: replicate [untitled.stream](https://untitled.stream/).** Its positioning ("a sacred place for your work-in-progress music") and ours ("your private music museum") share a "sanctuary for personal music" framing, so its design language fits MUZERO directly. Principles to carry over:

- **Minimal / editorial, calm.** Feature-maximalism is the opposite of the goal; let whitespace and copy breathe. Content is organized into distinct **thematic feature blocks** (organize / sync / sources / AI DJ / visuals), one idea per block.
- **Quiet type hierarchy.** A large, understated display heading; medium-weight subheads; highly readable body. No loud headlines.
- **Refined wordmark treatment.** untitled.stream leans on its bracketed `[untitled]` wordmark; MUZERO uses its own logo family with the same restrained, typographic confidence — not a busy hero illustration.
- **Label-first CTAs, no loud gradients.** Primary actions read plainly: **"Open MUZERO"** (→ `my.mu0.app`) and **"Download"** (→ `mu0.app/download`), mirroring untitled's "Enter App / Download on the App Store".
- **Palette adaptation.** untitled.stream reads light/neutral; MUZERO **keeps its established dark brand** (`#09090b`) so the site and app feel like one product. The only color accents are **cover-palette / flow** tones (the app's signature), used sparingly.

Concretely:

- **Current implementation:** none for the public site (the README is the only "landing" today). The app's components are **not** reused wholesale — the marketing site is independent; only the brand assets ([`public/muzero-logo-*.png`](../../../../public/), [`docs/media/*`](../../../../docs/media/)) and copy are shared.
- **Required changes:** build a small landing (hero + thematic feature blocks + screenshot/GIF gallery) in the untitled.stream-inspired style above; let Starlight own docs chrome. Keep it static; avoid pulling the app's heavy runtime into the marketing build.
- **Brand consistency:** reuse logo family, theme color `#09090b`, and screenshots/GIFs already curated for the README ([`docs/media/*`](../../../../docs/media/)).

### 5.3 State Management

Not applicable — static content. No Zustand/Dexie/app state in the site package.

---

## 6. Implementation Plan

### Phase 1: Site Foundation

**Goal:** A deployable Astro + Starlight site with a real landing page, on a preview domain, not yet touching the apex.

**Tasks:**
- [x] Add `packages: ["packages/*"]` to [`pnpm-workspace.yaml`](../../../../pnpm-workspace.yaml); scaffold `packages/site/` (`@muzero/site`) with **Astro 6 + Starlight 0.40** (`docsLoader`/`docsSchema`), `site: https://mu0.app`. Custom `src/pages/index.astro` owns `/`; docs under `src/content/docs/docs/**` → `/docs/*`.
- [x] Build the landing page (hero + thematic feature blocks + gallery + CTA) in the **untitled.stream-inspired** visual language (§5.2), reusing `docs/media/*` and the logo family. Added a minimal `/download` page (Electron updater target).
- [ ] Create Cloudflare Pages project `mu0-site`; add `make`/`package.json` scripts mirroring the existing `pages:*` scripts. **(Pending owner go-ahead — outward-facing deploy.)**
- [ ] Deploy to a preview URL and verify perf (LCP) + that no app runtime leaks into the bundle. **(Pending the Pages project.)**

### Phase 1 Checklist
- [x] `pnpm --filter @muzero/site build` produces a static `packages/site/dist` (5 routes + Pagefind index + sitemap + robots).
- [x] Landing renders crawlable text (server-rendered HTML has the real copy, not an empty root div). Verified via DOM eval on the dev server.
- [x] CTA links point at `https://my.mu0.app` and `/download` (and `/docs`). Verified.
- [x] Dark brand `#09090b` applied; `/docs` Starlight chrome + search render; `/download` lists macOS/Windows/Linux. Verified via DOM eval (pixel screenshot tool unavailable in this env).
- [ ] `mu0-site` preview deploy is green. **(Pending owner go-ahead.)**

### Phase 2: Docs as Single Source

**Goal:** Port README content into Starlight docs as the single source; README shrinks to a pointer; i18n live.

**Tasks:**
- [ ] Create the docs tree (getting-started, sources, sync, AI DJ, self-host, architecture/project-map) from existing README sections.
- [ ] Set up Starlight i18n: en (default) + zh / ja / ko, mirroring the four READMEs; enable Pagefind search.
- [ ] Shorten the READMEs (owner decision 2026-06-22, §10 Q6): **keep the centered brand header, the hero image/GIF + screenshot table, the language links, and the main "What is MUZERO?" intro**; replace the long Features/Architecture/Run/Deploy detail with concise pointers to `mu0.app/docs`. Avoid duplicate-and-drift.
- [ ] Verify every old inbound README/PRD link still resolves (or redirects).

### Phase 2 Checklist
- [ ] Docs cover install, sources, sync, AI DJ, self-host, architecture.
- [ ] All four languages present with a working language switcher.
- [ ] Pagefind search returns results across docs.
- [ ] README is a pointer, not a fork; no content lives in two places.

### Phase 3: Domain Split + Cutover

**Goal:** Apex serves the site; the app lives at `my.mu0.app`; zero/near-zero downtime.

**Tasks (ordered to avoid downtime):**
- [ ] Add `my.mu0.app` as an **additional** custom domain on the existing `mu0-app` Pages project (app reachable at both hosts).
- [ ] Update the app's [`index.html`](../../../../index.html) canonical / `og:url` / `og:image` / `twitter:image` from `mu0.app` → `my.mu0.app`; redeploy `mu0-app`.
- [ ] Add a `mu0.app/app` → 302 `my.mu0.app` redirect to the site (`_redirects`).
- [ ] Add a one-time in-app notice about the origin move + recovery (cloud re-pull / export-import). Origin reset is accepted (§10 Q1).
- [ ] Flip the apex `mu0.app` custom domain from `mu0-app` → `mu0-site`.
- [ ] Update [`docs/deploy/mu0-app-release.md`](../../../../docs/deploy/mu0-app-release.md), [`wrangler.toml`](../../../../wrangler.toml) comments, and live-request "Web (`mu0.app`)" references to reflect the new host split.

### Phase 3 Checklist
- [ ] `curl -I https://mu0.app` serves the Astro site; `curl -I https://my.mu0.app` serves the app.
- [ ] `mu0.app/download` works and the Electron updater's download link still resolves.
- [ ] `assets.mu0.app/desktop/*` untouched and still serving.
- [ ] App canonical/OG point at `my.mu0.app`; social debuggers re-scrape cleanly.
- [ ] Origin-reset notice + recovery paths implemented (§10 Q1, accepted).

### Phase 4: SEO Hardening

**Goal:** Maximize indexability and international ranking.

**Tasks:**
- [ ] `sitemap.xml` (Astro sitemap integration) + `robots.txt`; submit to Search Console / Bing.
- [ ] `hreflang` alternates for en/zh/ja/ko; verify canonical per locale.
- [ ] Per-page OG/Twitter metadata + a default OG image; JSON-LD (`SoftwareApplication` / `WebSite`).
- [ ] Decide analytics (§10 Q2); if adopted, cookieless only.

### Phase 4 Checklist
- [ ] Sitemap + robots reachable and submitted.
- [ ] `hreflang` validates; no duplicate-content warnings.
- [ ] OG preview correct for landing and key docs.
- [ ] Lighthouse SEO + perf are strong (static targets ≥95).

---

## 7. Out of Scope

- Rewriting or restructuring the app (SPA) itself — it only changes host + canonical/OG.
- Any DB schema change, sync-protocol change, or new app runtime feature.
- Building the `mu0.app/s/<slug>` share viewer / control plane (separate [share-links PRD](../../../20260612-muzero-mu0-share-links-control-plane-prd/20260612-muzero-mu0-share-links-control-plane-prd.md); this PRD only **reserves** the route).
- Changing `assets.mu0.app` / R2 desktop distribution.
- A cross-origin auto-migration of existing web `muzero-db` (recovery is via cloud re-pull / export-import).
- Accounts, server-side personalization, MUZERO-owned media backend, or required telemetry.

---

## 8. Security Considerations

- **No secrets in the site:** the marketing/docs build is fully static; it carries no API keys, no BYOK material, no R2 write creds (those stay in rclone/CI per existing rules).
- **Origin isolation is a feature, not a bug:** the app's local data staying origin-scoped is by design; the cutover must communicate the one-time reset rather than silently lose data.
- **No hidden backend flags:** the site is static; any toggle (e.g., analytics) is a visible build decision, not a runtime kill switch (CLAUDE.md §3).
- **Privacy:** default no tracking; optional analytics must be cookieless and document what it collects.
- **Redirect safety:** `mu0.app/app` → `my.mu0.app` is a same-org first-party 302; no open-redirect parameters.
- **Codename layer unchanged:** db name `muzero-db`, id prefixes, provider ids, `appId app.mu0.muzero`, and `assets.mu0.app` are all preserved (CLAUDE.md §4).

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Product Positioning + Multilingual README PRD](../../../20260612-muzero-product-positioning-readme-prd/20260612-muzero-product-positioning-readme-prd.md) | Source of the product narrative and the four-language copy this site reuses. |
| [Release Pipeline + Changelog PRD](../../../20260611-muzero-release-pipeline-changelog-prd/20260611-muzero-release-pipeline-changelog-prd.md) | Defines `mu0.app` / `assets.mu0.app` / `appId`; download center + updater link to `mu0.app/download`. |
| [mu0 Share Links Control Plane PRD](../../../20260612-muzero-mu0-share-links-control-plane-prd/20260612-muzero-mu0-share-links-control-plane-prd.md) | Will own `mu0.app/s/<slug>`; this PRD reserves that route. |
| [R2 Cloud Drive Sync PRD](../../../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | Recovery path for existing-web-data after the origin move. |
| [Media Metadata Import/Export PRD](../../../20260609-muzero-media-metadata-import-export-prd/20260609-muzero-media-metadata-import-export-prd.md) | Second recovery path (export old origin → import new). |
| [Release operator checklist](../../../../docs/deploy/mu0-app-release.md) | Must be updated for the apex/subdomain split in Phase 3. |
| [README.md](../../../../README.md) | Brand header + hero + intro stay; long detail moves to `mu0.app/docs`. |
| [untitled.stream](https://untitled.stream/) | Visual-language reference for the landing page (§5.2). |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | How to handle existing hosted-web users' local `muzero-db` when the app moves to a new origin (`my.mu0.app`)? | **Resolved (2026-06-22)** | **Accept the origin reset** (pre-launch, small base) + one-time in-app notice + recovery via user-owned cloud re-pull and export/import. No cross-origin migration. |
| 2 | Add marketing analytics on the site? | **Resolved (2026-06-22)** | **No analytics** for now. Keep the site tracking-free; revisit later only with a visible, cookieless choice. |
| 3 | Subdomain name: `my.` confirmed over `app.`? | Resolved | `my.mu0.app` — "我的", matches the private-museum positioning. |
| 4 | One repo vs separate repo, and where does the package live? | **Resolved (2026-06-22)** | Same repo, new **`packages/` convention** with the site at **`packages/site/`** (`packages: ["packages/*"]`). App stays at repo root; `apps/` restructure out of scope. Separate Pages project keeps builds decoupled. |
| 5 | Astro + Starlight vs Next/VitePress/Docusaurus? | Resolved | Astro + Starlight — static-first SEO/perf + turnkey i18n docs + static Pagefind search (no backend), can reuse React islands if needed. |
| 6 | Does the README stay full or shrink to a pointer? | **Resolved (2026-06-22)** | **Shorten**: keep the brand header, hero image/GIF + screenshot table, language links, and the main "What is MUZERO?" intro; move the long detail to `mu0.app/docs` with pointers. |
| 7 | Landing-page visual language? | **Resolved (2026-06-22)** | **Replicate [untitled.stream](https://untitled.stream/)** (minimal/editorial, whitespace, quiet type, label-first CTAs, thematic feature blocks) **adapted to MUZERO's dark brand** `#09090b` with cover-palette/flow accents (§5.2). |
| 8 | Single Starlight project (custom splash homepage) vs plain Astro landing + Starlight docs? | **Resolved (2026-06-22)** | **Plain Astro landing + Starlight docs in one Astro project.** Custom `src/pages/index.astro` owns `/` (full design freedom for the untitled.stream look); Starlight owns `/docs/*`. Shared build/i18n/brand. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-22 | DoodleBear / Product | Initial draft. Resolved: marketing/docs at apex `mu0.app`, app → `my.mu0.app`, Astro + Starlight, same-repo workspace. Open: existing-web-data handling (Q1), analytics (Q2), README shrink (Q6). |
| 2026-06-22 | DoodleBear / Product | Owner decisions: Q1 accept origin reset; Q2 no analytics; Q6 shorten README (keep header/hero/intro). Added Q7 — landing visual language replicates untitled.stream, adapted to the dark brand (§5.2). |
| 2026-06-22 | DoodleBear / Product | Q4 resolved: introduce `packages/` convention; site at `packages/site/` with `packages: ["packages/*"]`; app stays at repo root (`apps/` restructure out of scope). Synced all structure/paths/commands. |

---

> **Note:** This is a new public web surface, intentionally decoupled from the app build. It modifies the app only at the edges (host + canonical/OG) and changes no DB schema or sync protocol. The biggest risk is the **web origin change orphaning existing local libraries** — tracked as Open Question Q1.
