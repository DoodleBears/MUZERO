# PRD: MUZERO Share Links + `mu0.app` Hosted Control Plane (Track/Set Sharing, Permissions, Revocable Invites, Stable Short Links)

**Status:** Draft
**Created:** 2026-06-12
**Author:** MUZERO
**Module:** Sync / Sharing / `mu0.app` control plane — one-click share links for a single track or a whole set, a Google-Drive-style web landing page, and an owner-side permission management surface with revocable invites and stable short links.

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Share projection writer + raw-URL share (no backend) | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | `mu0` broker foundation (Worker + D1 + device auth + short links) | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Share viewer landing page (`mu0.app/s/<slug>`) | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Owner sharing management UI in-app | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Receive flow + deep links (`muzero://`) | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Invite-only shares + invite management | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |
| 7 | Private buckets: credential vault + broker presign | 🔲 Pending | [Phase 7 Checklist](#phase-7-checklist) |
| 8 | Ops, audit, abuse handling + self-host packaging | 🔲 Pending | [Phase 8 Checklist](#phase-8-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

The R2 cloud drive sync PRD ([20260609-muzero-r2-cloud-drive-sync-prd](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md)) shipped V1: owner devices publish their library to a user-owned R2 bucket, and anyone with the **whole-library** public manifest URL can subscribe read-only. It deliberately deferred three things, and this PRD is the "separate PRD" it called for (§2.7: *"This hosted control plane should be a separate PRD before implementation"*):

1. **Set-level and track-level share projections** — designed in §3.4.1 (`muzero-r2-share-manifest-v1` / `muzero-r2-share-index-v1`), and the Zod schema already exists unused at [r2-manifest-schema.ts:238](../../../src/sync/r2-manifest-schema.ts). There is no writer, no UI, and no way today to share *one set* or *one track* without exposing the whole library manifest.
2. **A web destination for shared links** — today a recipient must install MUZERO and paste a manifest URL into Add Drive. There is no "click the link, hear the song" experience.
3. **Permission management, revocable invites, stable short links** — §2.6 concluded this is *"not safely achievable with public R2 alone"* and routed it to a V3 `mu0.app` hosted control plane / V2 self-hosted broker built from the same code (§2.6.1 access tiers, §2.7 hosted architecture).

This PRD concretizes all three on top of the existing infrastructure:

- **Requirement 1 — share a single track**: owner clicks Share on a track → gets `https://mu0.app/s/<slug>` → recipient opens it in any browser and the track plays immediately (Google-Drive-file-share UX), with cover, title, tags, and an "Open in MUZERO" path.
- **Requirement 2 — share a set**: owner clicks Share on a set → recipient opens the link in a browser (playable track list) **or** pastes it into MUZERO → sees a preview (title, track count, size, owner attribution) → one click "Add to my sets", backed by the existing subscribe/import pipeline.
- **Requirement 3 — owner management**: a Sharing panel lists every active share with its short link, scope, capabilities, visit counters, and expiry; the owner can copy, edit capabilities, set expiry, create/revoke scoped invites, and revoke the link — all resolved through the broker so revocation actually works.

**What already exists and is reused, not rebuilt** (verified against the codebase 2026-06-12):

| Existing piece | Location | Reused for |
|---|---|---|
| Share manifest/index Zod schemas (unused) | [r2-manifest-schema.ts:238](../../../src/sync/r2-manifest-schema.ts) | Phase 1 activates them |
| Publish pipeline: export plan → binaries first → indexes → manifest-last with ETag preconditions | [r2-export-plan.ts](../../../src/sync/r2-export-plan.ts), [r2-publish-sync.ts](../../../src/sync/r2-publish-sync.ts), [r2-publish.ts](../../../src/sync/r2-publish.ts) | Share projection publish; content-addressed `objects/media/sha256-*` means shared tracks already synced upload **zero new media bytes** |
| Subscribe/read path + read-only link onboarding | [r2-subscription.ts](../../../src/sync/r2-subscription.ts), [r2-shared-link.ts](../../../src/sync/r2-shared-link.ts) | "Add to my sets" import of a share projection |
| `CloudDrive.provider: "r2" \| "mu0"` union + `apiBaseUrl` field, `capabilities.manageInvites` | [types.ts](../../../src/db/types.ts) (CloudDrive ~:977, capabilities ~:944) | Already reserved for this PRD; no codename change needed |
| `CloudShare.access` union incl. `"collaborator" \| "owner"` | [types.ts](../../../src/db/types.ts) ~:998 | Receive-side rows for mu0 shares |
| Paste-and-parse link flow (trusted-device setup link `muzero://trusted-r2-drive#v1=…`) | [cloud-drive-settings.ts](../../../src/sync/cloud-drive-settings.ts), [add-drive-dialog.tsx](../../../src/components/settings/add-drive-dialog.tsx) | Same dialog learns to recognize `mu0.app/s/…` links |
| AWS SigV4 signing (header-based) | [r2-s3.ts](../../../src/sync/r2-s3.ts) | Phase 7 extends to query-string presign (same key derivation, different serialization) |
| Auto-sync scheduler + dirty tracking | [auto-sync-scheduler.ts](../../../src/sync/auto-sync-scheduler.ts), [cloud-drive-dirty.ts](../../../src/sync/cloud-drive-dirty.ts) | Live shares republish on the next scheduled sync |
| Remote playback cache | [r2-cache.ts](../../../src/sync/r2-cache.ts) | Imported shared tracks stream or cache exactly like today's remote tracks |
| `DeviceRecord.localSigningSecret` placeholder (unused) | [types.ts](../../../src/db/types.ts) ~:1076 | Becomes the device keypair for broker auth |
| `mu0.app` domain + release distribution at `assets.mu0.app` | [release-manifest.ts](../../../src/lib/release-manifest.ts) | Landing page links "Get MUZERO" to the existing desktop feed |
| Recommended CORS JSON already includes the `mu0.app` origin in healthcheck tests | [r2-healthcheck.test.ts](../../../src/sync/r2-healthcheck.test.ts), [scripts/r2-cloud-drive-test-cors.json](../../../scripts/r2-cloud-drive-test-cors.json) | Viewer fetches the share manifest cross-origin |

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Owner** | MUZERO user with an owned R2 drive (existing `kind: "owned"`). Creates shares, manages invites, revokes links. | Full: create/edit/revoke shares and invites for their own drives; publish projections with local R2 credentials. |
| **Link visitor** | Anyone who opens `mu0.app/s/<slug>` in a browser. No account, no install. | Read-only: stream the shared track/set in the web viewer. No writeback of any kind. |
| **MUZERO recipient** | A MUZERO user who pastes/opens the share link in the app. | Read-only subscribe: preview → add as a shared set → stream or cache locally. Local stats stay local (existing Phase 5 behavior). |
| **Invitee** | Holder of an invite-scoped link (`mu0.app/i/<token>`) for an invite-only share. | Same as link visitor/recipient but gated by a revocable token; counted against `maxUses`/expiry. |
| **Self-hoster** | Open-source user deploying the same broker Worker under their own domain. | Everything the hosted broker does; app points `apiBaseUrl` at their deployment. |

### 1.3 Core Value

1. **"Send one link" sharing** — the single most-requested missing flow: share a memory-laden track or a whole set the way you'd share a Google Drive file, with a link that unfurls (Open Graph) in chat apps and just plays in the browser.
2. **Real revocation and real permissions** — links resolve through the broker, so the owner can revoke, expire, and scope access without rotating R2 credentials or re-uploading media. This is the §2.6 capability matrix row that public R2 alone could never provide.
3. **Local-first preserved** — media bytes stay in the user's R2 bucket and are **never proxied** through `mu0.app` (egress stays free, §2.6.1 rule). The broker stores only grants/metadata. Local/offline playback never requires an account. Self-hosting the broker is a first-class deployment of the same open-source code (V2 = V3 code, per roadmap decision in §2.6).
4. **Zero re-upload sharing** — because media objects are content-addressed (`objects/media/sha256-…`), sharing a set whose media is already synced publishes only a few small JSON objects.

### 1.4 Product Boundary Update

This PRD adopts the boundary already ratified in R2 PRD §2.7:

> Core playback and storage remain local-first and user-owned. `mu0.app` may provide an **optional** control plane for setup, permissions, and invite tokens. Media bytes still live in the user's R2 bucket and are not proxied through MUZERO by default.

**Long-term vision (owner, 2026-06-12, Q1):** MUZERO + a user-supplied private storage backend becomes each user's **personal music cloud** — quick to listen anywhere, quick to share, with `mu0.app` as the universal playback destination for recipients. R2 is the backend today; WebDAV-class backends are a candidate future storage provider. The share contracts in this PRD are therefore deliberately **storage-agnostic**: resolution returns plain HTTPS URLs (`manifestUrl` + media URLs), so any HTTP-readable storage can back a public-mode share without contract changes; only Phase 7 presign is S3/R2-specific.

Hard implications, restated as acceptance constraints:

- A user who never touches sharing sees **zero** behavior change and makes zero requests to `api.mu0.app`.
- Sharing requires an **owned R2 drive** (the media must live somewhere reachable). MUZERO-hosted media storage remains permanently out of scope.
- CLAUDE.md hard rule 2 (BYOK secret discipline) extends to the broker: **R2 write credentials never appear in share URLs, broker requests (except the explicit Phase 7 opt-in vault), logs, or manifests.**

---

## 2. System Architecture

### 2.1 Architecture Overview

```
┌──────────────────────────── Owner's MUZERO app ────────────────────────────┐
│  Sharing panel (Settings / per-set / per-track)                           │
│   │ 1. build share projection (pure fn)                                   │
│   ▼                                                                       │
│  existing publish pipeline ──────────────▶ Owner's R2 bucket              │
│  (r2-export-plan + r2-publish-sync)        shares/<shareId>/share.json    │
│   │                                        shares/<shareId>/index.json    │
│   │ 2. register share                      objects/media/sha256-* (reused)│
│   ▼                                                 ▲          ▲          │
│  mu0-client (src/sync/mu0-client.ts)                │          │          │
└───────┼────────────────────────────────────────────┼──────────┼──────────┘
        │ POST /v1/shares (device-key auth)          │ 4a. GET  │ 4b. GET
        ▼                                            │ (public) │ (presigned,
┌─── api.mu0.app Worker (open-source, self-hostable) │          │  Phase 7)
│  Hono router                                       │          │
│  D1: accounts, devices, drives, shares,            │          │
│      invites, grants, audit, abuse                 │          │
│  KV: slug→resolution cache, rate-limit buckets     │          │
│  3. returns stable short link mu0.app/s/<slug>     │          │
└───────┬────────────────────────────────────────────┼──────────┼───────────┘
        │ GET /v1/resolve/<slug>                     │          │
        ▼                                            │          │
┌── mu0.app/s/<slug> share viewer (static, same repo) ──────────┐│
│  fetches share.json + index.json directly from owner R2 ──────┘│
│  <audio>/<video> src = R2 URL (direct; bytes NEVER via broker)─┘
│  OG tags for chat unfurl · "Open in MUZERO" (muzero://share/<slug>)
│  "Get MUZERO" → assets.mu0.app desktop feed
└─────────────────────────────────────────────────────────────────┘
        ▲
        │ paste link / muzero:// deep link
┌── Recipient's MUZERO app ────────────────────────────────────────┐
│  Add Drive "Shared link" tab recognizes mu0.app/s/<slug>         │
│  → resolve → preview (title/tracks/bytes/owner) → Add to my sets │
│  → existing import: CloudDrive(kind shared, provider mu0)        │
│    + CloudShare + stream/cache via r2-cache                      │
└──────────────────────────────────────────────────────────────────┘
```

Three invariants carried over from R2 PRD §2.6.1 / §2.8:

1. **The broker issues URLs/grants but never proxies media bytes.** Bytes always flow owner-R2 → client directly.
2. **Identity is attribution, not authentication** for everything except broker device keys. `devicePublicId`/display name stay attribution-only; broker authorization comes from registered device keypairs and invite tokens.
3. **Object storage is not a database.** All grant/revocation/counter state lives in D1, never in R2 JSON.

### 2.2 Access Tiers (recap) and What This PRD Implements

| Tier (R2 PRD §2.6.1) | Status before | This PRD |
|---|---|---|
| ① Own devices, private bucket, local presign | designed, not built | **Not this PRD** (stays a V1-enhancement slice of the R2 PRD); Phase 7's presign utility is shared groundwork |
| ② Shared to others via broker | designed only | **Built here** (Phases 2–8) |
| ③ Truly public bucket | shipped (whole-library subscribe) | Extended: per-set/per-track projections + short-link indirection + web viewer (Phases 1–5) |

**Revocation honesty matrix** (must be reflected verbatim in UI hints, see §5.2):

| Bucket mode | Revoking the mu0 link… | Residual risk |
|---|---|---|
| Public (Tier ③) | stops all new resolutions via `mu0.app/s/<slug>` and the viewer | anyone who saved the **direct R2 URL** can still fetch until the owner deletes the projection objects / rotates the bucket. UI must say so when creating a public-bucket share. |
| Private (Tier ②, Phase 7) | stops resolution **and** no new presigned URLs are minted; outstanding presigned URLs expire in minutes | effectively none after TTL |

### 2.3 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **App-side client** | `src/sync/mu0-client.ts`, plain typed fetch via `getAppFetch()` | Same HTTP discipline as every provider (CLAUDE.md rule 5/10); injectable for tests like `cloud-job.ts` |
| **Broker runtime** | Cloudflare Worker + **Hono** | Tiny, typed router; Workers-native; the repo already lives on Cloudflare (R2 release pipeline) |
| **Broker storage** | **D1** (durable records) + **KV** (slug-resolution cache, rate-limit counters) | Matches R2 PRD §2.7 recommended architecture exactly |
| **Schema contracts** | Zod schemas in `mu0/shared/` imported by both app and Worker | One source of truth for API shapes, same pattern as `TrackBrief` being the single contract |
| **Auth** | Device Ed25519 keypair (WebCrypto), challenge → short-lived bearer | No passwords, no email requirement; fills the reserved `DeviceRecord.localSigningSecret` slot; account = set of device keys |
| **Share viewer** | Second Vite build target in this repo (`mu0/share-viewer/`), React, reuses `r2-manifest-schema` parsing | Minimal, static, served as Worker assets at `mu0.app`; no MUZERO app bundle bloat |
| **Slug** | 21-char nanoid-style base64url (~126 bits) | Unguessable, non-enumerable (Drive-style), no sequential IDs |
| **Testing** | Vitest; Worker handlers as pure functions with injected env (D1/KV mocked), `@cloudflare/vitest-pool-workers` for integration | Same determinism discipline as `cloud-job.ts` (inject `now`) |

### 2.4 Project Structure

```
MUZERO/
├── mu0/                                  # NEW — open-source control plane (self-hostable)
│   ├── shared/                           # Zod API contracts shared app↔worker
│   │   └── api-schema.ts
│   ├── broker/                           # api.mu0.app Worker
│   │   ├── wrangler.jsonc                # parameterized: hosted vs self-host
│   │   ├── migrations/                   # D1 SQL migrations
│   │   └── src/ (index.ts, routes/, auth.ts, presign.ts, rate-limit.ts)
│   └── share-viewer/                     # mu0.app/s/<slug> landing page
│       ├── vite.config.ts
│       └── src/ (main.tsx, share-player.tsx, og.ts)
├── src/sync/
│   ├── share-projection.ts               # NEW — pure: Track/DjSession → share manifest+index
│   ├── mu0-client.ts                     # NEW — typed broker API client + device-key auth
│   ├── mu0-share-link.ts                 # NEW — parse/recognize mu0.app/s/ + /i/ links
│   └── (existing modules extended, see §3/§4)
├── src/components/settings/
│   ├── sharing-panel.tsx                 # NEW — owner share management
│   └── share-create-dialog.tsx           # NEW — per-set / per-track share creation
└── docs/prd/20260612-muzero-mu0-share-links-control-plane-prd/
```

Net-new top-level directory rationale (template exception policy): the broker and viewer are **deployables with their own build targets and runtime**, not app modules; mixing them into `src/` would put Worker-only code in the app bundle graph. `mu0/` mirrors how `electron/` and `src-tauri/` isolate shells. Makefile gains `mu0-dev` / `mu0-test` / `mu0-deploy` / `mu0-viewer-dev` targets.

### 2.5 Brand / Codename Discipline

Per CLAUDE.md hard rule 4 and R2 PRD §2.7 brand/domain rules:

- Product name stays **MUZERO**; public domain **`mu0.app`**; API **`api.mu0.app`**; share links **`mu0.app/s/<slug>`**; invites **`mu0.app/i/<token>`**.
- Codename layer untouched: `muzero-db`, `trk_`/`ses_`/`blb_` prefixes, manifest schema ids (`muzero-r2-share-manifest-v1`), provider ids (`"r2"`, the already-reserved `"mu0"`).
- New id prefixes (codename layer, stable forever): `shr_` (share, already used in §3.4.1 examples), `inv_` (invite), `grt_` (grant), `acc_` (broker account), `dev` public ids unchanged.

---

## 3. Data Model Design

### 3.1 Core Concepts

```
LOCAL (owner)                      REMOTE R2 (owner's bucket)        BROKER D1 (mu0)
─────────────                      ──────────────────────────        ───────────────
DjSession ses_x ─┐                 shares/shr_a/share.json           shares (slug → drive,
Track trk_y ─────┼─ projection ──▶ shares/shr_a/index.json             shareId, status,
ownedShares row  │   (filtered     objects/media/sha256-… (reused)     capabilities, expiry)
 shr_a ◀─────────┘    view)                                          invites (token_hash,
   │ slug, status                                                      maxUses, revoked_at)
   └────────── register/manage ──────────────────────────────────▶  accounts ◀─ devices
                                                                       (Ed25519 pubkeys)
RECIPIENT
CloudDrive (kind "shared", provider "mu0", apiBaseUrl) ── CloudShare (remoteShareId shr_a)
  └─ imported set + tracks with remoteMediaUrl (existing pull/import path)
```

A **share is a projection, not a grant of the library**: the share index is a filtered copy of set/track metadata generated from local truth (§3.4.1 rules all apply — sharing a set never exposes the library manifest; indexes never reveal other sets referencing the same content-addressed object).

### 3.2 Database Schema

⚠️ Prefer modifying existing structures. Current schema: [src/db/muzero-db.ts](../../../src/db/muzero-db.ts) (v2 + upgrades), types in [src/db/types.ts](../../../src/db/types.ts).

#### 3.2.1 Local Dexie changes (additive, version bump + `.upgrade()`)

**New table `ownedShares`** — owner-side share records (distinct from `cloudShares`, which are *subscriptions I read*; `ownedShares` are *links I manage*):

```typescript
interface OwnedShare {
  id: string;                      // shr_<nanoid> — also the remote shareId
  driveId: string;                 // FK CloudDrive (kind "owned")
  scope: "set" | "track";
  sourceSetId?: string;            // ses_… when scope = "set"
  sourceTrackId?: string;          // trk_… when scope = "track"
  title: string;                   // share display title (defaults from set/track)
  mode: "live" | "snapshot";       // live = republished on every drive sync while active
  projection: ShareProjectionOptions; // what's included, see below
  capabilities: { readMedia: boolean; readMemories: boolean }; // writeStats/writePresence stay false in this PRD
  visibility: "link" | "invite";   // Phase 6 adds "invite"
  status: "active" | "revoked" | "error";
  slug?: string;                   // broker slug; absent for Phase-1 raw-URL shares
  shortUrl?: string;               // https://mu0.app/s/<slug>
  rawManifestUrl: string;          // direct R2 URL of shares/<id>/share.json (fallback / Phase 1)
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
  lastPublishedAt?: number;        // last successful projection publish
  lastPublishedRevision?: number;
}

interface ShareProjectionOptions {
  includeTags: boolean;            // default true
  includeNotes: boolean;           // default FALSE (notes are personal memories)
  includeMemories: boolean;        // default FALSE (photos are private by default)
  includeLyrics: boolean;          // default true
  includeBrief: boolean;           // default false (generated TrackBrief is provenance)
  trackIds?: string[];             // subset of the set; undefined = whole set
}
```

Index: `id, driveId, sourceSetId, sourceTrackId, status, updatedAt`.

**`AppSettings` additions** (settings row, device-local, never synced):

```typescript
mu0?: {
  apiBaseUrl: string;              // default "https://api.mu0.app"; self-hosters override
  accountId?: string;              // acc_… once registered
  deviceKeyPair?: { publicKeyJwk: JsonWebKey; privateKeyJwk: JsonWebKey }; // Ed25519
  registeredAt?: number;
}
```

The keypair fills the role reserved by `DeviceRecord.localSigningSecret` (currently an unused placeholder); we keep it in settings alongside R2 credentials — same trust level, same storage discipline (IndexedDB only, never logged, never exported except… never exported).

**`CloudDrive` / `CloudShare`** — no structural change needed: receive-side uses existing `provider: "mu0"` + `apiBaseUrl`; `CloudShare.access` stays `"read-only"` for everything this PRD ships. Phase 6 adds one additive field: `CloudShare.grantId?: string` (the redeemed grant id for invite shares, Q7).

#### 3.2.2 Remote R2 layout additions (owner's bucket)

```
shares/<shareId>/share.json     # muzero-r2-share-manifest-v1 (schema exists)
shares/<shareId>/index.json     # muzero-r2-share-index-v1
objects/media|covers|memories/… # REUSED content-addressed objects, no new copies
```

Publish ordering reuses the manifest-last discipline: media objects (usually already present) → `index.json` → `share.json` last, with the same ETag preconditions as [r2-export-plan.ts](../../../src/sync/r2-export-plan.ts) `basePrecondition()`. The **library `manifest.json` does not reference shares** — a share must be unreachable from the public library manifest (projection isolation, §3.4.1).

**Additive schema extensions** to `r2ShareManifestSchema` (existing fields untouched):

```typescript
scope: z.enum(["set", "track"]).default("set"),     // NEW — single-track shares
sourceTrackId: z.string().optional(),               // NEW — when scope = "track"
revision: z.number().int().optional(),              // NEW — republish counter
viewer: z.object({                                  // NEW — landing-page hints
  accent: z.string().optional(),                    //   cover-derived hex for the page theme
}).optional(),
```

`muzero-r2-share-index-v1` follows the §3.4.1 example: `tracks[]` rows reuse the `R2SetTrack` shape (title, kind, durationSec, tags?, media{url,mime,bytes,sha256}, cover?, lyrics?, memories?) filtered by `ShareProjectionOptions`. `shareTrackId` aliases are **not** used (Q3 resolved: rejected) — canonical `trk_` ids are random and non-identifying, and content-addressed `sha256` media keys correlate across shares regardless, so aliasing would add indirection without real unlinkability.

#### 3.2.3 Broker D1 schema (new, `mu0/broker/migrations/0001_init.sql`)

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,              -- acc_<nanoid>
  created_at INTEGER NOT NULL      -- no recovery columns: account loss is accepted by design (Q2)
);
CREATE TABLE devices (
  id TEXT PRIMARY KEY,              -- broker device id
  account_id TEXT NOT NULL REFERENCES accounts(id),
  public_key_jwk TEXT NOT NULL,     -- Ed25519 public JWK
  label TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);
CREATE TABLE drives (
  id TEXT PRIMARY KEY,              -- broker drive id
  account_id TEXT NOT NULL REFERENCES accounts(id),
  bucket_mode TEXT NOT NULL CHECK (bucket_mode IN ('public','private')),
  public_base_url TEXT,             -- public mode
  vault_credential_id TEXT,         -- private mode, Phase 7
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE shares (
  slug TEXT PRIMARY KEY,            -- 21-char nanoid, the stable public identity
  account_id TEXT NOT NULL REFERENCES accounts(id),
  drive_id TEXT NOT NULL REFERENCES drives(id),
  remote_share_id TEXT NOT NULL,    -- shr_… (key under shares/ in R2)
  scope TEXT NOT NULL CHECK (scope IN ('set','track')),
  title_cache TEXT,                 -- for OG tags without hitting R2
  capabilities_json TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('link','invite')),
  status TEXT NOT NULL CHECK (status IN ('active','revoked','expired')),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  resolve_count INTEGER NOT NULL DEFAULT 0,
  last_resolved_at INTEGER
);
CREATE INDEX idx_shares_account ON shares(account_id, status, updated_at);
CREATE TABLE invites (
  id TEXT PRIMARY KEY,              -- inv_<nanoid>
  share_slug TEXT NOT NULL REFERENCES shares(slug),
  token_hash TEXT NOT NULL,         -- SHA-256 of the bearer token; raw token never stored
  label TEXT,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE TABLE grants (               -- Phase 6 (Q7): durable per-recipient access
  id TEXT PRIMARY KEY,              -- grt_<nanoid>
  share_slug TEXT NOT NULL REFERENCES shares(slug),
  invite_id TEXT REFERENCES invites(id),     -- which invite was redeemed
  recipient_public_key_jwk TEXT NOT NULL,    -- anonymous recipient device key (Ed25519)
  label TEXT,                                -- recipient-chosen label shown to the owner
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  share_slug TEXT,
  kind TEXT NOT NULL,               -- share-created|share-revoked|invite-created|invite-revoked|drive-registered|device-linked|…
  meta_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE abuse_reports (
  id TEXT PRIMARY KEY,
  share_slug TEXT NOT NULL,
  reason TEXT NOT NULL,
  reporter_contact TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution TEXT                   -- dismissed|share-disabled
);
-- Phase 7:
CREATE TABLE vault_credentials (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  enc_blob TEXT NOT NULL,           -- AES-GCM(scoped R2 token), key from Worker secret
  scope_note TEXT,                  -- human label: bucket + prefix the token is scoped to
  created_at INTEGER NOT NULL,
  rotated_at INTEGER
);
```

- **Privacy & retention:** D1 stores no listener identity — `resolve_count`/`last_resolved_at` are coarse counters; no IP/UA logging beyond Cloudflare's default operational logs. Invite tokens stored hashed. Vault rows only exist after explicit Phase 7 opt-in.
- **Rollback:** D1 migrations are forward-only files; destructive changes require a new migration + export. Local Dexie change is additive (new table + settings field) — rollback = `git revert`, old clients ignore unknown table.

### 3.3 Data Relationship Diagram

```
accounts 1───* devices (Ed25519 pubkeys)
accounts 1───* drives 1───* shares (slug) 1───* invites 1───* grants (recipient device keys)
shares *──(remote_share_id)──▶ owner R2: shares/<shr_id>/{share,index}.json
ownedShares(local) 1──1 shares(broker) when slug present
CloudDrive(recipient, provider "mu0") 1───* CloudShare ──▶ imported DjSession/Tracks
```

---

## 4. API Design

### 4.1 Broker API Endpoints (`api.mu0.app`, all JSON, versioned `/v1`)

⚠️ Contracts live in `mu0/shared/api-schema.ts` (Zod), imported by both sides.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/v1/devices/register` | POST | none (first contact) | `{publicKeyJwk, label}` → creates account+device (or links via `linkCode`) → `{accountId, deviceId}` |
| `/v1/auth/challenge` | POST | none | `{deviceId}` → `{nonce}` (KV, 60s TTL) |
| `/v1/auth/token` | POST | Ed25519 signature over nonce | `{deviceId, nonce, signature}` → `{bearer, expiresInSec}` (~1h) |
| `/v1/devices/link-code` | POST | bearer | mint short-lived code so a second device joins the same account (mirrors trusted-device-link UX, but **no R2 credentials inside**) |
| `/v1/drives` | POST | bearer | register drive `{bucketMode, publicBaseUrl?}` → `{driveId}` |
| `/v1/shares` | POST | bearer | `{driveId, remoteShareId, scope, titleCache, capabilities, visibility, expiresAt?}` → `{slug, url}` |
| `/v1/shares` | GET | bearer | owner's shares incl. `resolveCount`, `lastResolvedAt` |
| `/v1/shares/:slug` | PATCH | bearer | update capabilities / expiry / titleCache / `status: "revoked"` (revoke = soft, idempotent) |
| `/v1/shares/:slug` | DELETE | bearer | hard-delete broker record (R2 objects untouched — explicit local cleanup is separate, mirrors "no automatic remote deletion") |
| `/v1/shares/:slug/invites` | POST | bearer | `{label?, maxUses?, expiresAt?}` → `{inviteId, token, url}` (token returned **once**) |
| `/v1/invites/:id` | DELETE | bearer | revoke invite (stops new redemptions + browser token access; existing grants unaffected) |
| `/v1/invites/redeem` | POST | recipient device signature | Phase 6 (Q7): `{token, deviceId}` → durable device-bound grant `{grantId}`; consumes one `maxUses`; the app discards the raw token afterwards |
| `/v1/shares/:slug/grants` | GET | bearer | owner lists redeemed grants (label, created, last used) |
| `/v1/grants/:id` | DELETE | bearer | revoke a single recipient grant |
| `/v1/resolve/:slug` | GET | none (+ `?invite=<token>` or grant-signed request when visibility=invite) | public resolution → see 4.2 |
| `/v1/resolve/:slug/sign` | POST | none (+ invite token) | Phase 7, private drives only: `{keys: string[]}` → `{urls: {key, url, expiresAt}[]}` batch presigned GETs (rate-limited, keys must belong to the share index) |
| `/v1/abuse-reports` | POST | none | `{slug, reason, contact?}` — rate-limited |
| `/s/:slug`, `/i/:token` | GET | none | HTML share viewer (Worker assets) with OG tags |

### 4.2 Request/Response Examples

```typescript
// POST /v1/shares  (owner app, bearer auth)
{ driveId: "bdrv_8f…", remoteShareId: "shr_V1StGXR8Z5jdHi6Bmy",
  scope: "track", titleCache: "Blue Highway", 
  capabilities: { readMedia: true, readMemories: false },
  visibility: "link" }
// → 201
{ slug: "V1StGXR8_Z5jdHi6B-myT", url: "https://mu0.app/s/V1StGXR8_Z5jdHi6B-myT" }

// GET /v1/resolve/V1StGXR8_Z5jdHi6B-myT   (viewer or recipient app, no auth)
// → 200 (public drive)
{ status: "active", scope: "track",
  manifestUrl: "https://music.example.com/muzero/shares/shr_V1…/share.json",
  bucketMode: "public",
  capabilities: { readMedia: true, readMemories: false } }
// → 200 (private drive, Phase 7): manifestUrl is presigned, plus { signEndpoint: "/v1/resolve/<slug>/sign" }
// → 410 Gone { status: "revoked" }  |  410 { status: "expired" }  |  404 unknown slug
```

Resolution is cached in KV (60s TTL, purged on revoke) so a viral link doesn't hammer D1.

### 4.3 Error Handling

- **App-side states:** broker unreachable → share creation fails with retry affordance; the projection publish and raw `rawManifestUrl` still succeed (graceful degradation: owner can share the raw URL, Phase-1 behavior). Revoke is retried with backoff until acknowledged; UI shows "revocation pending" until confirmed — never show "revoked" before the broker confirms.
- **Viewer states:** `410 revoked/expired` → friendly "This link is no longer available" page (no metadata leak); media fetch failure (owner deleted objects / CORS broken) → per-track error chip; geo/offline → standard retry.
- **Auth failures:** expired bearer → silent re-challenge; revoked device → surfaced in Settings with re-register flow.
- **Rate limits:** per-IP on `resolve`/`sign`/`abuse-reports` (KV token buckets); per-account on share/invite creation. `429` includes `Retry-After`.
- **Telemetry/Logging:** broker logs operational errors without slugs-as-PII beyond what routing requires; app side uses [logger.ts](../../../src/lib/logger.ts) (rule 8) and **never logs bearer tokens, invite tokens, or key material**. No analytics on the viewer page (no tracking scripts — matches no-telemetry stance).

### 4.4 Live vs Snapshot Republish Semantics

- `mode: "live"` (default for sets): every successful publish sync of the owning drive rebuilds active live projections whose source set is dirty ([cloud-drive-dirty.ts](../../../src/sync/cloud-drive-dirty.ts) gains share-source tracking) and bumps `revision`. The share link always reflects the current set — Google Drive semantics.
- `mode: "snapshot"` (default for single tracks): projection is written once; later source edits don't touch it. Owner can "Update now" manually.
- Removing the source set/track prompts: keep share as orphan snapshot, or revoke+cleanup.

---

## 5. Frontend Design

### 5.1 Page Structure

```
src/components/settings/
├── sharing-panel.tsx            # Settings ▸ Sharing: all ownedShares, status, counters, revoke
├── share-create-dialog.tsx      # stepper: scope → options → publish → link ready (copy)
└── add-drive-dialog.tsx         # EXTENDED: "Shared link" tab recognizes mu0.app/s/<slug>
src/components/library/
└── track-row.tsx                # EXTENDED: Share action in hover toolbar
src/pages/sessions-page.tsx      # EXTENDED: per-set overflow menu (Share / existing actions)
mu0/share-viewer/src/
├── share-player.tsx             # track hero / set track-list + single <audio|video>
└── open-in-app.tsx              # muzero:// attempt + "Get MUZERO" fallback
```

### 5.2 UI Components

- **Share creation dialog** (owner): entry points = per-track hover toolbar button (next to the existing Add-to-Set popover pattern in [track-row.tsx](../../../src/components/library/track-row.tsx) :305–351) and a new per-set overflow menu on [sessions-page.tsx](../../../src/pages/sessions-page.tsx) set rows (which currently have no menu — add a kebab button, reusing the `add-to-set-menu.tsx` popover pattern). Steps:
  1. *What*: set (with optional track subset checklist) or single track; title editable.
  2. *Options*: include tags / notes / memories / lyrics toggles (defaults per §3.2.1 — notes & memories **off**); live vs snapshot; expiry preset (never / 7d / 30d / custom).
  3. *Publish & link*: runs projection publish (progress reuses sync progress components), registers with broker, shows the short link + copy button + QR, plus a secondary **Copy direct link** (raw R2 manifest URL) that works even when the broker is unreachable (Q1). If the drive's bucket is **public**, show the revocation-honesty hint (§2.2) verbatim-equivalent: *"Anyone with the link can listen. Revoking stops the mu0.app link, but the underlying public file URL keeps working until you delete the shared files."*
- **Sharing panel** (Settings ▸ Sharing, new sidebar section): table of `ownedShares` — title, scope chip (set/track), drive, visibility, status badge, visits (`resolveCount`), last visit, expiry. Row actions: copy link, edit (capabilities/expiry/title), update now (snapshot), revoke (confirm dialog), delete + clean up R2 objects (explicit two-step, consistent with "no automatic remote deletion"). Invite-only rows expand to the invite list (Phase 6): label, redemptions `3/10`, expiry, revoke — plus the **grants list** (recipient devices that redeemed an invite: label, created, last used), each grant individually revocable (Q7).
- **Receive flow** (recipient app): [add-drive-dialog.tsx](../../../src/components/settings/add-drive-dialog.tsx) "Shared link" tab detection order becomes: trusted-setup link → `mu0.app/s/…` or `mu0.app/i/…` → raw manifest/share-manifest URL. mu0 links resolve via broker then preview exactly like today's `cloud-drive-sets.tsx` preview (title, track count, bytes, owner device attribution chip) → "Add to my sets" creates `CloudDrive{kind:"shared", provider:"mu0", apiBaseUrl}` + `CloudShare` and imports via the existing pull path; tracks stream or cache via [r2-cache.ts](../../../src/sync/r2-cache.ts) unchanged. Subscribe is the **default** relationship (live sync of the owner's set); because imported shared tracks are normal `Track` rows, the existing per-track Add-to-Set action doubles as track-level fork into the user's own sets — no separate fork mode needed (Q5).
- **Share viewer** (`mu0.app/s/<slug>`): mobile-first single column; track scope = cover hero + title + tags + play button + seek bar; set scope = header (title, owner display name, track count, total duration) + tap-to-play track list with one shared `<audio>`/`<video>` element (same single-element discipline as [media-engine.ts](../../../src/player/media-engine.ts)). Video renders poster (cover) + explicit tap-to-load with `preload="none"`; audio uses `preload="metadata"`; `Save-Data` suppresses any eager loading (Q4). Persistent footer: **Open in MUZERO** (`muzero://share/<slug>`, with visibility-change fallback detection), **Get MUZERO** (links to the desktop downloads fed by `assets.mu0.app`), and a terms/privacy link (Q6). OG/Twitter meta rendered server-side by the Worker from `title_cache` + cover URL so links unfurl in chat apps. Respect `prefers-reduced-motion`; no autoplay with sound (browser policy) — show a prominent play button instead.
- **Deep link**: Electron registers `muzero://` via `app.setAsDefaultProtocolClient` + `open-url` (macOS) / second-instance argv (Win/Linux) in [electron/main.cjs](../../../electron/main.cjs) (none exists today); routed through a new `DesktopBridge.onDeepLink` capability (rule 10: extend the bridge interface + all three implementations; web = paste fallback, Tauri = deferred). A received `muzero://share/<slug>` opens the Add-Drive preview pre-filled.

### 5.3 State Management

- Share creation/management is **request/response async** → TanStack Query (mutations + `ownedShares` broker-counter refresh), matching the provider-healthcheck pattern; local `ownedShares` rows read reactively via Dexie `useLiveQuery`. Nothing share-related enters Zustand (rule 6) — there is no per-frame state here.
- The share viewer is its own tiny app: local component state only, no store.
- i18n: new `share.*` namespace in all four locales (en first, then zh/ja/ko, rule: en is the type source). Viewer ships its own minimal catalog (subset, four locales) because it must not import the whole app.

---

## 6. Implementation Plan

> TDD discipline throughout: pure functions first (`share-projection.ts`, broker route handlers with injected env/`now`), `fake-indexeddb` for Dexie, mocked D1/KV for unit tests, `vitest-pool-workers` for broker integration.

> **Release gating (Q1, resolved):** phases below are implementation milestones, **not** separate public releases. The sharing feature ships as **one batch** once short links, viewer, management UI, receive flow, and invites exist (Phases 1–6 target a single release; 7–8 may trail). The Phase-1 raw **Copy direct link** affordance stays in the shipped UI as a secondary option next to the short link — it works without the broker and is the graceful-degradation path.

> **Upstream dependency (2026-06-12):** Phase 1's projection publish goes through the `CloudObjectStore` interface from the [storage provider abstraction PRD](../20260612-muzero-cloud-storage-provider-abstraction-webdav-prd/20260612-muzero-cloud-storage-provider-abstraction-webdav-prd.md) — that PRD's Phases 1–2 land **first** (priority order in [TODO.md](../../../TODO.md)). Its §2.5 also defines the WebDAV sharing limits referenced from §1.4's storage-agnostic vision.

### Phase 1: Share Projection Writer + Raw-URL Share (no backend)

**Goal:** Owner can share a set or single track as a direct R2 URL today (public buckets), and another MUZERO can add it. Delivers requirement 2 baseline + the projection layer everything else builds on. Zero broker dependency.

**Tasks:**
- [ ] Extend `r2ShareManifestSchema` additively (`scope`, `sourceTrackId`, `revision`, `viewer`) + share index schema with projection filtering.
- [ ] `src/sync/share-projection.ts`: pure `buildShareProjection({set?, track, tracks, blobsMeta, options})` → `{shareManifest, shareIndex, requiredObjects[]}` with exhaustive tests (subset selection, notes/memories/lyrics/brief toggles, content-addressed object reuse, no library-manifest reference).
- [ ] Dexie: new `ownedShares` table + version bump + upgrade; repo helpers (`createOwnedShare`, `listOwnedShares`, `markSharePublished`, `revokeOwnedShare`).
- [ ] Publish integration: fold active shares of a drive into [buildR2ExportPlanForDrive](../../../src/sync/r2-export-plan.ts) (`shares/<id>/index.json` then `share.json` last, ETag preconditions); live-mode republish via dirty tracking; snapshot stays frozen.
- [ ] Receive: extend [r2-shared-link.ts](../../../src/sync/r2-shared-link.ts)/[r2-subscription.ts](../../../src/sync/r2-subscription.ts) so a pasted **share-manifest URL** previews and imports as a set (scope "track" imports a one-track set), reusing stream/cache import.
- [ ] Minimal creation UI behind the per-set/per-track Share action: dialog (steps 1–2 of §5.2) ending at "Copy direct link" (`rawManifestUrl`); Sharing panel lists shares with revoke = unpublish (delete projection objects, explicit confirm).
- [ ] i18n `share.*` en/zh/ja/ko.

### Phase 1 Checklist

- [ ] Sharing a set whose media is already synced uploads only JSON objects (no media bytes re-uploaded).
- [ ] A shared single track imports and plays in another MUZERO install via pasted raw URL.
- [ ] Notes/memories are excluded by default and never appear in the share index unless toggled on.
- [ ] Share index never references the library manifest or other sets; library manifest never references shares.
- [ ] Removing a share deletes `shares/<id>/*` objects after explicit confirm; content-addressed media objects are untouched.
- [ ] Live share republishes on next sync after the source set changes; snapshot does not.

### Phase 2: `mu0` Broker Foundation

**Goal:** Stable short links with real revocation: `mu0/broker` Worker + D1 + device-key auth + share registry + resolve endpoint; app gets `mu0-client.ts` and shares created in Phase 1 can be upgraded to short links.

**Tasks:**
- [ ] Scaffold `mu0/` workspace (broker + shared schemas), wrangler config (hosted + self-host params), D1 migration 0001, Makefile targets.
- [ ] Device auth: Ed25519 keypair generation in app (WebCrypto), register/challenge/token routes, bearer middleware; link-code flow for second devices.
- [ ] Drive + share registry routes (`POST/GET/PATCH/DELETE /v1/shares`), slug minting, KV resolution cache with purge-on-revoke, expiry sweep on read.
- [ ] `GET /v1/resolve/:slug` (public mode), 410 semantics for revoked/expired.
- [ ] App: `mu0-client.ts` (typed, via `getAppFetch()`, injectable), settings fields, "Enable mu0 short links" opt-in in Sharing panel; share creation registers and stores `slug`/`shortUrl`; revoke calls PATCH with pending-state UI.
- [ ] Rate limiting (KV token buckets) on resolve + share creation; audit_events writes for create/revoke.
- [ ] Broker unit tests (handlers, injected env/now) + `vitest-pool-workers` integration suite.

### Phase 2 Checklist

- [ ] Creating a share returns `mu0.app/s/<slug>` ≤ 2s after projection publish completes.
- [ ] Revoking via the app makes `resolve` return 410 within 60s (KV purge) and the share viewer shows "no longer available".
- [ ] No R2 credential, secret, bearer, or invite token ever appears in a share URL, broker log line, or local log (`src/**` via logger only).
- [ ] A second device can link to the same account via link code and manage the same shares; no email required.
- [ ] Self-hosted deploy (`wrangler deploy` with own vars) passes the same integration suite; app honors custom `apiBaseUrl`.
- [ ] Broker outage degrades gracefully: existing imported shares keep playing (direct R2), share creation falls back to raw URL with a clear notice.

### Phase 3: Share Viewer Landing Page

**Goal:** Requirement 1's UX: open the link, the music plays — in any browser, no install.

**Tasks:**
- [ ] `mu0/share-viewer` Vite app served as Worker assets at `/s/:slug`; resolves via `/v1/resolve`, fetches share manifest+index from owner R2 (CORS), renders track hero / set list per §5.2.
- [ ] Single persistent media element, play/pause/seek, next/prev for sets, Media Session API metadata (lockscreen controls), video support for `kind: "video"` tracks — video = poster + tap-to-load with `preload="none"`, audio `preload="metadata"`, honor `Save-Data` (Q4).
- [ ] Publish a minimal `mu0.app` terms/AUP + privacy note; viewer footer links it (Q6).
- [ ] Server-rendered OG/Twitter tags (`title_cache`, cover URL) for chat unfurl; revoked/expired/404 pages without metadata leak.
- [ ] "Open in MUZERO" (`muzero://share/<slug>`) with fallback + "Get MUZERO" download links (reuse `assets.mu0.app` release feed data).
- [ ] Viewer i18n (en/zh/ja/ko subset catalog), reduced-motion, mobile-first layout, no analytics/tracking.
- [ ] Update copyable CORS guidance ([scripts/r2-cloud-drive-test-cors.json](../../../scripts/r2-cloud-drive-test-cors.json) + Settings copy) to include `https://mu0.app`; healthcheck verifies it.

### Phase 3 Checklist

- [ ] A shared single track plays in mobile Safari and desktop Chrome within one tap of opening the link.
- [ ] A shared set shows its track list; tapping any track plays it; cover/tags/durations render.
- [ ] The link unfurls with title + cover in chat apps (OG tags verified).
- [ ] A revoked slug shows the unavailable page and leaks no title/cover/owner metadata.
- [ ] Viewer never calls any endpoint except `api.mu0.app/v1/resolve*` and the owner's R2 URLs; zero third-party requests.
- [ ] `capabilities.readMemories: false` shares render no memory content even if objects exist in the bucket.
- [ ] Video shares download zero media bytes before an explicit tap (Q4).

### Phase 4: Owner Sharing Management UI

**Goal:** Requirement 3's management surface, complete for link-visibility shares.

**Tasks:**
- [ ] Settings ▸ Sharing panel per §5.2 (list, status badges, visit counters via TanStack Query, copy, edit capabilities/expiry/title, update-now, revoke with pending state, delete+cleanup two-step).
- [ ] Per-set overflow menu on sessions page + per-track Share action wired to the full dialog (QR code, public-bucket honesty hint).
- [ ] Expiry handling end-to-end (local badge, broker 410, viewer page).
- [ ] Counters: `resolveCount`/`lastResolvedAt` surfaced as "Visits"; explicitly **not** unique-listener analytics (privacy stance documented in UI hint).
- [ ] Source deletion guard: deleting a set/track with active shares prompts keep-as-snapshot vs revoke+cleanup.
- [ ] Link the `mu0.app` terms/privacy note contextually from the Sharing panel and cloud-drive Settings sections — local-only users never encounter it (Q6).
- [ ] i18n completion for all management strings (4 locales).

### Phase 4 Checklist

- [ ] Owner can find every share they ever created in one place with live status.
- [ ] Editing expiry/capabilities takes effect on next resolve without recreating the link (slug stable).
- [ ] Revoke shows pending until broker-confirmed; UI never claims revoked prematurely.
- [ ] Deleting the source set with an active live share triggers the guard prompt.
- [ ] All new strings exist in en/zh/ja/ko.

### Phase 5: Receive Flow + Deep Links

**Goal:** Requirement 2 end-to-end polish: paste or click, preview, add to my sets.

**Tasks:**
- [ ] Add-Drive "Shared link" tab recognizes `mu0.app/s/…` (+ `/i/…`): resolve → preview (reuses cloud-drive-sets preview UI) → Add creates `CloudDrive{provider:"mu0"}` + `CloudShare` + import.
- [ ] `DesktopBridge.onDeepLink` capability + Electron `muzero://` protocol registration (`setAsDefaultProtocolClient`, macOS `open-url`, Win/Linux second-instance argv, single-instance lock); web/Tauri fallbacks documented.
- [ ] `muzero://share/<slug>` routes to the pre-filled Add-Drive preview; viewer's Open-in-MUZERO uses it.
- [ ] Owner attribution chip on imported shares (existing `DevicePublicProfile` display path) + "via mu0.app" source label in track-source description ([track-source.ts](../../../src/lib/track-source.ts)).
- [ ] Re-resolve on sync: pulling a mu0 share re-checks `resolve` (revoked → mark share stale locally, keep cached media, stop refreshing).
- [ ] Verify per-track Add-to-Set works on tracks imported from a subscribed share (track-level fork, Q5); document that streaming-only forked tracks still depend on the share staying live, while cached ones don't.

### Phase 5 Checklist

- [ ] Clicking "Open in MUZERO" on the landing page opens the installed desktop app with the preview pre-filled (macOS + Windows).
- [ ] Recipient can add a shared set and play it streamed, then cache it for offline (existing cache mode).
- [ ] A revoked share stops refreshing on the recipient side with a visible stale state; already-cached local media keeps playing (documented; revocation is forward-looking).
- [ ] Pasting all three link kinds (trusted-setup / mu0 / raw manifest) routes correctly in one input field.
- [ ] A track from a subscribed shared set can be added to one of the user's own sets via the existing Add-to-Set action (Q5).

### Phase 6: Invite-Only Shares + Invite Management

**Goal:** Restricted sharing: revocable per-person invites instead of anyone-with-the-link.

**Tasks:**
- [ ] Broker: `visibility: "invite"` enforcement on resolve (`?invite=` token, hashed lookup, expiry/revoked checks) for browser visitors; invite CRUD routes. `maxUses` counts **redemptions** (grant creations), not browser resolutions — repeat listening never burns uses (Q7).
- [ ] Broker: `POST /v1/invites/redeem` — a MUZERO-app recipient's device key redeems the token into a durable, individually revocable `grants` row; subsequent re-resolutions authenticate by grant signature; the app discards the raw token after redemption (Q7 long-term best practice).
- [ ] App (owner): visibility selector in creation dialog; invite list UI (create with label/maxUses/expiry, copy `mu0.app/i/<token>` shown once, revoke) + grants list with per-grant revoke.
- [ ] App (recipient): invite-link paste/deep-link path registers the device key if needed, redeems, and stores `grantId` on the `CloudShare` row (additive field).
- [ ] Viewer: `/i/<token>` entry resolves like `/s/` with the token; invalid/exhausted/revoked invite page.
- [ ] Tests: token never stored raw anywhere (hashed broker-side, discarded app-side post-redemption), grant revocation immediacy, redemption maxUses boundary, browser-resolution-does-not-consume-uses.

### Phase 6 Checklist

- [ ] An invite-only share's `/s/<slug>` URL alone resolves to an access-required page (no content).
- [ ] Revoking one invite stops new redemptions and browser-token access for that invite only; revoking one grant cuts off exactly that recipient device; other invites, grants, and the owner keep working.
- [ ] `maxUses: 1` invite stops accepting redemptions after the first; redemption and grant counters visible to owner.
- [ ] A redeemed recipient keeps access after their invite is later revoked, until their grant is individually revoked (documented semantics, Drive-style: disabling the invite link ≠ removing people already in).
- [ ] Raw invite tokens exist nowhere in persistent storage (hashed broker-side, discarded app-side after redemption).

### Phase 7: Private Buckets — Credential Vault + Broker Presign

**Goal:** Tier ② proper: shares from **private** buckets with real, complete revocation (no public-URL residual risk).

**Tasks:**
- [ ] Extend [r2-s3.ts](../../../src/sync/r2-s3.ts) with query-string presign (SigV4 `X-Amz-*` serialization; same derived key) + unit vectors. (Shared groundwork with the R2 PRD's Tier-① local-presign slice; that slice itself stays in the R2 PRD's scope.)
- [ ] Broker vault: explicit opt-in flow with security wording (per R2 PRD §2.7 credential table); store **scoped** R2 API token (bucket+prefix, read-only) AES-GCM-encrypted under a Worker secret; rotation + delete-vault endpoints.
- [ ] Resolve for private drives: presigned `share.json`/`index.json` URLs; `POST /v1/resolve/:slug/sign` batch endpoint (keys validated against the share index, short TTL ~10min, rate-limited).
- [ ] Viewer: presigned playback with expiry-aware refresh (re-sign before seek/long tracks expire); Range requests verified for seeking.
- [ ] App receive path: mu0 shares from private drives stream via sign endpoint (media URL resolution gains a per-drive "broker-signed" mode — the abstraction R2 PRD Open Question 5 anticipated).
- [ ] Setup UX: drive registration asks bucket mode (mirrors §2.6.1 setup-time selection); private mode requires vault opt-in before sharing; healthcheck validates a presigned GET round-trip.

### Phase 7 Checklist

- [ ] A share from a private bucket plays in the viewer and in a recipient app; the bucket has no public access enabled.
- [ ] Revoking it makes content unreachable after presign TTL (≤10min), verified by test.
- [ ] Vault is opt-in with explicit wording; deleting the vault disables private-drive shares with a clear owner-side error, and the encrypted blob is destroyed.
- [ ] The vault token is read-only and bucket/prefix-scoped; a write attempt with it fails (verified in integration test docs).
- [ ] Sign endpoint refuses keys not present in the share's index.

### Phase 8: Ops, Audit, Abuse + Self-Host Packaging

**Goal:** Run it responsibly; make self-hosting first-class.

**Tasks:**
- [ ] Audit log UI (owner-visible event history per share, from `audit_events`).
- [ ] Abuse pipeline: `/v1/abuse-reports`, viewer footer "Report" link, owner notification surface, admin disable path (`status: revoked` + `abuse_reports.resolution`); expand the Phase-3 policy page with abuse/DMCA contact + takedown specifics.
- [ ] Rate-limit hardening + cost review (D1/KV/Workers free-tier headroom estimate, alarms).
- [ ] Accepted-loss account stance (Q2): no recovery mechanism by design; document it, and show a proactive "link a second device" hint in Sharing settings (multi-device linking is the only mitigation). Document that orphaned shares (all devices lost) keep resolving until expiry, with the abuse path as the only remaining disable lever.
- [ ] Self-host docs: `wrangler deploy` walkthrough, parameterized vars (domain, secrets), app Settings field for custom `apiBaseUrl` per drive, smoke-test checklist; future "Deploy to Cloudflare" button noted as post-stability (R2 PRD §2.7).
- [ ] Cross-PRD doc sync: update R2 PRD §2.6/§2.7 status notes + Settings Cloud Drive UX PRD pointers.

### Phase 8 Checklist

- [ ] Owner can see when each share was created/edited/revoked and by which of their devices.
- [ ] An abuse report can disable a slug without touching the owner's bucket; the owner sees why.
- [ ] Self-host quickstart verified end-to-end on a fresh Cloudflare account by following only the docs.
- [ ] Cost model documented with measured per-resolve unit costs.

---

## 7. Out of Scope

- **MUZERO-hosted storage of user media bytes** — permanent non-goal; bytes live only in user R2.
- **WebDAV / non-R2 storage backends** — part of the long-term private-cloud vision (§1.4, Q1) but a separate storage-provider PRD; the share/broker contracts here stay URL-based and storage-agnostic so that work needs no redesign.
- **Proxying media through the broker** — never, including as a "fallback" (egress/cost/bottleneck rule, §2.6.1).
- **Collaborator write-back via broker** (shared-set editing, upload grants, anonymous listener stats/presence write-back from shared links) — the broker makes these *possible* later; deliberately excluded here to bound scope. `capabilities.writeStats/writePresence` remain `false`.
- **Tier ① local presign for own devices** — stays a slice of the R2 sync PRD; Phase 7's presign utility is shared groundwork only.
- **Accounts with passwords / OAuth / social profiles, public discovery, feeds, comments, likes** — `mu0.app` stores grants, not a social graph. Account recovery likewise (Q2: loss accepted by design).
- **DRM / copyright enforcement technology** (abuse takedown process in Phase 8 is operational, not DRM).
- **Mobile (Tauri iOS/Android) deep-link registration** — desktop-first per CLAUDE.md rule 9; paste flow works everywhere meanwhile.
- **Realtime presence/sync rooms on shares.**
- **Per-track alias ids (`shareTrackId`) privacy layer** — rejected (Q3): canonical ids are random, and sha256 media keys correlate across shares anyway.

---

## 8. Security Considerations

### 8.1 Authentication

- **Owner devices:** Ed25519 keypair per install (WebCrypto), registered with the broker; challenge-response → short-lived bearer (~1h). No passwords; account = the set of linked device keys. Key material lives only in IndexedDB settings (same custody class as R2 secrets, CLAUDE.md rule 2); never logged, never in URLs.
- **Link visitors:** none by design (link-visibility) or single-use-style bearer invite tokens (invite-visibility), stored only hashed server-side.
- **Device revocation:** an owner can revoke a lost device's key from another linked device; revoked keys fail token issuance immediately.
- **Account loss is accepted by design (Q2):** there is no email/password recovery of any kind. Losing every linked device forfeits management of existing shares — they keep resolving until expiry (abuse path is the only remaining disable lever), and re-sharing under a new account restores control going forward. Sharing settings encourages linking a second device proactively.

### 8.2 Authorization

- All share/invite mutations require a bearer from a device on the owning account; D1 rows are account-scoped (no cross-account reads by construction; every query filters `account_id`).
- `resolve` enforces: status active → not expired → visibility check (valid unexpired invite token for browser visitors, or a valid unrevoked grant signature for redeemed app recipients; `maxUses` gates redemptions, not resolutions).
- Phase 7 `sign` only mints GET presigns for keys present in that share's index — the broker cannot be used to enumerate or exfiltrate other bucket contents even with a vault token present.
- Vault tokens must be **read-only and bucket/prefix-scoped**; setup UX instructs creating a dedicated scoped token, mirroring the existing owner-credential guidance (R2 PRD §8.2).

### 8.3 Data Protection

- **Hard rule (inherited):** R2 write credentials never appear in share links, broker payloads (vault opt-in is a separate explicit read-only token), manifests, logs, or exports.
- Share projections are **privacy-filtered at build time**: notes, memories/photos, and `TrackBrief` provenance are excluded by default and only included by explicit toggle; the publish UI warns that public-bucket shares are world-readable (consistent with R2 PRD §8.3).
- Slugs/tokens: ≥126-bit entropy, no enumeration endpoint, KV/D1 lookups constant-time-ish by key; invite tokens stored as SHA-256 hashes.
- Broker data minimization: no visitor identity, no IP retention in D1, coarse counters only; viewer page has zero third-party scripts/trackers.
- Vault blobs AES-GCM-encrypted with a Worker secret (rotatable); deleting the vault destroys ciphertext.
- Viewer XSS surface: all owner-controlled strings (titles, tags) rendered as text nodes (React default), CSP on `mu0.app` (no inline script, media/img/connect-src limited to https:), OG output HTML-escaped by the Worker.

### 8.4 Threats Specific to This Design

| Threat | Mitigation |
|---|---|
| Leaked short link (link-visibility) | That's the chosen semantics (Drive-style); owner mitigates via revoke / expiry / invite-visibility; honesty hint explains public-bucket residual risk |
| Broker compromise | Blast radius = grants metadata + (Phase 7) encrypted scoped read-only tokens; no write credentials, no media; vault delete + token rotation runbook in Phase 8 docs |
| Slug brute force | 126-bit slugs + per-IP rate limits on resolve |
| Hotlink/abuse of someone's bucket via viral share | Owner-visible visit counters; owner can revoke; Cloudflare-side rate limits; (public buckets already carry this risk pre-mu0) |
| Copyright abuse via mu0 links | Abuse reports + takedown path disable the slug (Phase 8); MUZERO never hosts the bytes |
| Broker as availability SPOF | Imported shares keep playing direct-from-R2; only *new* resolutions/invites depend on broker uptime (documented trade-off from §2.6.1) |

### 8.5 Audit Logging

`audit_events` records share/invite/drive/device lifecycle actions (owner-visible, Phase 8 UI). No content access logs beyond coarse `resolve_count`/`last_resolved_at`.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [R2 Cloud Drive Sync PRD](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | Parent design: §2.6 permission models, §2.6.1 access tiers/link indirection, §2.7 hosted control plane sketch, §3.4.1 share projection schemas — this PRD implements them |
| [Cloud Storage Provider Abstraction + WebDAV PRD](../20260612-muzero-cloud-storage-provider-abstraction-webdav-prd/20260612-muzero-cloud-storage-provider-abstraction-webdav-prd.md) | **Upstream prerequisite**: Phase 1 here publishes via its `CloudObjectStore`; its §2.5 defines which drives can back shares (public-read requirement) |
| [Settings Cloud Drive UX PRD](../20260609-muzero-settings-cloud-drive-ux-prd/20260609-muzero-settings-cloud-drive-ux-prd.md) | The Settings surface the Sharing panel and Add-Drive extensions live in |
| [Release Pipeline + Changelog PRD](../20260611-muzero-release-pipeline-changelog-prd/20260611-muzero-release-pipeline-changelog-prd.md) | `assets.mu0.app` distribution the viewer's "Get MUZERO" links into; precedent for MUZERO-operated Cloudflare infrastructure |
| [Set/PlayQueue/Memory Data Model PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md) | Set vs queue semantics behind "add to my sets" |
| [prd-template.md](../prd-template.md) | Template |

---

## 10. Open Questions

All seven resolved by the owner on 2026-06-12; decisions folded into the body sections referenced below.

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should Phase-1 raw-URL sharing be user-visible, or internal-only until short links (Phase 2) ship? | Resolved (2026-06-12) | Ship the whole batch together — short links are required at ship time, with **Copy direct link** kept as a secondary affordance (§5.2, §6 release gating). Long-term vision recorded in §1.4: user-supplied private storage (R2 now, WebDAV-class later) + `mu0.app` as the universal listen destination; share contracts stay storage-agnostic. |
| 2 | Recovery story for a lost only-device: accept account loss, or add email recovery? | Resolved (2026-06-12) | No accounts/passwords/recovery — **account loss is accepted**. Mitigation = proactively link a second device (hint in Sharing settings). Orphaned shares keep resolving until expiry; abuse path is the only remaining disable lever (§8.1, Phase 8). |
| 3 | `shareTrackId` aliasing (hide canonical `trk_` ids in share indexes)? | Resolved (2026-06-12) | Rejected per best practice: random `trk_` ids are non-identifying, and content-addressed sha256 media keys correlate across shares anyway — aliasing adds indirection without real unlinkability (§3.2.2). |
| 4 | Viewer playback of `kind: "video"` MV shares on cellular? | Resolved (2026-06-12) | Best practice: poster + explicit tap-to-load, `preload="none"` for video / `"metadata"` for audio, honor `Save-Data`. No transcoding (unchanged non-goal) (§5.2, Phase 3). |
| 5 | "Add to my sets": fork in addition to subscribe? | Resolved (2026-06-12) | **Subscribe is the default** (sync sharing). Track-level fork comes free: imported shared tracks are normal rows, so the existing Add-to-Set action copies them into the user's own sets. No whole-set fork mode in v1 (§5.2, Phase 5). |
| 6 | ToS/AUP + privacy note before public exposure? | Resolved (2026-06-12) | Yes — a minimal policy page ships with the viewer (Phase 3), linked from the viewer footer and from cloud/Sharing Settings sections only; local-only users never encounter it (Phases 3/4/8). |
| 7 | Invite redemption: device-bound grants vs stateless tokens? | Resolved (2026-06-12) | Long-term best practice: app recipients **redeem the token into an individually revocable device-bound grant** (raw token discarded after redemption); browser visitors keep token-link access while the invite is active; `maxUses` counts redemptions, not browser plays (§3.2.3 `grants`, §4.1, Phase 6). |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | MUZERO | Sequenced behind the new [storage provider abstraction PRD](../20260612-muzero-cloud-storage-provider-abstraction-webdav-prd/20260612-muzero-cloud-storage-provider-abstraction-webdav-prd.md): Phase 1's projection publish consumes `CloudObjectStore`; cross-PRD priority recorded in TODO.md. |
| 2026-06-12 | MUZERO | All 7 open questions resolved by owner: single-batch ship with short links + secondary raw-link copy (Q1; long-term private-cloud vision incl. WebDAV-class backends recorded in §1.4, contracts kept storage-agnostic), accepted-loss accounts with no recovery (Q2; recovery-email column dropped from D1), `shareTrackId` aliasing rejected (Q3), tap-to-load/`preload="none"` video best practice (Q4), subscribe-default + track-level fork via existing Add-to-Set (Q5), policy page ships with viewer and is linked only from cloud-feature Settings (Q6), redeem-to-grant invite model with per-recipient revocation (Q7; D1 gains `grants` table + `grt_` prefix, `CloudShare.grantId?` additive field, redeem/grants endpoints, Phase 6 rewritten). |
| 2026-06-12 | MUZERO | Initial draft. Investigated existing codebase (share-manifest schema present but unused; `provider:"mu0"` + `apiBaseUrl` already reserved; SigV4 header signing present, presign absent; trusted-link paste flow reusable; no `muzero://` protocol registration yet). Defined 8 phases: projection writer (no backend) → broker (D1 + device-key auth + stable slugs) → web viewer → owner management UI → deep links/receive → invites → private-bucket presign via opt-in vault → ops/abuse/self-host. Carried over hard rules: bytes never proxied, secrets never in links, broker optional, self-host first-class. |
