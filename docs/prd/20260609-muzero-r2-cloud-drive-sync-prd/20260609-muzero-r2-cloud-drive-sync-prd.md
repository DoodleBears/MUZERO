# PRD: MUZERO — User-Owned R2 Cloud Drive Sync

**Status:** Draft
**Created:** 2026-06-09
**Author:** MUZERO
**Module:** Sync / Sharing — Cloudflare R2 as user-owned cloud drive

> This PRD records the decision to pursue **方案 A: R2 Setup Wizard** first. MUZERO remains fully local-first and usable offline. Cloud sync is an optional, visible user-configured feature where the user owns the Cloudflare R2 bucket, public read URL, and write credentials. MUZERO provides a manifest format, setup checklist, validation, sync engine, progress UI, and conflict rules. In the V1 R2-only scope, MUZERO does **not** host user music, proxy media, manage accounts, or operate a backend. The optional `mu0.app` Worker/D1 control plane is explicitly a later V3 layer.

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Manifest protocol + read-only subscription | 🔄 In Progress | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | R2 Setup Wizard + connection validation | ✅ Done | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Local-to-cloud publish sync with visible progress | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Cloud-to-local pull sync + conflict handling | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Anonymous device registry + playback stats sync | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Optional low-frequency currently-playing presence | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO is local-first: tracks, sets, memories, settings, media bytes, and playback runtime live in the device-local `muzero-db`. This gives privacy and resilience, but creates a new user need:

1. A user wants a personal "cloud drive" for MUZERO music without signing up for a MUZERO cloud service.
2. A user wants to share a set by sending one link, so other MUZERO instances can load the playlist and stream or cache the media.
3. A user wants to move between browser, Tauri desktop, Electron preview, and other machines while keeping sets, uploaded audio/video, covers, memories, and playback statistics in sync.

Cloudflare R2 is a good fit because it can expose public read URLs for objects, supports S3-compatible writes, and can be managed by the user. The important product boundary: **R2 is storage only**. There is no R2 directory listing dependency, no MUZERO server, and no hidden backend flag.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Local listener** | Uses MUZERO without cloud. | Full local playback and library management; no R2 needed. |
| **Cloud drive owner** | Owns a Cloudflare R2 bucket and wants to publish/sync sets. | Reads/writes their configured R2 prefix using local credentials. |
| **Shared-link listener** | Receives a MUZERO R2 manifest link from someone else. | Read-only subscribe, stream, and optional local cache; no write access. |
| **Multi-device user** | Uses browser/desktop on multiple machines. | Pulls remote changes and pushes local changes from devices that have write credentials. |

### 1.3 Core Value

1. **Local-first remains true**: MUZERO works fully offline and locally before any sync is configured.
2. **User-owned cloud drive**: users bring their own R2 bucket; MUZERO stores no user media.
3. **One-link sharing**: a public `manifest.json` link is enough to subscribe to a playlist/set.
4. **Bidirectional sync**: local sets can publish to R2, and remote R2 manifests can update local IndexedDB.
5. **Complete media sync**: audio, video, covers, memory photos, set covers, and metadata sync together.
6. **Visible trust**: sync progress, pending writes, errors, skipped files, and conflicts are shown in the UI.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
┌──────────────────────────────────────────────┐
│ MUZERO app: browser / Tauri / Electron        │
│                                              │
│  IndexedDB `muzero-db`                       │
│  tracks · mediaBlobs · sessions · memories   │
│  settings · playQueue · chatSessions         │
│        │                                     │
│        │ local read/write is always available │
│        ▼                                     │
│  Sync Engine                                 │
│  - export local manifest/index/media         │
│  - import remote manifest/index/media        │
│  - progress + conflict model                 │
│        │                                     │
│        ├── public read: GET manifest/index/media URLs
│        │
│        └── owner write: S3-compatible PUT/HEAD/DELETE
│                                              │
└──────────────────────────────────────────────┘
                       │
                       ▼
        User-owned Cloudflare R2 bucket
        ┌───────────────────────────────────┐
        │ /muzero/manifest.json             │
        │ /muzero/sets/<setId>/index.json   │
        │ /muzero/sets/<setId>/media/*      │
        │ /muzero/sets/<setId>/covers/*     │
        │ /muzero/sets/<setId>/memories/*   │
        │ /muzero/profiles/devices/*        │
        │ /muzero/stats/devices/*           │
        │ /muzero/presence/devices/*        │
        └───────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Frontend** | Vite + React + TypeScript | Current MUZERO app shell; browser/desktop share the same code path. |
| **Local database** | Dexie / IndexedDB `muzero-db` | Existing local-first store. |
| **Cloud storage** | User-owned Cloudflare R2 | Object storage only; no MUZERO backend. |
| **Remote read** | Public R2 URL or custom domain | One-link share and subscribe. |
| **Remote write** | R2 S3-compatible API with user-provided credentials | Enables local-to-cloud publish without a server. |
| **HTTP** | `getAppFetch()` in Tauri, browser `fetch` fallback | Desktop can use Tauri HTTP; browser requires correct R2 CORS. |
| **Validation** | Zod schemas | Manifest/index/stats must be schema-validated before import. |

### 2.3 R2-Only Best Practices

1. **Do not rely on bucket listing**: public R2 buckets do not provide a filesystem-like folder listing for app logic. MUZERO must use `manifest.json` and per-set `index.json` as the only remote index.
2. **Manifest is the contract**: every readable object is discoverable from manifest/index, not by scanning a bucket root.
3. **Content-address large files**: media object names include stable hashes when possible to avoid duplicate uploads and make cache validation cheap.
4. **Atomic publish**: upload media and per-set indexes first, then write the root `manifest.json` last. Readers only see a new version after all referenced objects exist.
5. **Use ETag/sha256/bytes for diff**: sync should skip unchanged objects and show exact pending transfer size.
6. **Public read, explicit write**: shared listeners only need a manifest URL; publishing requires visible user-owned R2 credentials in Settings.
7. **CORS is part of setup**: browser read/write requires CORS on the R2 bucket/custom domain. The wizard validates this before enabling sync.
8. **No secret in URLs/logs**: Access Key / Secret Key never appear in manifest, share links, logs, or exported debug bundles.

### 2.4 R2 Write Capability Boundary

There are two different audiences for the same R2 URL:

| Audience | Has only public manifest/media URL | Has owner/trusted R2 write credentials |
|----------|------------------------------------|----------------------------------------|
| Can read/play shared sets | ✅ | ✅ |
| Can cache locally | ✅ | ✅ |
| Can record private local stats | ✅ | ✅ |
| Can push stats/presence back to the shared R2 bucket | ❌ | ✅ |
| Can publish/update sets | ❌ | ✅ |

This is a hard product boundary for the **R2-only** approach. A public R2 URL is enough for anonymous listening, but it is not enough for anonymous users to write their own play stats or currently-playing state back to the owner's bucket. MUZERO must not ask owners to share R2 write credentials with the public.

Therefore:

- Public shared-link listeners get local-only per-device stats by default.
- Owner/trusted devices with configured R2 credentials can sync stats and presence to the shared R2 bucket.
- Anonymous listener stats/presence flowing back to the owner from read-only public links requires a future write broker, such as a user-deployed Worker with scoped upload endpoints or presigned URL issuance. That is explicitly out of scope for this PRD because it is no longer "only R2 link".

### 2.5 Write Credential Control

Public R2 access and write credentials are separate products in the MUZERO UX:

1. **Public Base URL / Manifest URL**
   Safe to share. Grants read access to `manifest.json`, set indexes, media, covers, and other objects intentionally published by the owner.

2. **Owner Write Credentials**
   Never safe to share publicly. Stored only on devices the owner trusts. Required for publish, push sync, remote stats writeback, and presence writeback.

Credential rules:

- Write credentials are entered only in Settings > Cloud Drive.
- Write credentials are never embedded in manifest/index/stats/presence JSON.
- Write credentials are never copied into share links.
- Write credentials are never logged.
- Use a dedicated MUZERO R2 bucket, not an account-wide media bucket.
- Prefer the narrowest Cloudflare/R2 token possible for the bucket. If the platform cannot scope narrowly enough for the desired public/trusted split, use a future Worker broker instead of sharing broad credentials.
- Treat browser owner-sync as a convenience mode with explicit warning: the credential lives in that browser profile's IndexedDB. Desktop should be recommended for long-lived trusted sync.
- Provide a "Remove write credentials from this device" action.
- Provide a "Rotate credentials" checklist in Settings docs; after rotation, devices with old credentials become read-only until updated.

Recommended modes:

| Mode | User input | Can read | Can write | Typical use |
|------|------------|----------|-----------|-------------|
| **Subscribe** | Manifest/public URL only | ✅ | ❌ | Friend opens a shared playlist. |
| **Owner sync** | Public URL + R2 write credentials | ✅ | ✅ | User's own trusted devices sync both directions. |
| **Trusted collaborator** | Public URL + owner-created restricted credentials | ✅ | ✅ | Small private group; owner accepts that collaborator can write. |

Important non-goal: MUZERO must not provide a UI that encourages owners to paste their write credentials into a public web page for other listeners to reuse. Anonymous public writeback needs a separate broker design.

### 2.6 Invite URLs and Permission Management

The desired UX is: "owner clicks Share Write Access, MUZERO creates a URL, another user enters it and gains permission." This is **not safely achievable with public R2 alone**.

Reason:

- A public R2 URL grants read only.
- R2 write access is controlled by credentials or signed requests.
- If MUZERO puts credentials directly into an invite URL, that URL becomes a bearer secret: anyone who obtains it can write until the credential is revoked.
- If MUZERO wants short-lived, revocable, per-device write grants, some trusted signer must exist to mint and validate those grants.

Supported permission models:

| Model | Requires MUZERO backend | Requires user-deployed broker | Can issue invite URL in MUZERO UI | Revocable per invite | Suitable for |
|-------|--------------------------|-------------------------------|-----------------------------------|----------------------|--------------|
| Public subscribe link | ❌ | ❌ | ✅ | N/A read-only | Public listening/sharing |
| Manual trusted credentials | ❌ | ❌ | ⚠️ Only by pasting a credential bundle | Only by rotating/deleting credentials in Cloudflare | Owner devices / very trusted collaborator |
| Presigned object URLs | ❌ | ⚠️ signer must be owner device or broker | ⚠️ Limited, operation-specific | Expires automatically | One-off upload/download, not general sync |
| User-deployed Worker broker | ❌ | ✅ | ✅ | ✅ | Self-hosted version of the hosted broker |
| MUZERO hosted control plane | ✅ | ❌ | ✅ | ✅ | Easy invites, presence writeback, anonymous contributions |

Therefore v1 must expose only two safe UI flows:

1. **Share read-only link**
   Generates/copies the public `manifest.json` URL. Anyone can subscribe and play. No writeback.

2. **Add trusted device**
   Helps the owner copy the R2 connection settings into another device they personally control. The UI must label this as trusted-device setup, not public sharing. The invite/export should be encrypted with a user-entered passphrase if bundled, and should expire locally where possible, but it is still effectively credential transfer.

Roadmap decision:

- **V1: R2-only protocol and owner sync** ships first.
- **V3: `mu0.app` hosted control plane** should be built as the primary permission/invite UX after V1.
- **V2: self-hosted drive broker** becomes a deployment target of the same open-source Worker/backend code used by V3. Once V1 protocols and V3 broker contracts exist, self-hosting is mostly "clone the repo, configure Cloudflare bindings, deploy" plus documentation and templates.

This means V2 should not block V3. Building V3 well gives open-source users the code they need to self-deploy the same capability under their own Cloudflare account.

Owner terminology:

| Term | Phase | Meaning | Requires `mu0.app` D1 / backend |
|------|-------|---------|----------------------------------|
| **Local Owner Mode** | V1 | A local MUZERO install has the user's R2 public URL plus R2 write credentials in local Settings. It can publish, push, pull, and generate read-only share links. | ❌ |
| **Hosted Owner Account** | V3 | An owner signs in to `mu0.app`; `api.mu0.app` stores drive records, owner devices, invites, grants, revocation state, and audit history in D1/KV. | ✅ |

Therefore V1 does **not** deploy or require a Cloudflare D1 database controlled by MUZERO. V1's "owner" is a local capability. The moment MUZERO stores "owner gave this R2 link to these people with these permissions" in a database, that is the V3 hosted control plane.

The shared V2/V3 broker flow:

- Worker has an R2 binding or scoped access to the user's R2 and stores invite grants.
- Owner's MUZERO UI calls the broker to create an invite token.
- Invite URL contains only a scoped token, not raw R2 credentials.
- Collaborator pastes URL; broker validates token and allows only scoped operations, such as reading a specific share projection, stats/presence writeback for that share, or upload to a specific set/share.
- Owner can revoke invite tokens from MUZERO UI.

### 2.7 Optional MUZERO Hosted Control Plane

MUZERO is open source and users can self-host the app and any future drive broker. Separately, the available product domain is currently `mu0.app` (`0` = zero), which can offer an **optional hosted Worker backend** to make R2 binding, owner setup, and invite management easier for non-technical users.

Brand/domain rule:

- Product name remains **MUZERO**.
- Public app/site domain can be **`mu0.app`**.
- Hosted API examples should use **`api.mu0.app`**.
- Share/invite URLs can use **`mu0.app/invite/...`** or app deep links that resolve through `mu0.app`.
- Do not rename codename-layer storage such as `muzero-db`, table names, id prefixes, manifest schemas, or provider ids.

This would change MUZERO's product boundary from "no backend" to:

> Core playback and storage remain local-first and user-owned. `mu0.app` may provide an optional control plane for setup, permissions, and invite tokens. Media bytes still live in the user's R2 bucket and should not be proxied through MUZERO by default.

Recommended hosted architecture:

```text
MUZERO App
  ├─ local IndexedDB remains source of local truth
  ├─ reads media directly from user's R2 public/custom domain
  └─ calls api.mu0.app only for optional setup/invite control

api.mu0.app Worker
  ├─ D1: users, drives, devices, invites, grants, audit log
  ├─ KV: short-lived invite/session/cache records
  ├─ Secrets: MUZERO service secrets only
  └─ optional encrypted user R2 credential vault (only if absolutely necessary)

User-owned R2
  ├─ manifest/index/media/stats/presence objects
  └─ remains the data plane
```

Hosted control plane responsibilities:

- Create and manage drive records: public base URL, manifest URL, bucket metadata, owner devices.
- Validate R2 setup from the app: public read, CORS, manifest presence, optional write test.
- Issue scoped invite URLs without exposing raw R2 credentials.
- Store collaborator grants against `driveId`, `shareId`, and optional per-track scopes: read-only, stats-only, presence-only, set-upload, owner.
- Provide revocation and audit history.
- Optionally mint short-lived presigned upload URLs or accept small metadata writes.

Hosted control plane should avoid:

- Proxying audio/video playback by default.
- Storing user media bytes.
- Requiring a MUZERO account for local/offline playback.
- Making hosted sync the only path; self-host and pure R2-only modes must remain available.

Credential handling options:

| Option | Hosted backend stores user R2 secret? | UX | Risk | Recommendation |
|--------|----------------------------------------|----|------|----------------|
| User-deployed Worker with R2 binding | No | More setup | Lowest trust burden | Best privacy / open-source default |
| Hosted backend stores encrypted R2 key | Yes | Easiest | MUZERO becomes secret custodian | Only if we accept backend/security obligations |
| Owner device signs/presigns locally | No | Owner device must be online for invites/uploads | Awkward | Useful for small peer workflows |
| Hosted backend only stores grants, user Worker performs writes | No | Requires user Worker | Strong | Best scalable compromise |

If `mu0.app` offers hosted setup, the safest hosted path is:

1. User still creates/owns R2.
2. User pastes public URL and a write credential into their local app.
3. App validates and uploads manifest/media directly.
4. Hosted Worker stores drive metadata and invite grants only.
5. For collaborator writeback, either:
   - require a user-deployed drive Worker; or
   - explicitly opt in to MUZERO-hosted credential vault/presigned upload service, with clear security wording.

This hosted control plane should be a separate PRD before implementation because it introduces accounts/auth, D1 schema, secret custody decisions, abuse controls, rate limits, and operational responsibilities.

Self-host packaging implication:

- The hosted Worker/backend code must live in the open-source repo.
- Deployment configuration must be parameterized for `api.mu0.app` hosted mode and user-owned self-host mode.
- Avoid dependencies on private MUZERO infrastructure unless guarded behind explicit hosted-only config.
- Provide a future `Deploy to Cloudflare` button and a manual `wrangler deploy` path, but after the broker API is stable.

### 2.8 Architectural Review Notes

This PRD has three boundaries that must stay consistent during implementation:

1. **V1 is R2-only storage, not an authorization backend**
   V1 can read public manifests and write with locally stored owner/trusted credentials. It cannot safely mint revocable public write invite URLs, cannot accept anonymous public writeback, and cannot store owner/share/grant state in MUZERO D1. Those belong to V3 `mu0.app` or the self-hosted V2 broker package.

2. **Object storage is not a transactional database**
   R2 has no row locks, multi-object transactions, server-side conflict resolution, or realtime query layer. MUZERO must avoid designs where many devices rewrite the same `stats/index.json`, `devices/index.json`, or `presence/index.json` on every local change. Shared indexes are owner-published catalog artifacts; per-device objects are the write source of truth.

3. **Identity is attribution, not authentication**
   `devicePublicId`, display name, and avatar make memories/stats/presence understandable to humans. They do not prove account ownership and must not be used as a security boundary. Write permission comes only from R2 credentials in V1, or scoped broker grants in V2/V3.

Pitfalls to avoid:

- Putting R2 write credentials into share URLs or manifests.
- Treating public R2 URLs as write-capable cloud drives.
- Letting two devices write the same object key except through an explicit owner-only publish path.
- Updating avatar/profile metadata by rewriting every memory that references the device.
- Assuming remote deletes are safe to apply locally without user review.
- Assuming presence can be realtime because reads/writes are "just JSON".
- Publishing private notes, lyrics, generated prompts, or photos by default without an explicit set/share projection review.

### 2.9 Project Structure

```text
src/
├── sync/
│   ├── r2-manifest-schema.ts       # Zod schemas for manifest/index/stats
│   ├── r2-url.ts                   # link normalization + relative URL resolution
│   ├── r2-client.ts                # public GET + S3-compatible write adapter
│   ├── sync-engine.ts              # local↔remote diff/apply orchestration
│   ├── sync-progress.ts            # progress model and event stream
│   └── sync-conflicts.ts           # conflict detection/resolution helpers
├── db/
│   ├── types.ts                    # cloud config, devices, stats, sync rows
│   ├── muzero-db.ts                # next schema version
│   └── repositories.ts             # sync/device/stats repos
├── pages/settings-page.tsx         # Cloud Drive setup section
└── components/sync/
    ├── r2-setup-wizard.tsx
    ├── sync-status-panel.tsx
    └── sync-progress-list.tsx
```

> New files are justified because this is a new protocol and adapter boundary. Existing DB/repository/settings patterns must be reused; avoid scattering `if (r2)` logic through player, DJ, or media components.

---

## 3. Data Model Design

### 3.1 Core Concepts

```text
AppSettings
  └── cloudDrive config (optional; local only)

CloudDrive[]
  ├── My drives: R2 locations the user owns or can write
  └── Shared with me: read-only or granted shares from others

Device
  └── identifies this local install/profile for sync attribution

DjSession(Set)
  ├── Track[]             metadata
  ├── Memory[]            note/photo timeline
  └── MediaBlob[]         audio/video/cover/memory photos/set cover

Remote Manifest
  ├── folder indexes
  ├── remote object refs
  ├── device snapshots
  └── playback stat snapshots
```

### 3.1.1 Multi-Drive Product Model

The UX should be closer to a music-focused Google Drive than a single hardcoded R2 bucket. A user may have:

- one personal R2 drive for their own MUZERO library
- a second R2 drive for experiments or generated music
- many read-only shared playlists from friends
- trusted collaborator access to a private group drive
- future `mu0.app` hosted-control-plane shares

Local navigation model:

```text
Cloud
├── My Drives
│   ├── Personal R2
│   ├── Studio R2
│   └── Family Drive
├── Shared With Me
│   ├── Tokyo Night Drive by A
│   ├── Workout Clips by B
│   └── MV Set by C
└── Local Only
    ├── Unsynced sets
    └── Private uploads
```

Each drive/share has its own sync settings, cached search catalog, permissions, and conflict state. Global search can search across all connected drives and local-only data.

Local data model additions:

```ts
export interface CloudDrive {
  id: string; // newId("drv")
  label: string;
  kind: "owned" | "trusted" | "shared" | "local-only";
  provider: "r2" | "mu0";
  publicBaseUrl?: string;
  manifestUrl?: string;
  apiBaseUrl?: string; // e.g. https://api.mu0.app for hosted control plane
  capabilities: {
    read: boolean;
    write: boolean;
    manageInvites: boolean;
    writeStats: boolean;
    writePresence: boolean;
  };
  createdAt: number;
  updatedAt: number;
  lastSyncedAt?: number;
}

export interface CloudShare {
  id: string; // newId("shr") locally, may map to remote shareId
  driveId: string;
  remoteShareId: string;
  label: string;
  sourceOwnerName?: string;
  manifestUrl: string;
  access: "read-only" | "stats" | "presence" | "collaborator" | "owner";
  addedAt: number;
  lastSyncedAt?: number;
}
```

Suggested stores:

```ts
cloudDrives: "id, kind, provider, updatedAt, lastSyncedAt"
cloudShares: "id, driveId, remoteShareId, access, lastSyncedAt"
```

Rules:

- `AppSettings.cloudDrive` should evolve into a default selected drive pointer plus per-device credential storage, not a single global cloud.
- Read-only shared links become `CloudShare` rows.
- Owner/trusted R2 configurations become `CloudDrive` rows.
- Search catalog rows include `driveId` and optional `shareId`.
- A local `Track` imported from a remote share may remain remote-scoped until the user explicitly saves/caches/imports it into their own library.

### 3.2 Current Schema

Current local data is defined in:

- `src/db/types.ts`
- `src/db/muzero-db.ts`
- `src/db/repositories.ts`

Relevant existing structures:

- `Track`: includes `kind`, `origin`, `durationSec`, `blobId`, `coverBlobId`, `tags`, `playCount`.
- `MediaBlob`: stores bytes with `role: "media" | "cover" | "background" | "gallery" | "memory"`.
- `DjSession`: stores set metadata and `trackIds`.
- `Memory`: stores memory notes and optional `photoBlobId`.
- `AppSettings`: stores local-only BYOK-style settings.

### 3.3 Required Local Schema Changes

Add a next Dexie schema version after the current version.

```ts
export interface CloudDriveConfig {
  provider: "r2";
  enabled: boolean;
  /** Public base link, e.g. https://music.example.com/muzero/ */
  publicBaseUrl?: string;
  /** Optional direct manifest URL. If set, it wins over publicBaseUrl + manifest.json. */
  manifestUrl?: string;
  /** S3-compatible endpoint: https://<accountId>.r2.cloudflarestorage.com */
  s3Endpoint?: string;
  bucket?: string;
  prefix?: string; // default "muzero/"
  accessKeyId?: string;
  secretAccessKey?: string;
  /** User-visible mode: read-only subscribe vs bidirectional owner sync. */
  mode: "subscribe" | "owner-sync";
  lastValidatedAt?: number;
}

export interface DeviceRecord {
  id: string; // newId("dev")
  /**
   * Anonymous per-install public id. Generated locally and stable for this
   * browser profile / desktop install. It is not derived from hardware IDs,
   * account data, IP, or user agent.
   */
  publicId: string; // random 128-bit url-safe id, e.g. "dvc_..."
  /** Optional user-visible nickname; defaults to a generic local name. */
  name: string;
  /** Optional short color/avatar seed for attribution chips. */
  avatarSeed?: string;
  /** Optional avatar image blob, stored in mediaBlobs role "avatar" or a future profileBlobs table. */
  avatarBlobId?: string;
  platform: "browser" | "tauri" | "electron";
  userAgent?: string;
  os?: string;
  appVersion: string;
  /** Local secret used to sign this device's own public stats/presence object. Never synced. */
  localSigningSecret?: string;
  /** Whether this device profile should be published to connected owner/trusted drives. */
  publishProfile: boolean;
  createdAt: number;
  lastSeenAt: number;
}

export interface DevicePublicProfile {
  schema: "muzero-r2-device-profile-v1";
  devicePublicId: string;
  displayName: string;
  avatarSeed?: string;
  avatar?: {
    url: string;
    mime: string;
    bytes: number;
    sha256?: string;
  };
  appVersion?: string;
  updatedAt: number;
}

export interface TrackPlaybackStats {
  id: string; // `${devicePublicId}:${trackId}`
  /** Public anonymous device id, safe to sync. */
  devicePublicId: string;
  trackId: string;
  playCount: number;
  listenedSec: number;
  lastPlayedAt?: number;
  updatedAt: number;
}

export interface PlaybackEvent {
  id: string; // newId("ple")
  devicePublicId: string;
  /** Local canonical track id if this track is imported into the user's library. */
  trackId?: string;
  /** Remote identity for a track played from a connected drive/share. */
  remoteTrackRef?: {
    driveId: string;
    shareId?: string;
    setId?: string;
    trackId: string;
    mediaSha256?: string;
  };
  /** The context where the listen happened. */
  context: {
    source: "local" | "owned-drive" | "shared-drive" | "share";
    driveId?: string;
    shareId?: string;
    setId?: string;
    queueEntryId?: string;
  };
  startedAt: number;
  endedAt?: number;
  listenedSec: number;
  countedAsPlay: boolean;
}

export interface MemoryAuthorRef {
  devicePublicId: string;
  displayName?: string;
  avatarSeed?: string;
  avatarUrl?: string;
}

export interface PlaybackAggregate {
  id: string; // stable aggregate key
  devicePublicId: string;
  scope: "track" | "track-in-set" | "track-in-share" | "set" | "share" | "drive";
  driveId?: string;
  shareId?: string;
  setId?: string;
  trackId?: string;
  remoteTrackId?: string;
  mediaSha256?: string;
  playCount: number;
  listenedSec: number;
  lastPlayedAt?: number;
  updatedAt: number;
}

export interface NowPlayingPresence {
  id: string; // devicePublicId
  devicePublicId: string;
  deviceName?: string;
  trackId?: string;
  setId?: string;
  state: "playing" | "paused" | "stopped";
  positionSec?: number;
  updatedAt: number;
  /** Readers ignore records older than the TTL. */
  expiresAt: number;
}

export interface SyncRemoteObject {
  id: string; // remote key or object id
  localBlobId?: string;
  remoteKey: string;
  sha256?: string;
  bytes: number;
  role: MediaBlob["role"];
  updatedAt: number;
}

export interface SyncRun {
  id: string; // newId("syn")
  direction: "push" | "pull";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  phase: "plan" | "upload" | "download" | "index" | "manifest" | "apply";
  totalBytes: number;
  completedBytes: number;
  totalObjects: number;
  completedObjects: number;
  currentObject?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface SyncMutation {
  id: string; // newId("mut")
  driveId: string;
  devicePublicId: string;
  scope: "set" | "track" | "memory" | "profile" | "stats";
  entityId: string;
  action:
    | "set-metadata-updated"
    | "track-added-to-set"
    | "track-removed-from-set"
    | "track-metadata-updated"
    | "memory-added"
    | "memory-updated"
    | "memory-removed"
    | "profile-updated"
    | "stats-segment-published";
  /**
   * Remote object version observed before this mutation was planned.
   * Used for three-way merge and stale-write detection.
   */
  base?: {
    remoteKey: string;
    etag?: string;
    revision?: number;
    updatedAt?: number;
  };
  payload: unknown;
  createdAt: number;
  syncedAt?: number;
}
```

Dexie stores:

```ts
devices: "id, lastSeenAt"
trackPlaybackStats: "id, trackId, devicePublicId, updatedAt, [trackId+devicePublicId]"
playbackEvents: "id, devicePublicId, startedAt, trackId, [devicePublicId+startedAt]"
playbackAggregates: "id, devicePublicId, scope, driveId, shareId, setId, trackId, updatedAt"
syncMutations: "id, driveId, devicePublicId, scope, entityId, createdAt, syncedAt"
syncObjects: "id, localBlobId, remoteKey, sha256"
syncRuns: "id, status, startedAt"
```

`AppSettings` gains optional `cloudDrive?: CloudDriveConfig`. Credentials remain device-local only. They are not synced.

### 3.4 Remote Manifest Format

Root object:

```json
{
  "schema": "muzero-r2-manifest-v1",
  "libraryId": "lib_abc",
  "title": "Doodlebear's MUZERO Drive",
  "createdAt": "2026-06-09T00:00:00.000Z",
  "updatedAt": "2026-06-09T00:00:00.000Z",
  "baseUrl": "https://music.example.com/muzero/",
  "sets": [
    {
      "id": "ses_tokyo",
      "title": "Tokyo Night Drive",
      "index": "sets/ses_tokyo/index.json",
      "updatedAt": "2026-06-09T00:00:00.000Z",
      "trackCount": 24,
      "bytes": 1840123123
    }
  ],
  "devicesIndex": "devices/index.json",
  "statsIndex": "stats/index.json",
  "presenceIndex": "presence/index.json"
}
```

`devicesIndex`, `statsIndex`, and `presenceIndex` are optional owner-maintained discovery indexes. They make large drives cheaper to browse, but readers must still tolerate missing or stale indexes and fall back to per-set/profile/stat references already present in manifests and share indexes.

### 3.4.1 Share Manifest and Set-Level Projection

Access control must work at the **set/share** level, not only at the whole-library level. A track can appear in multiple local sets, and a user may want to share only:

- one set
- a subset of tracks inside one set
- metadata without all memories/photos
- media streaming but not original upload metadata

Therefore MUZERO must distinguish:

1. **Canonical local entities**
   Local `Track`, `DjSession`, `Memory`, and `MediaBlob` rows are the owner's private source of truth.

2. **Remote share projection**
   A share manifest is a filtered view generated from the local source of truth. It can include the same track in multiple shares without exposing every set that contains that track.

Share manifest example:

```json
{
  "schema": "muzero-r2-share-manifest-v1",
  "shareId": "shr_tokyo_public",
  "title": "Tokyo Night Drive - selected tracks",
  "createdAt": "2026-06-09T00:00:00.000Z",
  "updatedAt": "2026-06-09T00:00:00.000Z",
  "baseUrl": "https://music.example.com/muzero/",
  "sourceSetId": "ses_tokyo",
  "index": "shares/shr_tokyo_public/index.json",
  "capabilities": {
    "readMedia": true,
    "readMemories": false,
    "writeStats": false,
    "writePresence": false
  }
}
```

Share index example:

```json
{
  "schema": "muzero-r2-share-index-v1",
  "shareId": "shr_tokyo_public",
  "sourceSetId": "ses_tokyo",
  "tracks": [
    {
      "id": "trk_blue",
      "shareTrackId": "shrtrk_1",
      "title": "Blue Highway",
      "kind": "audio",
      "durationSec": 214,
      "tags": ["night", "drive"],
      "media": {
        "url": "objects/media/trk_blue-1d8f.mp3",
        "mime": "audio/mpeg",
        "bytes": 8241123,
        "sha256": "..."
      }
    }
  ]
}
```

Projection rules:

- Sharing a set does not imply sharing the whole library manifest.
- Sharing a subset does not imply sharing every track in that set.
- A shared `track.id` may be stable when the owner wants cross-share identity, or replaced with a `shareTrackId` when privacy requires hiding canonical ids.
- The projection controls whether tags, notes, memories, cover photos, generated `TrackBrief`, and provider provenance are included.
- Media objects can be content-addressed and reused across shares, but indexes must not reveal other sets that reference the same object.
- In V1, share links are read-only projections.
- In V3, access grants attach to a `shareId`, not only to the whole drive.

### 3.4.2 Remote Search Catalog and Local Search Index

R2 should not be queried object-by-object during search. For large drives, MUZERO must sync a **search catalog** from R2 into local IndexedDB, then run global search locally.

Remote objects:

```text
/muzero/catalog/library.json
/muzero/catalog/sets-page-0001.json
/muzero/catalog/tracks-page-0001.json
/muzero/catalog/shares-page-0001.json
/muzero/catalog/tags.json
```

`catalog/library.json`:

```json
{
  "schema": "muzero-r2-search-catalog-v1",
  "libraryId": "lib_abc",
  "updatedAt": "2026-06-09T00:00:00.000Z",
  "locale": "en",
  "pages": {
    "sets": ["catalog/sets-page-0001.json"],
    "tracks": ["catalog/tracks-page-0001.json"],
    "shares": ["catalog/shares-page-0001.json"]
  },
  "counts": {
    "sets": 120,
    "tracks": 14000,
    "shares": 24
  }
}
```

Track search page:

```json
{
  "schema": "muzero-r2-track-search-page-v1",
  "page": 1,
  "updatedAt": "2026-06-09T00:00:00.000Z",
  "tracks": [
    {
      "id": "trk_blue",
      "title": "Blue Highway",
      "setIds": ["ses_tokyo", "ses_favorites"],
      "shareIds": ["shr_tokyo_public"],
      "kind": "audio",
      "origin": "uploaded",
      "durationSec": 214,
      "tags": ["night", "drive"],
      "memoryText": "friends sea night",
      "briefCaption": null,
      "artistLike": null,
      "updatedAt": 1780944000000,
      "mediaAvailable": true,
      "coverUrl": "objects/covers/trk_blue.jpg"
    }
  ]
}
```

Local IndexedDB additions:

```ts
export interface RemoteSearchCatalog {
  id: string; // `${driveId}:${libraryId}` or `${driveId}:${shareId}`
  driveId: string;
  shareId?: string;
  scope: "library" | "share";
  sourceUrl: string;
  updatedAt: number;
  syncedAt: number;
  setCount: number;
  trackCount: number;
}

export interface RemoteSearchTrack {
  id: string; // `${catalogId}:${trackId}`
  catalogId: string;
  driveId: string;
  shareId?: string;
  trackId: string;
  title: string;
  normalizedText: string;
  setIds: string[];
  shareIds: string[];
  tags: string[];
  kind: TrackKind;
  origin: TrackOrigin;
  durationSec: number;
  coverUrl?: string;
  mediaAvailable: boolean;
  updatedAt: number;
}

export interface RemoteSearchSet {
  id: string; // `${catalogId}:${setId}`
  catalogId: string;
  driveId: string;
  shareId?: string;
  setId: string;
  name: string;
  description?: string;
  normalizedText: string;
  trackCount: number;
  coverUrl?: string;
  updatedAt: number;
}
```

Stores:

```ts
remoteSearchCatalogs: "id, scope, syncedAt, updatedAt"
remoteSearchTracks: "id, catalogId, trackId, *setIds, *shareIds, *tags, updatedAt"
remoteSearchSets: "id, catalogId, setId, updatedAt"
```

Search behavior:

- `Command/Ctrl+F` global search queries local IndexedDB-backed search tables, not R2.
- Search can be scoped to: current set, current drive, all my drives, shared with me, or everything.
- Initial subscribe can import only `manifest.json`; the UI then offers "Index this drive for search".
- Full search sync downloads catalog pages, not media bytes.
- Search results can show remote-only tracks and offer stream/cache actions.
- When a result is opened, MUZERO lazy-loads the specific set/share index if it is not already local.
- Catalog sync is incremental by `updatedAt`, page ETag, and page hash.
- Search text should be normalized locally: lowercase, trim, tag tokens, optional CJK-friendly substring matching.
- Memories and notes are included only if the owner/share projection allows them.

Performance targets:

- 10k tracks: search results appear under 100 ms after catalog is synced.
- 100k tracks: search remains local and paginated; no UI freeze; index sync progress visible.
- Catalog pages should target 500-2000 tracks per JSON page to keep fetch and parse work chunked.

Per-set index object:

```json
{
  "schema": "muzero-r2-set-index-v1",
  "set": {
    "id": "ses_tokyo",
    "name": "Tokyo Night Drive",
    "description": "Late night city pop and rainy generated tracks",
    "seedPrompt": "rainy Tokyo night drive",
    "displayMode": "video",
    "config": {
      "autoExtend": true,
      "refillThreshold": 2,
      "batchSize": 1,
      "targetDurationSec": 60,
      "allowVocals": true
    },
    "createdAt": 1780944000000,
    "updatedAt": 1780944000000
  },
  "tracks": [
    {
      "id": "trk_blue",
      "title": "Blue Highway",
      "kind": "audio",
      "origin": "uploaded",
      "provider": "upload",
      "durationSec": 214,
      "createdAt": 1780944000000,
      "generatedAt": null,
      "liked": true,
      "tags": ["night", "drive"],
      "brief": null,
      "providerPreset": null,
      "media": {
        "key": "sets/ses_tokyo/media/trk_blue-1d8f.mp3",
        "url": "sets/ses_tokyo/media/trk_blue-1d8f.mp3",
        "mime": "audio/mpeg",
        "bytes": 8241123,
        "sha256": "..."
      },
      "cover": {
        "key": "sets/ses_tokyo/covers/trk_blue-cover.jpg",
        "url": "sets/ses_tokyo/covers/trk_blue-cover.jpg",
        "mime": "image/jpeg",
        "bytes": 512221,
        "sha256": "..."
      },
      "memories": [
        {
          "id": "mem_1",
          "note": "朋友开车去海边那晚",
          "author": {
            "devicePublicId": "dvc_7Qx5Kq9vS3JmA2pL",
            "displayName": "Mac desktop",
            "avatarSeed": "ocean-blue",
            "avatarUrl": "profiles/devices/dvc_7Qx5Kq9vS3JmA2pL/avatar.jpg"
          },
          "createdAt": 1780944000000,
          "photo": {
            "key": "sets/ses_tokyo/memories/mem_1.jpg",
            "url": "sets/ses_tokyo/memories/mem_1.jpg",
            "mime": "image/jpeg",
            "bytes": 742001,
            "sha256": "..."
          }
        }
      ]
    }
  ]
}
```

### 3.5 Remote Device, Profile, and Stats Format

Device registry index:

```json
{
  "schema": "muzero-r2-devices-v1",
  "updatedAt": 1780947600000,
  "devices": [
    {
      "publicId": "dvc_7Qx5Kq9vS3JmA2pL",
      "profile": "profiles/devices/dvc_7Qx5Kq9vS3JmA2pL/profile.json",
      "stats": "stats/devices/dvc_7Qx5Kq9vS3JmA2pL.json",
      "presence": "presence/devices/dvc_7Qx5Kq9vS3JmA2pL.json",
      "lastSeenAt": 1780947600000,
      "profileUpdatedAt": 1780947600000
    }
  ]
}
```

The registry index is a discovery optimization, not the write-hot source of truth. In V1, it should be updated by the owner/trusted publish sync, not by every device on every profile/stat change. Readers can also discover known devices from set indexes, memory authors, stats objects, and presence objects already referenced by manifests.

Per-device public profile object:

```json
{
  "schema": "muzero-r2-device-profile-v1",
  "devicePublicId": "dvc_7Qx5Kq9vS3JmA2pL",
  "displayName": "Mac desktop",
  "avatarSeed": "ocean-blue",
  "avatar": {
    "url": "profiles/devices/dvc_7Qx5Kq9vS3JmA2pL/avatar.jpg",
    "mime": "image/jpeg",
    "bytes": 45221,
    "sha256": "..."
  },
  "appVersion": "0.1.0",
  "revision": 7,
  "updatedAt": 1780947600000
}
```

Per-device stats object:

```json
{
  "schema": "muzero-r2-stats-v1",
  "devicePublicId": "dvc_7Qx5Kq9vS3JmA2pL",
  "revision": 18,
  "updatedAt": 1780947600000,
  "aggregates": [
    {
      "trackId": "trk_blue",
      "scope": "track",
      "playCount": 3,
      "listenedSec": 514,
      "lastPlayedAt": 1780947600000,
      "updatedAt": 1780947600000
    }
  ]
}
```

Merge rule:

- Each device writes only its own profile/stats/presence object key.
- `playCount` and `listenedSec` are additive per `(scope, trackId/shareId/setId, devicePublicId)`.
- Global track display can show `sum(all device stats)`.
- Existing `Track.playCount` remains for backward compatibility but should be treated as a derived/local cached value after this PRD lands.
- `TrackPlaybackStats` is a compatibility/fast-summary layer. New analytics should be based on `PlaybackEvent` and `PlaybackAggregate` so shared-drive context is not lost.
- Profile fields use last-writer-wins only within the same `devicePublicId`, guarded by `revision`, `updatedAt`, and object ETag where available.
- Avatar image objects are content-addressed or revisioned. A profile update should point to the new avatar object after upload, then optionally leave old avatar objects for later explicit cleanup.
- Memory author snapshots should not be rewritten when a device profile changes. The UI may resolve the latest profile by `devicePublicId`, but the memory keeps its original snapshot for historical stability and offline rendering.

### 3.6 Anonymous Device Identity Model

Shared R2 URLs can be used by many anonymous devices. MUZERO must be able to keep listener data separated without accounts. In the R2-only design, separation works locally for all listeners, and remote sync works for devices that also have write credentials for that R2 bucket/prefix.

Best practice:

1. On first launch, generate a random `DeviceRecord.publicId` using cryptographically secure randomness.
2. Never derive `publicId` from hardware serials, IP address, account ids, user agent hashes, or Cloudflare request metadata.
3. Keep a separate internal local `DeviceRecord.id` for Dexie rows if useful, but only sync `publicId`.
4. Device names are optional and user-editable. Default names should be generic, such as "Browser device" or "Mac desktop".
5. Per-device stats are stored in separate remote objects to avoid write contention:

```text
stats/devices/<devicePublicId>.json
presence/devices/<devicePublicId>.json
profiles/devices/<devicePublicId>/profile.json
```

This means many trusted devices can report stats to the same R2 library without overwriting one shared `stats/index.json` on every play event. Aggregated indexes may be rebuilt opportunistically, but the source of truth is per-device. Public read-only listeners keep the same per-device shape locally, but do not upload it.

### 3.7 Device Display Profile and Attribution

Although MUZERO has no account system in V1, each device can have a user-edited display profile:

- display name, e.g. "Doodle's Mac", "Studio PC", "Phone"
- optional avatar/color seed
- optional avatar image
- anonymous `devicePublicId`

This profile can be published to R2 so shared UI has attribution without accounts.

Uses:

1. **Drive / playlist owner display**
   A share can show "Owner: Doodle's Mac" or "Published by Studio PC" when no hosted account exists.

2. **Memory author display**
   Every `Memory` created after this feature should store an optional `author` reference. UI can show "Memory by Doodle's Mac" on memory cards.

3. **Presence / listening now**
   Presence rows use the same display profile for "Mac desktop is listening to Blue Highway".

4. **Playback stats attribution**
   Per-device stats can be shown as device-level breakdowns without requiring accounts.

Schema implication for local `Memory`:

```ts
export interface Memory {
  id: string;
  trackId: string;
  note: string;
  photoBlobId?: string;
  author?: MemoryAuthorRef;
  createdAt: number;
}
```

Rules:

- Device names are user-authored profile data, not hidden telemetry.
- Avatar is user-authored profile data. V1 should provide generated initials/color avatars from `avatarSeed`; uploaded avatar images are optional and can ship later in the same profile schema.
- Uploaded avatar images, if enabled, are stored in the user's local DB and published to the user's R2 profile object path, not to MUZERO-hosted storage.
- Device profile sync is visible and can be disabled.
- A device profile update writes only to writable scopes where the current install has permission:
  - its own Owner R2 drive, if owner sync is enabled
  - trusted shared drives only when the grant allows profile/presence/stat writeback
  - never to read-only public shares
- Updating display name or avatar should upload the new avatar blob first, then write `profiles/devices/<devicePublicId>/profile.json` with an incremented `revision`, then let owner-maintained indexes refresh later.
- If the same device profile is edited offline in two app profiles that somehow share a `devicePublicId`, MUZERO treats it as a conflict and asks the user to keep local, use remote, or create a new device identity. This should be rare because `devicePublicId` is per-install.
- Existing memories without `author` display as "Unknown device" or "Local memory".
- If a user renames a device, old memories can either display the latest profile by `devicePublicId` or preserve the snapshot display name; V1 should preserve a snapshot in `MemoryAuthorRef` for stable historical display.
- In V3 hosted mode, account/user attribution may exist, but memory authors should still keep device attribution for local-first continuity.

### 3.8 Playback Analytics Identity Model

Listening data must be decoupled from playlist membership. The same track can appear in many sets/shares, and a user can listen to a friend's shared track without importing that track into their own canonical library.

Required identity axes:

| Axis | Purpose |
|------|---------|
| `devicePublicId` | Separates one listener/device from another. |
| `trackId` | Local canonical track identity, when imported/owned locally. |
| `remoteTrackRef` | Remote track identity for tracks played from another drive/share. |
| `mediaSha256` | Optional content identity to recognize the same media across sets/shares/drives without relying on matching track ids. |
| `driveId` | Which connected cloud drive supplied the playback context. |
| `shareId` | Which shared projection exposed the track. |
| `setId` | Which set/playlist context the track was played from. |
| `queueEntryId` | Which queue entry played, since the same track can appear multiple times in a queue. |

Recording model:

1. Every meaningful listen creates or updates local `PlaybackEvent` rows.
2. Aggregates are derived from events and stored for fast UI/search:
   - per track
   - per track in set
   - per track in share
   - per set
   - per share
   - per drive
3. A shared-link listener with no write credentials keeps these events/aggregates local.
4. A user with an Owner R2 drive can optionally sync their own playback aggregates to their own R2, even when the listened track came from someone else's shared drive.
5. Trusted devices can sync aggregates to the owner/shared R2 only when granted `writeStats`.

Example: "I listened to B's shared Tokyo set"

```json
{
  "devicePublicId": "dvc_me",
  "remoteTrackRef": {
    "driveId": "drv_b",
    "shareId": "shr_tokyo",
    "setId": "ses_tokyo",
    "trackId": "trk_blue",
    "mediaSha256": "..."
  },
  "context": {
    "source": "share",
    "driveId": "drv_b",
    "shareId": "shr_tokyo",
    "setId": "ses_tokyo",
    "queueEntryId": "pqe_123"
  },
  "listenedSec": 188,
  "countedAsPlay": true
}
```

Sync targets:

- **Local only**: always available; stores all personal listening history.
- **My Owner R2**: optional personal stats backup/sync for the current user across their devices.
- **Shared/owner R2**: only when the share grant permits `writeStats`; useful for "listeners of this shared playlist" aggregate views.

This avoids mixing:

- "How many times have I listened to this audio anywhere?"
- "How many times did I hear it inside Set A?"
- "How many times did I hear the same track inside Set B?"
- "How many times did all granted listeners hear this shared projection?"

Remote stats storage should separate **event truth** from **aggregate cache**:

```text
stats/events/<devicePublicId>/<yyyy-mm>/<segmentId>.json
stats/devices/<devicePublicId>/aggregate.json
stats/devices/<devicePublicId>/checkpoint.json
```

Rules:

- The local `PlaybackEvent` table is the user's full personal listening log.
- Remote event segments are immutable once uploaded. A segment contains a small batch of events, for example 25-100 listens or a time window such as 5-15 minutes.
- `segmentId` includes a device-local monotonically increasing sequence range or a random sync-run id, so two uploads never target the same key.
- One JSON file per listen is the simplest conflict-free model, but it creates many small objects and Class A writes. Use it only for debug/export mode. The default should be immutable batched segments.
- `aggregate.json` is a per-device cache for fast UI. It can be rebuilt from event segments, so if it conflicts, the app should prefer the newest valid checkpoint or rebuild rather than losing events.
- Shared/public listener writeback still requires write permission. Read-only listeners keep the same local event model but do not upload segments.

Default stats flush policy:

- Flush to R2 when either threshold is reached:
  - **Event count threshold:** 25 pending listen events minimum, with a hard flush by 100 pending listen events.
  - **Time threshold:** 5 minutes minimum since last flush while active, with a hard flush by 15 minutes if events are still pending.
- Also attempt a best-effort flush on app background, app close, network regain, and manual Sync.
- If fewer than 25 events exist but the user manually runs Sync, upload the small segment anyway.
- If upload fails, keep the segment pending locally and retry with the same event ids; never generate duplicate remote play counts from a retry.
- After segment upload succeeds, update `checkpoint.json`, then rebuild/upload `aggregate.json` opportunistically. Aggregate upload may lag behind event segment upload.
- Settings should expose these as advanced defaults later, but V1 should not add hidden flags.

### 3.9 Currently-Playing Presence Format

Presence is optional and weakly consistent. It is intended to show "recently active trusted devices and what they are listening to", not hard real-time online status. Public read-only listeners cannot publish presence to the owner's R2 bucket under the R2-only model.

Remote object:

```json
{
  "schema": "muzero-r2-presence-v1",
  "devicePublicId": "dvc_7Qx5Kq9vS3JmA2pL",
  "deviceName": "Mac desktop",
  "trackId": "trk_blue",
  "setId": "ses_tokyo",
  "state": "playing",
  "positionSec": 42,
  "updatedAt": 1780947600000,
  "expiresAt": 1780947720000
}
```

Recommended heartbeat:

- Write on track start, pause, resume, stop, and track change.
- While continuously playing, write at most once every 60 seconds.
- Use `expiresAt = updatedAt + 120 seconds`.
- Readers ignore expired records.
- Do not attempt per-second position sync via R2.

R2 pressure note:

- Presence writes are Class A operations; presence reads are Class B operations.
- Cloudflare's current R2 pricing model charges by storage plus Class A/B operations, with a monthly free tier. As of the 2026-05-28 pricing page, Standard storage includes 1M Class A operations/month and 10M Class B operations/month free; egress is free, but operations still matter.
- Therefore, presence is acceptable for low-frequency "now/recently playing" updates, but not for high-frequency realtime collaboration. If MUZERO later needs realtime rooms, that is a separate backend/Worker/WebSocket PRD.

### 3.10 Privacy & Retention

- Device information is functional sync metadata, not telemetry.
- Device names must be user-editable before first sync.
- Device profile sync must be visible and optional.
- `userAgent` is optional and should not be synced by default unless needed for debugging.
- Playback stats stay in local DB and the user's R2 bucket only.
- No MUZERO-operated endpoint receives device or listening data.
- Presence is visible to anyone who can read the shared R2 presence objects. The publish UI must clearly label this before enabling it.
- Presence should be disabled by default for public shared links and opt-in for owner/shared-listening modes.

### 3.11 Multi-Writer Object Ownership and Conflict Rules

R2 sync must be designed around object ownership, because object storage cannot safely merge concurrent JSON writes by itself.

Object ownership table:

| Remote object family | Writer in V1 | Merge strategy | Conflict risk |
|----------------------|--------------|----------------|---------------|
| `manifest.json` | Owner/trusted publish sync only | Last successful owner publish wins after local diff review | High if many devices publish blindly |
| `sets/<setId>/index.json` | Owner/trusted publish sync only | Published snapshot generated from local DB + accepted mutations | High |
| `sets/<setId>/mutations/<devicePublicId>/*.json` | The matching device only | Append-only mutation log; owner/trusted publish sync folds into next snapshot | Low |
| `shares/<shareId>/index.json` | Owner/trusted publish sync only | Projection regenerated from local source of truth | Medium |
| `objects/media/*` | Any writer with upload permission, content-addressed | Immutable by hash; skip when hash matches | Low |
| `objects/covers/*`, `memories/*`, `profiles/*/avatar.*` | Writer uploads new revision/hash | Immutable or revisioned; profile points to latest object | Low |
| `profiles/devices/<devicePublicId>/profile.json` | The matching device only | Last-writer-wins within the same device, guarded by revision/ETag | Low unless identity duplicated |
| `stats/events/<devicePublicId>/**/*.json` | The matching device only | Immutable event segments; never overwritten | Low |
| `stats/devices/<devicePublicId>/aggregate.json` | The matching device only | Rebuildable per-device aggregate cache | Low |
| `stats/devices/<devicePublicId>/checkpoint.json` | The matching device only | Tracks uploaded event watermarks | Low |
| `presence/devices/<devicePublicId>.json` | The matching device only | Replace current status; TTL expiry handles stale data | Low |
| `devices/index.json`, `stats/index.json`, `presence/index.json` | Owner/trusted publish sync only | Derived discovery indexes, rebuildable | Medium |

Implementation rules:

- Never require a non-owner public listener to update a shared index object.
- Do not make `devices/index.json`, `stats/index.json`, or `presence/index.json` mandatory for correctness. They are cache/discovery artifacts; per-device objects remain authoritative.
- Use remote ETag or a stored object hash before overwriting mutable JSON. If the remote ETag changed since planning, stop, pull the latest remote object, and either auto-merge or show a conflict.
- For R2 S3 writes, prefer conditional operations such as `If-Match`/ETag where supported so stale writes fail instead of overwriting remote changes.
- Use monotonically increasing `revision` for device profile and stats objects. `updatedAt` is for display and fallback only; it is not a reliable conflict clock across devices.
- Treat media/photo/avatar objects as immutable once written. Updates create a new key or content hash and then update the small JSON pointer.
- For metadata conflicts on sets/tracks/memories, prefer explicit user choice over silent last-writer-wins.
- For stats, immutable event segments are the source of truth. Aggregates are caches; if two aggregate versions diverge, rebuild from event segments rather than choosing one and losing listens.
- For presence, never surface conflicts. Newer valid presence replaces older presence for the same device; expired records are ignored.
- Remote deletes do not delete local media automatically in V1. They create a visible conflict or "remote missing" state.

Set mutation log format:

```json
{
  "schema": "muzero-r2-set-mutation-v1",
  "mutationId": "mut_9fL2",
  "devicePublicId": "dvc_7Qx5Kq9vS3JmA2pL",
  "setId": "ses_tokyo",
  "base": {
    "indexKey": "sets/ses_tokyo/index.json",
    "etag": "\"a1b2c3\"",
    "revision": 12
  },
  "ops": [
    {
      "op": "track-added-to-set",
      "trackId": "trk_new",
      "afterTrackId": "trk_blue",
      "mediaKey": "objects/media/sha256-...",
      "createdAt": 1780947600000
    }
  ],
  "createdAt": 1780947600000
}
```

Set sync protocol:

1. Local edit records a `SyncMutation` with the remote snapshot version that the user edited from.
2. Media/covers/memory photos upload first as immutable objects.
3. The device uploads mutation files under `sets/<setId>/mutations/<devicePublicId>/...`.
4. Owner/trusted publish sync reads the current set snapshot plus pending mutation files.
5. Non-overlapping operations are folded automatically into a new `sets/<setId>/index.json` revision.
6. If two mutations edit the same user-authored field or incompatible track order position, MUZERO marks a conflict and keeps both local pending until the user resolves it.
7. The new `index.json` is written with an ETag/conditional guard. If the remote changed meanwhile, the publish run stops and re-plans.

This means adding songs is usually conflict-free: the uploaded media object is immutable, and the set membership change is a per-device mutation. Directly overwriting `sets/<setId>/index.json` from two devices is the fallback path only for owner snapshot publishing, not the normal edit transport.

Auto-merge examples:

- Two devices add different tracks to the same set.
- One device adds a cover photo while another adds a memory to a different track.
- Two devices update their own stats/profile/presence objects.

Conflict examples:

- Two devices rename the same set differently from the same base revision.
- Two devices edit the same memory note.
- Two devices reorder the same adjacent track range in incompatible ways.
- A device removes a track while another edits that track's set-specific metadata.

Profile/avatar propagation:

1. User edits device name or avatar locally.
2. MUZERO updates local `DeviceRecord` and creates a `DevicePublicProfile` revision.
3. For every connected writable drive/share where profile publishing is enabled, MUZERO uploads the avatar object first if changed.
4. MUZERO writes `profiles/devices/<devicePublicId>/profile.json`.
5. Owner-maintained discovery indexes may be refreshed during the next normal publish sync.
6. Existing memories keep their `MemoryAuthorRef` snapshot; UI can optionally decorate it with the latest fetched profile.

This keeps profile changes cheap and avoids rewriting every set, memory, stats row, or share projection when a user changes their name or avatar.

---

## 4. API Design

### 4.1 Remote Object Operations

R2 is accessed as object storage, not a custom backend API.

| Operation | Method | Description |
|----------|--------|-------------|
| `manifest.json` | GET | Load root library manifest from public R2 URL. |
| `sets/<setId>/index.json` | GET | Load metadata and object refs for one set. |
| `sets/<setId>/media/*` | GET | Stream or cache audio/video bytes. |
| `sets/<setId>/covers/*` | GET | Load covers and set art. |
| `sets/<setId>/memories/*` | GET | Load memory photos. |
| `profiles/devices/<devicePublicId>/profile.json` | GET/PUT | Read/write the current device's display profile when allowed. |
| `profiles/devices/<devicePublicId>/avatar.*` | GET/PUT | Read/write optional avatar image objects when allowed. |
| `stats/devices/<devicePublicId>.json` | GET/PUT | Read/write anonymous per-device playback stats. |
| `presence/devices/<devicePublicId>.json` | GET/PUT | Optional low-frequency currently-playing state for one device. |
| `devices/index.json`, `stats/index.json`, `presence/index.json` | GET/PUT | Optional owner-maintained discovery indexes; never the write-hot source of truth. |
| Object key | HEAD | Check existing object size/ETag when owner credentials are configured. |
| Object key | PUT | Upload media/index/manifest via S3-compatible R2 API. |
| Object key | DELETE | Optional cleanup for explicitly removed remote objects. Disabled by default in v1. |

### 4.2 Local Sync Service API

Internal TypeScript API:

```ts
type SyncDirection = "push" | "pull";

interface SyncPlan {
  direction: SyncDirection;
  objects: Array<{
    action: "upload" | "download" | "skip" | "metadata";
    localBlobId?: string;
    remoteKey: string;
    bytes: number;
    reason: "missing" | "changed" | "unchanged" | "metadata-only";
  }>;
  totalBytes: number;
  warnings: string[];
}

async function validateR2Connection(config: CloudDriveConfig): Promise<ValidationResult>;
async function planSync(direction: SyncDirection, options: SyncOptions): Promise<SyncPlan>;
async function runSync(plan: SyncPlan, onProgress: (event: SyncProgressEvent) => void): Promise<void>;
async function subscribeManifest(manifestUrl: string): Promise<RemoteLibraryPreview>;
```

### 4.3 Error Handling

- **Missing manifest**: show "No MUZERO manifest found" and offer `Initialize Cloud Drive` for owner mode.
- **Invalid schema**: reject import; show schema version and first validation issue.
- **CORS failure**: explain that browser access requires R2 CORS; provide exact allowed origin/methods checklist.
- **401/403 write failure**: key invalid or insufficient permission; never retry forever.
- **404 media object**: import metadata but mark track as unavailable until object is restored.
- **Hash mismatch**: skip object, show warning, never write corrupt Blob to `mediaBlobs`.
- **Quota or billing issue**: surface Cloudflare error body safely, redacting credentials.
- **Network interruption**: sync run remains failed/cancellable; next run resumes by re-planning and skipping completed objects.

### 4.4 Logging

Use `src/lib/logger.ts`.

Allowed log fields:

- direction
- phase
- object count
- byte count
- remote key suffix or hashed key
- HTTP status code
- schema version

Forbidden log fields:

- R2 Access Key ID / Secret Access Key
- full signed URL
- lyrics, memory notes, user file names if user has opted into privacy mode
- media bytes

---

## 5. Frontend Design

### 5.1 Page Structure

Cloud Drive lives in Settings as a visible runtime feature.

```text
Settings
└── Cloud Drive
    ├── Local-first status
    ├── My Drives
    ├── Shared With Me
    ├── Subscribe with manifest/share link
    ├── R2 Setup Wizard
    ├── Connection validation
    ├── Per-drive sync controls
    └── Per-drive last sync / progress / conflicts
```

### 5.2 R2 Setup Wizard

方案 A flow:

1. Explain: "MUZERO does not host your music. You will create a Cloudflare R2 bucket you own."
2. Open Cloudflare R2 dashboard in browser.
3. User creates a bucket, e.g. `muzero-drive`.
4. User enables public access through either:
   - custom domain, recommended for real sharing and caching; or
   - `r2.dev` public development URL for testing.
5. User configures CORS:
   - `GET`, `HEAD` for subscribe/read.
   - `PUT`, `DELETE` only if owner sync is enabled.
   - allowed origins include local dev, deployed web origin, and desktop webview origin where applicable.
6. User creates an R2 API token / S3 credentials scoped to the bucket.
7. User pastes:
   - public base URL or manifest URL
   - account endpoint
   - bucket
   - optional prefix, default `muzero/`
   - Access Key ID / Secret Access Key for owner sync
8. MUZERO validates:
   - `GET publicBaseUrl/manifest.json` or initializes it
   - `PUT .muzero/healthcheck-<deviceId>.json`
   - `HEAD` the healthcheck object
   - `GET` public URL for the healthcheck object
9. Only after validation, enable `Sync`.

### 5.3 Sync Progress UI

Required visible states:

- Idle: last sync time, remote URL, mode.
- Planning: "Scanning local library" / "Reading manifest".
- Uploading: object name/type, object progress, total bytes.
- Downloading: object name/type, object progress, total bytes.
- Applying: "Writing local IndexedDB".
- Completed: uploaded/downloaded/skipped counts.
- Failed: exact actionable reason and retry button.
- Conflicts: list by set/track/memory with resolution action.

Progress detail:

```text
Syncing to R2
Phase: Uploading media
17 / 43 objects
182 MB / 1.4 GB
Current: sets/ses_tokyo/media/trk_blue-1d8f.mp3
[Cancel] [Run in background]
```

Conflict/sync indicators:

| Indicator | Meaning | User action |
|-----------|---------|-------------|
| `Local changes` | Local mutations exist but have not been uploaded. | Sync now / keep local. |
| `Uploading files` | Immutable media/photo/avatar objects are being uploaded. | Wait/cancel. |
| `Publishing playlist` | MUZERO is folding accepted mutations into a new set snapshot. | Wait. |
| `Remote changed` | Remote ETag changed since planning; sync must pull/re-plan. | Review incoming changes. |
| `Auto-merged` | Non-overlapping mutations were folded successfully. | No action; show brief history. |
| `Needs review` | Same user-authored field/order range changed on both sides. | Keep local / use remote / edit manually / duplicate. |
| `Read-only` | This drive/share has no write credentials or grant. | Save locally / add owner credentials. |
| `Stats local only` | Playback stats are recorded locally but cannot be uploaded to this share. | Optional: sync to own Owner R2. |

Set-level indicator placement:

- Settings > Cloud Drive shows drive-wide sync state and last error.
- Set header shows the set's own mutation/conflict state.
- Track rows with pending media upload show a small pending/cloud icon.
- Conflict drawer groups issues by set, then track/memory/profile/stat object.
- The player should never block playback because a set has sync conflicts; it should block only destructive remote publish actions until conflicts are resolved.

### 5.4 Playback Stats UX

Track detail / Now Playing should expose:

- total plays
- total listened time
- last played
- optional per-device breakdown in a compact details panel

Settings should expose:

- device name
- anonymous public device id
- last sync
- "Forget this device" local action
- "Stop syncing playback stats" visible toggle, default on once cloud sync is enabled
- "Share currently playing status" visible toggle, default off

Stats sync UI should distinguish:

- **Recorded locally**: event exists in IndexedDB.
- **Queued for cloud**: event is waiting for the next immutable segment upload.
- **Uploaded**: event is included in a remote segment and checkpoint.
- **Aggregated**: `aggregate.json` or local aggregate cache has been rebuilt.

Play count should update locally immediately. Remote aggregate totals may lag until the next sync; UI should show "synced just now / pending N listens" rather than pretending the shared count is realtime.

When pending playback events exist, Settings and track detail can show:

```text
Listening stats
23 pending listens
Next cloud sync: at 25 listens or in 3 min
Last segment upload: 8 min ago
Aggregate: pending refresh
```

### 5.5 Currently-Playing Presence UX

When presence is enabled on owner/trusted devices, a shared set can show a small "Listening now" surface:

- anonymous device display name
- current track title
- state: playing / paused / recently stopped
- last updated time
- expired devices hidden automatically

This must be phrased as "recently active" or "listening now" with a freshness indicator, not as a guaranteed live room.

For a large shared playlist with many trusted devices, the UI should:

- read `presence/index.json` or another owner-maintained known-device list at a low frequency, e.g. every 30-60 seconds while the panel is visible
- fetch only changed per-device presence objects by `updatedAt`/ETag
- cap visible devices in the main UI and offer "show more"
- never poll presence while the app is backgrounded unless the user explicitly opens the shared-listening view

### 5.6 State Management

- Sync progress is ephemeral runtime state in a small Zustand store or event emitter.
- Durable sync run summaries live in `syncRuns`.
- Remote metadata and sync object mapping live in Dexie.
- Presence is ephemeral and should not update global React trees every heartbeat.
- Do not put media bytes or remote object maps into Zustand.
- Track lists continue to use Dexie `useLiveQuery`.

---

## 6. Implementation Plan

### Phase 1: Manifest Protocol + Read-Only Subscription

**Goal:** Users can paste a manifest URL and load/play a remote set without write credentials.

**Tasks:**

- [x] Add Zod schemas for `muzero-r2-manifest-v1`, `muzero-r2-set-index-v1`, devices, stats.
- [x] Add URL normalization and relative URL resolution.
- [x] Add read-only manifest preview service with injected fetch.
- [x] Add remote set index loader that resolves streamable media/cover/memory URLs.
- [x] Add read-only import flow: manifest → set indexes → tracks/memories/media refs.
- [x] Support stream mode: keep remote media URLs without downloading blobs.
- [x] Support cache mode: download selected media into `mediaBlobs`.
- [x] Add remote search catalog and paged track/set search schemas.
- [x] Add remote search track row normalization and query matcher.
- [x] Add optional remote search catalog import: `catalog/library.json` + paged set/track indexes.
- [x] Store remote-only searchable set/track rows in IndexedDB without downloading media.
- [x] Show preview before import: set count, track count, media size, source domain.
- [x] Add tests for invalid schema, relative URLs, missing media, and duplicate ids.

### Phase 1 Checklist

- [ ] Browser can subscribe to a public manifest link and play an audio track.
- [ ] Browser can subscribe to a public manifest link and play a video track.
- [ ] Tauri/Electron use the same manifest import path.
- [x] No R2 write credential is required for subscription.
- [ ] Command/Ctrl+F can search synced remote catalog rows locally.
- [ ] Invalid manifests do not mutate local IndexedDB.

### Phase 2: R2 Setup Wizard + Connection Validation

**Goal:** Users can configure their own R2 bucket through guided manual steps.

**Tasks:**

- [x] Add `cloudDrive` settings fields and repository helpers.
- [x] Add multi-drive local model: owned drives, trusted drives, shared links.
- [x] Build Settings Cloud Drive section.
- [x] Add setup checklist for Cloudflare account, bucket, public URL, CORS, and R2 credentials.
- [x] Add healthcheck validation for public read and S3 write.
- [x] Add copyable recommended CORS JSON.
- [x] Store credentials only in local IndexedDB settings.
- [x] Add i18n keys for en/zh/ja/ko.

### Phase 2 Checklist

- [x] A fresh user can configure read-only mode with only a manifest URL.
- [x] An owner can validate bidirectional mode with R2 credentials.
- [x] A user can add multiple R2 drives and multiple shared links.
- [x] Secret values are masked in UI and never logged.
- [x] Failed CORS validation gives an actionable fix.

### Phase 3: Local-to-Cloud Publish Sync

**Goal:** A user can publish local sets and all referenced media to R2 with visible progress.

**Tasks:**

- [ ] Implement local export plan from `sessions`, `tracks`, `memories`, and `mediaBlobs`.
- [ ] Compute object keys for media/video/cover/memory photos.
- [ ] Upload missing/changed media first.
- [ ] Upload per-set `index.json`.
- [ ] Upload the current device `DevicePublicProfile` when profile publishing is enabled.
- [ ] Upload per-device stats objects only for the current device or explicitly granted trusted devices.
- [ ] Rebuild optional `devices/index.json`, `stats/index.json`, and `presence/index.json` as owner-maintained discovery indexes.
- [ ] Upload root `manifest.json` last.
- [ ] Persist `syncObjects` mapping and `syncRuns`.
- [ ] Add cancel support between objects.

### Phase 3 Checklist

- [ ] Audio media syncs to R2.
- [ ] Video media syncs to R2.
- [ ] Track covers sync to R2.
- [ ] Memory photos sync to R2.
- [ ] Device avatar/profile syncs to R2 only where write permission exists.
- [ ] Set metadata and `TrackBrief` metadata sync to R2.
- [ ] Progress shows object count, byte count, current phase, and failures.
- [ ] Readers never see a manifest that references not-yet-uploaded objects.

### Phase 4: Cloud-to-Local Pull Sync + Conflict Handling

**Goal:** A user can pull remote changes into local IndexedDB and resolve conflicts.

**Tasks:**

- [ ] Implement remote diff against local DB.
- [ ] Add `SyncMutation` rows for local set/track/memory edits.
- [ ] Upload per-device set mutation files under `sets/<setId>/mutations/<devicePublicId>/`.
- [ ] Fold non-overlapping set mutations into the next owner-published `index.json` snapshot.
- [ ] Add conflict detection for set/track/memory edits changed on both sides.
- [ ] Add ETag/hash/conditional-write guard before overwriting mutable remote JSON objects.
- [ ] Default merge rule:
  - [ ] additive stats merge
  - [ ] add new tracks/memories
  - [ ] preserve local-only tracks unless user chooses delete
  - [ ] latest `updatedAt` wins only for non-user-authored cache metadata
  - [ ] user-authored set/track/memory fields use explicit conflict UI when both sides changed
  - [ ] per-device profile conflicts use `revision` first, then explicit user choice
- [ ] Add conflict UI with "keep local", "use remote", "duplicate both".
- [ ] Add set-level indicators for local changes, remote changed, auto-merged, and needs review.
- [ ] Add dry-run preview before applying large pulls.
- [ ] Verify imported Blob roles match expected object roles.
- [ ] Incrementally refresh remote search catalog pages by `updatedAt`/ETag/hash.
- [ ] Lazy-load specific set/share indexes when a search result is opened.

### Phase 4 Checklist

- [ ] Pull sync can recreate a set on a new device.
- [ ] Pull sync can download media for offline playback.
- [ ] Pull sync can stream without downloading.
- [ ] Pull sync can update a large remote search catalog without downloading media bytes.
- [ ] Conflicts are visible and never silently overwrite media.
- [ ] Two devices adding different tracks to the same set can auto-merge.
- [ ] Two devices renaming the same set differently produce a reviewable conflict.
- [ ] Stale set snapshot publish fails/replans instead of overwriting remote changes.
- [ ] Hash mismatch blocks import for that object.

### Phase 5: Anonymous Device Registry + Playback Stats Sync

**Goal:** MUZERO records device-local identity, play count, and listened duration. Devices with R2 write credentials can sync those stats through R2; read-only shared-link listeners keep the same stats locally.

**Tasks:**

- [ ] Generate one anonymous random `DeviceRecord.publicId` per app profile.
- [ ] Add UI to rename device.
- [ ] Add optional device avatar/color seed for attribution chips.
- [ ] Add optional uploaded avatar image with local storage and remote profile object reference.
- [ ] Publish `DevicePublicProfile` to owner/trusted drives when enabled and write permission exists.
- [ ] Add profile `revision` and ETag/hash checks so two offline edits cannot silently overwrite each other.
- [ ] Add `Memory.author?: MemoryAuthorRef` and backfill existing rows as unknown/local.
- [ ] Show memory author on memory cards.
- [ ] Track listened seconds while a track is actively playing.
- [ ] Increment play count once per meaningful listen, not on every seek/replay glitch.
- [ ] Persist `PlaybackEvent` with drive/share/set/queue context for every meaningful listen.
- [ ] Derive `PlaybackAggregate` rows for track, track-in-set, track-in-share, set, share, and drive scopes.
- [ ] Persist per-device `TrackPlaybackStats`.
- [ ] Export/import immutable playback event segments under `stats/events/<devicePublicId>/`.
- [ ] Flush playback event segments when either the event-count threshold or time threshold is reached.
- [ ] Retry failed segment uploads without duplicating remote play counts.
- [ ] Export/import rebuildable per-device aggregate cache under `stats/devices/<devicePublicId>/aggregate.json`.
- [ ] Track uploaded event watermarks under `stats/devices/<devicePublicId>/checkpoint.json`.
- [ ] Add optional `stats/index.json` for discovery, but do not make it the write-hot source of truth.
- [ ] Keep public read-only listener stats local when no R2 write credentials are configured.
- [ ] Keep read-only shared-link device profile/avatar local unless the user also has a writable Owner R2 target.
- [ ] Reconcile existing `Track.playCount` with per-device stats.
- [ ] Add tests around play threshold, pause/resume, seek, track change, and app close.

### Phase 5 Checklist

- [ ] Listening to a track records listened seconds.
- [ ] Listening to a track records play count according to the defined threshold.
- [ ] Device display name appears in owner/publisher UI where no account exists.
- [ ] Device avatar appears anywhere device attribution appears, with generated-avatar fallback.
- [ ] Device profile updates sync only to writable targets and do not rewrite historical memories.
- [ ] Memory cards show author attribution when available.
- [ ] Stats survive reload.
- [ ] Stats merge correctly from two devices.
- [ ] Rebuilding aggregates from event segments does not lose play counts.
- [ ] Sync UI shows pending local listens separately from uploaded/aggregated listens.
- [ ] Pending listening stats flush at 25-100 events or 5-15 minutes, whichever threshold is reached first.
- [ ] Manual Sync can flush a small pending stats segment below the normal event-count threshold.
- [ ] A large shared playlist can keep local stats separated across many anonymous devices.
- [ ] The same track in two sets can show separate track-in-set play counts.
- [ ] A track played from someone else's shared set can be recorded locally without importing the track.
- [ ] A user can sync their own listening history about shared tracks to their own Owner R2.
- [ ] Trusted devices with write credentials can sync separated stats to the shared R2 bucket.
- [ ] UI can show total plays and listened time.

### Phase 6: Optional Low-Frequency Currently-Playing Presence

**Goal:** Trusted devices can optionally write "recently listening" state to the same user-owned R2 library, and other devices can display it without a MUZERO backend.

**Tasks:**

- [ ] Add `NowPlayingPresence` schema.
- [ ] Add visible Settings toggle, default off.
- [ ] Enable remote presence writes only when owner/trusted R2 write credentials are configured.
- [ ] Write presence on track start, pause, resume, stop, and track change.
- [ ] Add throttled heartbeat while playing, at most once per 60 seconds.
- [ ] Write presence to `presence/devices/<devicePublicId>.json`.
- [ ] Read presence only while the "Listening now" UI is visible, at a low polling interval.
- [ ] Ignore expired presence records based on `expiresAt`.
- [ ] Add cost/operations warning in Settings for public shared libraries.

### Phase 6 Checklist

- [ ] Presence can show which trusted anonymous device is listening to which track.
- [ ] Read-only public listeners do not attempt remote presence writes.
- [ ] Expired devices disappear without requiring deletes.
- [ ] Presence writes are throttled and do not happen every second.
- [ ] Presence reads are scoped to the visible UI and stop when hidden/backgrounded.
- [ ] The feature remains optional and off by default.

---

## 7. Out of Scope

- MUZERO-hosted accounts, API proxy, telemetry, or managed backend in the V1 R2-only implementation. The V3 `mu0.app` hosted control plane requires its own PRD.
- MUZERO-hosted storage of user media bytes in any phase.
- One-click automatic Cloudflare account creation.
- Worker-based upload broker or Deploy-to-Cloudflare flow in V1. This becomes the shared V2/V3 broker/package after the hosted control-plane PRD.
- Private sharing with access control beyond user-managed R2 settings.
- Cloudflare Stream transcoding or adaptive bitrate packaging.
- Cross-user social feeds, comments, likes, or public discovery.
- Hard real-time rooms, chat, or synchronized playback based only on R2.
- Anonymous public writeback of listener stats/presence from read-only shared links. This needs a future Worker/presigned-upload design.
- DRM or copyright enforcement.
- Automatic deletion of remote objects in v1. Deletion is dangerous and should be a separate explicit cleanup flow.

---

## 8. Security Considerations

### 8.1 Authentication

- Subscribe mode uses no authentication; anyone with the public link can read the published manifest/media.
- Owner-sync mode uses user-provided R2 S3 credentials stored only in the local `settings` row.
- MUZERO must label owner-sync credentials as powerful and local to the current browser/profile/device.

### 8.2 Authorization

- Recommended R2 credentials should be bucket-scoped and limited to the MUZERO bucket/prefix when possible.
- UI should warn against account-wide keys.
- Write actions are disabled unless validation passes.
- Presence/stat writeback is disabled for read-only public shared links.
- Device profile, stats, and presence writes are allowed only for the current device's object key unless a future broker grant explicitly says otherwise.
- Owner-maintained indexes and manifests are only rewritten by owner/trusted publish sync.

### 8.3 Data Protection

- Secrets never sync to R2.
- Secrets never appear in manifest/index/stats.
- Display name and avatar are public within any readable R2 share that references the profile. The UI must label this before publishing profile sync.
- Manifest may include user-visible titles, tags, notes, and generated lyrics/briefs. The publish UI must warn that public buckets make these readable by anyone with the link.
- Private memories/photos should not be published unless the user chooses that set for sync.

### 8.4 Browser Risk

Browser owner-sync necessarily keeps R2 credentials in that browser profile. This is acceptable only because it is explicit BYO cloud behavior. The UI must recommend desktop app for long-lived owner credentials if the user is concerned.

### 8.5 Audit Logging

Local sync history should record:

- direction
- started/finished time
- object counts
- byte counts
- failure status

Do not record secrets, full signed URLs, or media content.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [MUZERO AI DJ Foundation](../20260606-muzero-ai-dj-foundation-prd/20260606-muzero-ai-dj-foundation-prd.md) | Original local-first AI DJ architecture. |
| [Set / Play Queue / Memory Data Model](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md) | Current set, queue, track, memory model. |
| [Cloud Music-Gen Provider Selection](../20260607-muzero-cloud-musicgen-provider-selection-prd/20260607-muzero-cloud-musicgen-provider-selection-prd.md) | BYOK provider discipline and local secret handling. |
| [Cloudflare R2 Public Buckets](https://developers.cloudflare.com/r2/data-access/public-buckets/) | Public R2 access behavior and custom domain guidance. |
| [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) | Required browser CORS setup. |
| [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/) | Storage and operation pricing; egress is free but requests/storage still matter. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should public manifests include memory notes by default? | Open | Default should likely be yes for selected synced sets, with a per-set "include memories" option. |
| 2 | Should generated lyrics/briefs be published? | Open | Include by default for DJ continuity, but show privacy warning. |
| 3 | What threshold defines a play count? | Open | Candidate: count when listened >= max(30s, 30% duration), once per track start. |
| 4 | Should remote deletes apply locally? | Open | v1 should preserve local data and surface deleted remote objects as conflicts. |
| 5 | Should stream mode create remote-only tracks without `blobId`? | Open | Likely yes, but player/media engine needs a remote URL source abstraction. |
| 6 | Should sync include chat sessions? | Resolved | No for this PRD; chat sync is out of scope due prompt/privacy sensitivity. |
| 7 | Can browser and desktop share identical R2 write implementation? | Open | Prefer one S3 signing client with `getAppFetch()` injection; validate bundle size before adding AWS SDK. |
| 8 | Should anonymous public listeners be able to contribute stats/presence to the owner? | Resolved | Not in the R2-only PRD. Requires a future user-deployed Worker or presigned-upload broker. |
| 9 | Should device display name/avatar updates rewrite existing memories? | Resolved | No. Memories keep author snapshots; profile updates write only the per-device profile object and optional avatar object. |

---

## 11. Acceptance Criteria

- MUZERO remains fully usable with no network and no R2 configuration.
- Browser, Tauri, and Electron share the same subscription and sync behavior.
- A public manifest link can load at least one audio set and one video set.
- Owner-sync can push local metadata and media to user-owned R2 without a MUZERO backend.
- Pull sync can recreate the same set on a fresh local database.
- Sync progress is visible and cancellable.
- Audio/video media, covers, set covers, and memory photos sync.
- Device records are created locally and synced only to the user's R2.
- Device profile/avatar writes are scoped to the current device object and never require rewriting all memories.
- Track play count and listened seconds are recorded per device.
- Trusted devices with R2 write credentials can merge per-device stats through R2.
- Read-only shared-link listeners keep stats local and never attempt unauthenticated writes.
- Optional presence shows recently active trusted devices only, with low-frequency writes and TTL expiry.
- Multi-writer sync avoids shared hot JSON objects; per-device objects are authoritative and owner indexes are rebuildable.
- Credentials are never included in remote manifest/index/stats or logs.

---

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-09 | MUZERO | Initial draft for R2-only user-owned cloud drive sync. |
| 2026-06-09 | MUZERO | Architecture review pass: clarified V1/V3 boundary, profile/avatar sync, per-device object ownership, and multi-writer conflict rules. |
| 2026-06-09 | MUZERO | Phase 1 implementation started: manifest/set/share/stats schemas and R2 URL normalization/resolution added with tests. |
| 2026-06-09 | MUZERO | Phase 1 read-only subscription service added: public manifest preview and remote set index loading with resolved media URLs. |
| 2026-06-09 | MUZERO | Phase 1 remote search catalog schemas and local remote-search row normalization added with tests. |
| 2026-06-09 | MUZERO | Phase 1 Dexie v11 remote search cache added for remote set/track rows without media downloads. |
| 2026-06-09 | MUZERO | Phase 1 remote search catalog importer added for `catalog/library.json` plus paged set/track rows. |
| 2026-06-09 | MUZERO | Phase 1 stream-mode playback foundation added: tracks can carry remote media/cover URLs without local blobs. |
| 2026-06-09 | MUZERO | Phase 1 read-only stream import added: remote set indexes create playable local session/track/memory rows without media downloads. |
| 2026-06-09 | MUZERO | Phase 1 cache-mode media download added: selected remote track media can be saved into `mediaBlobs`. |
| 2026-06-09 | MUZERO | Phase 1 Settings UI added for public manifest preview and read-only set import. |
| 2026-06-09 | MUZERO | Phase 1 edge-case tests added for invalid schemas, relative URLs, missing remote media, and duplicate imports. |
| 2026-06-09 | MUZERO | Phase 2 local cloud drive/share registry added with Dexie v12 tables and repository helpers. |
| 2026-06-09 | MUZERO | Phase 2 R2 healthcheck core added for public manifest read validation, S3-compatible write probes, secret masking, and recommended CORS JSON generation. |
| 2026-06-09 | MUZERO | Phase 2 Settings Cloud Drive wizard completed with setup checklist, shared-link registry, owner validation, local-only R2 credentials, copyable CORS JSON, connected-drive list, and en/zh/ja/ko strings. |
