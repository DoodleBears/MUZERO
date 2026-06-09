# PRD: Settings Two-Column Layout + Cloud Drive Setup Simplification

**Status:** Review
**Created:** 2026-06-09
**Author:** MUZERO
**Module:** Settings page (`src/pages/settings-page.tsx`) + R2 owner setup (`src/sync/*`)

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Minimal owner R2 connection model + bucket auto-discovery | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Simplified owner R2 setup form | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Two-column Settings layout (sidebar → detail) + persistence | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Split the Cloud Drive section into items | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

The Settings page is a single long stack of cards, and the Cloud Drive card in
particular is dense and hard to parse — the owner R2 form alone asked for 8
fields (manifest URL, account id, bucket, prefix, S3 endpoint, access key,
secret, label). The PM wants Settings to read like a focused control panel:
a left sidebar of sections → items, with the selected item's controls on the
right, and a much simpler R2 setup.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Local listener** | Subscribes to a shared public manifest link | Read-only |
| **Owner** | Owns a Cloudflare R2 bucket, syncs their library | Read + write (local credentials) |

### 1.3 Core Value

1. **Legibility**: master-detail Settings — one concern on screen at a time.
2. **Lower setup friction**: owner connects R2 with the minimum honest inputs;
   the bucket is auto-discovered, the whole bucket is used (no prefix).
3. **No new backend**: everything stays local-first; sharing/revocation that
   needs a server is explicitly deferred to a future V3 PRD.

---

## 2. System Architecture

### 2.1 Project Structure

```
src/
├── pages/settings-page.tsx          # two-column shell + per-item detail panes
├── components/settings/
│   ├── settings-nav.ts              # sidebar IA config + active-item resolver (pure)
│   └── settings-sidebar.tsx         # left section/item list
├── stores/nav-store.ts              # persisted `settingsItem` (localStorage muzero-nav)
└── sync/
    ├── owner-r2-connection.ts       # minimal input → R2LocalCredentials + manifest URL
    └── r2-list-buckets.ts           # signed S3 ListBuckets for bucket auto-discovery
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Layout** | React + Tailwind v4 | Existing stack; responsive master-detail |
| **State** | Zustand (`nav-store`, persist) | Same tiny-UI-pref pattern as tab/locale/theme |
| **R2 write** | S3 SigV4 (`r2-s3.ts`) | Owner BYO credentials, local only |

---

## 3. Data Model Design

No IndexedDB schema change. New ephemeral UI state only:

- `nav-store.settingsItem: string` — active Settings item id, persisted in
  localStorage `muzero-nav` (alongside `tab`). Defaults to `"appearance"`.

Owner R2 credentials continue to live only in the local `settings` row
(`AppSettings.r2CredentialsByDriveId`), never synced, never logged.

---

## 5. Frontend Design

### 5.1 Sidebar Information Architecture

```
Settings
├── Appearance   → [appearance, background, visualizer]
├── Playback     → [playback-dj, playback-music]
├── Cloud Drive  → [cloud-owner, cloud-subscribe, cloud-sync, cloud-presence]
├── Device       → [device]
└── Advanced     → [advanced]   (Trace diagnostics)
```

- Left sidebar lists sections (group headers) → items (buttons). Clicking an
  item shows only that item's controls on the right.
- Active item persists in `nav-store`; an unknown/stale id falls back to the
  first item.
- Responsive: under `md` the sidebar collapses to a horizontal selector above
  the detail pane.

### 5.2 UI Components

- **Current Implementation:** `src/pages/settings-page.tsx` (single card stack).
- **Required Changes:** introduce `settings-nav.ts` (pure config + resolver) and
  `settings-sidebar.tsx`; refactor `SettingsPage` into a two-column shell that
  renders one item's controls at a time. Split the Cloud Drive card's
  sub-blocks across the four `cloud-*` items.

### 5.3 State Management

- `useNavStore((s) => s.settingsItem)` with a minimal selector; `setSettingsItem`
  on click. No store churn beyond the active id.

---

## 6. Implementation Plan

### Phase 1: Minimal owner R2 connection model + bucket auto-discovery

**Goal:** Pure, testable model behind the simplified setup.

**Tasks:**
- [x] `buildOwnerR2Connection`: minimal input → `R2LocalCredentials` (no prefix) + derived public base + manifest URL.
- [x] `parseR2AccountId`: extract account id from S3 endpoint or pass a bare id.
- [x] `listR2Buckets`: signed S3 ListBuckets parsing bucket names from the XML.

### Phase 1 Checklist

- [x] Owner credentials derive from endpoint/account + key + secret + public URL.
- [x] The whole bucket is used — no prefix field.
- [x] Buckets can be auto-discovered from the keys (single auto-selects).
- [x] Reads/writes default to the shared `getAppFetch()` path.

### Phase 2: Simplified owner R2 setup form

**Goal:** Replace the 8-field form with the minimal one.

**Tasks:**
- [x] Owner form reduced to label + S3 endpoint/account + access key + secret + public URL.
- [x] "Find bucket" runs ListBuckets; single bucket auto-selects, multiple show a picker.
- [x] Validation derives manifest URL + credentials via `buildOwnerR2Connection`.
- [x] en/zh/ja/ko strings for the new fields and actions.

### Phase 2 Checklist

- [x] A fresh owner can connect R2 without typing a bucket name or prefix.
- [x] Removed fields (manifest URL, account-only, prefix, endpoint override) no longer appear.
- [x] Secret is masked and stored only in local settings.
- [x] Verified rendering in the preview.

### Phase 3: Two-column Settings layout (sidebar → detail) + persistence

**Goal:** Master-detail Settings shell driven by a pure nav config.

**Tasks:**
- [x] Persist active item in `nav-store` (`settingsItem`, localStorage).
- [x] Add `settings-nav.ts`: section/item config + `resolveActiveSettingsItem` fallback (pure, tested).
- [x] Add `SettingsSidebar` component (sections → item buttons, active highlight).
- [x] Refactor `SettingsPage` into a two-column shell rendering one item at a time (Cloud Drive as a single item for this phase).
- [x] Responsive: sidebar collapses to a top selector under `md`.

### Phase 3 Checklist

- [x] Clicking a sidebar item shows only that item's controls on the right.
- [x] The active item persists across reloads.
- [x] An unknown/stale persisted id falls back to the first item.
- [x] No settings control is lost in the refactor; the page renders crash-free.

### Phase 4: Split the Cloud Drive section into items

**Goal:** Break the dense Cloud Drive card into focused items.

**Tasks:**
- [ ] `cloud-owner`: setup checklist + simplified owner form + connected drives.
- [ ] `cloud-subscribe`: subscribe via public link + set preview/import.
- [ ] `cloud-sync`: recommended CORS + latest sync progress.
- [ ] `cloud-presence`: Listening Now presence toggle.

### Phase 4 Checklist

- [ ] Each cloud concern is its own sidebar item under the Cloud Drive section.
- [ ] Owner setup, subscribe, sync, and presence each render independently.
- [ ] No cloud control is lost; verified in the preview.

---

## 7. Out of Scope

- **Sharing via a link with backend-recorded binding + per-recipient revocation.**
  That requires a MUZERO-operated Worker + D1 (the V3 hosted control plane) and
  contradicts the local-first "no backend" rule; it needs its own PRD. The
  existing read-only "paste link → bind → auto-pull" flow stays as-is.
- Browser WASM credential rotation, multi-account R2, or non-R2 providers.
- Any IndexedDB schema change.

---

## 8. Security Considerations

- **Authorization:** owner R2 credentials stay in the local `settings` row only;
  never synced, never embedded in manifests/links, never logged.
- **Data Protection:** the secret is masked in the UI; ListBuckets is a signed
  request that never persists the response beyond the bucket names shown.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [R2 Cloud Drive Sync](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | V1 R2-only protocol, owner sync, and the deferred V3 control plane. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Backend-recorded sharing + revocation? | Resolved | Deferred to a V3 PRD; stay local-first now. |
| 2 | Persist the active Settings item where? | Resolved | `nav-store` (localStorage `muzero-nav`). |
| 3 | How deep to split the Cloud Drive card? | Resolved | Four items: owner / subscribe / sync / presence. |
| 4 | Can owner setup drop to just access key + secret? | Resolved | No — S3 signing needs the account endpoint; minimum is endpoint/account + key + secret + public URL, with the bucket auto-discovered. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-09 | MUZERO | Initial draft. Phase 1 (owner R2 connection model + ListBuckets) and Phase 2 (simplified owner form) already implemented; Phase 3 nav-store persistence landed. |
| 2026-06-09 | MUZERO | Phase 3 completed: Settings is now a two-column master-detail — a pure `settings-nav` config (sections → items, with a stale-id fallback resolver) drives a `SettingsSidebar`; `SettingsPage` renders one item's controls at a time, gated by the persisted `nav-store.settingsItem`. Responsive (vertical sidebar on `md+`, horizontal scroll row on mobile). Verified in the preview at desktop + mobile widths; en/zh/ja/ko section labels added. |
