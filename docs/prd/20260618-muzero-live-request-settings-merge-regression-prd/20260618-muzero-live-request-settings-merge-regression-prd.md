# PRD: Live-Request Settings Merge — Regression Hardening

**Status:** Draft
**Created:** 2026-06-18
**Author:** Claude (investigation) + DoodleBears
**Module:** Settings (`AppSettings.audienceRequestIntake`) — regression review after merging the live-chat song-request (点歌 / live-request) feature

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Deep-merge intake defaults + guard unguarded reads (HIGH) | 🔲 Pending | [Phase 1](#phase-1-checklist) |
| 2 | Stale-snapshot write clobber in the panel (MEDIUM) | 🔲 Pending | [Phase 2](#phase-2-checklist) |
| 3 | Transport re-apply debounce (LOW) | 🔲 Pending | [Phase 3](#phase-3-checklist) |
| 4 | Regression tests + verification | 🔲 Pending | [Phase 4](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

We merged the live-chat song-request feature (`feat/live-chat-song-request`) into the active branch. It adds a new nested settings object — `AppSettings.audienceRequestIntake` (`AudienceRequestIntakeSettings`) — plus a Settings panel ([`live-request-settings.tsx`](../../../src/components/settings/live-request-settings.tsx) + [`src/components/settings/live-request/`](../../../src/components/settings/live-request/)), a settings-nav entry, i18n for 4 locales, and a transport lifecycle wired at app boot.

MUZERO persists **all** settings in a single IndexedDB `settings` row (`AppSettings`, id `"app"`), and [`saveSettings`](../../../src/db/repositories.ts) merges writes **shallowly**: `{ ...current, ...patch, id: "app" }`. [`getSettings`](../../../src/db/repositories.ts) likewise merges defaults **shallowly**: `{ ...DEFAULT_SETTINGS, ...row }`. This shallow-merge model is the structural root cause of the regression risk below: any *nested* object (`audienceRequestIntake`, `streamSources`, `shortcutOverrides`, …) is replaced wholesale, never deep-merged. The live-request feature is the most exposed because its sub-fields are read **unguarded** in a panel that crashes on `undefined`, and its numeric sub-fields drive rate-limiting.

An investigation (8 regression vectors) found the nav/i18n/type/transport integration is **clean**, but surfaced a **HIGH-severity** data-shape regression for users carrying a *partial* persisted `audienceRequestIntake` object (early-branch testers, or any future sub-field added without a migration).

### 1.2 Target Users

| Role | Description | Impact |
|------|-------------|--------|
| **Existing users (pre-merge settings row)** | Have a persisted `settings` row with **no** `audienceRequestIntake` key | **Safe** — `getSettings` injects the full default object |
| **Early-branch testers / future field adds** | Have a **partial** `audienceRequestIntake` (missing newer sub-fields) | **Broken** — panel crashes, rate-limit disabled |
| **DJ / streamer using live requests** | Configures intake in Settings | Affected by stale-snapshot clobber + transport churn |

### 1.3 Core Value

1. **No crash on legacy/partial settings**: the live-request panel must render for any persisted shape, old or new.
2. **Rate-limiting never silently disabled**: numeric intake fields must always resolve to a number, never `NaN`.
3. **Edits don't revert each other**: rapid panel edits must not clobber sibling fields.
4. **Structural fix, not whack-a-mole**: deep-merge intake defaults once, so future sub-field additions are backfilled for free.

---

## 2. Regression Findings (investigation summary)

Cited `file:line` against the merged tree. Verdicts: **OK** / **RISK** / **BUG**.

| # | Vector | Verdict | Note |
|---|--------|---------|------|
| 1 | `saveSettings` shallow-merge clobbering (top-level) | OK (latent footgun) | All nested writers rebuild the full sub-object; see Vector 2 footgun → §2.2 |
| 2 | Migration / defaults backfill for existing users | **RISK (HIGH)** | Fully-absent intake is safe; **partial** intake is NOT deep-backfilled → §2.1 |
| 3 | `requireCommandPrefix` / `matchedCommandPrefix` | OK | Defined + defaulted `true`, read with `?? true`; normalizer sets `matchedCommandPrefix` |
| 4 | Settings page / nav integration | OK | `settings-nav.ts:59` entry + `:94` stale-id alias `audience-requests→live-requests`; no dup ids |
| 5 | i18n completeness (en/zh/ja/ko) | OK | All 4 locales carry identical `liveRequests*` keys; panel also uses `t(key,{defaultValue})` |
| 6 | Type / default drift | OK | Every required `AudienceRequestIntakeSettings` field present in the default; no Zod settings schema (by design) |
| 7 | Transport lifecycle side effects | OK (chatty) | Only boot + the panel call `applyLiveRequestIntake`; no unrelated panel re-triggers it → §2.3 |
| 8 | Other smells | mixed | Unguarded `commandPrefixes.length`; `requireApprovalForPlayNow` has no UI; thin test coverage |

### 2.1 HIGH — Partial `audienceRequestIntake` crashes the panel + disables rate-limiting

**Root cause:** `getSettings`' merge is shallow (`{ ...DEFAULT_SETTINGS, ...row }`) and only special-cases `visualizerIdleOnly`; it does **not** deep-merge `DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS` into an existing `audienceRequestIntake` object. The latest Dexie schema is `version(26)` with **zero** `.upgrade()` touching `settings.audienceRequestIntake`. So a persisted *partial* intake object leaves newer sub-fields `undefined`, and the only defense is per-read `?? default` guards — which are **missing** in key spots:

- **Crash:** [`live-request-settings.tsx:227,267`](../../../src/components/settings/live-request-settings.tsx) read `intake.commandPrefixes.length` unguarded → `Cannot read properties of undefined (reading 'length')` → the whole panel render throws.
- **Silent rate-limit bypass:** [`audience-request-runtime.ts:166,176,182`](../../../src/live-requests/audience-request-runtime.ts) compute `intake.dedupeWindowSec * 1000` / `requesterCooldownSec * 1000` / `maxRequestsPerMinute` — `undefined * 1000 = NaN`; `recentAcceptedAt.length >= NaN` is always false → dedupe/cooldown/rate-limit silently disabled.
- **Silent routing misbehavior:** `searchScope` / `routeMode` / `playbackAction` `undefined` → scope/route default-less.

**Who is affected:** anyone with a half-populated `audienceRequestIntake` — early testers of this branch (enabled the feature before `sources` / `transport` / `requireCommandPrefix` / `ssn*` existed), and, critically, **every future sub-field we add without a migration** (the bug is latent and recurring).

### 2.2 MEDIUM — Stale-snapshot write clobber inside the panel

The panel's `update()` helper ([`live-request-settings.tsx:59-63`](../../../src/components/settings/live-request-settings.tsx)) rebuilds the **entire** nested object from `intake`, which comes from `useSettings()` — a Dexie `useLiveQuery` snapshot, not a fresh DB read — then `saveSettings({ audienceRequestIntake: next })`. Two edits fired before the liveQuery re-emits both build off the **same stale snapshot**; the second reverts the first's sub-field. Repro: toggle `enabled`, then immediately edit `port` before re-render → the `port` write reverts `enabled`. (A general per-panel pattern, worse here because the whole nested object is rewritten each edit.)

### 2.3 LOW — Transport churn on every keystroke

`update()` calls `applyLiveRequestIntake(next)` on **every** edit ([`:62`](../../../src/components/settings/live-request-settings.tsx)), tearing down/rebuilding the Electron webhook server per character in `port`/`token`/prefix fields. Functionally idempotent, but wasteful and risks transient bind errors during rapid edits.

### 2.4 INFO — No settings-level schema; `requireApprovalForPlayNow` has no UI

There is no Zod schema for `AudienceRequestIntakeSettings` (only incoming chat *payloads* are validated) — this is the structural reason §2.1/§2.2 have no safety net. `requireApprovalForPlayNow` is in the type/default (`false`) and read by the runtime but has no Settings control (intentional per the type comment; confirm it's not meant to be user-facing).

---

## 3. Requirements

### 3.1 Functional

- **R1 (HIGH):** Loading settings for **any** persisted shape — absent, partial, or full `audienceRequestIntake` — yields a fully-populated intake object; the panel renders without throwing and rate-limiting uses real numbers.
- **R2 (HIGH):** Every numeric intake field used in arithmetic resolves to a number (no `NaN`); array fields resolve to an array (no unguarded `.length`).
- **R3 (MEDIUM):** Two rapid panel edits never revert each other; each edit is a read-modify-write against the latest persisted state.
- **R4 (LOW):** The transport (webhook/SSN) re-applies only when a transport-relevant field actually changes, and is debounced against rapid edits.
- **R5:** Backward/forward compatible — `codename` layer stable (db name `muzero-db`, `audienceRequestIntake` key, sub-field names unchanged); no data loss for existing rows (hard rule #4).

### 3.2 Non-functional / constraints

- **No hidden backend flags** (hard rule #3): rollback = `git revert` + redeploy, not a runtime kill switch. No `localStorage`/URL/`window.*` toggles.
- **BYOK secret discipline** (hard rule #2): `audienceRequestIntake.authToken` / `ssnSessionId` are device-local; never logged or sent over telemetry/the dev control endpoint.
- **Local-first**: fix stays in the renderer + Dexie; no new backend.

### 3.3 Design — fix direction

**Preferred (R1/R2): deep-merge intake defaults at the read boundary.** Add a single normalization in `getSettings` (or a small `resolveAudienceRequestIntake(row)` helper) that deep-merges `DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS` under the persisted object: `{ ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS, ...row.audienceRequestIntake }` (and backfill `sources` via `resolveSources()`). This fixes absent **and** partial shapes in one place and makes every future sub-field self-backfilling — superior to scattering `?? default` guards. Keep the unguarded reads defensive too (`intake.commandPrefixes ?? []`) as belt-and-suspenders.

- *Alternative considered:* a one-time `version(27)` `.upgrade()` that backfills the stored row. Rejected as the primary fix because it only patches rows present at upgrade time; a read-boundary deep-merge also covers rows written by older code paths and future fields. A migration MAY still be added to normalize at rest, but the read-boundary merge is the correctness guarantee.

**R3:** `update()` should read-modify-write off a fresh `getSettings()` (or a repo helper `setAudienceRequestIntake(patch)` that re-reads current before merging) instead of the liveQuery snapshot.

**R4:** Only call `applyLiveRequestIntake` when `enabled`/`transport`/`port`/`token`/`ssn*` changed; debounce by ~300–500ms.

---

## 4. Implementation Phases

### Phase 1 Checklist — Deep-merge defaults + guards (HIGH, R1/R2)
- [ ] Add deep-merge of `DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS` at the read boundary (`getSettings` or helper), incl. `sources` via `resolveSources()`.
- [ ] Guard `intake.commandPrefixes` reads in the panel (`?? []`) — `live-request-settings.tsx:227,267`.
- [ ] Unit test: a partial persisted intake → resolved object is fully populated; panel renders; runtime cooldown/rate-limit math is finite.

### Phase 2 Checklist — Stale-snapshot clobber (MEDIUM, R3)
- [ ] `update()` (or a repo `setAudienceRequestIntake(patch)`) read-modify-writes off fresh `getSettings()`.
- [ ] Test: two rapid edits don't revert each other.

### Phase 3 Checklist — Transport debounce (LOW, R4)
- [ ] Re-apply transport only on transport-relevant field change; debounce.
- [ ] Test: typing in `port` does not tear down/rebuild the webhook per keystroke.

### Phase 4 Checklist — Regression tests + verification
- [ ] Test fixture for a legacy/partial `audienceRequestIntake` (the case `live-request-settings.test.tsx` currently never exercises — it mocks full `DEFAULT_SETTINGS`).
- [ ] `make check` green (typecheck + lint + vitest).
- [ ] Confirm `requireApprovalForPlayNow` UI intent (expose or leave engine-only).

---

## 5. Acceptance Criteria

1. Seeding the DB `settings` row with a **partial** `audienceRequestIntake` (e.g. only `{ enabled: true }`) → the live-request panel renders without throwing, and `getSettings()` returns all required sub-fields populated from defaults.
2. With a partial intake, the runtime's dedupe/cooldown/rate-limit checks operate on finite numbers (asserted via the runtime integration test).
3. Toggling `enabled` then immediately editing `port` preserves both (no revert).
4. Editing `port` rapidly re-applies the transport at most once per debounce window.
5. All 4 locales still render; nav still resolves the stale `audience-requests` id.
6. No new hidden flags; no secret leaves the device; `muzero-db` / key names unchanged.

---

## 6. Out of Scope / Notes

- The play-now / play-next live-request **playback cut-in** bug (store↔DB cursor desync) is tracked + fixed separately (this session): `playRequestNow`/`playRequestNext` now insert relative to the store cursor. Not part of this Settings PRD.
- Performance / memory verification of **song switching** (CDP + control-endpoint harness, frame cadence + heap) is a separate verification activity, not this PRD.
- The same shallow-merge backfill gap exists structurally for other nested settings (`shortcutOverrides`, `streamSources`, `visualizerTuningByStyle`); they're lower-risk (no unguarded panel crash). A general deep-merge-on-read could be a follow-up, but this PRD scopes the fix to `audienceRequestIntake`.

## Related Documents
- Live-chat song request feature PRD: `docs/prd/20260616-muzero-live-chat-song-request-prd/` (origin of `audienceRequestIntake`)
- Settings panel: [`live-request-settings.tsx`](../../../src/components/settings/live-request-settings.tsx), [`src/components/settings/live-request/`](../../../src/components/settings/live-request/)
- Schema/types: [`src/db/types.ts`](../../../src/db/types.ts) (`AudienceRequestIntakeSettings`, `DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS`), [`src/db/repositories.ts`](../../../src/db/repositories.ts) (`getSettings`/`saveSettings`)
- Runtime/controller: [`audience-request-runtime.ts`](../../../src/live-requests/audience-request-runtime.ts), [`live-request-controller.ts`](../../../src/live-requests/live-request-controller.ts)
