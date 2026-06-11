# PRD: MUZERO — User-Owned R2 Cloud Drive Sync

**Status:** Completed（Phase 1–6 全实现 + 测试；post-v1 manifest 扩展 [entity-cover / rank / thumbhash / lyrics / memory atSec / streamed origin] 已并入 schema。延后：V2 自托管 broker、V3 `mu0.app` 托管控制面 — 审计 2026-06-11）
**Created:** 2026-06-09
**Author:** MUZERO
**Module:** Sync / Sharing — Cloudflare R2 as user-owned cloud drive

> This PRD records the decision to pursue **方案 A: R2 Setup Wizard** first. MUZERO remains fully local-first and usable offline. Cloud sync is an optional, visible user-configured feature where the user owns the Cloudflare R2 bucket, public read URL, and write credentials. MUZERO provides a manifest format, setup checklist, validation, sync engine, progress UI, and conflict rules. In the V1 R2-only scope, MUZERO does **not** host user music, proxy media, manage accounts, or operate a backend. The optional `mu0.app` Worker/D1 control plane is explicitly a later V3 layer.

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Manifest protocol + read-only subscription | ✅ Done | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | R2 Setup Wizard + connection validation | ✅ Done | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Local-to-cloud publish sync with visible progress | ✅ Done | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Cloud-to-local pull sync + conflict handling | ✅ Done | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Anonymous device registry + playback stats sync | ✅ Done | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Optional low-frequency currently-playing presence | ✅ Done | [Phase 6 Checklist](#phase-6-checklist) |
| 7 | Sync hardening (2026-06-11 audit follow-ups) | ✅ Done | [§12.3 backlog](#123-phase-7-proposed-sync-hardening) |
| 8 | Multi-writer library (read-merge-write publish) | ✅ Done | [§12.4](#124-phase-8-multi-writer-library-read-merge-write-publish) |
| 9 | Same-set co-editing (one user, multiple devices) | ✅ Done | [§12.5](#125-phase-9-same-set-co-editing-one-user-multiple-devices) |
| 10 | Automatic sync + R2 scale optimizations | ✅ Done | [§12.6](#126-phase-10-automatic-sync--r2-scale-optimizations) |
| 11 | Trusted-device setup link + local device naming UX | ✅ Done | [§12.7](#127-phase-11-trusted-device-setup-link--local-device-naming-ux) |
| 12 | Device Avatar UX + Source Attribution | ✅ Done | [§12.8](#128-phase-12-device-avatar-ux--source-attribution) |
| 13 | Sync Mode UX + Remote Playback Reliability + R2 Setup Flow | ✅ Done | [§12.9](#129-phase-13-sync-mode-ux--remote-playback-reliability--r2-setup-flow) |
| 14 | Smart sync content fingerprinting | ✅ Done | [§12.10](#1210-phase-14-smart-sync-content-fingerprinting) |
| 15 | Cloud-to-Local Playlist Cache UX | ✅ Done | [§12.11](#1211-phase-15-cloud-to-local-playlist-cache-ux) |
| 16 | Pull identity dedupe + metadata integrity | ✅ Done | [§12.12](#1212-phase-16-pull-identity-dedupe--metadata-integrity) |
| 17 | Remote Playback Handoff UX | ✅ Done | [§12.13](#1213-phase-17-remote-playback-handoff-ux) |
| 18 | Remote Cover Palette Reliability | ✅ Done | [§12.14](#1214-phase-18-remote-cover-palette-reliability) |
| 19 | Remote Cover MIME + Dock Loading Polish | ✅ Done | [§12.15](#1215-phase-19-remote-cover-mime--dock-loading-polish) |
| 20 | Remote Playback LRU Cache | ✅ Done | [§12.16](#1216-phase-20-remote-playback-lru-cache) |
| 21 | Sync Notification Quiet Refresh | ✅ Done | [§12.17](#1217-phase-21-sync-notification-quiet-refresh) |

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

### 2.6.1 Access Tiers and Link Indirection

The realistic usage profile is: **mostly the user's own devices, occasionally
shared to others.** Match the mechanism to the tier, and keep the bucket
**private by default** — public is opt-in, only for truly-public sharing.

| Tier | Bucket | Who signs the read | Backend | Egress |
|------|--------|--------------------|---------|--------|
| **① Own devices (default)** | private | the device itself, **locally** | none | free |
| **② Shared to others (occasional)** | private | a **Worker** (self-hosted V2 / mu0.app V3) | broker | free |
| **③ Truly public** | public | n/a (open URL) | none | free |

Key realizations:

- **Same mechanism, different signer — a presigned GET URL.** Media elements
  (`<audio>`/`<video>` `src`) cannot carry an `Authorization` header, so a
  *private* object is fetched via a presigned URL (auth in the query string).
  - **Own devices presign locally** — the device holds the R2 secret, so it
    signs its own short-TTL GET URLs with no server. This makes V1 owner-sync
    **private** (no public bucket needed) while egress stays free. This is a
    **V1 enhancement**: reads resolve through a per-drive media-URL abstraction
    (owned → local presign; shared → broker; public → open URL), which is the
    abstraction PRD Open Question 5 anticipated.
  - **Third parties cannot hold the secret**, so a Worker broker signs for them
    (Tier ②). This is the only tier that needs a backend.

- **Do NOT proxy media bytes through the broker.** The broker only issues
  presigned URLs; the client fetches bytes **directly from R2** (egress stays
  free). Proxying bytes would forfeit free egress, add cost, and bottleneck.

- **Opaque share links (`mu0.app/s/<id>`)** are the durable shared identity. The
  broker resolves the id → grant → real R2, then issues a presigned URL.
  Benefits: revocation, no enumeration/hotlinking, and the durable link is
  decoupled from the storage backend (owner can rotate buckets/keys without
  breaking the link). Caveat: the issued presigned URL still names the R2
  host/bucket/key at fetch time (it cannot be fully hidden without proxying),
  but it expires in minutes and the bucket is not enumerable — equivalent to how
  Dropbox/Drive share links resolve to temporary signed download URLs.

- **Dependency note:** Tier ① has **no** dependency on mu0.app (local + direct).
  Tier ② introduces a hard dependency on the broker's uptime and makes the
  broker a custodian of access — a deliberate V3 trade-off, out of V1 scope.

**Setup-time access-mode selection (UX).** Public-vs-private is a Cloudflare
*bucket* setting — MUZERO cannot toggle it via the S3 API. So MUZERO does **not**
"set" the mode; it **asks** which mode the owner intends when adding the drive,
records it on the `CloudDrive`, adapts the form, and validates:

- **Public**: ask for the public base URL (r2.dev / custom domain); reads go via
  that URL; validate with the existing `checkR2PublicRead` ("is your public URL
  actually reachable?"); guide the user to enable public access + CORS in
  Cloudflare. Hint: *anyone with the link can read; not revocable.*
- **Private**: no public URL; reads resolve via local presign (Tier ①); validate
  the S3 keys (ListBuckets + write probe). Hint: *most private; own devices only
  for now — sharing to others arrives with the V3 broker.*

The choice drives (a) whether the public-URL field shows, (b) how media URLs
resolve, and (c) which sharing options are offered.

**Considered & rejected — client-side strong encryption ("encrypted public").**
A fourth option was weighed: a public bucket holding only ciphertext, with a
password-derived key (Argon2/PBKDF2 → AES-GCM); recipients enter the password,
download, decrypt, then play (no streaming — it would reuse the existing
cache-mode/local-blob path). It is the only *no-backend* way to get real
confidentiality on a public bucket. **Rejected** because:

- **Coarse revocation** is its real weakness — a leaked password decrypts
  everything, and revoking means re-encrypting + re-uploading the whole library.
  (Note: *tampering* is **not** a weakness — a public bucket is read-only to
  outsiders since writes need S3 credentials, and AES-GCM authenticates every
  object, so silent modification is detected.)
- It duplicates a second confidentiality mechanism alongside the broker, and
  complicates key/password management and the playback pipeline.
- Its only edge over Tier ② is "no backend" — not worth it once controlled
  sharing is expected to use the broker anyway.

**Decision:** private/controlled sharing is **always Tier ② (broker)**. The
trade-off accepted: until the V3 broker ships, there is no "private sharing" —
only ① own devices and ③ truly public. This matches the usage profile (default
= own devices; sharing is occasional and can wait for V3).

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

#### Additive post-v1 manifest extensions (as-built, audited 2026-06-11)

Other PRDs extended `muzero-r2-manifest-v1` after the six phases closed. All are **additive optional fields — no schema version bump** (per the additive rule; legacy manifests parse unchanged). Recorded here so this PRD stays the protocol's source of truth:

| Field | Where | Carries | Source PRD / commit |
|-------|-------|---------|---------------------|
| `entityCoversIndex` | root manifest | path to `library/entity-covers/index.json` (`muzero-r2-entity-covers-v1`): library-global artist/album custom covers, content-addressed bytes in `objects/covers/`, LWW `updatedAt` per entry | artist/album entities PRD; `c2df2f9`/`9401dde` |
| `tracks[].rank` | set index | fractional rank (drag-reorder); exporter also emits `tracks[]` in display order so rank-ignorant readers still see the order; importer rebuilds `trackRanks`, ranking local-only members after the max | drag-reorder PRD §4.2; `f4f38c0` |
| `tracks[].thumbhash` | set index | base64 thumbhash of the track cover for instant remote previews | instant-cover-thumbnails PRD §3.4; `cf454a1` |
| `tracks[].lyrics` | set index | synced/plain lyrics + `source`/`sourceId`/`instrumental`; only `found`/`instrumental` rows travel (negative cache stays local); import merge = manual-wins (`lyricsRemoteWins`) | synced-lyrics PRD §4.8; `e4592f7` |
| `tracks[].memories[].atSec` | set index | optional playback-anchor seconds on a memory | immersive-memory-moments PRD; `1a31006` |
| `tracks[].origin: "streamed"` + `streamSourceId` / `streamExternalId` / `streamMeta` | set index | external-source tracks publish enough metadata to recreate playback on another device; if the publishing device has local media bytes (`blobId`), the private R2 drive also publishes the media object | external-streaming-sources PRD; Phase 22 supersedes the earlier conservative F5 skip policy |

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
      "mediaMetadata": {
        "title": "Blue Highway",
        "artists": ["Deidian"],
        "album": "Moonstone Beach",
        "genres": ["soluna"],
        "year": 2026,
        "originalFileName": "04-blue-highway.mp3",
        "originalMime": "audio/mpeg",
        "parser": "music-metadata",
        "parsedAt": 1780944000000
      },
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
  mediaMetadata?: TrackMediaMetadata;
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
- `mediaMetadata` is optional and additive. It carries normalized, user-visible fields such as title, artists, album, genre, year, and original import identity when the owner/share projection allows them. It must not include raw native tag frames or embedded cover bytes; cover bytes remain separate media objects.
- The synced `mediaMetadata` is consumed not only for flat substring search but also feeds **cross-drive artist/album entity derivation + faceted/scoped search** (Artists ▸ / Albums ▸ / Songs ▸, plus `artist:` / `album:` field tokens) per the [Artist & Album Library Entities PRD](../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md). Remote tracks therefore participate in the same artist/album views as local tracks. `matchesRemoteSearchTrack` ([`r2-search-catalog.ts`](../../../src/sync/r2-search-catalog.ts)) must mirror the scoped-token parser used locally so cross-drive search has parity.

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
      "mediaMetadata": {
        "title": "Blue Highway",
        "artists": ["Deidian"],
        "album": "Moonstone Beach",
        "genres": ["soluna"],
        "year": 2026,
        "originalFileName": "04-blue-highway.mp3",
        "originalMime": "audio/mpeg",
        "parser": "music-metadata",
        "parsedAt": 1780944000000
      },
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
- Avatar is user-authored profile data. V1 provides generated color avatars from `avatarSeed` and allows the user to upload/crop an avatar image from Settings > This device.
- Uploaded avatar images are stored in the user's local DB and published to the user's R2 profile object path when profile publishing is enabled, not to MUZERO-hosted storage.
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

**Artist/album rollups are a *derived dimension*, not a new aggregate scope.** Per-artist and per-album listening time/play-count are computed at read time by folding the per-track signal (events + `trackPlaybackStats`) over each track's **current** `mediaMetadata.artists`/`album` — including remote/shared plays resolved via `remoteTrackRef` + synced `RemoteSearchTrack.mediaMetadata`. They are deliberately **not** added to `PlaybackAggregate["scope"]` and **not** synced as standalone rows: artist/album are mutable, high-cardinality strings, and pinning them into the synced aggregate layer would go stale on re-tag and violate the "aggregate cache is rebuildable from events" rule below. This keeps event truth and current-truth dimensions cleanly separated. See the [Artist & Album Library Entities PRD §3.4](../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md).

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

Artist and album detail views (library, not this PRD) additionally surface **per-artist / per-album** listened time and play count, plus a "Top artists" sort — all derived from this same per-track/event signal (see [Artist & Album Library Entities PRD](../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md) §3.4, §5). No new synced stats rows are introduced.

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

- [x] Browser can subscribe to a public manifest link and play an audio track.
- [x] Browser can subscribe to a public manifest link and play a video track.
- [x] Tauri/Electron use the same manifest import path.
- [x] No R2 write credential is required for subscription.
- [x] Command/Ctrl+F can search synced remote catalog rows locally.
- [x] Invalid manifests do not mutate local IndexedDB.

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

- [x] Implement local export plan from `sessions`, `tracks`, `memories`, and `mediaBlobs`.
- [x] Compute object keys for media/video/cover/memory photos.
- [x] Upload missing/changed media first.
- [x] Upload per-set `index.json`.
- [x] Upload the current device `DevicePublicProfile` when profile publishing is enabled.
- [x] Upload per-device stats objects only for the current device or explicitly granted trusted devices.
- [x] Rebuild optional `devices/index.json`, `stats/index.json`, and `presence/index.json` as owner-maintained discovery indexes.
- [x] Upload root `manifest.json` last.
- [x] Persist `syncObjects` mapping and `syncRuns`.
- [x] Add cancel support between objects.

### Phase 3 Checklist

- [x] Audio media syncs to R2.
- [x] Video media syncs to R2.
- [x] Track covers sync to R2.
- [x] Memory photos sync to R2.
- [x] Device avatar/profile syncs to R2 only where write permission exists.
- [x] Set metadata, `TrackBrief`, and normalized `Track.mediaMetadata` sync to R2 set indexes.
- [x] Progress shows object count, byte count, current phase, and failures.
- [x] Readers never see a manifest that references not-yet-uploaded objects.

### Phase 4: Cloud-to-Local Pull Sync + Conflict Handling

**Goal:** A user can pull remote changes into local IndexedDB and resolve conflicts.

**Tasks:**

- [x] Implement remote diff against local DB.
- [x] Add `SyncMutation` rows for local set/track/memory edits.
- [x] Upload per-device set mutation files under `sets/<setId>/mutations/<devicePublicId>/`.
- [x] Fold non-overlapping set mutations into the next owner-published `index.json` snapshot.
- [x] Add conflict detection for set/track/memory edits changed on both sides.
- [x] Add ETag/hash/conditional-write guard before overwriting mutable remote JSON objects.
- [x] Default merge rule:
  - [x] additive stats merge
  - [x] add new tracks/memories
  - [x] preserve local-only tracks unless user chooses delete
  - [x] latest `updatedAt` wins only for non-user-authored cache metadata
  - [x] user-authored set/track/memory fields use explicit conflict UI when both sides changed
  - [x] per-device profile conflicts use `revision` first, then explicit user choice
- [x] Add conflict UI with "keep local", "use remote", "duplicate both".
- [x] Add set-level indicators for local changes, remote changed, auto-merged, and needs review.
- [x] Add dry-run preview before applying large pulls.
- [x] Verify imported Blob roles match expected object roles.
- [x] Incrementally refresh remote search catalog pages by `updatedAt`/ETag/hash.
- [x] Lazy-load specific set/share indexes when a search result is opened.

### Phase 4 Checklist

- [x] Pull sync can recreate a set on a new device.
- [x] Pull sync can download media for offline playback.
- [x] Pull sync can stream without downloading.
- [x] Pull sync can update a large remote search catalog without downloading media bytes.
- [x] Conflicts are visible and never silently overwrite media.
- [x] Two devices adding different tracks to the same set can auto-merge.
- [x] Two devices renaming the same set differently produce a reviewable conflict.
- [x] Stale set snapshot publish fails/replans instead of overwriting remote changes.
- [x] Hash mismatch blocks import for that object.

### Phase 5: Anonymous Device Registry + Playback Stats Sync

**Goal:** MUZERO records device-local identity, play count, and listened duration. Devices with R2 write credentials can sync those stats through R2; read-only shared-link listeners keep the same stats locally.

**Tasks:**

- [x] Generate one anonymous random `DeviceRecord.publicId` per app profile.
- [x] Add UI to rename device.
- [x] Add optional device avatar/color seed for attribution chips.
- [x] Add optional uploaded avatar image with local storage and remote profile object reference.
- [x] Add Settings UI to upload/crop the local device avatar before syncing it through the existing profile publish path.
- [x] Publish `DevicePublicProfile` to owner/trusted drives when enabled and write permission exists.
- [x] Add profile `revision` and ETag/hash checks so two offline edits cannot silently overwrite each other.
- [x] Add `Memory.author?: MemoryAuthorRef` and backfill existing rows as unknown/local.
- [x] Show memory author on memory cards.
- [x] Track listened seconds while a track is actively playing.
- [x] Increment play count once per meaningful listen, not on every seek/replay glitch.
- [x] Persist `PlaybackEvent` with drive/share/set/queue context for every meaningful listen.
- [x] Derive `PlaybackAggregate` rows for track, track-in-set, track-in-share, set, share, and drive scopes.
- [x] Persist per-device `TrackPlaybackStats`.
- [x] Export/import immutable playback event segments under `stats/events/<devicePublicId>/`.
- [x] Flush playback event segments when either the event-count threshold or time threshold is reached.
- [x] Retry failed segment uploads without duplicating remote play counts.
- [x] Export/import rebuildable per-device aggregate cache under `stats/devices/<devicePublicId>/aggregate.json`.
- [x] Track uploaded event watermarks under `stats/devices/<devicePublicId>/checkpoint.json`.
- [x] Add optional `stats/index.json` for discovery, but do not make it the write-hot source of truth.
- [x] Keep public read-only listener stats local when no R2 write credentials are configured.
- [x] Keep read-only shared-link device profile/avatar local unless the user also has a writable Owner R2 target.
- [x] Reconcile existing `Track.playCount` with per-device stats.
- [x] Add tests around play threshold, pause/resume, seek, track change, and app close.

### Phase 5 Checklist

- [x] Listening to a track records listened seconds.
- [x] Listening to a track records play count according to the defined threshold.
- [x] Device display name appears in owner/publisher UI where no account exists.
- [x] Device avatar appears anywhere device attribution appears, with generated-avatar fallback.
- [x] Device profile updates sync only to writable targets and do not rewrite historical memories.
- [x] Memory cards show author attribution when available.
- [x] Stats survive reload.
- [x] Stats merge correctly from two devices.
- [x] Rebuilding aggregates from event segments does not lose play counts.
- [x] Sync UI shows pending local listens separately from uploaded/aggregated listens.
- [x] Pending listening stats flush at 25-100 events or 5-15 minutes, whichever threshold is reached first.
- [x] Manual Sync can flush a small pending stats segment below the normal event-count threshold.
- [x] A large shared playlist can keep local stats separated across many anonymous devices.
- [x] The same track in two sets can show separate track-in-set play counts.
- [x] A track played from someone else's shared set can be recorded locally without importing the track.
- [x] A user can sync their own listening history about shared tracks to their own Owner R2.
- [x] Trusted devices with write credentials can sync separated stats to the shared R2 bucket.
- [x] UI can show total plays and listened time.

### Phase 6: Optional Low-Frequency Currently-Playing Presence

**Goal:** Trusted devices can optionally write "recently listening" state to the same user-owned R2 library, and other devices can display it without a MUZERO backend.

**Tasks:**

- [x] Add `NowPlayingPresence` schema.
- [x] Add visible Settings toggle, default off.
- [x] Enable remote presence writes only when owner/trusted R2 write credentials are configured.
- [x] Write presence on track start, pause, resume, stop, and track change.
- [x] Add throttled heartbeat while playing, at most once per 60 seconds.
- [x] Write presence to `presence/devices/<devicePublicId>.json`.
- [x] Read presence only while the "Listening now" UI is visible, at a low polling interval.
- [x] Ignore expired presence records based on `expiresAt`.
- [x] Add cost/operations warning in Settings for public shared libraries.

### Phase 6 Checklist

- [x] Presence can show which trusted anonymous device is listening to which track.
- [x] Read-only public listeners do not attempt remote presence writes.
- [x] Expired devices disappear without requiring deletes.
- [x] Presence writes are throttled and do not happen every second.
- [x] Presence reads are scoped to the visible UI and stop when hidden/backgrounded.
- [x] The feature remains optional and off by default.

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
- Manifest may include user-visible titles, artists, albums, genres, tags, notes, original import filenames, and generated lyrics/briefs. The publish UI must warn that public buckets make these readable by anyone with the link.
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
| [Artist & Album Library Entities](../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md) | Consumes synced `mediaMetadata` (§3.4.2) for cross-drive entities/facets; defines artist/album stats as a derived dimension over §3.8's event/aggregate model. |
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
| 5 | Should stream mode create remote-only tracks without `blobId`? | Resolved | Yes. V1 already streams remote-only tracks from a public URL. Next: a per-drive media-URL resolution abstraction (owned → local presign of a private object; shared → broker presign; public → open URL) so the bucket can be private by default (see §2.6.1). `<audio>`/`<video>` need the auth in the URL, hence presign. |
| 6 | Should sync include chat sessions? | Resolved | No for this PRD; chat sync is out of scope due prompt/privacy sensitivity. |
| 7 | Can browser and desktop share identical R2 write implementation? | Open | Prefer one S3 signing client with `getAppFetch()` injection; validate bundle size before adding AWS SDK. |
| 8 | Should anonymous public listeners be able to contribute stats/presence to the owner? | Resolved | Not in the R2-only PRD. Requires a future user-deployed Worker or presigned-upload broker. |
| 9 | Should device display name/avatar updates rewrite existing memories? | Resolved | No. Memories keep author snapshots; profile updates write only the per-device profile object and optional avatar object. |
| 10 | Should private sharing have a no-backend, client-side-encryption fallback (a "share password")? | Resolved | No. Considered & rejected (see §2.6.1): coarse revocation + duplicate mechanism + playback complexity; its only edge is "no backend". Private/controlled sharing is always Tier ② (broker, V3). Until V3, only own-devices (Tier ①) and truly-public (Tier ③) exist. |

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

## 12. Implementation Audit — 2026-06-11

> Full-codebase re-audit after two days of post-phase feature work (lyrics, ranks, entity covers, streaming sources, library entities). Two outputs: **(12.1)** the wiring truth — what is actually reachable in the running app vs built-but-unwired — and **(12.2)** sync edge cases found by reading the engine end to end. Findings feed the Phase 7 hardening backlog (12.3).

### 12.1 Wiring truth

**Wired and live:**

- Manual per-drive publish: `CloudDriveRow` → `useSyncStore.publishDrive` → orchestrator → `buildR2ExportPlanForDrive` + `runR2PublishSync`; live progress + durable `syncRuns`; cancel between objects.
- Per-drive-row browse + import: `CloudDriveSets` → `subscribeManifest`/`loadRemoteSetIndex` → `importRemoteSetStream` (raw path — see F2).
- Presence: write coordinator on playback events (player-store) + `useRemotePresence` poller on Now Playing for `ses_remote_` sets.
- Playback stats: recorded on listens; manual sync flushes a small pending segment.
- Round-trips: lyrics (manual-wins), rank, memory `atSec`, cover thumbhash, memory authors; entity-cover **export**.

**Built and tested, but NOT reachable in production:**

| Component | State | Consequence |
|-----------|-------|-------------|
| `useSyncStore.pullRemoteSet` (orchestrated pull: dry-run diff → conflict/blocked gates → apply → pull `syncRuns`) | zero UI callers | the only live import path is the raw one (F2) |
| `R2ConflictResolutionPanel` (keep-local / use-remote / duplicate-both) | component exists, never mounted | conflicts have no resolution surface |
| `recordSyncMutation` | zero production callers — no repository/store records mutations on set edits | the entire mutation machinery (folding, set-mutation objects, overlap conflicts, pull conflict detection, `needs-review`) is unreachable; publish is effectively a full-state mirror |
| mutation `syncedAt` | nothing ever sets it | if mutations were ever recorded, they would re-fold + re-upload forever, and an overlap conflict would permanently dead-end publish in `needs-review` (it returns before uploading) with no resolve/clear path |
| `importRemoteEntityCovers` | zero callers; `subscribeManifest` doesn't even surface `entityCoversIndex` | entity covers publish but never land on the subscribing device (export-only half-feature) |
| Remote search catalog (§3.4.2) | exporter never emits `catalog/library.json`; importer `r2-search-index.ts` has zero callers | end-to-end unwired — only the query/matching layer (`matchesRemoteSearchTrack`) is live, against an effectively empty cache table |
| `setIndexPreconditions` / device-profile ETag (`If-Match` guards) | supported by plan/publish, never passed by `sync-store` | stale-overwrite protection exists but is dormant; all JSON writes are unconditional |

### 12.2 Sync edge-case findings

| # | Severity | Finding |
|---|----------|---------|
| **F1** | **High** | **Re-import clobbers local state on remote tracks.** `importRemoteSetStream` `bulkPut`s whole `trk_remote_*` rows rebuilt from the manifest (`r2-import-stream.ts:119–140`). Re-importing an updated set wipes: `blobId` (cached offline media → blob orphaned in `mediaBlobs`, playback silently falls back to streaming), local `liked`/`tags` edits, `playCount`, local `coverBlobId`/`coverCrop`. Lyrics/memories merge politely; the track row does not. |
| **F2** | **High** | **The live import path has no protection.** `CloudDriveSets.importSet` calls `importRemoteSetStream` directly, bypassing `dryRunRemoteSetPull` — so no `keep-local` guard (local-newer is overwritten), no conflict gate, no pull `syncRuns` history, no cancellation. The protected orchestrated path exists but is the unwired one (§12.1). |
| **F3** | **High (structural)** | **Conflict machinery is dead in production** (no mutation writers, no `syncedAt` writer, panel unmounted — §12.1). Local edits to imported sets are silently lost (F1/F2); two-device edits to one drive merge by overwrite. Decide: either wire mutations end-to-end (record on set edits → mark synced after publish → mount the panel), or delete the machinery and declare LWW-mirror semantics. Keeping it half-built invites accidental activation → permanent `needs-review` deadlock. |
| **F4** | **High (multi-device)** | **Publish is a single-writer mirror; a second device's publish erases the first.** `devices/index.json`, `stats/index.json`, `presence/index.json` are each rebuilt listing **only the local device** (`r2-export-plan.ts:721–774`), and `manifest.json` lists only the publisher's local sets — all written unconditionally (no `If-Match`, §12.1). Device A then B publish → A vanishes from every index + any A-only sets vanish from the manifest (objects remain orphaned). Until merge-on-publish (read-modify-write indexes + union manifests) lands, the PRD must state the rule: **one writing device per drive**; additional devices subscribe read-only. |
| **F5** | **Medium (policy)** | **Cached streamed tracks DO export their media bytes.** The export filter is only `!track.blobId` (`r2-export-plan.ts:167`), and `cacheStreamedTrackBlob` sets `blobId` on streamed tracks — so a downloaded YouTube/NetEase track's bytes upload to the user's R2, contradicting the schema comment ("exporting their media bytes is intentionally out of scope"). Meanwhile *un-cached* streamed tracks are **silently dropped** from the set index, but `manifest.sets[].trackCount` still counts them (`session.trackIds.length`) → subscriber previews over-report. Pick a policy: skip `origin === "streamed"` always (consistent, conservative) or export-if-cached and update the schema comment + a publish-time disclosure. |
| **F6** | **Medium** | **Cancel is weaker than the UI implies.** Publish: the abort signal is checked only between objects — `r2SignedFetch` never receives it, so a multi-hundred-MB in-flight PUT cannot be cancelled. Pull/import: no abort support at all, yet the sync-indicator toast offers Cancel for both directions. |
| **F7** | **Medium** | **One failed object aborts the whole publish** (`r2-publish.ts:66–69`): no retry/backoff, no continue-with-rest. Re-running self-heals via HEAD-skips for content-addressed binaries, but every JSON re-uploads, and a flaky object late in a big plan wastes the run. Pull: a media-cache failure after a successful import marks the run `failed` even though the session landed (misleading history). |
| **F8** | **Low** | **Publish and pull share one controller/progress slot per drive** (`sync-store.ts:39`): concurrent publish + import on the same drive overwrite each other's `AbortController` (first becomes uncancellable) and interleave one progress line. |
| **F9** | **Low** | **Dead/stale guards:** the pull `blocked: hash-mismatch` gate compares against `syncObjects.sha256`, but set-index JSON objects are recorded without `sha256` → unreachable. The streamed-origin schema comment is stale (F5). `plan.totalBytes` double-counts duplicate content-addressed objects (same blob on two tracks) → progress % overshoots; second occurrence self-skips via HEAD. |
| **F10** | **Low (accepted)** | **LWW uses device wall clocks** (entity covers `updatedAt`, set diff `remoteUpdatedAt > local.updatedAt`): clock skew across devices can pick the older write. Acceptable for v1 single-writer; revisit with F4. |
| **F11** | **Low** | **Track `coverCrop` doesn't travel** — `r2SetTrackSchema` has no crop on the track cover (entity covers do carry one), so a cropped cover renders differently on the subscribing device. |

### 12.3 Phase 7: Sync Hardening — ✅ Done (2026-06-11)

**Goal:** close the audit gaps — make the live paths safe (F1/F2), settle the half-built machinery (F3), and declare or fix multi-device semantics (F4).

**Outcome:** all eleven items closed in seven TDD slices (commits `67591ac` → F4 copy). Three threads were *resolved by decision* rather than code: the mutation machinery stays dormant until the **multi-writer phase** (which also owns merge-on-publish for F4 and the index `If-Match` writes), and the remote search catalog stays deferred until a too-large-to-import drive exists. F9's dead hash-mismatch gate and F10's clock-skew note remain documented-as-is (both are subsumed by the multi-writer phase).

- [x] F1: merge-preserving re-import — `importRemoteSetStream` now field-merges existing `trk_remote_*` rows: remote stays authoritative for content (title/brief/media URLs/metadata), local wins for `blobId`/`coverBlobId`/`coverCrop`/`liked`/`tags`/`note`/`playCount`/`updatedAt` (simple local-wins rule; no per-field clocks). First imports take remote verbatim.
- [x] F2: `CloudDriveSets.importSet` now routes through `useSyncStore.pullRemoteSet` — dry-run diff gates (keep-local / conflict / blocked), durable pull `syncRuns`, and outcomes rendered by the existing per-drive progress line + sync toast. The raw importer is no longer called from UI.
- [x] F3 (decision + hazard defused): the mutation machinery is **kept, dormant** — it's the foundation for the future multi-writer phase, and deleting tested protocol code buys nothing. The structural hazard is fixed: a successful publish now marks the drive's pre-run unsynced mutations `syncedAt` (in the same transaction as the run bookkeeping), so if mutations ever get recorded they can no longer re-fold/re-upload/re-conflict forever. **Deferred to the multi-writer phase:** recording mutations on set edits + mounting `R2ConflictResolutionPanel`. Until then, sync semantics are an LWW mirror protected by the F1 local-wins merge and the F2 pull gates.
- [x] F4 (documented now; merge deferred): the Sync & CORS pane shows a "one writing device per drive" notice (`settings.cloudSingleWriterHint`, en/zh/ja/ko) explaining that publish rebuilds the manifest + device indexes from the publishing device and a second writer overwrites the first — other devices should add the drive as a read-only shared link. The real fix (read-merge-write for `devices/stats/presence` indexes + manifest set-union + passing `If-Match` preconditions) is the **multi-writer phase**, out of Phase 7's hardening scope.
- [x] F5: streamed-track export policy decided + enforced — Phase 7 initially chose the conservative policy of skipping `origin === "streamed"` unconditionally. That was later superseded by Phase 22 after product clarified the R2 bucket is the user's private cloud drive: streamed tracks now publish source metadata, and cached streamed media bytes publish when a concrete local `mediaBlobs` row exists.
- [x] F6: real cancellation — `r2SignedFetch` forwards the abort signal into the underlying fetch (in-flight PUT/HEAD abort, not just between objects), and pull is now abortable end-to-end: `ApplyRemoteSetPullInput.signal` is checked before mutating and between media downloads, the media-cache fetch takes the signal, the orchestrator forwards it and reports `cancelled` (new `PullRunResult` variant), and an aborted pull run is recorded as `cancelled` (not `failed`).
- [x] F7: per-object PUT retry with exponential backoff (default 3 attempts; only network errors + 5xx/429 retry — a 412 precondition surfaces immediately; abort is never retried); a failed HEAD probe now degrades to "not skippable" instead of killing the publish; pull media-cache failures no longer fail the run — the import completes with a `cacheFailures` count recorded on the `syncRun`.
- [x] Entity covers: the read half is wired — `loadRemoteEntityCovers(preview)` fetches + validates the manifest-referenced `library/entity-covers/index.json`, and the drive browse imports it via `importRemoteEntityCovers` (LWW keeps strictly-newer local covers; best-effort — a covers failure never blocks browsing sets).
- [x] Search catalog: **deferred by decision.** §3.4.2's remote search catalog is a scale feature (searching a large drive without importing its sets), not a hardening fix — emitting paged catalogs needs a pagination/refresh design of its own. Current reality stands: the schemas + matching layer (`matchesRemoteSearchTrack`) and the importer exist and are tested, but the exporter emits no `catalog/library.json` and nothing triggers the importer; remote search works on imported sets only. Revisit when a drive too large to import-by-set actually exists.
- [x] F8: per-drive operations serialized — `useSyncStore.publishDrive`/`pullRemoteSet` refuse to start while another operation holds the drive's `AbortController` (registered before the async context resolve, so rapid double-clicks can't slip through); the refused call logs a warning and leaves the in-flight op's progress untouched.
- [x] F11: track `coverCrop` travels in the set index (additive optional `r2CropSchema`); import takes the published crop on fresh imports while a local crop edit wins on re-import (consistent with the F1 merge).

### 12.4 Phase 8: Multi-writer library (read-merge-write publish)

**Goal:** 两台设备都能写回同一个盘 — multiple devices each publish their own sets/stats/profile/presence to ONE drive without erasing each other. This resolves the deferred half of F4 and turns §3.11's multi-writer rules into running code.

**Design:**

1. **Read-merge-write.** Before planning, the publisher fetches the *remote publish base* — `manifest.json` + `devices/stats/presence` indexes — via **signed GETs** (works for public and, later, private buckets), capturing each object's ETag.
2. **Merge rules** (pure, `r2-publish-merge.ts`): per-device discovery entries upsert by device id with LWW on the entry clock; manifest `sets` is a union keyed by set id with an additive `publishedBy` (device publicId) ownership stamp — the publisher is authoritative for its OWN sets (including deletions), other devices' sets are preserved verbatim, and legacy un-attributed sets are preserved conservatively.
3. **Conditional writes.** Manifest + the three indexes PUT with `If-Match: <etag>` (or `If-None-Match: *` when absent). A concurrent publish that changed the base since our read yields HTTP 412 → refetch base → re-merge → retry (bounded), so the race loser merges instead of clobbering.
4. **Out of scope (a later co-editing phase):** two devices editing the SAME set. A set keeps one owning device; other devices' edits to an imported copy stay local (protected by the F1 merge + F2 gates). The dormant mutation machinery (recording on edits, conflict panel) is that phase's foundation.

**Checklist:**

- [x] MW-1 Pure merge layer: `mergeDevicesIndex` / `mergeStatsIndex` / `mergePresenceIndex` / `mergeManifestSets` (+ formalized `r2DevicesIndexSchema`/`r2StatsIndexSchema`, additive `publishedBy` on manifest set summaries).
- [x] MW-2 `fetchRemotePublishBase`: signed GETs + ETag capture; 404 → absent (first publish); invalid JSON/schema → absent with warning (overwrite is the recovery); any other failure throws so a blind overwrite can't happen ("GET" added to the signing client).
- [x] MW-3 Export plan consumes the base: devices/stats/presence indexes merge with remote entries; the manifest unions sets (own sets stamped `publishedBy`, others preserved verbatim), preserves the library `createdAt`, and falls back to the remote manifest's discovery pointers for indexes this run didn't rewrite; merged JSON writes carry `If-Match` (etag) / `If-None-Match: *` (absent) — no base → legacy unconditional behavior, so MW-3 is safe standalone.
- [x] MW-4 Orchestrator fetches the base before planning (typed `R2PublishHttpError` from the executor) and on a 412 conditional-write loss refetches → re-merges → retries (≤2 extra attempts; non-412 failures never refetch; base-fetch failure fails the run). `useSyncStore` injects the real `fetchRemotePublishBase`, so every UI publish is now read-merge-write.
- [x] MW-5 Settings copy: `settings.cloudMultiWriterHint` (en/zh/ja/ko) replaces the single-writer warning — publish merges with the drive's current state, conflicts auto-re-merge, and a set still belongs to its publishing device. Preview-verified; the full sync surface (53 files / 270 tests) is green.

**Outcome (2026-06-11): Phase 8 ✅.** Two (or more) devices can each add the same drive with write credentials and publish — libraries union in the manifest (`publishedBy` ownership), per-device profiles/stats/presence coexist in merged indexes, concurrent publishes resolve by 412 → re-merge → retry, and deletions propagate only for the deleting device's own sets. Remaining for the future **co-editing phase**: two devices editing the SAME set (mutation recording on edits + the dormant conflict panel + `keep-local`/`use-remote`/`duplicate-both` appliers); F10's wall-clock LWW skew also lives there.

### 12.5 Phase 9: Same-set co-editing (one user, multiple devices)

**Goal:** 多台设备编辑同一个歌单 — add tracks to, remove tracks from, rename, and reorder the SAME set from any of the user's devices, converging through the drive.

**Design (extends §12.4's read-merge-write; no mutation machinery needed for the single-user case):**

1. **Adds = union.** Each device publishes its local-origin members of the set (including media bytes for its own uploads); members contributed by other devices stay on the remote side of the merge (`trk_remote_*` rows are never re-exported — the remote index already carries them). Set-index merge unions tracks by published id; the local entry wins for an id both sides have.
2. **Removals = tombstones.** `DjSession.removedTracks` (trackId → removedAt, capped 200, additive non-indexed) records removals at the repo layer (`removeTracksFromSession`, `deleteTracks`); re-adding clears the tombstone. The set index carries additive `removedTracks: [{id, removedAt}]`; merge = tombstone union applied to the track union, EXCEPT ids the local session re-added after its pull-merge (re-add intent drops the remote tombstone). Without tombstones, a stale copy resurrects removed tracks.
3. **Metadata = LWW** on `set.updatedAt`; **order = ranks** carried per entry (existing).
4. **Sync now becomes bidirectional:** after the base fetch, a **pull-merge** applies the remote set index INTO matching local sessions (other devices' new tracks land as remote-backed rows, tombstones remove membership, metadata LWW) — then the publish merge writes the union back with `If-Match`; 412 → §12.4's re-merge retry.
5. **Imported sets write back:** `ses_remote_<driveId>_*` sets publish back to their source drive under the ORIGINAL set id; manifest `publishedBy` stays with the original publisher (co-editing never steals ownership; only the owner's local deletion drops the manifest entry).

**Checklist:**

- [x] CE-1 Tombstone data layer: `DjSession.removedTracks` + repo recording on remove/delete-everywhere, cleared on re-add, capped 200; additive `removedTracks` on `muzero-r2-set-index-v1`.
- [x] CE-2 Pure `mergeSetIndex`: track union (local wins by id, remote order preserved, local-only appended), metadata LWW on `set.updatedAt`, tombstone union (max removedAt, capped 200) applied to the union with the re-add exception, revision bumps past both sides.
- [x] CE-3 Publish side: `fetchRemotePublishBase` also fetches the published sets' remote indexes (+ ETags); the export plan merges each set with its remote index under the **published id** (`publishedEntityId` strips the `_remote_<driveId>_` prefix — imported sets write back under their original ids, `trk_remote_*` members and streamed tracks never re-export, tombstones travel under published ids), set indexes write with `If-Match`, the manifest summary keeps the original `publishedBy`, and the store now includes the target drive's imported sets in `setIds`.
- [x] CE-4 Pull-merge into local sessions during Sync now (`applySetPullMerges`, run after every base fetch incl. 412 refetches): other devices' members land as remote-backed rows with their memories + ranks, remote tombstones drop membership (`session.lastPulledAt` distinguishes a genuine re-add from a stale copy), a pending local tombstone is never re-added, and set metadata is LWW. Store injects it.
- [x] CE-5 The Sync & CORS notice now describes bidirectional sync (en/zh/ja/ko, preview-verified); full sweep green (sync + stores + settings + repositories: 325 tests).

**Outcome (2026-06-11): Phase 9 ✅.** Any of the user's devices can add tracks to, remove tracks from, rename, and reorder the SAME set; one Sync now click receives the other devices' edits and publishes the merged result. Semantics: adds union (both sides kept), removals propagate via capped tombstones with a re-add escape hatch, metadata LWW, order via ranks, ownership (`publishedBy`) never moves. Known limits (recorded): per-track field conflicts resolve by local-entry-wins (no per-track clocks); tombstone/LWW clocks are device wall clocks (F10); the dormant mutation/conflict-panel machinery remains reserved for a future multi-USER (untrusted writers) phase.

### 12.6 Phase 10: Automatic sync + R2 scale optimizations

**Goal:** make cloud drive sync feel automatic without turning R2 into a hot, fragile coordination service. The existing manual `Sync now` path remains the source of truth; automatic sync is a visible user setting that schedules the same orchestrated publish/pull pipeline with conservative throttling, backoff, and conflict gates.

**Product requirements:**

1. **Per-drive automatic sync frequency.** Each writable owner/trusted drive can choose `Manual only` (default), `On app start`, `Every 15 min`, `Every 30 min`, `Every 60 min`, and `After local changes`. Read-only/shared drives do not show write-frequency controls.
2. **Visible and reversible.** The setting lives in Settings > Cloud Drive on the drive card, not in hidden flags, URL params, or localStorage-only toggles. The card shows the next scheduled sync, last auto-sync result, and whether the scheduler is paused.
3. **Scheduler guardrails.** Auto sync must not call `setInterval(sync)` blindly. It checks: drive write capability, local R2 credentials, no in-flight per-drive operation, app visibility, network reachability when detectable, last success/failure time, pending local changes, and the user's selected frequency.
4. **Debounce local changes.** `After local changes` waits at least 2-5 minutes after the latest local mutation before syncing, with a minimum interval between runs. Batch edits should collapse into one publish.
5. **Jitter + backoff.** Scheduled runs add jitter so multiple devices do not all publish at the exact same minute. Consecutive failures use exponential backoff and stop escalating after a capped delay.
6. **Conflict pause.** `needs-review`, a bounded 412 retry failure, repeated auth/CORS failures, or user cancellation pauses auto sync for that drive until the user manually retries or changes settings.
7. **Manual remains first-class.** `Sync now` bypasses the schedule delay, still uses the same per-drive controller/progress row, and can be cancelled. A manual success may clear a scheduler pause.
8. **Battery/data respect.** Mobile builds should default to `Manual only`; later mobile-specific options may restrict auto sync to Wi-Fi/charging, but those controls are out of the desktop-first v1 slice.

**Upload throughput requirements:**

1. **Bounded upload concurrency.** Introduce a user-visible `Upload concurrency` setting per drive or global cloud sync settings, with conservative choices `1`, `2` (default), and `3`.
2. **Only immutable bytes run in parallel.** Media, cover, memory photo, avatar, and immutable stats-event segment objects may upload concurrently. Mutable JSON (`sets/*/index.json`, devices/stats/presence indexes, checkpoints, and `manifest.json`) remains ordered and conditional.
3. **Manifest remains last.** The root manifest is still the final write. A failed media/index upload must prevent the manifest from referencing incomplete content.
4. **Progress stays intelligible.** The progress row continues to show object count, byte count, current object, and phase. With concurrency, `currentKey` may mean "one of the active uploads"; UI may show a small active-count label instead of flickering keys.
5. **Resume semantics stay object-level.** Persist each successfully uploaded resumable object immediately in `syncObjects`. A failed run can skip already-uploaded content-addressed objects on retry. Byte-level resume is explicitly deferred to multipart upload.
6. **Bandwidth limit is later.** A true speed cap requires a throttled `ReadableStream`/chunked body path and platform testing. It should not block bounded concurrency.

**R2 protocol optimization backlog:**

1. **ETag-aware reads.** Store remote manifest/index ETags and use conditional GETs where available to avoid re-downloading unchanged JSON during read-merge-write.
2. **Dirty-set planning.** Track which local sets/devices/stats changed since the last successful sync. A scheduled auto sync should plan only dirty entities plus required discovery indexes whenever possible.
3. **Avoid duplicate object accounting.** De-duplicate identical content-addressed objects in `plan.totalBytes` and progress totals so progress does not over-count the same blob referenced by multiple tracks.
4. **Paged large set indexes.** For very large sets, split `sets/<setId>/index.json` into a small header plus paged track/memory/member pages. This reduces write amplification for small edits and makes remote browsing cheaper.
5. **Append-only mutation logs.** For multi-user/trusted-collaborator scenarios, prefer per-device append-only mutation files under `sets/<setId>/mutations/<devicePublicId>/...` and periodic snapshot compaction over having every device race to rewrite the whole set index.
6. **Multipart upload for huge videos.** Add S3 multipart upload only after the object-level resume path is stable. Multipart must persist upload id/parts safely, abort stale multipart sessions, and keep manifest-last atomicity.
7. **Private/broker path remains separate.** Anonymous listener writeback, revocable invites, presigned upload grants, and private-by-default sharing require the future Worker broker / `mu0.app` control plane; they are not hidden inside the R2-only scheduler.

**Checklist:**

- [x] AS-1 Add persisted sync scheduling settings (`Manual only` default) and Cloud Drive card controls with en/zh/ja/ko copy.
- [x] AS-2 Implement a per-drive scheduler that triggers the existing orchestrator, honoring in-flight guards, jitter, debounce, backoff, and conflict pause.
- [x] AS-3 Add dirty tracking so automatic runs can skip when there is nothing meaningful to publish.
- [x] AS-4 Add bounded immutable-object upload concurrency while preserving ordered conditional JSON writes and manifest-last publish.
- [x] AS-5 Update progress UI/tests for concurrent active uploads and scheduler state.
- [x] AS-6 Add ETag/conditional-read cache for manifest/index base fetches.
- [x] AS-7 Revisit large-library scale: paged set indexes, mutation-log compaction, and multipart upload as separate implementation slices.

**AS-7 scale follow-up decisions:**

1. **Paged set indexes become a future protocol slice, not a hidden change.** Keep `sets/<setId>/index.json` as the v1 canonical snapshot until a real set size threshold justifies pagination. The future slice must add an additive manifest/index capability such as `pages`, keep legacy readers working, and test mixed v1/vpaged subscribers.
2. **Mutation-log compaction remains reserved for multi-user/trusted-collaborator sync.** The current single-user multi-device flow already merges same-set edits with tombstones/ranks. Append-only mutation files under `sets/<setId>/mutations/<devicePublicId>/...` should become the normal transport only when untrusted or semi-trusted writers need reviewable conflict resolution and snapshot compaction.
3. **Multipart upload is a separate large-video resilience slice.** The current Phase 10 implementation remains object-level resumable: a successful object is persisted immediately and skipped on retry; a failed single PUT retries the whole object. Multipart must design persisted upload ids, part checksums, complete/abort cleanup, and manifest-last safety before implementation.
4. **No automatic protocol migration in Phase 10.** AS-1 through AS-6 already deliver the user-visible automatic sync and R2 performance wins without changing reader compatibility. Large-library protocol changes need their own PRD/checklist and migration tests.

**Non-goals for Phase 10:**

- No hidden auto-sync feature flag.
- No background daemon outside the app lifecycle.
- No central lock server or MUZERO backend.
- No byte-level resume until multipart upload is designed and tested.
- No anonymous public writeback without the future broker layer.

**Outcome (2026-06-11): Phase 10 ✅.** Cloud drives now have visible per-drive auto-sync frequency and upload-concurrency controls; an app-lifecycle scheduler triggers the existing orchestrated Sync now path with app-start/interval/change-debounce policy, jitter, visibility/network/in-flight guards, failure backoff, and pause-on-conflict/cancel/failure semantics. Automatic sync skips empty runs via dirty tracking, immutable/resumable objects can upload with bounded concurrency while JSON barriers and manifest-last safety remain intact, progress UI shows active uploads and pause state, and remote base reads use ETag/304 caching. Larger protocol changes (paged set indexes, mutation-log compaction, multipart upload) are deliberately split into future slices.

### 12.7 Phase 11: Trusted-device setup link + local device naming UX

**Goal:** reduce repeated R2 setup friction across the same user's own devices without weakening the public share/write-credential boundary.

**Product requirements:**

1. **Copy one trusted-device setup link from a configured writable R2 drive.** The connected-drive card exposes a copy action only when the local device has write credentials for that drive.
2. **Paste-to-add on another trusted device.** The Add Drive dialog accepts the setup link in the same paste field as share/manifest URLs. A recognized setup link creates a writable `trusted` drive and stores the R2 credentials in the receiving device's local `AppSettings`.
3. **Clear trust labeling.** The UI must call this a trusted-device setup link, not a public share. Copy hints must state that the link contains write credentials and should only be sent to the user's own trusted devices.
4. **Credential locality remains intact.** The link is an explicit user-copied transfer bundle; credentials still do not go into `CloudDrive` rows, synced manifests, logs, telemetry, or public read-only links.
5. **Casual exposure reduction.** The setup payload uses a custom `muzero://trusted-r2-drive#v1=...` fragment bundle so the secret is not shown as plain form fields or normal query parameters. This is not encryption; anyone with the full link can recover the credentials.
6. **Local display names stay user-editable.** Settings > This device continues to let the user rename the local device profile.
7. **Creation-time name conflict avoidance.** When a local device profile is first created, its default display name must avoid existing device names in the local registry, case-insensitively (`Browser`, `Browser 2`, `Browser 3`, ...).

**Non-goals for Phase 11:**

- No public write invite.
- No revocation of copied setup links beyond rotating the user's R2 token in Cloudflare.
- No MUZERO-hosted broker or credential vault.
- No encrypted/passphrase-protected transfer bundle yet. If added later, it must be explicit in the UI and tested as a separate security slice.

**Checklist:**

- [x] TS-1 Add tested setup-link encode/decode helpers and trusted-drive construction that never embeds credentials in `CloudDrive`.
- [x] TS-2 Add copy setup action on writable R2 drive cards with en/zh/ja/ko trusted-device warning copy.
- [x] TS-3 Teach Add Drive to recognize a trusted-device setup link and save the receiving drive as writable `trusted` with local-only credentials.
- [x] TS-4 Keep device display name editable and add creation-time default-name conflict avoidance with repository tests.

**Outcome (2026-06-11): Phase 11 ✅.** A configured owner/trusted R2 drive can now copy a trusted-device setup link; another MUZERO install can paste it into Add Drive and become a writable trusted device without manually retyping endpoint, bucket, public URL, access key, secret, or prefix. The UX explicitly warns that the link contains write credentials and is only for the user's trusted devices. Local device profiles remain renameable, and new local profiles avoid default-name collisions.

### 12.8 Phase 12: Device Avatar UX + Source Attribution

**Goal:** make multi-device / multi-drive libraries understandable at a glance by pairing every publish source with a visible avatar + name while keeping V1's no-account, R2-only boundary.

**Status (2026-06-12):** Phase 12 is completed. The browse/import path now resolves `devices/index.json` plus per-device `profile.json` when available, falls back safely to the index summary or drive label, and stores a display-only `cloudSource` snapshot on imported set/track rows. Remote set preview rows, imported set headers, and cloud-imported track rows render the same avatar/name source chip. Device names/avatars remain attribution only and do not imply trust.

**Product requirements:**

1. **Local device avatar upload.** Settings > This device lets the user choose an image, crop it square, store it as a local `mediaBlobs(role="avatar")` object, and point `DeviceRecord.avatarBlobId` at it.
2. **Avatar sync is explicit.** The avatar only uploads to owner/trusted writable R2 drives when profile publishing is enabled; read-only/public drives never receive local profile data.
3. **Set owner attribution.** Remote set preview/import surfaces should resolve `manifest.sets[].publishedBy` through `devices/index.json` and/or `profiles/devices/<id>/profile.json`, then show avatar + display name with fallbacks to generated seed, public id, and drive label.
4. **Track/source attribution.** Tracks and sets imported from `ses_remote_<driveId>_*` / `trk_remote_<driveId>_*` should show a small source indicator in list rows and set headers so users can tell whether a song came from this device, another trusted device, or another connected cloud drive.
5. **No trust implication.** Device name/avatar are attribution only, not authentication. Write permission remains governed solely by local R2 credentials or future broker grants.

**Checklist:**

- [x] DA-1 Add tested Settings avatar upload/crop UI and local avatar media storage.
- [x] DA-2 Load remote device profiles/indexes during cloud-drive browse/import and cache safe display fields locally.
- [x] DA-3 Render owner/source avatar chips on remote set preview rows, imported set headers, and track rows.
- [x] DA-4 Add fallback and privacy copy: local-only when profile publishing is off; generated avatar/public id when a profile image is missing.

**Outcome (2026-06-12): Phase 12 ✅.** Device avatar publishing stays explicit and writable-drive-only, while subscribers can now understand where remote content came from without re-entering context manually. A missing or invalid per-device profile no longer blocks set browsing/import; MUZERO uses the owner-maintained devices index, public id, and drive label fallbacks. Imported rows cache only safe display fields (`driveId`, local drive label, optional `devicePublicId`, display name, avatar seed, avatar URL), so list/header attribution remains available offline and does not become an authentication boundary.

### 12.9 Phase 13: Sync Mode UX + Remote Playback Reliability + R2 Setup Flow

**Goal:** make cloud-drive setup feel like one coherent workflow, make the automatic/manual sync choice explicit, and ensure imported R2 songs are immediately playable, not merely downloadable.

**Status (2026-06-11):** Phase 13 is completed. Remote R2 playback now fetches the remote object through MUZERO's CORS-aware app fetch path and plays a temporary Blob so the WebAudio graph cannot mute a cross-origin media element; newly added/defaulted cloud drives now use automatic mode that imports every remote set through the guarded pull pipeline; Settings exposes one consolidated Cloud Drive area for setup, connected drives, sync state, and CORS; and the Add Drive flow is a two-column R2 setup guide that separates public read/CORS from optional write credentials.

**Product requirements:**

1. **Two visible sync modes.**
   - `Automatic sync` is the default for newly added writable owner/trusted drives.
   - `Automatic sync` should automatically import all remote sets when a drive is added or refreshed, and should keep using the existing guarded sync pipeline for bidirectional owner/trusted changes.
   - `Manual sync` keeps the drive connected but requires the user to click preview/import/sync actions.
   - Read-only/public drives can still default to automatic import-all because that path has no write credentials and no local secrets.
2. **Remote playback reliability.**
   - R2-imported tracks may remain non-persistent/streamed locally, but playback must load the media through a CORS-enabled path before WebAudio visualization/analyser wiring.
   - In the web app, remote R2 media playback fetches the object through `getAppFetch()` into a temporary Blob and then uses the existing local Blob media path. This avoids the browser's cross-origin media-element + WebAudio silent-output behavior.
   - A remote track that can be downloaded through MUZERO must also be playable through MUZERO.
   - Durable offline caching remains an explicit separate action; the playback Blob is temporary and is not linked to `track.blobId`.
3. **Settings UI consolidation.**
   - The current cloud-drive, sync, CORS, and setup-link surfaces should be merged into one `Cloud Drive` settings area instead of scattered sidebar destinations or disconnected cards.
   - Drive cards should show mode, last sync state, progress, CORS/public-read health, import status, and actions in one scan-friendly block.
4. **R2 setup modal as a two-column guide.**
   - The left column is the form/progress stepper.
   - The right column is contextual guidance for the selected step, with direct Cloudflare links and exact copy/paste snippets where applicable.
   - Steps should separate: bucket/public access, CORS, public read URL, optional write credentials, and validation.
5. **Credential explanation.**
   - Public R2 read only needs a public manifest/base URL and CORS/public access. It does **not** need Access Key ID / Secret Access Key.
   - Owner/trusted write sync needs R2 S3 API credentials. Cloudflare creates these from an R2 API token, but the S3-compatible client still receives an `Access Key ID` and `Secret Access Key`.
   - The UI should label the write section as optional for public/read-only use and required for bidirectional sync, never as a generic "account password".

**Checklist:**

- [x] SA-1 Add regression tests and fix R2-imported remote media playback so downloadable remote tracks also make sound.
- [x] SA-2 Add a tested sync-mode policy and default newly added drives to automatic import-all unless the user chooses manual.
- [x] SA-3 Wire automatic import-all into add/refresh flows while preserving manual import controls.
- [x] SA-4 Consolidate cloud drive/CORS/sync controls into one Settings area and update four-language copy.
- [x] SA-5 Redesign the Add R2 Drive modal as a two-column step-by-step guide with public-read vs optional write-credential sections.

### 12.10 Phase 14: Smart Sync Content Fingerprinting

**Goal:** avoid no-op automatic/manual sync work by proving whether local publish objects actually changed before uploading, while preserving the manifest-last safety boundary and multi-device merge semantics.

**Status (2026-06-11):** Completed. Export planning now gives every deterministic JSON publish object a `sha256`, and publish-sync uses durable `syncObjects` key/kind/hash matches to skip unchanged objects without doing remote PUTs. This complements existing content-addressed binary keys and remote ETag guards.

**Best-practice policy:**

1. **Use content hash for local change detection.** Every planned object that has deterministic bytes should carry `sha256`, including mutable JSON indexes/manifests. Binary objects already do this through content-addressed keys.
2. **Skip by key + kind + hash, not timestamp alone.** `updatedAt` is useful for UI ordering and merge rules, but upload suppression must be based on bytes/hash so clock skew and repeated sync clicks do not cause duplicate writes.
3. **Keep remoteBase as the multi-device truth.** Before planning a writable drive publish, MUZERO still fetches the remote manifest/index base with ETags. If another device changed the drive, the merged JSON body changes, so its hash changes and the object uploads conditionally.
4. **Preserve manifest-last atomicity.** Skipping an unchanged manifest is allowed only after referenced objects have either uploaded or been proven unchanged/skipped. A changed manifest remains last.
5. **Resume failed runs object-by-object.** If a run uploads immutable media or deterministic JSON and later fails, the next run may reuse the recorded object hash instead of starting from zero.
6. **Stats event segments remain immutable.** Event segment keys are hash-derived/idempotent; checkpoint and aggregate JSON use normal hash-based skip only when their bytes did not change.
7. **Do not delete remote objects automatically.** Smart sync suppresses redundant writes; cleanup of unreferenced remote blobs remains a separate explicit product flow.

**Checklist:**

- [x] SS-1 Add deterministic `sha256` to JSON export objects.
- [x] SS-2 Skip upload for locally recorded key/kind/hash matches while still counting skipped bytes/objects in progress.
- [x] SS-3 Add regression coverage proving a second identical publish sends no PUTs for JSON and a failed run resumes without re-uploading already recorded objects.
- [x] SS-4 Update durable run history so users see skipped objects instead of a reset-from-zero no-op upload.

**Outcome (2026-06-11): Phase 14 ✅.** Repeated sync clicks and automatic sync ticks now treat unchanged JSON like unchanged content-addressed media: they are counted as skipped, not re-uploaded. Remote existence probing and upload concurrency remain restricted to immutable objects, so mutable JSON indexes keep their ordered barriers and conditional-write semantics.

### 12.11 Phase 15: Cloud-to-Local Playlist Cache UX

**Goal:** make remote R2 media feel first-class in playlist surfaces: if a song is playable from cloud storage but not cached locally, users should see the same "download to this device" affordance as external streamed tracks, both per-track and for the whole set header.

**Status (2026-06-11):** Phase 15 is completed. MUZERO now treats any ready track without a local `blobId` as cacheable when it has either a streamed-source resolver or an R2 `remoteMediaUrl`. Track rows show the cloud-to-device button for R2 remote tracks, and the set header's "Save all offline" action caches every pending streamed/R2 remote track in the set through the existing bounded download queue.

**Product requirements:**

1. **Unified cacheability rule.**
   - A track is cacheable to the current device only when it is `ready`, lacks `blobId`, and has a fetchable cloud source: either a supported external stream source or an R2 `remoteMediaUrl`.
   - Already-local generated/uploaded tracks and already-cached tracks must not show a cloud download action.
2. **Track-row action parity.**
   - R2-imported tracks that are stream-only locally must show the cloud-to-device button instead of a file-export popover.
   - After caching succeeds, the row should naturally fall back to the normal local export behavior because `track.blobId` is linked.
3. **Set-header cache-all action.**
   - The set detail header's cache-all button must count and download both external streamed tracks and R2 remote tracks.
   - Bulk download should continue to use bounded concurrency and per-track durable `mediaBlobs` writes; a failure on one track must not block the others from being cached.

**Checklist:**

- [x] CL-1 Add a pure cacheability predicate covering streamed and R2 remote tracks.
- [x] CL-2 Show cloud-to-device actions on track rows and set headers for R2 remote tracks without local blobs.
- [x] CL-3 Cache remote R2 tracks through `cacheRemoteTrackMedia` for both single-track and whole-set actions.

### 12.12 Phase 16: Pull Identity Dedupe + Metadata Integrity

**Goal:** make bidirectional multi-device sync idempotent from the user's point of view: a device must not import its own published sets back as duplicated remote sets, and a pull that already has a local set shell must still repair missing or stale track metadata.

**Status (2026-06-11):** Completed. Repro fixed: A has 7 sets, B has 2 sets; after B syncs the shared drive, B imports A's 7 remote sets but skips B's own 2 self-published sets instead of creating `ses_remote_<driveId>_*` duplicates. Pull diff also repairs existing set shells whose track metadata is missing or stale.

**Product requirements:**

1. **Stable remote identity.** Remote set previews must retain `manifest.sets[].publishedBy` so the client can distinguish "from this local device" vs "from another device".
2. **Self-published set dedupe.** Automatic import-all and manual import from a writable owner/trusted drive must skip sets whose `publishedBy` matches the local `DeviceRecord.publicId`; those sets already exist locally under their normal ids and should be updated by publish/read-merge-write, not re-created as `ses_remote_<driveId>_*`.
3. **Remote set idempotence remains.** Sets published by other devices still import under deterministic `ses_remote_<driveId>_<remoteSetId>` ids; repeating the import updates the same rows, never creates new rows.
4. **Track metadata integrity gate.** Pull diff may only call a set `unchanged` when the expected local track rows exist and still match remote-authoritative fields such as title, kind, origin, provider, duration, media URL, cover URL, brief, and `mediaMetadata`.
5. **Repair partial imports.** If a previous run created a set shell or track ids without complete track metadata, the next pull must apply the remote index even when the set-level `updatedAt` did not change.

**Checklist:**

- [x] PI-1 Preserve `publishedBy` in remote set preview data.
- [x] PI-2 Skip self-published sets during automatic import-all and manual import.
- [x] PI-3 Add pull diff integrity checks for missing/stale local track metadata.
- [x] PI-4 Add regression tests covering self-published import dedupe and metadata repair.

**Outcome (2026-06-11): Phase 16 ✅.** Remote set previews now carry publisher identity, Cloud Drive import-all skips local-device authored sets, and the pull diff's unchanged path verifies track row integrity before suppressing an apply. If metadata is missing, the pull re-runs `importRemoteSetStream` and repairs the local track rows without creating duplicate sessions.

### 12.13 Phase 17: Remote Playback Handoff UX

**Goal:** make R2-backed playback feel intentional even when media bytes cannot start instantly. Users should never wonder whether their click worked, and active playback should not fall silent merely because the next cloud object is still downloading.

**Status (2026-06-11):** Phase 17 is completed. When a song is already playing and the user selects an uncached R2 remote track, MUZERO now keeps the current track/cursor/metadata active while it downloads the target remote object, shows a Dock-level loading indicator, and commits the track switch only after the target media bytes are ready to load.

**Product requirements:**

1. **Hold current playback during remote preparation.**
   - If a track is actively playing, selecting an uncached R2 remote track should keep the current audio, cover, progress, lyrics, and memory context stable until the remote media fetch succeeds.
   - If no track is playing, MUZERO may show the target track as current while preparing it because there is no previous audio context to preserve.
2. **Visible loading feedback.**
   - The Dock should show a compact loading indicator while the target remote media is being requested/downloaded.
   - The indicator should carry localized accessible copy so the delay reads as intentional work, not a broken click.
   - Phase 19 refines the visual placement from a separate row/chip to a spinner over the Dock cover slot.
3. **Race-safe handoff.**
   - Rapidly choosing another track must abort or invalidate the previous remote load; a stale remote fetch must not switch playback after the user has moved on.
   - The persistent play-queue cursor should update only when MUZERO commits the new track handoff.

**Checklist:**

- [x] RH-1 Add playback loading state with request tokens/abort handling for remote loads.
- [x] RH-2 Defer R2 `currentIndex` handoff while current audio is playing, then commit after bytes are ready.
- [x] RH-3 Render a Dock loading indicator with localized remote-preparation copy.
- [x] RH-4 Add regression coverage for the held-current-song remote handoff.

### 12.14 Phase 18: Remote Cover Palette Reliability

**Goal:** make cloud-drive covers participate in the same visual color system as local covers. When a remote R2 cover is visible in the player, spectrum bars, flow backgrounds, and other cover-color-driven visuals should extract colors from that cover instead of silently falling back to the theme primary.

**Status (2026-06-11):** Phase 18 is completed. Remote cover palette extraction now fetches cover bytes through MUZERO's app fetch path, converts them to a local Blob URL, and reuses the existing Blob palette pipeline. This avoids canvas readback failures caused by direct cross-origin image URLs, cached R2 responses, or proxy/CORS differences.

**Product requirements:**

1. **Remote covers use the Blob palette path.**
   - A track with `remoteCoverUrl` but no local `coverBlobId` must fetch the image bytes first and then sample pixels from a local `blob:` URL.
   - The remote path should use `getAppFetch()` so Electron/Tauri/browser runtime differences stay behind the existing platform fetch abstraction.
2. **Graceful visual fallback.**
   - If the remote cover fetch, decode, or pixel sampling fails, MUZERO should keep playback usable and fall back to the current theme primary color without throwing.
   - The current visualizer color should stay stable while the remote palette resolves; no visible flash back to the theme color is required during the request.
3. **Race-safe color updates.**
   - Switching tracks before a remote palette request finishes must abort or ignore the stale request so a previous cover does not recolor the current track.
   - Remote cover palettes should be cached by URL for the current app session, matching the existing local cover color cache behavior.

**Checklist:**

- [x] RC-1 Add a fetched-URL palette helper that reads remote cover bytes into a Blob before image sampling.
- [x] RC-2 Use the helper from the visualizer dynamic color hook for `remoteCoverUrl`, with abort/ignore cleanup.
- [x] RC-3 Add a regression test proving remote R2 cover palette extraction uses a Blob URL path.

### 12.15 Phase 19: Remote Cover MIME + Dock Loading Polish

**Goal:** close the QA gap where a cloud-drive cover is visible but still fails to drive visualizer colors, and align remote-media loading feedback with the Dock's existing album-art affordance instead of adding another floating chip.

**Status (2026-06-12):** Phase 19 is completed. Remote cover palette extraction now tolerates R2/proxy responses that serve cover bytes as `application/octet-stream` by inferring image MIME from the object URL extension before Blob sampling. The Dock no longer renders a separate playback-loading chip; it overlays an accessible spinner directly on the album cover slot while remote media is preparing.

**Product requirements:**

1. **MIME-tolerant remote cover sampling.**
   - If a remote cover URL has an image extension but the HTTP response reports a generic content type, MUZERO must still decode and sample it as an image Blob.
   - MIME inference should be limited to known image extensions so arbitrary remote bytes do not get misclassified as covers.
2. **Dock loading placement.**
   - Remote media preparation should not add an extra chip/row above the player card.
   - The Dock should keep the current album art/title stable and show a spinner overlay in the cover position with localized accessible status text.
3. **Regression coverage.**
   - Tests must cover octet-stream R2 cover palette extraction and the Dock cover-spinner UI state.

**Checklist:**

- [x] DP-1 Infer image MIME from remote cover object URLs when R2/proxy returns `application/octet-stream`.
- [x] DP-2 Move playback loading UI from a separate Dock row to a cover-slot spinner.
- [x] DP-3 Add regression tests for octet-stream cover sampling and the Dock cover loading indicator.

### 12.16 Phase 20: Remote Playback LRU Cache

**Goal:** avoid repeated remote-media preparation on refresh/replay while keeping user-requested offline downloads distinct from an automatically managed playback cache.

**Status (2026-06-12):** Phase 20 is completed. MUZERO now has a separate remote playback cache for R2/cloud media: Dexie keeps URL-keyed metadata/LRU state, OPFS stores media bytes when available, and IndexedDB Blob storage is only a compatibility fallback. Playback checks permanent local media first (`Track.blobId` → `mediaBlobs`), then the bounded LRU playback cache, and only downloads from R2 when both are missing. Cache misses still show the Dock cover spinner; cache hits load immediately without entering `playbackLoading`. The Settings offline-cache area exposes a visible 1–10 GB cache-size control and clear action.

**Product requirements:**

1. **Two storage tiers.**
   - Manual "download to device" remains permanent/offline storage in `mediaBlobs` and links through `Track.blobId`.
   - Automatic playback reuse lives in the remote playback cache; it may be evicted by LRU and must not set `Track.blobId`.
   - The cache stores media bytes in OPFS when supported, because it is origin-private, quota-bound, and optimized for file-like byte storage. Dexie stores metadata only; IndexedDB Blob bytes are the fallback when OPFS is unavailable.
2. **Playback priority.**
   - Play from `Track.blobId` / `mediaBlobs` first.
   - If no permanent local media exists, try `playbackCache` by remote media URL and refresh `lastAccessedAt` on hit.
   - Only on cache miss should MUZERO show loading, fetch through `getAppFetch()`, then save the fetched Blob into the LRU cache.
3. **User-visible cache policy.**
   - Expose a bounded cache-size selector from 1 GB to 10 GB.
   - Evict least-recently-used playback-cache rows when the cache exceeds the selected size.
   - Clearing playback cache must not delete permanent offline downloads.

**Checklist:**

- [x] PC-1 Add a Dexie `playbackCache` table with URL-keyed LRU metadata and OPFS-backed media bytes.
- [x] PC-2 Add cache read/write/prune helpers with 1–10 GB limit handling.
- [x] PC-3 Wire remote R2 playback through permanent local media → playback cache → remote fetch priority.
- [x] PC-4 Add Settings controls for cache size and clearing playback cache.
- [x] PC-5 Add regression coverage for cache hits, LRU pruning, and permanent-download isolation.

### 12.17 Phase 21: Sync Notification Quiet Refresh

**Goal:** keep the Cloud Drive settings page refresh/auto-preview path quiet when it only confirms already-synced remote sets.

**Status (2026-06-12):** Phase 21 is completed. R2 pull refreshes that dry-run to `unchanged` still close any transient progress toast, but no longer emit one "Completed" notification per already-synced set. Completed sync runs with a real `runId` still show the success notification, and failures / cancellations / needs-review remain visible.

**Product requirements:**

1. **No toast spam for unchanged refreshes.**
   - Auto-sync / preview refresh may check many remote sets.
   - If a pull emits terminal `completed` without a `runId`, treat it as dry-run unchanged and keep it silent.
2. **Keep meaningful feedback.**
   - Completed publish/pull runs that actually created a `syncRun` keep the success notification.
   - Failed, cancelled, and needs-review terminal states still surface as notifications.

**Checklist:**

- [x] SN-1 Add a regression test proving unchanged pull refreshes dismiss loading without success toast spam.
- [x] SN-2 Keep completed real sync runs (`runId` present) notifying successfully.
- [x] SN-3 Update the R2 sync indicator terminal handling.

### 12.18 Phase 22: Streamed Playlist Metadata + Private Media Export

**Goal:** make external-source playlists (NetEase / Bilibili / YouTube) sync as real playable playlists instead of empty shells, while treating any already-present local audio bytes as user-owned private-drive content.

**Status (2026-06-12):** Phase 22 is completed. Streamed-origin tracks now publish their source ref (`streamSourceId`, `streamExternalId`) and display snapshot (`streamMeta`, `mediaMetadata`) in set indexes. If a device has a local `mediaBlobs` row for that streamed track (for example, a downloaded NetEase song), the exporter publishes that media object to the user's R2 bucket. If no local bytes exist, the remote import still creates a resolvable streamed track on the other device, so playback can resolve through that device's configured source credentials. Generated/uploaded tracks still require a media object.

**Product requirements:**

1. **No more playlist-only streamed sync.**
   - A set imported from NetEase must carry its track rows, artist/album/duration snapshot, tags, rank, lyrics, memories, and source identifiers.
   - Another device should import those rows with stable remote-local IDs and dedupe normally instead of creating duplicate shells.
2. **Private R2 means cached source bytes can sync.**
   - If `Track.blobId` points at a concrete local media blob, publish it regardless of whether `origin` is `uploaded`, `generated`, or `streamed`.
   - Streamed tracks without local bytes publish metadata-only and rely on `streamSourceId + streamExternalId` for playback resolution.
3. **Keep non-streamed integrity strict.**
   - `uploaded` and `generated` tracks remain invalid without a `media` object in the set index.
   - Metadata-only tracks are only valid for `origin: "streamed"`.
4. **Diffs must notice source metadata changes.**
   - Pull dry-run / unchanged checks compare `streamSourceId`, `streamExternalId`, and `streamMeta`, not only title/media URL.

**Checklist:**

- [x] SM-1 Extend set-index schema with streamed source fields and optional media only for streamed tracks.
- [x] SM-2 Export streamed metadata-only tracks when no local bytes exist.
- [x] SM-3 Export cached streamed media bytes when a local `mediaBlobs` row exists.
- [x] SM-4 Import streamed source fields onto local remote tracks so playback can resolve on another device.
- [x] SM-5 Update pull diff + regression tests for streamed metadata changes.

### 12.19 Phase 23: Legacy Empty Set Repair UX + R2 5xx Diagnostics

**Goal:** make the Phase 22 upgrade understandable in existing libraries that already published empty streamed-set indexes, and make transient R2 write failures debuggable without guessing.

**Status (2026-06-12):** Phase 23 is completed. Cloud Drive browse/import now hides legacy empty duplicate set previews when the same publisher/title also has a repaired non-empty preview, and collapses repeated same-publisher same-title empty previews to a single row. Automatic import-all uses the same filtered list, so B devices do not import a pile of old `0 songs / <1 KB` shells once A has republished the repaired set. R2 publish errors that exhaust 5xx retries now surface as structured `R2PublishHttpError` values with `status`, `key`, and a short response body summary in logs.

**Product requirements:**

1. **Do not show users historical empty-shell spam.**
   - If a non-empty repaired set exists for the same publisher + normalized title, hide the old `trackCount: 0` preview.
   - If only repeated empty same-title previews exist, show one row as the remaining repair hint.
   - Keep unique empty sets visible so intentionally empty playlists are not silently removed.
2. **Do not auto-import legacy empty duplicates.**
   - Automatic import-all must use the same filtered preview list as the UI.
3. **Make R2 500 actionable.**
   - Exhausted 5xx uploads should keep the object key and status structured.
   - Logs should include a short response summary when R2 returns one.
   - Manifest-last semantics remain unchanged: a failed child `sets/*/index.json` write prevents publishing a new root manifest, so the remote library is not advanced into a half-success state.

**Checklist:**

- [x] LR-1 Filter repaired legacy empty duplicate previews from Cloud Drive set browsing.
- [x] LR-2 Reuse the same filtering during automatic import-all.
- [x] LR-3 Preserve structured publish error context for exhausted R2 5xx uploads.
- [x] LR-4 Add regression coverage for duplicate empty previews and 5xx error diagnostics.

### 12.20 Phase 24: Playlist Cover Metadata + Metadata-Only Playback Warning

**Goal:** make imported playlist covers travel with the playlist itself, and make a remote metadata-only streamed track failure explainable instead of looking like a broken player.

**Status (2026-06-12):** Phase 24 is completed. Streamed playlist imports now best-effort cache the source playlist cover as the local set cover immediately after creating the MUZERO set. R2 set indexes now carry set-level `cover`, `coverCrop`, and `thumbhash` fields, and subscribers resolve/import that cover onto the remote session so gallery/detail cards can show the playlist cover without relying on the first track. If a cloud-imported streamed track has no local blob and no R2 media URL, playback resolve failures surface as a warning using the source-access wording instead of a generic playback error, matching the product reality that Device A may have synced only metadata because it had not downloaded the audio bytes.

**Product requirements:**

1. **Playlist cover is set metadata, not only a first-track fallback.**
   - Importing a NetEase/Bilibili/YouTube playlist should cache the playlist cover as `DjSession.coverBlobId` when the image is fetchable.
   - R2 set indexes should publish the set cover object with crop/thumbhash so another device can display the same playlist identity.
   - A subscriber should prefer a local custom set cover, then the imported remote set cover, then the existing fallback track cover.
2. **Metadata-only streamed tracks are valid but not silently playable.**
   - If Device A publishes streamed track metadata without local audio bytes, Device B should still import the track rows.
   - If Device B cannot resolve that source track through its own source access, the toast should be warning-level and communicate that source access is needed, not just "Playback error".
   - The queue may continue auto-skipping unplayable gaps, but should only show one warning per skip run.

**Checklist:**

- [x] PC-1 Cache streamed playlist cover URLs as local set covers during import.
- [x] PC-2 Extend R2 set indexes with set-level cover object, crop, and thumbhash.
- [x] PC-3 Resolve/import remote set cover URLs and render them in set cards/detail headers.
- [x] PC-4 Treat cloud metadata-only streamed playback resolve failures as warning-level source-access failures.
- [x] PC-5 Add focused regression tests for cover cache, export/import/subscription cover metadata, and warning classification.

### 12.21 Phase 25: Streamed Track Cover Cache + Sync

**Goal:** treat per-song artwork inside imported streamed playlists as the primary cover sync surface. The playlist/set cover is useful identity metadata, but the user-visible gallery, queue, Now Playing, and track rows mostly depend on each track's cover.

**Status (2026-06-12):** Phase 25 is completed. After importing or incrementally syncing a streamed playlist, MUZERO now starts a best-effort background cache for each hit's `coverUrl`, stores successful image responses as `Track.coverBlobId`, and skips tracks that already have a local cover so user edits are not overwritten. Existing R2 export/import already publishes local track covers as `track.cover`; this phase makes streamed playlist covers enter that path. For older metadata-only synced tracks that have not yet cached private cover bytes, subscribers now fall back from `track.cover` to `streamMeta.coverUrl` so Device B can still show the song artwork while Device A repairs and republishes private R2 cover objects.

**Product requirements:**

1. **Song covers are first-class synced metadata.**
   - Every imported playlist hit with `coverUrl` should attempt to cache the image as the local track cover.
   - Cached track covers publish through the existing R2 `track.cover` object field.
   - Existing local/user-edited `coverBlobId` values must not be overwritten by background playlist cover caching.
2. **Old metadata-only sync remains displayable.**
   - If a remote set index has no private `track.cover` object yet, but the streamed metadata has `streamMeta.coverUrl`, import should set `Track.remoteCoverUrl` from that source URL.
   - Pull diff should treat missing fallback cover metadata as repairable, so a future pull can fill it in.

**Checklist:**

- [x] TC-1 Cache per-track streamed playlist cover images after new-set import.
- [x] TC-2 Cache per-track streamed playlist cover images after incremental playlist sync into an existing set.
- [x] TC-3 Skip track cover cache writes when the track already has a local cover.
- [x] TC-4 Import `streamMeta.coverUrl` as the display fallback when no R2 `track.cover` exists.
- [x] TC-5 Add regression coverage for playlist track-cover caching and metadata-only remote-cover fallback.

### 12.22 Phase 26: Bounded Stream Playback Skip Runs

**Goal:** skip over individually unplayable streamed tracks without creating an apparent infinite loop when an entire playlist is VIP / unavailable / region-locked.

**Status (2026-06-12):** Phase 26 is completed. Stream playback resolve failures now track the set of track ids already auto-skipped in the current play-run. MUZERO tries the next queue member while there are untried tracks, but stops cleanly once every current queue member has failed once, with a hard cap of 30 attempts for unusually large queues. A successful media load resets the run. The UI still emits only one warning/error toast per skip run.

**Product requirements:**

1. **Do not loop forever through an all-unplayable queue.**
   - A playlist where every streamed track is VIP/unavailable should stop after one pass through the current queue.
   - Repeat-all and repeat-one must not cause the auto-skip path to wrap back indefinitely.
2. **Keep the happy path smooth.**
   - If only some tracks fail, auto-skip continues to the next untried track.
   - Loading any playable track resets the failed-track set.
   - Notifications remain de-spammed: one toast per skip run.

**Checklist:**

- [x] SK-1 Add a pure skip-run decision helper with queue-length and hard-cap bounds.
- [x] SK-2 Wire stream resolve failure handling to failed-track-id tracking instead of a raw retry count.
- [x] SK-3 Keep successful loads and hard stops resetting the skip-run state.
- [x] SK-4 Add regression tests for partial failure, all-failed queue, and hard cap.

### 12.23 Phase 27: Track Source Visibility + Cover Palette Diagnostics

**Goal:** make cloud-imported tracks explain where their media and cover are coming from, and make cover-color failures debuggable when the cover is visibly rendered but palette extraction falls back.

**Status (2026-06-12):** Phase 27 is completed. Track details now show separate media-source and cover-source rows, distinguishing local files/cache, R2 objects, generic URLs, streamed sources, and missing media/cover. Playback trace logs now include sanitized media/cover source kind and host on `playback.start` and `media.load.*` events. Cover palette extraction now emits `cover.palette.*` diagnostics for start/cache/success/fallback/failure, including track id, cover source kind, sanitized host/path hash for remote covers, blob mime/bytes for local covers, palette count, and whether the visualizer fell back to the theme color.

**Product requirements:**

1. **Expose source type in the song information pane.**
   - Media source must distinguish local file/cache, R2 cloud file, generic URL, streamed provider, and missing media.
   - Cover source must distinguish local cover, R2 cover, generic image URL, and missing cover.
   - Do not display full signed URLs or secrets; host-only details are acceptable.
2. **Make playback/cover-color diagnostics actionable.**
   - Playback trace events should carry the same source classification used by the UI.
   - Cover palette extraction should log whether it used local blob bytes or fetched a remote cover, and why it fell back.
   - Remote-cover diagnostics must sanitize URLs with host/path hash/query redaction, matching existing trace discipline.

**Checklist:**

- [x] SV-1 Add a tested track media/cover source classifier.
- [x] SV-2 Render media and cover source rows in the track inspector.
- [x] SV-3 Include source kind/host in playback trace logs.
- [x] SV-4 Add cover palette start/cache/success/fallback/failure diagnostics.
- [x] SV-5 Add four-locale labels for source rows and source kinds.

---

## 13. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | MUZERO | Phase 27 completed: track details now show media and cover source types (local/cache, R2 object, URL, stream, missing), playback trace logs include sanitized media/cover source kind and host, and cover palette extraction logs start/cache/success/fallback/failure with sanitized remote URL context, local blob mime/bytes, palette count, and theme-fallback state. |
| 2026-06-12 | MUZERO | Phase 26 completed: streamed playback auto-skip now tracks failed track ids per play-run, stops after every current queue member has failed once (or after the 30-track hard cap), resets on successful load/hard stop, and keeps notifications to one warning/error per skip run. |
| 2026-06-12 | MUZERO | Phase 25 completed: streamed playlist imports now cache each song's cover image as `Track.coverBlobId` so existing R2 `track.cover` export syncs per-track artwork. Incremental playlist syncs do the same, existing local covers are preserved, and imported metadata-only tracks fall back to `streamMeta.coverUrl` when no private R2 cover object exists yet. |
| 2026-06-12 | MUZERO | Phase 24 completed: streamed playlist imports now best-effort cache playlist covers as set covers; R2 set indexes publish set-level cover/crop/thumbhash metadata and subscribers render remote set covers; cloud metadata-only streamed playback resolve failures now surface as warning-level source-access gaps instead of generic playback errors. |
| 2026-06-12 | MUZERO | Phase 23 completed: Cloud Drive browse/import now filters historical duplicate empty set previews once a repaired non-empty set exists for the same publisher/title, collapses repeated empty same-title previews to one row, and applies that filter to automatic import-all. Exhausted R2 5xx uploads now throw/log structured `R2PublishHttpError` details including object key, status, and a short response summary. |
| 2026-06-12 | MUZERO | Phase 22 completed: streamed-source playlist tracks now sync their source identifiers and display metadata instead of being dropped from set indexes. Cached streamed tracks with concrete local media blobs publish those bytes to the user's private R2 bucket, while metadata-only streamed tracks remain resolvable on another device through its configured source credentials. Generated/uploaded tracks still require media objects, and pull diff checks streamed source metadata. |
| 2026-06-12 | MUZERO | Phase 21 completed: Cloud Drive page refresh / auto-preview paths no longer emit one success toast per unchanged remote set. The sync indicator treats completed pull progress without a `runId` as a dry-run unchanged result, while real completed sync runs and terminal errors remain visible. |
| 2026-06-12 | MUZERO | Phase 20 completed: R2/cloud playback now uses a separate bounded LRU playback cache after permanent `mediaBlobs` and before remote fetch, so refresh/replay can avoid the loading spinner. Cache bytes prefer OPFS with IndexedDB Blob fallback, while Dexie tracks URL-keyed metadata/LRU state. Settings exposes a 1–10 GB playback cache size and clear action; manual downloads remain permanent and are not evicted by playback-cache pruning. |
| 2026-06-12 | MUZERO | Phase 19 completed: remote cover palette extraction now infers image MIME from `.jpg`/`.png`/`.webp`/etc. object URLs when R2/proxy responses are generic octet-stream, and remote media loading feedback moved from a separate Dock chip to an accessible spinner over the album-cover slot. |
| 2026-06-11 | MUZERO | Phase 18 completed: R2 remote covers now feed flow/spectrum cover-color extraction by fetching cover bytes through `getAppFetch()`, sampling a local Blob URL, caching by remote URL, and falling back to the theme primary only on fetch/decode failure. |
| 2026-06-11 | MUZERO | Phase 17 completed: R2 remote playback now uses a held-current-track handoff when another song is already playing. MUZERO displays a Dock loading indicator while the target object downloads, aborts/invalidates stale loads, and commits `currentIndex` only after the target media is ready. |
| 2026-06-11 | MUZERO | Phase 16 completed: remote set previews preserve `publishedBy`, Cloud Drive automatic/manual import skips sets published by the local device to prevent `2 + 7 + 2` self-duplication, and pull diff now verifies local track metadata integrity before treating a set as unchanged so partial imports are repaired. |
| 2026-06-11 | MUZERO | Phase 16 added from QA: avoid B-device self-published set duplication during import-all by preserving `publishedBy`, and strengthen pull diff so an existing set shell without complete track metadata is repaired instead of treated as unchanged. |
| 2026-06-11 | MUZERO | Phase 15 completed: playlist track rows and set headers now treat R2 `remoteMediaUrl` tracks without local blobs as cacheable-to-device, reusing the existing `mediaBlobs` cache path so both single-track and whole-set "download to local" actions work for cloud-drive media. |
| 2026-06-11 | MUZERO | Phase 14 completed: JSON publish objects now carry deterministic sha256 fingerprints, publish-sync skips locally recorded key/kind/hash matches with durable skipped-byte accounting, and remote HEAD/concurrency skips remain limited to immutable objects so mutable JSON still respects ordered barriers and conditional writes. Focused sync tests cover JSON hashing, no-PUT repeated publish, and failed-run object reuse. |
| 2026-06-11 | MUZERO | Phase 14 added for smart sync best practices: deterministic object hashes drive no-op upload suppression, remoteBase/ETag remains the multi-device merge guard, manifest-last atomicity stays intact, and failed runs resume object-by-object instead of making users watch unchanged data upload again. |
| 2026-06-11 | MUZERO | Phase 13 SA-5 completed: Add Drive is now a wider two-column modal with the form/stepper on the left and contextual R2 setup guidance on the right. The owner flow separates write credentials from the public read URL, links to the R2 dashboard/token docs, and explains that public/read-only imports do not need Access Key ID / Secret Access Key while owner/trusted bidirectional sync does. |
| 2026-06-11 | MUZERO | Phase 13 SA-4 completed: Settings now has a single Cloud Drive sidebar destination for the R2 setup checklist, add-drive action, connected drive cards, sync/progress state, multi-writer explanation, and copyable CORS JSON. Stale `cloud-owner` / `cloud-sync` navigation ids alias to the consolidated pane so persisted selections remain safe. |
| 2026-06-11 | MUZERO | Phase 13 SA-1 reliability follow-up: remote R2 audio/video playback now uses `getAppFetch()` to read the object as a temporary Blob before loading the `MediaEngine`, eliminating the remaining browser case where progress advanced but WebAudio produced no sound. The regression tests now require remote audio/video to use the Blob path rather than direct cross-origin media element loading. |
| 2026-06-11 | MUZERO | Phase 13 SA-2/SA-3 completed: CloudDrive defaults now resolve to `change-debounce` automatic mode, Add Drive defaults the post-add sync/auto-sync choices on for writable owner/trusted drives, and `CloudDriveSets` automatically browses/imports every remote set for automatic drives through the existing orchestrated `pullRemoteSet` path while keeping manual preview/import controls available. |
| 2026-06-11 | MUZERO | Phase 13 SA-1 completed: R2-imported remote audio/video now loads with `crossOrigin: "anonymous"` so WebAudio visualization/analyser wiring does not taint the media element into silent playback in the web app. Regression coverage in `player-store.test.ts` requires remote R2 audio/video to use the CORS-enabled media element path. |
| 2026-06-11 | MUZERO | Phase 13 added from QA feedback: split cloud drive UX into explicit automatic/manual sync modes (automatic import-all default), prioritize the R2-imported playback-no-sound regression, and specify a consolidated Cloud Drive settings area plus a two-column R2 setup modal that separates public read/CORS from optional write credentials generated from Cloudflare R2 API tokens. |
| 2026-06-11 | MUZERO | Phase 12 DA-1 started/completed: Settings > This device now supports uploaded avatar images via the existing square cropper, stores the cropped image as a device-bound avatar media blob, and reuses the existing `DevicePublicProfile.avatar` R2 publish path when profile publishing is enabled. Phase 12 also records the remaining owner/source avatar-chip UX for remote set previews, imported set headers, and track rows. |
| 2026-06-11 | MUZERO | UX follow-up: Add Drive now gives writable owner/trusted R2 drives explicit post-add choices before saving — run `Sync now` immediately and/or enable `After local changes` auto sync. Both are opt-in, visible, and covered by component tests so adding a drive no longer leaves users guessing whether the first sync will happen. |
| 2026-06-11 | MUZERO | Regression fix: weak R2 ETags such as `W/"..."` are no longer used as `If-Match` write preconditions. Export planning now only emits `If-Match` for strong validators; weak or missing child/manifest validators fall back to the existing manifest-last recovery behavior instead of entering a guaranteed HTTP 412 loop. The concurrent-upload regression test now asserts JSON barrier ordering without assuming a fixed order among parallel immutable PUTs. |
| 2026-06-11 | MUZERO | Regression fix: child JSON objects (`sets/*/index.json`, discovery indexes) no longer use `If-None-Match: *` when their base object is absent or unreadable. Child writes use `If-Match` only when a valid ETag was read; otherwise they overwrite as recoverable intermediate artifacts while the root `manifest.json` remains the conditional, manifest-last publish boundary. This prevents orphan/legacy child objects from causing endless 412 loops. |
| 2026-06-11 | MUZERO | Regression fix: after a 412 conditional-write failure, the next publish-base fetch now force-refreshes the failed object key instead of reusing the cached ETag via `If-None-Match`/304. This prevents stale cached set-index bases from causing repeated `If-Match` 412 loops during read-merge-write retry. |
| 2026-06-11 | MUZERO | Regression fix: publish-base reads now probe every set id the current run intends to write, even when the existing manifest does not reference that set yet. This recovers partial publishes where `sets/<id>/index.json` exists as an orphan after an earlier run failed before updating `manifest.json`, avoiding repeated `If-None-Match: *` 412 loops on the set index. |
| 2026-06-11 | MUZERO | Regression fix: partial first publishes can leave child JSON objects (for example `sets/<id>/index.json`) uploaded before `manifest.json` lands. When the remote manifest is absent and a child JSON base object was not read, export planning now treats those child writes as recoverable intermediate artifacts and does not add `If-None-Match: *`; the root manifest remains conditional and last. This prevents repeated 412 loops while preserving object-level resume semantics for content-addressed media objects. |
| 2026-06-11 | MUZERO | Phase 11 added and completed: trusted-device setup links let a configured writable R2 drive export a pasteable credential bundle for the user's other trusted devices; Add Drive imports it as a writable `trusted` drive with credentials stored only in local settings; cloud drive cards and four locales warn that the link contains write credentials. Local device creation now avoids display-name collisions while keeping the Settings device name editable. |
| 2026-06-11 | MUZERO | Phase 10 AS-7 completed and Phase 10 closed: large-library protocol work was split into future explicit slices instead of hidden migration. Paged set indexes require an additive compatibility protocol, mutation-log compaction remains reserved for multi-user/trusted-collaborator sync, and multipart upload needs its own persisted-upload/part-cleanup/manifest-last design. Phase 10 outcome recorded as complete. |
| 2026-06-11 | MUZERO | Phase 10 AS-6 completed: remote publish-base reads now support an explicit ETag cache. Validated manifest/index objects are cached with their ETags, later reads send `If-None-Match`, and HTTP 304 reuses the cached parsed object. The sync store wires a per-R2-drive cache into every publish-base fetch, and tests cover conditional headers plus cached-object reuse. |
| 2026-06-11 | MUZERO | Phase 10 AS-5 completed: publish progress now reports active concurrent uploads, the live cloud-drive progress row displays the active count, and the drive sync controls show when automatic sync is paused. Tests cover active-upload progress events and paused scheduler state rendering. |
| 2026-06-11 | MUZERO | Phase 10 AS-4 completed: `publishR2ExportPlan` now supports bounded upload concurrency for immutable/resumable objects only, while mutable JSON objects remain ordered barriers and `manifest.json` remains last. The orchestrator forwards each drive's visible upload concurrency preference, and tests verify concurrent media/cover PUTs do not allow set indexes or the root manifest to overtake unfinished immutable uploads. |
| 2026-06-11 | MUZERO | Phase 10 AS-3 completed: added tested dirty tracking for automatic cloud sync. The scheduler now receives the oldest locally changed publishable set since the latest successful push, including co-edited sets imported from the same drive and excluding read-only imports from other drives, so `After local changes` can debounce real pending work and skip empty runs. |
| 2026-06-11 | MUZERO | Phase 10 AS-2 completed: added a tested automatic-sync scheduler policy/runtime, started it from the app lifecycle, gated runs on write capability, local credentials, visibility, network state, in-flight sync, jitter, interval, failure backoff, app-start delay, and pause state. Publish outcomes now pause auto-sync on `needs-review`, cancellation, or failure, while a successful manual publish or preference change clears the pause. `After local changes` is wired as a scheduler input and will become active when AS-3 dirty tracking supplies pending-change timestamps. |
| 2026-06-11 | MUZERO | Phase 10 AS-1 completed: CloudDrive now persists visible per-drive auto-sync frequency and upload concurrency preferences with safe defaults (`Manual only`, concurrency `2`), Settings cloud drive cards expose the controls with en/zh/ja/ko copy, and repository/component tests cover defaults, updates, disabled read-only controls, and change callbacks. |
| 2026-06-11 | MUZERO | Phase 10 backlog added for automatic sync frequency and R2 scale optimization: visible per-drive scheduling (`Manual only` default), debounce/jitter/backoff/conflict pause, bounded immutable-object upload concurrency, object-level resume preservation, ETag/dirty planning, paged indexes, mutation-log compaction, multipart upload, and broker-only future writeback. |
| 2026-06-09 | MUZERO | Initial draft for R2-only user-owned cloud drive sync. |
| 2026-06-09 | MUZERO | Architecture review pass: clarified V1/V3 boundary, profile/avatar sync, per-device object ownership, and multi-writer conflict rules. |
| 2026-06-10 | MUZERO | Cross-PRD reconciliation with Artist & Album Library Entities: §3.4.2 synced `mediaMetadata` also feeds cross-drive artist/album entities + faceted/scoped search (`matchesRemoteSearchTrack` mirrors the scoped-token parser); §3.8 artist/album rollups are a derived current-truth dimension, not a synced `PlaybackAggregate` scope; §5.4 artist/album detail stats noted. No shipped behavior changed. |
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
| 2026-06-09 | MUZERO | Phase 3 implementation started: local export plan now collects set/track/memory/media rows, computes content-addressed R2 keys for media/cover/memory photos, emits per-set index writes, and keeps root manifest last. |
| 2026-06-09 | MUZERO | Phase 3 R2 publish executor added with shared S3 signing, HEAD-based skips for content-addressed binary objects, ordered PUT uploads for indexes/manifests, progress events, and between-object cancellation. |
| 2026-06-09 | MUZERO | Phase 3 sync bookkeeping added with Dexie v13 `syncRuns` and `syncObjects`, plus a publish-sync wrapper that records completed/failed runs and object provenance without clobbering old mappings on failure. |
| 2026-06-09 | MUZERO | Phase 5 device foundation started with Dexie v14 device/playback-stat tables, anonymous per-profile `DeviceRecord.publicId`, profile revision fields, avatar seed support, and local device repository tests. |
| 2026-06-09 | MUZERO | Phase 5 playback stats repository added with meaningful-listen threshold tests, `PlaybackEvent` persistence, per-device `TrackPlaybackStats`, track/set aggregates, and existing `Track.playCount` reconciliation for counted listens. |
| 2026-06-09 | MUZERO | Phase 5 playback listener integration added: MediaEngine time updates now feed a seek-aware listen tracker, pause/ended/track-change flushes persist per-device listened seconds, and eager load-time play-count increments were removed. |
| 2026-06-09 | MUZERO | Phase 3 device/stat export added to publish plans: profile publishing emits `profiles/devices/<devicePublicId>/profile.json`, current-device aggregates emit `stats/devices/<devicePublicId>/aggregate.json`, and owner-maintained devices/stats indexes are generated when data exists. |
| 2026-06-09 | MUZERO | Phase 1 remote search UI wired into the Search/Gallery track mode: synced remote catalog rows are queried from IndexedDB and displayed alongside local track results without downloading media bytes. |
| 2026-06-09 | MUZERO | Phase 4 implementation started with Dexie v15 `syncMutations`, mutation repository helpers, and a remote set diff planner that identifies create/unchanged/apply-remote/keep-local/conflict/blocked states, including set-level local-vs-remote conflict detection and remote index hash mismatch blocking. |
| 2026-06-09 | MUZERO | Phase 4 pull dry-run/apply flow added: remote set pulls now produce a non-mutating preview, can recreate missing sets as stream-only local rows without downloading media bytes, record pull `syncRuns`, and refuse blocked/conflicted diffs before mutating IndexedDB. |
| 2026-06-09 | MUZERO | Phase 6 presence foundation started with `muzero-r2-presence-v1` schema, per-device object key helper, TTL-based active filtering, one-minute heartbeat throttling, owner/trusted write-policy checks, and `presenceEnabled: false` default settings. |
| 2026-06-09 | MUZERO | Phase 6 Settings toggle added for optional Listening Now presence, with en/zh/ja/ko copy explaining trusted writable-drive scope and one-minute heartbeat cost/operations limits. |
| 2026-06-09 | MUZERO | Phase 1 shared-link registration hardened: public manifest links now register local read-only drive/share rows only after manifest validation succeeds, and invalid/fetch-failed manifests are covered by IndexedDB non-mutation tests. |
| 2026-06-09 | MUZERO | Phase 5 device profile UI added in Settings: users can rename the anonymous local device, rotate a generated avatar seed, and opt into profile publishing for future writable-drive sync while uploaded avatar images remain a later task. |
| 2026-06-09 | MUZERO | Phase 4 remote media cache now verifies imported blob roles before writing: audio tracks require `audio/*`, video tracks require `video/*`, and mismatched remote objects leave local IndexedDB untouched. |
| 2026-06-09 | MUZERO | Phase 4 remote search catalog refresh made incremental: catalog pages may now publish `updatedAt`/ETag/hash metadata, MUZERO stores per-page versions, and unchanged pages are skipped while legacy string page refs still full-refresh. |
| 2026-06-09 | MUZERO | Phase 6 R2 presence writer added: owner/trusted writable drives with local credentials can PUT signed per-device presence objects to `presence/devices/<devicePublicId>.json`; disabled, shared, or credential-less drives fail before any network write. |
| 2026-06-09 | MUZERO | Phase 5 memory author data layer added: `addMemory` can persist sanitized `MemoryAuthorRef` snapshots and Dexie v16 backfills existing unattributed local memories as unknown local authors. |
| 2026-06-09 | MUZERO | Phase 5 memory attribution now round-trips through R2 set indexes: exported memories include author snapshots and read-only stream imports preserve remote memory authors locally. |
| 2026-06-09 | MUZERO | Phase 5 playback event segment export added: R2 publish plans now include immutable per-device `stats/events/<devicePublicId>/...json` segment objects for local `PlaybackEvent` rows while checkpoint/retry policy remains a later slice. |
| 2026-06-09 | MUZERO | Phase 5 playback aggregate scopes completed: meaningful listens now derive global track, track-in-set, track-in-share, set, share, and drive aggregate rows, preserving remote track ids and media hashes for shared-library stats. |
| 2026-06-09 | MUZERO | Phase 5 aggregate rebuild helper added: playback event segments can be replayed into deterministic per-device aggregate rows without duplicating or losing play counts. |
| 2026-06-09 | MUZERO | Phase 3/4 metadata round-trip added: set indexes and remote search catalog rows may now carry normalized `Track.mediaMetadata` (artist/album/genre/import identity) without embedding raw native tag frames or cover bytes. |
| 2026-06-09 | MUZERO | Phase 5 playback stats persistence verified with a Dexie reload test covering playback events, per-track stats, and aggregate rows. |
| 2026-06-09 | MUZERO | Phase 5 remote-only shared listening stats added: playback events can now be recorded with only a remote track reference, deriving local aggregate rows without importing the track or creating local per-track stats. |
| 2026-06-09 | MUZERO | Phase 5 playback event segment flush policy added: automatic flush thresholds are clamped to 25-100 events or 5-15 minutes, and manual sync may flush a small pending segment. |
| 2026-06-09 | MUZERO | Phase 5 auto playback event segment flush added to R2 export planning: manual sync still flushes small pending batches, while auto sync emits segment/checkpoint objects only after the event-count or oldest-event age threshold is reached. |
| 2026-06-09 | MUZERO | Phase 5 playback event segment retry made idempotent: immutable `stats/events/<devicePublicId>/...json` objects are HEAD-checked on retry and skipped when already present, so a failed checkpoint upload can be retried without re-uploading the event segment. |
| 2026-06-09 | MUZERO | Phase 5 rebuildable aggregate cache import added: `stats/devices/<devicePublicId>/aggregate.json` validates schema/counts and bulk-upserts per-device `PlaybackAggregate` rows while preserving device separation. |
| 2026-06-09 | MUZERO | Phase 5 aggregate summary helper added: UI/query layers can merge matching stats across anonymous devices while preserving per-device rows, and can filter `track-in-set` aggregates so the same track has separate counts in different sets. |
| 2026-06-09 | MUZERO | Phase 3 media object sync coverage completed for export planning: audio, video, track covers, and memory photos are emitted as content-addressed R2 objects, with video set indexes preserving `kind: "video"` and `video/mp4` media metadata. |
| 2026-06-09 | MUZERO | Phase 3 publish-order safety covered: R2 publish aborts before `manifest.json` when an earlier referenced object such as a set index fails, so readers do not see manifests pointing at missing objects. |
| 2026-06-09 | MUZERO | Phase 3 sync progress visibility added: Settings now summarizes the latest sync run with current phase, object count, byte count/progress ratio, failure count, and error text backed by a tested progress summary helper. |
| 2026-06-09 | MUZERO | Phase 5 memory author attribution added to memory cards: each memory with an author snapshot now shows the device display name or public id plus a generated avatar fallback seeded by `avatarSeed`/device id. |
| 2026-06-09 | MUZERO | Phase 5 playback stats edge-case tests completed: threshold, seek jump filtering, pause/resume boundaries, track-change flushing, and app-close flushing are covered across the listen tracker and stats persistence suites. |
| 2026-06-09 | MUZERO | Phase 5 playback stats UI summary added: the Settings device card now shows total plays and listened time from `PlaybackAggregate` track-scope rows via the aggregate summary helper. |
| 2026-06-09 | MUZERO | Phase 5 pending-listen sync UI added: Settings now separates local playback events pending upload from uploaded stats segments and aggregated listening totals using a tested playback sync summary helper. |
| 2026-06-09 | MUZERO | Phase 5 large shared playlist stats separation verified: aggregate rebuild now has coverage for 100 anonymous devices listening to the same shared remote track while preserving one row per device and merged query totals. |
| 2026-06-09 | MUZERO | Phase 5 owner/publisher device display names added: owner-maintained `devices/index.json` entries now include `displayName` and `avatarSeed` next to the stable public id/profile links so no-account UI can show device identity without fetching each profile first. |
| 2026-06-09 | MUZERO | Phase 5 device profile history safety verified: profile publish policy remains limited to owner/trusted writable drives, and R2 set index export now has regression coverage that current device profile changes do not rewrite historical memory author snapshots. |
| 2026-06-09 | MUZERO | Phase 5 generated-avatar attribution completed: memory author cards already render generated avatar fallbacks, and owner/publisher device index entries now carry `avatarSeed` so device attribution surfaces can show an avatar without accounts or image uploads. |
| 2026-06-09 | MUZERO | Phase 5 owner-drive shared-track history sync verified: local listening history for remote shared tracks exports to the user's owner R2 as stats aggregate/event segment objects with remote track references and without uploading shared media bytes. |
| 2026-06-09 | MUZERO | Phase 5 trusted-device separated stats verified: trusted writers export aggregate stats under `stats/devices/<devicePublicId>/aggregate.json`, and `stats/index.json` points at that per-device object instead of coalescing anonymous devices into one mutable counter. |
| 2026-06-09 | MUZERO | Phase 6 presence write coordinator added: playback start, pause, resume, stop, and track-change events now publish low-frequency per-device presence through the player store when presence is enabled and an owner/trusted R2 target has write credentials. |
| 2026-06-09 | MUZERO | Phase 6 presence visible-scope polling added: the R2 presence poller reads immediately when the Listening Now UI becomes visible, clamps polling to at least 60 seconds, stops when hidden, and drops in-flight results after visibility changes. |
| 2026-06-09 | MUZERO | Phase 6 Listening Now display component added: `ListeningNowList` renders trusted anonymous device names/public ids with the current track title/id so UI surfaces can show who is listening to which track without accounts. |
| 2026-06-09 | MUZERO | Phase 5 uploaded device avatar export added: `DeviceRecord.avatarBlobId` media now publishes as a content-addressed `device-avatar` object and `DevicePublicProfile.avatar` references the remote object with mime/bytes/hash metadata. |
| 2026-06-09 | MUZERO | Phase 5 profile publish policy wired into export planning: `buildR2ExportPlanForDrive` now emits device profiles/avatars only when the device opted in and the target owner/trusted R2 drive has local write credentials, while read-only/shared targets get manifest-only plans. |
| 2026-06-09 | MUZERO | Phase 4 conditional R2 writes added: mutable export objects can now carry `If-Match` / `If-None-Match` preconditions, and `publishR2ExportPlan` signs and sends those headers so stale JSON overwrites can fail instead of silently clobbering remote changes. |
| 2026-06-09 | MUZERO | Phase 4 per-device set mutation export added: unsynced local `SyncMutation` rows for set edits now publish as immutable JSON files under `sets/<setId>/mutations/<devicePublicId>/`, preserving base ETag/revision and payload for later owner folding/conflict review. |
| 2026-06-09 | MUZERO | Phase 5 profile ETag guard added: device profile export can carry an observed remote profile ETag into the mutable `device-profile` object precondition, combining profile `revision` metadata with signed `If-Match` writes so offline profile edits cannot silently overwrite newer remote profiles. |
| 2026-06-09 | MUZERO | Phase 5 playback checkpoint export added: event segment publish plans now include `stats/devices/<devicePublicId>/checkpoint.json` with the latest event watermark and immutable segment key. |
| 2026-06-09 | MUZERO | Phase 5 optional `stats/index.json` discovery completed for stats sync: device entries can point to aggregate cache, checkpoint, and latest immutable event segment without making the index the write-hot source of truth. |
| 2026-06-09 | MUZERO | Phase 5 stats/profile write policy added: only owner/trusted drives with local R2 credentials may receive stats or opted-in device profiles, keeping read-only shared-link listener data local by default. |
| 2026-06-09 | MUZERO | Phase 4 set/track/memory conflict detection completed: pull diff now maps unsynced local mutations back to remote set, track, and memory ids so double-edited user-authored fields become reviewable conflicts instead of being silently overwritten by remote updates. |
| 2026-06-09 | MUZERO | Phase 4 owner set mutation folding added: export planning now applies non-overlapping set metadata, track add, and track remove mutations into the next owner-published `sets/<setId>/index.json` snapshot while leaving overlapping or invalid mutation payloads for later review. |
| 2026-06-09 | MUZERO | Phase 4 additive set merge rule added: owner export folding now auto-merges different trusted devices adding distinct tracks plus new memories into the same set index, preserving per-object ids instead of coalescing writers into one mutable file. |
| 2026-06-09 | MUZERO | Phase 4 reviewable rename conflict metadata added: owner export plans now report overlapping set-field mutations with entity, field, reason, and mutation ids so two devices renaming the same set differently can be surfaced for explicit resolution instead of being silently dropped. |
| 2026-06-09 | MUZERO | Phase 4 stale set snapshot guard added: set index export planning can attach observed remote ETags as `If-Match` preconditions, using the existing signed conditional PUT path so stale `sets/<setId>/index.json` publishes fail instead of overwriting newer remote snapshots. |
| 2026-06-09 | MUZERO | Phase 4 remote-search lazy-load added: opening a remote search result can now fetch only the referenced set indexes plus matching share manifest/index pairs, without fetching unrelated sets or media bytes. |
| 2026-06-09 | MUZERO | Phase 4 large remote-search catalog regression added: catalog pull now has coverage for 250 remote tracks proving only catalog/set/track JSON pages are fetched, while media and cover object bytes remain untouched. |
| 2026-06-09 | MUZERO | Phase 4 pull offline-cache option added: `applyRemoteSetPull` remains stream-only by default but can now cache imported remote media into `mediaBlobs` for offline playback, reusing MIME/role validation before linking `Track.blobId`. |
| 2026-06-09 | MUZERO | Phase 3 device avatar/profile write-policy checklist reconciled: `buildR2ExportPlanForDrive` is already covered by policy tests proving profiles and avatar objects publish only to owner/trusted writable drives with local R2 credentials. |
| 2026-06-09 | MUZERO | Phase 3 owner-maintained discovery indexes completed: export plans now build `devices/index.json`, `stats/index.json`, and optional `presence/index.json`, and root `manifest.json` references whichever discovery indexes are present. |
| 2026-06-09 | MUZERO | Phase 4 set-level sync indicator contract added: sync previews can now expose stable `local-changes`, `remote-changed`, `auto-merged`, and `needs-review` flags plus conflict metadata for later UI rendering. |
| 2026-06-09 | MUZERO | Phase 4 additive stats merge verified: importing multiple per-device R2 aggregate caches preserves device-separated rows and query summaries add play counts/listened seconds without using a shared mutable counter. |
| 2026-06-09 | MUZERO | Phase 4 conflict media safety verified: pull dry-run exposes track conflicts with mutation ids, and apply blocks conflicted pulls without replacing existing local `Track.blobId` or `mediaBlobs` rows. |
| 2026-06-09 | MUZERO | Phase 4 device profile merge rule added: per-device profile conflicts now compare `revision` first, auto-apply the newer side, and mark same-revision profile field differences as `needs-review` for explicit user choice. |
| 2026-06-09 | MUZERO | Phase 5 play-count reconciliation added: local `Track.playCount` can be rebuilt from per-device `TrackPlaybackStats`, with an option to preserve legacy counts for tracks that have no stats rows yet. |
| 2026-06-09 | MUZERO | Phase 4 local-only track preservation added: refreshing a remote set now keeps existing non-remote track ids in the local session while applying the remote order for shared tracks. |
| 2026-06-09 | MUZERO | Phase 4 updatedAt merge policy added: only non-user-authored cache metadata, such as search catalog page versions, may use `updatedAt` as an automatic cache freshness winner. |
| 2026-06-09 | MUZERO | Phase 4 explicit conflict-resolution contract added: set/track/memory conflicts now expose only `keep-local`, `use-remote`, and `duplicate-both` actions, and cannot resolve without a user-selected action. |
| 2026-06-09 | MUZERO | Phase 4 conflict resolution panel added: reusable Settings-ready UI renders set/track/memory conflicts and emits keep-local, use-remote, or duplicate-both actions without embedding untranslated text. |
| 2026-06-09 | MUZERO | Phase 1 subscribed-manifest playback verified end-to-end: a public manifest subscription streams imported audio and video tracks straight from their remote object URLs (`MediaEngine.loadUrl`) with no `mediaBlobs` download, locking the stream-mode play path with player-store regression tests. |
| 2026-06-09 | MUZERO | Phase 1 completed: shared manifest import path verified — `subscribeManifest`/`loadRemoteSetIndex` default their reader to the `getAppFetch()` platform shim (Tauri http plugin vs browser/Electron `fetch`) and still honor an injected fetcher, so browser, Tauri, and Electron read manifests through one code path with no per-runtime fork. |
| 2026-06-09 | MUZERO | Phase 3/4 sync orchestration core added: a pure injectable `createSyncOrchestrator().publish` maps the tested export-plan builder + publish executor into one user-triggerable run, emitting planning → uploading → completed ephemeral progress (object/byte counts, current key), blocking destructive publish when the plan has conflicts (needs-review), and reporting cancellation vs failure — with no IndexedDB/HTTP in the orchestration layer. |
| 2026-06-09 | MUZERO | Phase 4 sync orchestration pull added: `createSyncOrchestrator().pull` wraps the tested dry-run/apply pull flow into planning → applying → completed progress, no-ops when nothing will mutate, surfaces `needs-review` for set/track/memory conflicts and `blocked` for hash-mismatch without applying, and never mutates IndexedDB on a refused pull. |
| 2026-06-09 | MUZERO | Phase 3/4 sync orchestration store added (PRD §5.6): `useSyncStore` resolves a writable drive's publish context from IndexedDB (R2 credentials, public base URL, and local-origin set ids — remote-imported `ses_remote_` sets excluded), runs the orchestrator with a per-drive `AbortController` for cancel, blocks before start with an actionable reason when a drive is read-only/credential-less/URL-less, and keeps only ephemeral per-drive progress in Zustand (durable history stays in `syncRuns`, localized copy stays in the UI). |
| 2026-06-09 | MUZERO | Phases 3 & 4 completed: Settings → Cloud Drive now wires a per-drive **Sync now** / **Cancel** control on each writable connected drive, with a compact live phase/object/percent/error line backed by `useSyncStore`, plus en/zh/ja/ko strings. Verified end-to-end in the preview: clicking Sync now resolves the publish context, builds the export plan, runs the publisher, and surfaces live + durable failure progress — closing the last integration gap between the tested publish/pull logic and a user-triggerable action. |
| 2026-06-09 | MUZERO | Phase 6 presence read fetcher added: `readRemotePresence` reads the owner-maintained `presence/index.json` (new `muzero-r2-presence-index-v1` schema) and resolves each referenced per-device `presence/devices/<id>.json`, skipping a missing index or malformed device object rather than throwing and defaulting its fetch to the shared `getAppFetch()` path — the read side the `R2PresencePoller` previously lacked. |
| 2026-06-09 | MUZERO | Phases 5 & 6 completed: the `useRemotePresence` hook resolves the active remote set's source drive by `ses_remote_<driveId>_` id prefix and polls `readRemotePresence` only while the new **Listening now** section is mounted on Now Playing (visible-scope, ≥60s interval), rendering trusted devices' current track via `ListeningNowList` (+ en/zh/ja/ko label); Phase 5's plays/listened-time stats UI was already wired into Settings. Now Playing render verified crash-free in the preview, with the section correctly hidden for local sets. All six phases are now ✅ Done. |
| 2026-06-10 | MUZERO | §2.6.1 added — access tiers + link indirection. Private-by-default model: ① own devices read private objects via **local presign** (no public bucket, no backend, free egress) — a V1 enhancement via a per-drive media-URL resolution abstraction; ② occasional sharing via a **Worker broker** (self-hosted V2 / mu0.app V3) issuing presigned URLs, with opaque `mu0.app/s/<id>` durable links; ③ public only for truly-public sharing. Rule: the broker issues presigned URLs but **never proxies bytes** (egress stays free). Open Question 5 resolved accordingly. |
| 2026-06-10 | MUZERO | §2.6.1 expanded with setup-time access-mode selection: public/private is a Cloudflare bucket setting MUZERO cannot toggle, so the add-drive flow **asks** the intended mode, records it on `CloudDrive`, adapts the form (public-URL field only for public), validates accordingly (`checkR2PublicRead` for public; keys for private), and shows the trade-off hints. |
| 2026-06-11 | MUZERO | §3.4 updated with the additive post-v1 manifest extensions that other PRDs landed (`entityCoversIndex`, track `rank`/`thumbhash`/`lyrics`, memory `atSec`, `origin: "streamed"`), so this PRD stays the protocol's source of truth. No behavior change. |
| 2026-06-11 | MUZERO | §12 full-codebase implementation audit added: §12.1 wiring truth (orchestrated pull, conflict panel, mutation recording/`syncedAt`, entity-cover import, search catalog, and `If-Match` guards are all built-but-unreachable in production), §12.2 eleven edge-case findings (headline: F1 re-import clobbers local track state + orphans cached blobs; F2 the live import path bypasses every pull safeguard; F4 publish is a single-writer mirror — a second device's publish erases the first from indexes/manifest; F5 cached streamed tracks export media bytes while un-cached ones silently drop), §12.3 Phase 7 hardening backlog added to the phase table. Audit only — no code changed. |
| 2026-06-11 | MUZERO | Phase 7 F1 fixed (TDD): re-importing an updated remote set no longer clobbers local track state — `importRemoteSetStream` bulk-gets existing `trk_remote_*` rows and field-merges (remote-authoritative content vs local-wins `blobId`/cover/crop/`liked`/`tags`/`note`/`playCount`/annotation clock), so cached offline media stays linked (no orphaned blobs) and annotation edits survive. Covered by re-import preservation + fresh-import regression tests. |
| 2026-06-11 | MUZERO | Phase 7 F2 fixed (TDD): the drive-row import (`CloudDriveSets`) now calls the orchestrated `useSyncStore.pullRemoteSet` instead of the raw `importRemoteSetStream` — every UI import gets the dry-run diff gates (keep-local / conflict→needs-review / blocked), a durable pull `syncRun`, and progress through the same per-drive pipeline the publish path uses (`CloudDriveLiveProgress` + sync toast). §12.1's "orchestrated pull has zero UI callers" gap is closed. |
| 2026-06-11 | MUZERO | Phase 7 F5 fixed (TDD): streamed-origin tracks never publish — the export loop skips on `origin === "streamed"` (not just missing `blobId`, since offline caching sets `blobId` on streamed tracks), keeping platform-derived bytes out of the user's R2; `manifest.sets[].trackCount` now reports the post-skip/post-fold set-index track count so subscriber previews match what they receive; the stale `r2SetTrackSchema` origin comment is refreshed. |
| 2026-06-11 | MUZERO | Phase 9 closed (CE-1…CE-5, all TDD): same-set co-editing across one user's devices — removal tombstones (`DjSession.removedTracks` → set-index `removedTracks`, capped, re-add revokes), pure `mergeSetIndex` (adds-union / metadata LWW / tombstones), imported sets publish back merged under their original ids with `If-Match`, and Sync now is bidirectional (`applySetPullMerges` lands other devices' edits — rows + memories + ranks + tombstones + LWW metadata — before the merged publish; `session.lastPulledAt` disambiguates re-adds). Settings notice updated (4 locales, preview-verified); 325 tests green across sync/stores/settings/repositories. |
| 2026-06-11 | MUZERO | Phase 8 closed (MW-5): the Sync & CORS notice now explains multi-writer semantics (`cloudMultiWriterHint`, en/zh/ja/ko, preview-verified) — publish merges with the drive's current state, write conflicts auto-re-merge, and a set still belongs to its publishing device. Full sync surface green (53 test files / 270 tests). 真正的「两台设备都能写回同一个盘」 now ships; same-set co-editing is the named future co-editing phase. |
| 2026-06-11 | MUZERO | Phase 8 MW-4 landed (TDD): the publish orchestration is a bounded read-merge-write loop — fetch base → plan → conditional upload; an HTTP 412 (another device published since our read, surfaced as the new typed `R2PublishHttpError`) refetches the base, re-merges, and retries up to twice, emitting planning→uploading cycles in the progress line. `useSyncStore` wires the real `fetchRemotePublishBase`, making every UI publish multi-writer-safe. |
| 2026-06-11 | MUZERO | Phase 8 MW-3 landed (TDD): the export plan consumes the remote base — discovery indexes merge per device, the manifest unions sets with `publishedBy` ownership (preserving the other device's sets, the library `createdAt`, and discovery pointers this run didn't rewrite), and merged JSON writes are conditional (`If-Match`/`If-None-Match: *`). Legacy callers without a base keep the old unconditional mirror, so the slice ships safely before the orchestrator wiring. `buildR2ExportPlanForDrive` now forwards `remoteBase` + `setIndexPreconditions`. |
| 2026-06-11 | MUZERO | Phase 8 MW-2 landed (TDD): `fetchRemotePublishBase` reads `manifest.json` + devices/stats/presence indexes via **signed S3 GETs** (private-bucket-ready) with ETag capture for the coming conditional writes; 404 → absent, garbage → absent + warning, other failures throw (never blind-overwrite). |
| 2026-06-11 | MUZERO | Phase 8 (multi-writer) started — §12.4 design recorded (read-merge-write publish: signed-GET base fetch + ETag, per-device LWW index merges, manifest set-union with additive `publishedBy` ownership, If-Match conditional writes with bounded 412 re-merge retry; same-set co-editing explicitly a later phase). MW-1 landed (TDD): pure merge layer `r2-publish-merge.ts` + formalized devices/stats index schemas + `publishedBy` on set summaries. |
| 2026-06-11 | MUZERO | Phase 7 F4 documented + Phase 7 closed: the Sync & CORS pane now carries a four-locale "one writing device per drive" notice (verified rendering in the preview); merge-on-publish (read-merge-write indexes + manifest set-union + `If-Match`) is named as the future **multi-writer phase** together with F3's mutation recording/panel. The remote search catalog (§3.4.2) is deferred by decision until a too-large-to-import drive exists. All eleven §12.3 items are closed; Phase 7 ✅. |
| 2026-06-11 | MUZERO | Phase 7 F3 resolved (decision + TDD): the mutation machinery stays — dormant — as the multi-writer foundation; a successful publish now marks the drive's pre-run unsynced mutations `syncedAt` inside the run-bookkeeping transaction (other drives' and mid-run mutations untouched; failed publishes leave them unsynced), defusing the re-fold/re-upload/permanent-needs-review hazard. Recording mutations on set edits + mounting the conflict panel are explicitly deferred to the multi-writer phase. |
| 2026-06-11 | MUZERO | Phase 7 F11 fixed (TDD): the track cover's non-destructive crop now round-trips — `r2SetTrackSchema.coverCrop` (additive optional, no version bump), exported from `Track.coverCrop`, imported with local-edit-wins on re-import. A cropped cover now renders the same framing on the subscribing device. |
| 2026-06-11 | MUZERO | Phase 7 entity-cover read half wired (TDD): new `loadRemoteEntityCovers` in the subscription layer fetches + zod-validates the manifest's `entityCoversIndex`, and `CloudDriveSets.browse` now imports the covers via the previously-orphaned `importRemoteEntityCovers` (LWW protects strictly-newer local covers; best-effort so a covers failure never blocks set browsing). Closes §12.1's "entity covers publish but never land" gap. |
| 2026-06-11 | MUZERO | Phase 7 F7 fixed (TDD): publish gained transient-failure resilience — per-object PUT retry with injectable exponential backoff (network errors + 5xx/429 only; non-transient HTTP like a 412 If-Match surfaces immediately; aborts never retry), and a failed HEAD skip-probe degrades to a normal upload instead of failing the run. Pull: optional media-cache failures no longer fail an otherwise-successful import — the run completes with a `cacheFailures` count (`failed` on the syncRun row). |
| 2026-06-11 | MUZERO | Phase 7 F6+F8 fixed (TDD): cancellation is now real on both directions — the abort signal travels into every signed request (`r2SignedFetch` → fetch, PUT and HEAD), and pull aborts end-to-end (signal threaded through orchestrator → `applyRemoteSetPull` → media-cache fetch, aborted runs recorded `cancelled`, orchestrator returns a new `cancelled` pull result instead of throwing). Per-drive ops are serialized: the store refuses a second publish/pull while one is in flight, with the controller registered before the async context resolve to close the double-click race. Four new tests across publish/pull/orchestrator/store. |
| 2026-06-10 | MUZERO | §2.6.1: client-side strong encryption ("encrypted public", Tier ④) **considered & rejected** — coarse revocation + duplicate mechanism + playback complexity outweigh its only edge ("no backend"); tampering is not a weakness (public bucket is read-only to outsiders + AES-GCM authenticates). Decision: private/controlled sharing is always Tier ② (broker/V3); until V3, only own-devices and truly-public exist. Open Question 10 added/resolved accordingly. |
