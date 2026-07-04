# PRD: README + Marketing-Site Media Quality Refresh

**Status:** Draft
**Created:** 2026-07-04
**Author:** Claude (from PM request)
**Module:** Docs / Marketing site (`README.md` + `packages/site`) — showcase media

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Sharpen the capture pipeline (retina PNG + lossless GIF frames) | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Raise site `optimize-media` quality + sharpen | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Capture new / updated feature surfaces | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Re-capture all, integrate into README + site, verify (redaction) | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO's first impression is visual — the [`README.md`](../../../../README.md) hero grid and the marketing site landing page ([`packages/site/src/components/Landing.astro`](../../../../packages/site/src/components/Landing.astro)) both showcase the app through screenshots + GIFs. PM feedback before the next site deploy:

1. **图糊 (blurry)** — the current showcase media look soft/banded, especially the animated ones.
2. **过时 / 缺功能 (stale + missing)** — the media in [`docs/media/`](../../../../docs/media/) are all dated **Jun 18** and predate a wave of newer features; several shipped features have **no** showcase at all.

All showcase media are produced by one docs tool, [`scripts/capture-readme-media.mjs`](../../../../scripts/capture-readme-media.mjs) (drives a running Electron app via the dev control endpoint + CDP, writes PNG/GIF to `docs/media/`), and the site copies are re-encoded to WebP by [`packages/site/scripts/optimize-media.mjs`](../../../../packages/site/scripts/optimize-media.mjs).

**Blur — confirmed root causes (the whole chain):**

| Stage | File | Problem |
|-------|------|---------|
| Capture (PNG) | `capture-readme-media.mjs` L77-82 | `Page.captureScreenshot` with **no `deviceScaleFactor` override** → captured at the dev window's 1× DPR → soft on retina and when the README/site render it larger. |
| Capture (GIF) | `capture-readme-media.mjs` L119-155 | Intermediate frames are **JPEG** (`f-%04d.jpg`, lossy) fed into palettegen; `maxWidth` only **560–720px** while README displays `now-playing` at **760px** (upscale); **64–128 colors** + `dither=bayer` → banding. |
| Site re-encode | `packages/site/scripts/optimize-media.mjs` | Animated WebP at **`quality: 70`** (aggressive for motion graphics — spectrum bars, transitions) and **no sharpening**; raw `<img>` (no `astro:assets`, no `srcset`). |

**Stale / missing coverage:** the 7 captured surfaces are `now-playing`, `visualizer`, `switch-song`, `search`, `library`, `settings`, `dj` — and `dj` is only the **Settings model pane**, not the actual conversational/voice DJ. Shipped since Jun 18 with **zero** showcase: **voice DJ conversation**, **DJ tool-call activity + notifications**, **online streaming sources** (QQ / NetEase / YouTube / Bilibili), **video playback + download**, **genre enrichment**, **live chat requests (弹幕点歌)**, and the refreshed chat UI. Site-only doc gaps: **memory photos/annotations**, a dedicated **lyrics** shot, **cloud sync**, **keyboard shortcuts**.

### 1.2 Target Users

| Role | Description | Interest |
|------|-------------|----------|
| **Prospective user** | Lands on the README / site before installing | Needs a crisp, current picture of what the app does |
| **Contributor / PM** | Maintains docs before releases | Needs a repeatable, high-quality capture pipeline, not per-release manual editing |

### 1.3 Core Value

1. **Crisp first impression** — retina-sharp stills + clean motion, no soft/banded showcase media.
2. **Truthful, current showcase** — the media reflects what shipped (voice DJ, streaming, video…), not a Jun-18 snapshot.
3. **Repeatable pipeline** — quality is fixed in the capture + optimize scripts, so the next release re-captures cleanly instead of hand-editing.

---

## 2. System Architecture

### 2.1 Media Pipeline (current)

```
running Electron (dev control endpoint + CDP, real library)
        │  scripts/capture-readme-media.mjs
        │   • Page.captureScreenshot(png)  ← no DPR override  (blur #1)
        │   • frames→JPEG→ffmpeg palette GIF, maxWidth 560-720 (blur #2)
        ▼
   docs/media/*.{png,gif}   ──► README.md  <img> grid (GitHub)
        │
        │  packages/site/scripts/optimize-media.mjs
        │   • sharp.resize(1280).webp({quality: animated?70:82})  (blur #3), no sharpen
        ▼
   packages/site/public/media/*.webp  ──► Landing.astro SHOWCASE_MEDIA  <img>
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Capture** | CDP (`Page.captureScreenshot`, `Emulation.setDeviceMetricsOverride`, `Input.*`) + dev control endpoint | Already the perf/E2E harness; drives real UI, no mocking |
| **GIF encode** | `ffmpeg` 2-pass palette (palettegen/paletteuse) | Existing; zero runtime dep |
| **Site re-encode** | `sharp` (WebP, animated) | Existing in `optimize-media.mjs` |
| **Site render** | Astro/Starlight, raw `<img>` | Existing; keep (astro:assets is out of scope, see §7) |

### 2.3 Project Structure (touched files)

```
scripts/capture-readme-media.mjs        # Phase 1 + 3: DPR, PNG frames, wider GIFs, new surfaces
docs/media/*.{png,gif}                   # Phase 4: regenerated outputs
README.md                                # Phase 4: <img> grid (add new features)
packages/site/
├── scripts/optimize-media.mjs           # Phase 2: animated quality↑ + sharpen + config
├── public/media/*.webp                  # Phase 4: regenerated
├── src/components/Landing.astro          # Phase 4: SHOWCASE_MEDIA array
└── src/i18n/ui.ts                        # Phase 4: showcase captions (en/zh/ja/ko)
```

---

## 3. Data Model Design

N/A — this PRD touches build-time media assets + capture/encode scripts only. No IndexedDB, DB schema, or runtime data-model changes.

---

## 4. API Design

N/A — no product API changes. The capture tool only **consumes** the existing dev-only control endpoint ([`electron/perf-control.cjs`](../../../../electron/perf-control.cjs)); any new showcase surface reuses existing routes (`/nav/tab`, `/player/*`, `/settings`, `/voice/transcript`, `/search`) or adds a dev-only driving route if a surface can't be reached with the current set (documented in Phase 3).

---

## 5. Frontend Design

### 5.1 Showcase surfaces (target set)

Keep the 7 existing surfaces (re-captured crisp) and **add**:

| New surface | What it shows | How to drive (control endpoint + CDP) |
|-------------|---------------|----------------------------------------|
| `dj-chat` | Conversational DJ: expand chat, a real request → tool-call rows (icon+label+field) + `dj_say` reply | `/voice/transcript` inject or type into composer; expand widget; capture chat panel |
| `dj-voice` (optional) | Voice request + tool-activity notifications mirrored top-left | inject transcript, capture the notification stack mid-turn |
| `streaming` | Online source search + import (NetEase/YouTube/Bilibili/QQ) | enable a source in settings; drive `/search` or the online panel |
| `video` | Video track playing on the Now Playing stage | activate a video track; capture stage |
| `genre` | Genre-enrichment settings / genre-filtered library | nav to enrichment settings |
| `live-requests` (optional) | 弹幕点歌 intake | nav to live-request settings |

> The exact surface list is confirmed in Phase 3 against what is demoable with seed content; low-value or hard-to-stage surfaces drop to Out of Scope with a note (no silent truncation).

### 5.2 Quality targets

- **PNG**: capture at **`deviceScaleFactor: 2`** → 2× pixel density; display width unchanged. Sharp/legible UI text.
- **GIF**: **lossless (PNG) intermediate frames**; `maxWidth` ≥ the README display width (≥ 760px, likely 800–900); revisit `colors`/dither per surface; **each GIF stays under a size budget** (target ≤ ~5 MB, README total reasonable). Where a GIF can't be both crisp and small, note the animated-WebP-only path (README keeps GIF, site gets the sharper WebP).
- **Site WebP**: animated **`quality` 70 → ~82** + a light sharpen; static stays ~82 (or lossless for text-heavy panes); quality made configurable (env/const), not magic numbers.

### 5.3 README + site integration

- README `<img>` grid: add rows/cells for the new surfaces; keep alt text descriptive; keep display widths matched to (or below) capture width so nothing upscales.
- Site `SHOWCASE_MEDIA` (Landing.astro) + `src/i18n/ui.ts` captions (en/zh/ja/ko) extended for each new surface — **4-locale coverage required**; any missing locale flagged as `pending translation`.

---

## 6. Implementation Plan

### Phase 1: Sharpen the capture pipeline (code only)

**Goal:** Fix blur at the source so any re-capture is crisp — landable without re-running the app.

**Tasks:**
- [ ] PNG: before `shot()`, apply `Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor: 2, mobile: false })` (read current `width/height` from the renderer), capture, then `clearDeviceMetricsOverride`. Verify output is 2× the CSS size.
- [ ] GIF: switch intermediate frames JPEG → **PNG** (lossless) into palettegen; raise default `maxWidth` (≥ display width); expose `colors`/`dither` per call; keep a per-GIF size guard + log final dimensions/size.
- [ ] Keep the size/format trade-off documented in the script header.

#### Phase 1 Checklist
- [ ] PNG captures are 2× pixel density (spot-check dimensions).
- [ ] GIF intermediate frames are lossless; output width ≥ README display width.
- [ ] `node --check scripts/capture-readme-media.mjs`; script header updated.

### Phase 2: Raise site `optimize-media` quality + sharpen (code only)

**Goal:** Stop the site re-encode from re-introducing blur.

**Tasks:**
- [ ] `optimize-media.mjs`: animated WebP `quality` 70 → ~82; add a light `sharpen`; consider near-lossless for static text panes; make quality/width configurable constants (no magic literals).
- [ ] Re-run `pnpm --filter site optimize:media` against current `docs/media/` to A/B the delta (sanity-check size vs. sharpness) before Phase 4 wholesale re-capture.

#### Phase 2 Checklist
- [ ] Animated WebP visibly sharper at an acceptable size delta.
- [ ] Quality/width are named constants/env, not inline numbers.

### Phase 3: Capture new / updated feature surfaces (code only)

**Goal:** Add driving routines for the missing features.

**Tasks:**
- [ ] Add `dj-chat` (+ optional `dj-voice`/notifications), `streaming`, `video`, `genre`, and optional `live-requests` capture routines, reusing the control endpoint; add a dev-only driving route only if a surface is otherwise unreachable.
- [ ] Confirm each surface is stageable with seed content; drop non-viable ones to Out of Scope with a logged note.

#### Phase 3 Checklist
- [ ] Each new surface captures deterministically from a seeded state.
- [ ] Surface list finalized; dropped surfaces logged (not silently skipped).

### Phase 4: Re-capture, integrate, verify (needs a configured running app)

**Goal:** Produce the final assets and wire them in — **gated on a running Electron with real, non-sensitive content + BYOK configured** (same dependency as the E2E harness).

**Tasks:**
- [ ] Run the improved capture against a configured instance; regenerate `docs/media/`; run `optimize:media` → `public/media/`.
- [ ] Update README `<img>` grid + `SHOWCASE_MEDIA` + `ui.ts` captions (4 locales).
- [ ] **Redaction pass (blocking):** no API keys, tokens, personal file paths, or private library detail visible; Settings panes show masked/empty key fields; the AI-DJ shot must not reveal a key.
- [ ] Commit; the site deploy (`packages/site` `pages:deploy`) picks up the new `public/media/`.

#### Phase 4 Checklist
- [ ] All showcase media regenerated crisp + current.
- [ ] Redaction verified on every still/GIF.
- [ ] README + site + 4-locale captions updated; deploy shows the new media.

---

## 7. Out of Scope

- **Astro `astro:assets` / responsive `srcset` migration** — larger refactor of `Landing.astro`; keep raw `<img>` for now (note as a follow-up).
- **Video (`<video>`/mp4/webm) instead of GIF in the README** — GitHub relative-path videos don't autoplay; keep GIF for README, WebP for site. (Site could later adopt `<video>` — separate PRD.)
- **New product features** — this PRD only showcases what already shipped; it changes no runtime behavior.
- **Cover-tile (Pexels/SVG) rework** — the landing hero tiles are fine; not touched.
- **Docs-page inline screenshots** (getting-started/sources/sync) — optional stretch, not required for this pass.

---

## 8. Security Considerations

- **No secrets in media (blocking).** Screenshots/GIFs are of the real app. The redaction pass (Phase 4) must ensure **no BYOK API keys, tokens, cookies, personal file paths, account handles, or private library content** are visible. Key inputs are `type=password` (masked) — verify they render masked/empty in every Settings capture, especially the AI-DJ/LLM and streaming-source panes.
- **Capture tool is dev-only.** `capture-readme-media.mjs` depends on `MUZERO_PERF_CONTROL=1` (dev control endpoint) — never shipped in a packaged build (consistent with the [dev-control-endpoint PRD](../../20260615-muzero-dev-control-endpoint-automation-harness-prd/)).
- **Seed vs. real library.** Prefer a seeded/curated demo set for captures so nothing personal leaks; if using the real library, apply the redaction pass rigorously.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Marketing/docs site PRD](../20260622-muzero-marketing-docs-site-prd/) | The site this media feeds (`packages/site`) |
| [Product positioning / README PRD](../../20260612-muzero-product-positioning-readme-prd/) | Original README structure + showcase intent |
| [Dev control-endpoint harness PRD](../../20260615-muzero-dev-control-endpoint-automation-harness-prd/) | The endpoint the capture tool drives |
| [Voice-DJ conversation PRD](../../desktop/20260702-muzero-voice-dj-conversation-prd/) | New feature to showcase (dj-chat / notifications) |
| [Genre-enrichment PRD](../../desktop/20260704-muzero-track-metadata-genre-enrichment-prd/) | New feature to showcase (genre) |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Keep GIF for README (vs. animated WebP)? GitHub renders animated WebP inline. | Open | Lean: README animated WebP if GitHub renders it crisply; else GIF. Validate in Phase 4. |
| 2 | Seeded demo set vs. real library for captures? | Open | Prefer seeded (`/seed/example` + curated) to avoid redaction risk; fall back to real + redaction. |
| 3 | Final new-surface list (which of dj-voice / live-requests make the cut)? | Open | Decided in Phase 3 by demo-ability + value. |
| 4 | Per-GIF size budget / total README weight ceiling? | Open | Target ≤ ~5 MB/GIF; revisit if crispness needs more. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-04 | Claude (from PM request) | Initial draft. Traced the full blur chain (capture: no-DPR PNG + JPEG-frame/small-width/palette GIF; site: animated WebP q70 + no sharpen) and the stale/missing-feature gap (media dated Jun-18; no voice-DJ / streaming / video / genre / live-requests). 4-phase plan: (1) sharpen capture pipeline, (2) raise site optimize quality, (3) add new surfaces, (4) re-capture + integrate + redaction. §7 keeps GIF-for-README + raw `<img>`; §8 makes the no-secrets redaction pass blocking. |
