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
| 4 | Split the Cloud Drive section into items | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Add-drive modal with a stepper | ✅ Completed | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Unify add-drive (own R2 + shared link); retire the standalone Subscribe item | 🔄 In Progress | [Phase 6 Checklist](#phase-6-checklist) |

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
- [x] `cloud-owner`: setup checklist + simplified owner form + connected drives.
- [x] `cloud-subscribe`: subscribe via public link + set preview/import.
- [x] `cloud-sync`: recommended CORS + latest sync progress.
- [x] `cloud-presence`: Listening Now presence toggle.

### Phase 4 Checklist

- [x] Each cloud concern is its own sidebar item under the Cloud Drive section.
- [x] Owner setup, subscribe, sync, and presence each render independently.
- [x] No cloud control is lost; verified in the preview.

### Phase 5: Add-drive modal with a stepper

**Goal:** Replace the inline owner form with an "Add cloud drive" modal — a
two-step stepper that scales to multiple drives (and, later, others' shared
resources in V3). Important fields first; the in-bucket folder is an optional
collapsible advanced setting; the display name is last.

**Tasks:**
- [x] Add optional `folder` (prefix) to `buildOwnerR2Connection` (default: whole bucket).
- [x] Add a `Stepper` UI primitive (numbered steps + active state, a11y `aria-current`).
- [x] Build `AddDriveDialog`: Step 1 connect (keys + public URL, advanced collapsible folder) → validate (ListBuckets + read/write) → auto-select bucket; Step 2 name + save.
- [x] Wire it into the `cloud-owner` item: replace the inline owner form with an "Add cloud drive" button + the connected-drives list; mount the dialog.
- [x] Add en/zh/ja/ko strings.

### Phase 5 Checklist

- [x] Adding a drive is a focused modal, not an inline form.
- [x] Step 1 collects keys/URL with the folder tucked into an "Advanced" collapsible; validation auto-discovers the bucket.
- [x] Step 2 names the drive and saves it; the new drive appears in the connected list.
- [x] The flow scales to multiple drives; verified in the preview.

### Phase 6: Unify add-drive; retire the standalone Subscribe item

**Goal:** One place to add any drive. The manifest URL stays as the read
mechanism, but pasting a shared link becomes the modal's second tab (read-only),
not a separate Subscribe page. Set browse/import moves onto each drive row. (V3:
share whole playlists / buckets through the same shared-link tab.)

**Tasks:**
- [x] `connectReadOnlyManifest` accepts an optional `label` (so the name step can rename a shared drive).
- [x] `AddDriveDialog` gets a mode switcher — "My R2" (owner) and "Shared link" (read-only URL → validate → name).
- [ ] In the "My R2" tab, add a **public / private access-mode** choice (MUZERO asks, doesn't toggle the Cloudflare bucket): public shows the public-URL field + validates public reachability; private hides it (reads via local presign, own-devices-only for now), with trade-off hints. Record the mode on `CloudDrive`. See R2 PRD §2.6.1.
- [x] Move remote-set browse/import onto each connected-drive row.
- [ ] Remove the standalone `cloud-subscribe` item; relabel `cloud-owner` to a unified Drives item.

### Phase 6 Checklist

- [ ] Adding a drive — own R2 or a shared link — happens only in the modal.
- [ ] The "My R2" tab lets the owner pick public or private; the form + validation adapt and explain the trade-off.
- [ ] A shared link binds a read-only drive with a custom name.
- [ ] Sets are browsed/imported from a drive row, not a separate page.
- [ ] The Subscribe sidebar item is gone; no add/import capability is lost.

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
| 2026-06-10 | MUZERO | Phase 4 completed: the Cloud Drive section is now four sidebar items — 我的盘(R2) (setup + owner form + connected drives), 订阅 (manifest link + preview/import), 同步与 CORS (sync progress + recommended CORS), and 在线状态 (presence toggle). One shared "Cloud Drive" card shows for any `cloud-*` item with each sub-block gated to its item. Verified each pane renders its own controls independently in the preview; en/zh/ja/ko item labels added. All four phases done. |
| 2026-06-10 | MUZERO | Phase 3 refinement: the two columns now scroll independently — the root clips overflow and each column owns its own `overflow-y-auto` with `pt-chrome-top`/`pb-chrome-bottom` clearance, so a long detail pane (e.g. owner form) scrolls without moving the sidebar. Mobile keeps a sticky horizontal nav row with the detail scrolling beneath it. Verified at desktop + mobile widths. |
| 2026-06-10 | MUZERO | Phase 5 (in progress): add-drive modal components built — `buildOwnerR2Connection` gained an optional `folder` prefix (default whole-bucket, tested), a `Stepper` UI primitive (tested), and `AddDriveDialog` (two-step: connect + validate/auto-bucket → name + save, with the folder under an Advanced collapsible) plus en/zh/ja/ko strings. Settings wiring (replace the inline owner form with the modal) is the remaining task. |
| 2026-06-10 | MUZERO | Phase 5 completed: the `cloud-owner` item's inline owner form is replaced by an "Add cloud drive" button that opens `AddDriveDialog`; the connected-drives list and setup checklist stay. Verified in the preview — modal opens with the two-step stepper, the Advanced collapsible reveals the in-bucket folder, and Next stays disabled until validation. All five phases done. |
| 2026-06-10 | MUZERO | Phase 6 (in progress): `AddDriveDialog` now has a mode switcher — "My R2" (owner keys flow) and "Shared link" (read-only: paste a public manifest/share URL → validate → name), unifying both kinds of drive into one modal. `connectReadOnlyManifest` gained an optional `label`. Verified in the preview (the shared tab shows only the URL field). Moving set browse/import onto drive rows and retiring the standalone Subscribe item are the remaining tasks. |
| 2026-06-10 | MUZERO | Phase 6 task added: the "My R2" tab will offer a public/private access-mode choice — MUZERO asks (it can't toggle the Cloudflare bucket), adapts the form (public-URL field + reachability check for public; keys + local-presign reads for private), records the mode on `CloudDrive`, and shows the trade-off hints. Anchored to R2 PRD §2.6.1. |
| 2026-06-10 | MUZERO | Phase 6 progress: new `CloudDriveSets` component browses + imports a connected drive's remote sets inline on the drive row (lazy: loads the manifest on a Browse click; imports keyed by `drive.id`). TDD'd (mocked subscribe/loadIndex/import) and mounted in `CloudDriveRow`; reuses existing i18n keys. The access-mode toggle stays deferred until local-presign reads (R2 PRD Tier ①) exist — a "private" drive isn't readable without it. Retiring the standalone Subscribe item is next. |
