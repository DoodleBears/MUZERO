# PRD: Cloud Storage Provider Abstraction + WebDAV Support

**Status:** Draft
**Created:** 2026-06-12
**Author:** MUZERO
**Module:** Sync / storage transport — extract a pluggable `CloudObjectStore` interface from the R2/S3-specific sync code (mirroring the `MusicGenProvider` registry pattern), then add WebDAV as the second storage backend so any user-supplied private cloud (Nextcloud, Synology, rclone serve, Apache mod_dav, …) can be a MUZERO cloud drive.

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Extract `CloudObjectStore` + S3 adapter (pure refactor) | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Capability model + degraded-mode policies + registry | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | WebDAV adapter | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | WebDAV drive UX (Add Drive, setup links, healthcheck UI) | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Drive-aware media source resolution (auth-required playback) | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Compatibility matrix, docs + cross-PRD alignment | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

The R2 cloud drive sync ([20260609-muzero-r2-cloud-drive-sync-prd](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md)) shipped with Cloudflare R2 (S3 API) as the only storage backend. The share-links PRD ([20260612-muzero-mu0-share-links-control-plane-prd](../20260612-muzero-mu0-share-links-control-plane-prd/20260612-muzero-mu0-share-links-control-plane-prd.md)) recorded the owner's long-term vision (§1.4, Q1): **each user supplies their own private cloud — R2 *or WebDAV-class* storage — and MUZERO is the player + sharer on top.** That PRD deliberately kept its share contracts storage-agnostic (plain HTTPS URLs) and pushed WebDAV to "a separate storage-provider PRD". This is that PRD.

**Why now, before building more on top:** a 2026-06-12 audit of the actual coupling surface shows the extraction is small and the timing is ideal:

- Only **five** non-test modules call the S3 transport directly (`r2SignedFetch` in [r2-s3.ts](../../../src/sync/r2-s3.ts)): [r2-publish.ts](../../../src/sync/r2-publish.ts), [r2-publish-base.ts](../../../src/sync/r2-publish-base.ts), [r2-healthcheck.ts](../../../src/sync/r2-healthcheck.ts), [r2-presence-sync.ts](../../../src/sync/r2-presence-sync.ts), [r2-list-buckets.ts](../../../src/sync/r2-list-buckets.ts). Everything else — export plan, merge policy, pull/import, conflict handling, search catalog, playback cache, auto-sync scheduler, mutations — is already storage-agnostic (keys + bytes + JSON) or read-side plain HTTPS.
- Write preconditions already flow as generic `{ifMatch, ifNoneMatch}` headers ([r2-publish.ts:293](../../../src/sync/r2-publish.ts) `preconditionHeaders()`); WebDAV servers speak the same RFC 7232 conditional headers, so the concurrency model ports without redesign.
- Exactly **one** UI behavior branch on storage type exists ([settings-page.tsx:1203](../../../src/pages/settings-page.tsx) `drive.provider === "r2" && drive.capabilities.write`) — the kind of scattered check CLAUDE.md rule 5 bans for musicgen providers; the registry pattern eliminates it before it multiplies.
- The share-links PRD's Phase 1 (share projection publish) will otherwise add new direct `r2SignedFetch` call sites. Landing the interface first means that PRD builds on the abstraction from day one.

The codebase already has the exact architectural template: [`MusicGenProvider`](../../../src/musicgen/provider.ts) + [registry.ts](../../../src/musicgen/registry.ts) + mock provider for tests, and the visualizer registry that copied it. This PRD applies the same pattern to storage.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Owner (R2)** | Existing R2 drive user. | Must see **zero behavior change** from the refactor (Phases 1–2 are pure extraction). |
| **Owner (WebDAV)** | User with a Nextcloud/Synology/rclone/Apache-DAV server who wants MUZERO sync without a Cloudflare account. | Add a WebDAV drive with URL + username + app password; publish/pull/auto-sync their library; stream/cache playback on their own devices. |
| **Self-hoster / homelab user** | The archetypal WebDAV owner — data never leaves hardware they control. | Same as Owner (WebDAV). |
| **Share recipients** | Unchanged from the share-links PRD. | WebDAV drives are own-devices-first; sharing from WebDAV only when the server exposes public HTTP read (see §2.5). |

### 1.3 Core Value

1. **"Any private cloud" instead of "Cloudflare only"** — directly serves the product vision: MUZERO + user-supplied storage = a personal music cloud. WebDAV is the broadest self-hosted denominator (Nextcloud, ownCloud, Synology, QNAP, rclone serve, Apache/Nginx DAV, Koofr, …).
2. **Stop the S3 coupling from spreading** — the share-links PRD and every future sync feature writes against one interface; vendor mapping is isolated in adapters exactly like `cloud-provider.ts`'s three pure functions isolate musicgen vendors.
3. **Contract-tested storage** — one shared contract test suite runs the full publish/pull/conflict scenarios against an in-memory fake plus every adapter, so a new backend can't silently break manifest-last ordering or precondition semantics.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                       ┌────────────────────────────────────────────┐
                       │  Storage-agnostic pipelines (UNCHANGED)    │
                       │  r2-export-plan / r2-publish-sync /        │
                       │  r2-pull-sync / r2-import-stream /         │
                       │  merge policy / scheduler / dirty tracking │
                       └───────────────┬────────────────────────────┘
                                       │ keys + bytes + {ifMatch, ifNoneMatch}
                                       ▼
                       ┌────────────────────────────────────────────┐
                       │  src/sync/storage/  (NEW)                  │
                       │  provider.ts   CloudObjectStore interface  │
                       │  registry.ts   getCloudObjectStore(drive)  │
                       │  capabilities  StoreCapabilities + policy  │
                       │  memory.ts     in-memory fake (tests)      │
                       └───────┬───────────────────────┬────────────┘
                               ▼                       ▼
                  ┌─────────────────────┐   ┌──────────────────────────┐
                  │ s3.ts (adapter)     │   │ webdav.ts (adapter, NEW) │
                  │ wraps r2-s3 SigV4   │   │ GET/PUT/DELETE/HEAD      │
                  │ header signing      │   │ PROPFIND / MKCOL         │
                  │ ListBuckets wizard  │   │ Basic auth (app password)│
                  └─────────┬───────────┘   └───────────┬──────────────┘
                            ▼                           ▼
                     R2 / any S3 endpoint        Nextcloud / Synology /
                     (existing)                  rclone serve / mod_dav …
                            └───────────┬───────────────┘
                                        ▼
                          getAppFetch() → desktop bridge
                          (muzfetch:// CORS-free; WebDAV is
                           desktop-first because DAV servers
                           rarely send CORS headers)
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Interface + registry** | `src/sync/storage/` — `CloudObjectStore`, `StoreCapabilities`, `getCloudObjectStore()` | Mirrors `MusicGenProvider`/`registry.ts` exactly (CLAUDE.md rule 5 discipline: no scattered `if (provider === …)`) |
| **S3 adapter** | Thin wrapper over existing [r2-s3.ts](../../../src/sync/r2-s3.ts) SigV4 | Zero rewrite of proven signing code; `r2-s3.ts` keeps its name (it *is* S3-specific) |
| **WebDAV adapter** | Plain HTTP verbs + PROPFIND/MKCOL via `getAppFetch()`; Basic auth header | RFC 4918 core only — **no LOCK/UNLOCK** (we use conditional PUT, not DAV locks) |
| **XML parsing** | Pure function `parsePropfindResponse(xml: string)` using `DOMParser` (main thread) | PROPFIND multistatus is the only XML; pure + exhaustively unit-tested; sync code already runs on the main thread (workers handle ingest, not sync) |
| **HTTP** | `getAppFetch()` everywhere (rule 5/10) | Desktop `muzfetch://` bypasses missing CORS on DAV servers; web build limited (documented) |
| **Testing** | Shared **contract test suite** parameterized over `memory` fake + both adapters (adapters tested against canned HTTP fixtures) | One suite proves manifest-last ordering, precondition semantics, retry/abort for every backend |

### 2.3 The `CloudObjectStore` Interface

```typescript
// src/sync/storage/provider.ts
export interface CloudObjectStore {
  readonly id: CloudStorageKind;                  // "s3" | "webdav"
  readonly capabilities: StoreCapabilities;        // probed at connect, cached on drive
  getObject(key: string, opts?: { signal?: AbortSignal; range?: { start: number; end?: number } }):
    Promise<{ body: Blob; etag?: string; status: number }>;
  headObject(key: string, opts?: { signal?: AbortSignal }):
    Promise<{ exists: boolean; etag?: string; size?: number }>;
  putObject(key: string, body: BodyInit, opts: {
    contentType?: string;
    precondition?: { ifMatch?: string; ifNoneMatch?: string }; // same shape r2-publish already uses
    signal?: AbortSignal;
  }): Promise<{ etag?: string }>;
  deleteObject(key: string, opts?: { signal?: AbortSignal }): Promise<void>;
}

export interface StoreCapabilities {
  conditionalPut: boolean;        // server honors If-Match/If-None-Match on PUT
  etagOnPut: boolean;             // PUT response carries a usable strong ETag
  rangeRead: boolean;             // GET honors Range (streaming/seek)
  publicReadBaseUrl?: string;     // optional anonymous-read base URL (R2 public / DAV server configured for it)
}
```

Notes:

- Keys are the **existing flat object keys** (`manifest.json`, `sets/<id>/index.json`, `objects/media/sha256-…`). The WebDAV adapter owns the mapping to collections (directories) internally — pipelines never know about MKCOL.
- The interface is deliberately minimal: the sync protocol needs get/head/put/delete + preconditions, nothing else. `r2-list-buckets.ts` (connection wizard) is S3-specific tooling and stays **outside** the interface, in the S3 adapter's realm.
- Hashing/content-addressing is storage-agnostic and untouched (sha256 keys computed in the export plan as today).

### 2.4 Capability Degradation Policy (Phase 2)

WebDAV server quality varies wildly. Capabilities are **probed once at connect** (and re-probed from drive settings on demand), persisted on the drive, and drive behavior degrades per this table — never silently:

| Missing capability | Policy |
|---|---|
| `etagOnPut` | HEAD after PUT to learn the ETag (one extra request per mutable JSON object; media objects are immutable and skip it) |
| `conditionalPut` | **Guarded single-writer mode**: pre-PUT HEAD-compare replaces If-Match (race window acknowledged); multi-device co-edit publish to this drive is disabled with a visible Settings explanation — one publishing device, others read-only. This protects the manifest-last guarantee instead of pretending optimistic concurrency works. |
| `rangeRead` | Streaming degrades to full-file blob fetch before play; Settings recommends cache mode ([r2-cache.ts](../../../src/sync/r2-cache.ts) path is unchanged) |
| `publicReadBaseUrl` absent | Drive is **own-devices only**: share-links public mode and the `mu0.app` viewer are unavailable for content on this drive (see §2.5) |

### 2.5 Interplay with the Share-Links PRD

- The share-links PRD's contracts are already URL-based and storage-agnostic (its §1.4). A WebDAV drive whose server exposes an anonymous-read base URL (`publicReadBaseUrl`) can back public-mode shares exactly like a public R2 bucket: the share projection publishes through `CloudObjectStore`, and `resolve` returns plain HTTPS URLs.
- WebDAV servers **without** public read cannot back shares in V1 (most home setups). The broker-presign path (share PRD Phase 7) is S3-only — presigned URLs are an S3 signature feature; a DAV equivalent would require proxying, which is banned. The Sharing UI simply doesn't offer share creation for tracks whose media lives only on a non-public WebDAV drive.
- **Sequencing:** share-links Phase 1 (projection publish) must consume `CloudObjectStore` — therefore **this PRD's Phase 1 lands first** (see [TODO.md](../../../TODO.md) priority order).

### 2.6 Codename / Naming Discipline

- Manifest schema ids (`muzero-r2-manifest-v1`, `muzero-r2-set-index-v1`, `muzero-r2-share-manifest-v1`, …) are **codename layer and do not change** even though they say "r2" — they describe the protocol, and renaming would orphan every existing bucket (CLAUDE.md rule 4).
- Existing `r2-*` module names stay where the content is genuinely S3-specific (`r2-s3.ts`, `r2-list-buckets.ts`, `owner-r2-connection.ts`, `r2-healthcheck.ts` S3 write probe). Storage-agnostic pipeline files also keep their names in this PRD (rename-only churn is out of scope); new code goes under `src/sync/storage/` and `webdav-*` names.
- DB name, table names, id prefixes, provider ids: unchanged. `CloudDrive.provider` union gains `"webdav"` additively.

---

## 3. Data Model Design

### 3.1 Core Concepts

```
CloudDrive (existing row)
  ├─ provider: "r2" | "webdav" | "mu0"        ← "webdav" added (additive union member)
  ├─ storageCapabilities?: StoreCapabilities  ← NEW optional field, probed at connect
  └─ capabilities (read/write/…)              ← unchanged semantic layer

AppSettings
  ├─ r2CredentialsByDriveId      (existing, untouched — codename)
  └─ webdavCredentialsByDriveId? (NEW, parallel field)

registry: (drive, credentials) ──▶ CloudObjectStore (s3 | webdav | memory-for-tests)
```

### 3.2 Database Schema

⚠️ All changes additive; Dexie version bump + `.upgrade()` backfill per CLAUDE.md data-model rule. Current schema: [muzero-db.ts](../../../src/db/muzero-db.ts), types: [types.ts](../../../src/db/types.ts).

- **`CloudDrive.provider`**: extend union `"r2" | "mu0"` → `"r2" | "webdav" | "mu0"` ([types.ts:981](../../../src/db/types.ts)). Existing rows keep `"r2"`; no migration needed.
- **`CloudDrive.storageCapabilities?: StoreCapabilities`**: NEW optional field; absent = legacy R2 defaults (`conditionalPut: true, etagOnPut: true, rangeRead: true`, public base from `publicBaseUrl`).
- **`AppSettings.webdavCredentialsByDriveId?: Record<string, WebDavCredentials>`**: NEW, parallel to the untouched `r2CredentialsByDriveId`:

```typescript
interface WebDavCredentials {
  baseUrl: string;     // e.g. https://cloud.example.com/remote.php/dav/files/anna/
  username: string;
  password: string;    // app password / token strongly recommended in UI copy
  basePath?: string;   // optional sub-collection, mirrors R2 prefix
}
```

- **Trusted-device setup link** ([cloud-drive-settings.ts](../../../src/sync/cloud-drive-settings.ts)): payload schema gains additive `storage?: "s3" | "webdav"` discriminator + a `webdavCredentials?` variant; `parseTrustedR2DriveSetupLink` stays backward-compatible (absent `storage` = s3). Link prefix `muzero://trusted-r2-drive#v1=` is codename and unchanged.
- **Rollback:** all fields optional/additive — `git revert` safe; older builds ignore unknown fields and simply don't show WebDAV drives' write capability.
- **Privacy:** WebDAV passwords follow the exact R2-secret discipline (IndexedDB settings only; never in manifests, share links, logs, exports — CLAUDE.md rule 2).

### 3.3 Data Relationship Diagram

```
AppSettings ── r2CredentialsByDriveId ───────┐
            └─ webdavCredentialsByDriveId ──┐│
                                            ▼▼
CloudDrive(provider, storageCapabilities) ──▶ registry ──▶ CloudObjectStore
                                                            ├─ s3 (SigV4)
                                                            ├─ webdav (Basic + PROPFIND/MKCOL)
                                                            └─ memory (tests only, not registered in UI)
```

---

## 4. API Design

No network API of our own — the "API" is the internal interface (§2.3) plus the WebDAV wire protocol the adapter speaks:

### 4.1 WebDAV Adapter Wire Mapping

| `CloudObjectStore` call | WebDAV request(s) |
|----------|--------|
| `getObject(key)` | `GET <base>/<encoded-key>` (+ `Range` when asked) |
| `headObject(key)` | `HEAD` (fallback `PROPFIND Depth: 0` parsing `getetag`/`getcontentlength` when HEAD is unreliable) |
| `putObject(key, …)` | `MKCOL` missing parent collections (memoized per session; `405` = already exists = success) → `PUT` with `If-Match`/`If-None-Match` when `conditionalPut` |
| `deleteObject(key)` | `DELETE` |
| connect-time probe | `OPTIONS` (DAV header) → `PROPFIND Depth: 0` → probe object `PUT`/conditional-`PUT`/`Range`-`GET`/`DELETE` cycle → fills `StoreCapabilities` |

- Key→path mapping URL-encodes each segment; content-addressed media filenames are already URL-safe.
- Auth: `Authorization: Basic` per request. Browsers block credentials-in-URL for media elements — playback never uses raw URLs for WebDAV (see Phase 5).
- All requests via `getAppFetch()`; no DAV LOCK/UNLOCK anywhere.

### 4.2 Error Handling

- **Error states:** `401/403` → credential error surfaced like R2's existing 401 policy ("never retry forever", R2 PRD §"sync failure modes"); `405 MKCOL` = exists; `412` = precondition failure → existing replan path in [r2-publish.ts:33](../../../src/sync/r2-publish.ts) `preconditionFailureKey()` (unchanged — that's the point); `507` (quota) → actionable storage-full message; XML parse failure → schema-style validation error, no partial import.
- **Probe honesty:** if the capability probe can't confirm `conditionalPut`, record `false` — degrade safely rather than corrupt (mirrors "readers never see a manifest referencing missing objects").
- **Telemetry/logging:** [logger.ts](../../../src/lib/logger.ts) only; log status codes and keys, never credentials or `Authorization` headers (redaction test included).

---

## 5. Frontend Design

### 5.1 Page Structure

```
src/components/settings/
├── add-drive-dialog.tsx        # EXTENDED: owner mode gains storage selector (R2 | WebDAV)
└── (drive row, sync controls)  # unchanged — they're capability-driven already
src/sync/storage/               # NEW (interface + adapters, §2.3)
src/sync/webdav-healthcheck.ts  # NEW probe (mirrors r2-healthcheck shape)
src/sync/webdav-connection.ts   # NEW connect flow (mirrors owner-r2-connection)
```

### 5.2 UI Components

- **Add Drive dialog** ([add-drive-dialog.tsx](../../../src/components/settings/add-drive-dialog.tsx)): "My R2" owner mode becomes "My cloud" with a storage segmented control — **R2/S3** (existing form, unchanged) | **WebDAV** (server URL, username, app password, optional folder). The guide sidebar swaps content per storage type (WebDAV guide: how to mint a Nextcloud/Synology app password; HTTPS strongly recommended, plain HTTP allowed only with explicit warning). Validation runs `webdav-healthcheck` and renders the probed capability list with plain-language consequences ("This server doesn't support safe concurrent writes — only one device should publish").
- **Drive row** ([settings-page.tsx](../../../src/pages/settings-page.tsx)): replace the lone `drive.provider === "r2"` check (:1203) with a registry-driven `driveSupportsOwnerSync(drive)` helper; add a small storage chip (R2/WebDAV) next to the kind badge; guarded single-writer mode shows a persistent informational badge.
- **Trusted setup link**: copy/paste flow unchanged; WebDAV drives produce links carrying the WebDAV variant payload.
- **i18n**: new keys under `settings.webdav*` + capability-warning strings, en → zh/ja/ko (4 locales, type-source-first).

### 5.3 State Management

No new stores. Drives/credentials stay in Dexie + settings (Dexie `useLiveQuery` reads); healthcheck/probe results via TanStack Query like existing validation; the `CloudObjectStore` instance is a module-scope non-reactive object created per sync run (rule 6: never in Zustand).

---

## 6. Implementation Plan

> TDD throughout. The **contract test suite** (Phase 1) is the backbone: every adapter must pass it before any UI work.

### Phase 1: Extract `CloudObjectStore` + S3 Adapter (pure refactor)

**Goal:** Zero-behavior-change extraction; all five S3 call sites consume the interface; contract suite + in-memory fake exist.

**Tasks:**
- [ ] `src/sync/storage/provider.ts` (interface + capability types) and `storage/memory.ts` in-memory fake store.
- [ ] Contract test suite: get/head/put/delete, `ifMatch`/`ifNoneMatch` success + 412, etag round-trip, abort signals, range read — parameterized to run against any store.
- [ ] `storage/s3.ts` adapter wrapping [r2-s3.ts](../../../src/sync/r2-s3.ts) (SigV4 code untouched); passes the contract suite against canned HTTP fixtures.
- [ ] Switch call sites to injected store: [r2-publish.ts](../../../src/sync/r2-publish.ts), [r2-publish-base.ts](../../../src/sync/r2-publish-base.ts), [r2-presence-sync.ts](../../../src/sync/r2-presence-sync.ts), [r2-healthcheck.ts](../../../src/sync/r2-healthcheck.ts) write-probe path ([r2-list-buckets.ts](../../../src/sync/r2-list-buckets.ts) stays S3-internal).
- [ ] `storage/registry.ts`: `getCloudObjectStore(drive, settings)` with `"r2"`→s3 mapping; existing sync orchestrator/scheduler construct stores via registry only.

### Phase 1 Checklist

- [ ] Full existing sync test suite passes unmodified (behavioral freeze proven).
- [ ] `grep r2SignedFetch src/sync` outside `r2-s3.ts`/`storage/s3.ts` returns nothing (non-test).
- [ ] Memory fake + S3 adapter both pass the same contract suite.
- [ ] A publish → pull round-trip integration test runs entirely against the memory store (no HTTP), proving pipelines are store-agnostic.

### Phase 2: Capability Model + Degradation Policies + Registry Hygiene

**Goal:** Capability-driven behavior replaces storage-type checks; degraded modes are implemented and visible.

**Tasks:**
- [ ] `StoreCapabilities` persisted on `CloudDrive.storageCapabilities` (Dexie bump + backfill legacy R2 defaults).
- [ ] Degradation policies per §2.4: HEAD-after-PUT etag recovery; guarded single-writer mode (HEAD-compare fallback + multi-writer co-edit disabled + Settings badge); range-less streaming fallback flag consumed by cache mode.
- [ ] Replace [settings-page.tsx:1203](../../../src/pages/settings-page.tsx) provider check with `driveSupportsOwnerSync()`; lint-guard note added to CLAUDE.md navigation (no new `provider === "…"` branches outside registry/adapters).
- [ ] Publish pipeline consumes `etagOnPut`/`conditionalPut` from the store instead of assuming S3 semantics.

### Phase 2 Checklist

- [ ] A simulated store with `conditionalPut: false` forces guarded single-writer mode and the manifest-last ordering still holds (contract test).
- [ ] A simulated store with `etagOnPut: false` still produces correct `If-Match` bases on the next publish (HEAD recovery test).
- [ ] No `provider === "r2"`-style branches remain outside `storage/` + S3-specific modules.

### Phase 3: WebDAV Adapter

**Goal:** `storage/webdav.ts` passes the contract suite against real-world server behaviors.

**Tasks:**
- [ ] `parsePropfindResponse()` pure XML parsing (namespace-tolerant: `D:`, `d:`, default-ns variants from Nextcloud/Apache/rclone fixtures) with exhaustive unit tests.
- [ ] Adapter verbs per §4.1: GET (+Range), HEAD with PROPFIND fallback, PUT with memoized recursive MKCOL, DELETE; Basic auth header injection; key→path encoding.
- [ ] Connect-time capability probe (`webdav-healthcheck.ts`): OPTIONS/PROPFIND reachability, PUT probe, conditional-PUT probe, Range probe, etag-on-PUT detection, cleanup of probe objects.
- [ ] Contract suite green against canned fixtures emulating: Nextcloud, rclone serve webdav, Apache mod_dav (including their known ETag/If-Match quirks as distinct fixture profiles).
- [ ] Credential redaction test: `Authorization` never logged.

### Phase 3 Checklist

- [ ] Contract suite passes for all three fixture profiles, with capability flags differing per profile and degradation engaging automatically.
- [ ] Publishing a library to the webdav memory-fixture creates parent collections exactly once each (MKCOL memoization verified).
- [ ] A 412 from conditional PUT surfaces through the existing `preconditionFailureKey()` replan path identically to R2.

### Phase 4: WebDAV Drive UX

**Goal:** A user can add, validate, sync, and trust-link a WebDAV drive end-to-end.

**Tasks:**
- [ ] Add Drive storage selector + WebDAV form + per-storage guide sidebar (app-password instructions; HTTP-not-HTTPS explicit warning gate).
- [ ] Validation step renders probed capabilities with plain-language consequences; failed probes give actionable fixes (mirrors `Failed CORS validation gives an actionable fix` from the R2 PRD).
- [ ] `webdavCredentialsByDriveId` settings plumbing; drive row storage chip; guarded-mode badge.
- [ ] Optional "Public base URL" field for WebDAV drives (user-entered, mirrors R2 public-URL UX); healthcheck verifies anonymous GET before accepting; result populates `StoreCapabilities.publicReadBaseUrl` (Q3).
- [ ] Web-build availability is probe-decided, not platform-hardcoded: the connect probe's CORS outcome determines whether a WebDAV server is usable in the web build (Q4).
- [ ] Trusted-device setup link v2 payload (`storage` discriminator) build/parse round-trip + backward-compat tests.
- [ ] Auto-sync scheduler + publish/pull/conflict flows verified against a WebDAV drive (integration test on memory-fixture; manual matrix in Phase 6).
- [ ] i18n en/zh/ja/ko.

### Phase 4 Checklist

- [ ] Fresh user adds a Nextcloud drive with URL + app password only, publishes a set, pulls it on a second device via trusted setup link.
- [ ] A server failing the conditional-PUT probe yields a visibly single-writer drive, and a second device's publish attempt is blocked with explanation, not corruption.
- [ ] Secrets masked in UI, absent from logs and exported diagnostics.
- [ ] Existing R2 users see no UI change beyond the storage selector defaulting to R2.

### Phase 5: Drive-Aware Media Source Resolution

**Goal:** Playback of WebDAV-hosted media, which cannot use bare URLs in media elements (Basic auth header required).

**Tasks:**
- [ ] Per-drive media source resolution: extend [track-source.ts](../../../src/lib/track-source.ts) / import path so tracks from auth-required drives resolve to a **store-fetch** source (fetch via `CloudObjectStore` → existing blob playback path, the same mechanism as "play remote R2 media through blob") instead of a raw `remoteMediaUrl`. This realizes the per-drive media-URL resolution abstraction the R2 PRD's Open Question 5 anticipated (owned→signed/authed fetch; public→open URL).
- [ ] Streaming UX: Range-capable servers stream via partial fetch into the blob/cache path; range-less servers prefetch whole file with progress (capability-driven, §2.4).
- [ ] [r2-cache.ts](../../../src/sync/r2-cache.ts) accepts a store-backed fetcher; cache/pin flows work for WebDAV tracks unchanged from the user's perspective.
- [ ] Cover/memory photo loading for WebDAV drives goes through the same resolution (covers in `useTrackCoverUrl` path resolve via store fetch + object URL with revoke discipline).

### Phase 5 Checklist

- [ ] A WebDAV-hosted track plays on desktop with playback position seeking (Range server) and with prefetch fallback (range-less server).
- [ ] No `user:pass@host` URLs anywhere; no `Authorization` leakage into media element src or object URLs.
- [ ] Covers and memory photos from a WebDAV drive render in library, dock, and Now Playing.
- [ ] Cached WebDAV tracks play offline identically to cached R2 tracks.

### Phase 6: Compatibility Matrix, Docs + Cross-PRD Alignment

**Goal:** Honest, tested server support claims; documentation; alignment notes in sibling PRDs.

**Tasks:**
- [ ] Manual compatibility matrix run + doc: Nextcloud, ownCloud, Synology, rclone serve webdav, Apache mod_dav, Caddy webdav — recording probed capabilities and any quirks (published in the PRD folder, linked from Settings guide).
- [ ] Self-host quickstart docs: recommended `rclone serve webdav` and Nextcloud app-password setups.
- [ ] Share-links PRD alignment: Sharing UI hides share creation for non-public WebDAV-only media (§2.5); share PRD §1.4 vision note updated to point here.
- [ ] R2 sync PRD change-log entry: storage abstraction landed; Open Question 5 media-resolution abstraction realized by Phase 5.
- [ ] CLAUDE.md: add storage registry to the hard-rules/navigation sections (provider boundary discipline now covers musicgen + visualizer + storage).

### Phase 6 Checklist

- [ ] Compatibility matrix documents ≥4 real servers with probe results.
- [ ] Both sibling PRDs reference this abstraction correctly (no stale "S3-only" claims).
- [ ] CLAUDE.md storage-registry rule present; `make check` green.

---

## 7. Out of Scope

- **WebDAV-backed public sharing UX beyond §2.5** — public-mode shares require server-exposed anonymous read; making arbitrary DAV servers publicly shareable (e.g., via Nextcloud share-API integration) is vendor-specific work for a future PRD.
- **Broker presign for WebDAV** — presigned URLs are an S3 signature feature; the alternative is proxying, which is banned (share PRD §2.1 invariant).
- **Other storage backends** (Google Drive API, Dropbox API, FTP/SFTP, SMB) — the interface is the extension point; each backend is its own evaluation. No speculative adapters.
- **DAV LOCK/UNLOCK based concurrency** — conditional requests only; lock semantics vary too much across servers to build correctness on.
- **Renaming `r2-*` pipeline files / manifest schema ids** — churn without user value; codename discipline (§2.6).
- **Mobile-first WebDAV polish** — desktop-first (CLAUDE.md rule 9); Tauri mobile inherits whatever the bridge fetch provides, untested this PRD.
- **Migration of existing R2 drives between storage kinds** — a drive's storage type is fixed at creation.

---

## 8. Security Considerations

- **Authentication:** WebDAV Basic auth over HTTPS; UI strongly pushes app passwords/tokens (Nextcloud/Synology) over account passwords; plain-HTTP endpoints require an explicit "I understand credentials travel unencrypted on my network" acknowledgment and are visually flagged.
- **Authorization:** the DAV account's ACL is the boundary (mirrors R2's "bucket-scoped credential" guidance — recommend a dedicated account/folder scope where the server supports it).
- **Data Protection:** `WebDavCredentials` follow R2-secret discipline exactly: IndexedDB settings only, masked in UI, never in manifests/share links/logs/diagnostics exports (redaction tests). Trusted-device setup links containing WebDAV credentials inherit the existing plaintext-bundle caveat and warning copy (same as R2 setup links today).
- **Transport:** all requests through `getAppFetch()`; desktop `muzfetch://` keeps Electron `webSecurity` intact (no CORS weakening); mixed-content (HTTPS app → HTTP DAV) only via the desktop proxy with the warning above, never silently.
- **Probe hygiene:** capability probe objects are written under the drive prefix with a reserved key and deleted afterward; probe failures never leave partial state.
- **Audit logging:** sync runs/objects recorded in existing `syncRuns`/`syncObjects` regardless of backend; no new logging surface.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [R2 Cloud Drive Sync PRD](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | The protocol this abstraction generalizes; Open Question 5 (media-URL resolution) realized by Phase 5 |
| [mu0 Share Links + Control Plane PRD](../20260612-muzero-mu0-share-links-control-plane-prd/20260612-muzero-mu0-share-links-control-plane-prd.md) | Downstream consumer: its Phase 1 publishes via `CloudObjectStore`; §2.5 here defines WebDAV share limits |
| [TODO.md](../../../TODO.md) | Cross-PRD implementation priority order |
| [prd-template.md](../prd-template.md) | Template |

---

## 10. Open Questions

All four resolved by the owner on 2026-06-12.

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should the contract suite run against a real WebDAV server in CI, or fixtures only? | Resolved (2026-06-12) | No CI infrastructure for real servers for now — automated tests use fixtures only (Vitest, canned server-profile fixtures); the real-server compatibility matrix is **manual testing** (Phase 6). No CI server spawning. |
| 2 | Guarded single-writer mode: hard-block second-device publish, or allow with a scary confirm? | Resolved (2026-06-12) | Long-term best practice: **hard-block** — correctness over convenience; a confirm dialog invites the exact corruption the mode exists to prevent. Second device's publish is blocked with a clear explanation; reads stay available. |
| 3 | `publicReadBaseUrl` for WebDAV: user-entered with probe-verify? | Resolved (2026-06-12) | Yes — mirror the R2 public-URL UX: optional user-entered field, healthcheck verifies anonymous GET before accepting, result populates `StoreCapabilities.publicReadBaseUrl` (Phase 4 task added). |
| 4 | Web (non-desktop) build support for WebDAV given missing CORS on most DAV servers? | Resolved (2026-06-12) | Long-term best practice: **capability-probe-decided, not platform-hardcoded** — the connect probe runs in whatever shell the app is in; if the server sends usable CORS, the web build works, otherwise WebDAV is presented as desktop-only for that server. No `isTauri()`-style platform branches (CLAUDE.md rule 10 spirit). |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | MUZERO | All 4 open questions resolved by owner: fixtures-only automated tests + manual real-server matrix (Q1), hard-block guarded single-writer (Q2), user-entered + probe-verified WebDAV public base URL (Q3, Phase 4 task added), capability-probe-decided web-build availability instead of platform hardcoding (Q4, Phase 4 task added). |
| 2026-06-12 | MUZERO | Initial draft. Coupling audit: only 5 modules touch `r2SignedFetch`; preconditions already generic `{ifMatch, ifNoneMatch}`; 1 UI provider branch. Designed `CloudObjectStore` + registry (mirrors MusicGenProvider pattern), capability probe + degradation policies (guarded single-writer for non-conditional-PUT servers), WebDAV adapter (PROPFIND/MKCOL, Basic auth, no LOCK), drive-aware media resolution for auth-required playback (realizes R2 PRD OQ5), 6 phases with contract-test backbone. Sequenced before share-links PRD Phase 1 (see TODO.md). |
