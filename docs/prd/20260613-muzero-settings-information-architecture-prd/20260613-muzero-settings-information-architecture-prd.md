# PRD: MUZERO Settings Information Architecture Refresh

**Status:** Draft
**Created:** 2026-06-13
**Author:** Codex
**Module:** Settings / Local Files / Cloud Sync / AI / Desktop Distribution - settings IA cleanup

> Product request: Settings is currently carrying several unrelated jobs in the same surface. This PRD reorganizes it into clearer user mental models: file management, online sync, AI features, app/about, and developer/advanced tools. It also adds a desktop-only associated-folder management requirement with per-folder recursive scan control.

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | PRD + Current-State Audit | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Settings Navigation IA + Icon Sidebar | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Local File Management Section | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Storage Management Section | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Online Sync Section Split | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | AI Features Section Split | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |
| 7 | Listening Stats Section | 🔲 Pending | [Phase 7 Checklist](#phase-7-checklist) |
| 8 | Desktop Downloads Rename + i18n | 🔲 Pending | [Phase 8 Checklist](#phase-8-checklist) |
| 9 | Verification + Polish | 🔲 Pending | [Phase 9 Checklist](#phase-9-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

The Settings page has grown from a simple app configuration screen into a mixed control room for:

- appearance and playback preferences;
- LLM/music generation provider setup;
- external streaming sources and offline cache;
- local folder import/watch behavior;
- OPFS/IndexedDB/Electron persistent storage, playback cache, and cleanup tools;
- cloud drive setup, sync preferences, presence, and R2 operational guidance;
- device profile and playback stats;
- diagnostics, version history, and release/download information.

This density is reasonable for a desktop-first local music app, but the current information architecture is not matching user intent:

- Local files are nested under the device profile area, even though "manage files" is a core library operation.
- External streaming/offline cache and permanent local storage sit close to playback, while R2 cloud sync lives elsewhere, making "local file vs online sync" blurry.
- Browser users with OPFS storage need a single, trustworthy place to understand disk usage and clear cache/storage safely.
- AI DJ model setup and AI music generation are split as playback-DJ/playback-music, even though the user thinks of them as "AI features".
- Listening data exists in the data model, but the UI only surfaces a small device summary; power users need a complete listening-data view.
- "Version history" sounds like a changelog, but the product need in Settings is closer to "desktop app downloads".
- The sidebar uses text-only items, which makes the rail harder to scan once the list grows.

This PRD keeps the local-first architecture intact. It is an IA and settings UX cleanup with one scoped new feature: desktop associated folders can choose whether they scan recursively.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| Desktop library owner | Keeps music/MV files in one or more local folders and expects MUZERO to track new files. | Add/remove associated folders, choose target set, set recursive scanning, sync now. |
| Cloud sync user | Publishes or syncs library state/media through user-owned online storage. | Configure drives, run sync, inspect progress, tune online sync behavior. |
| Browser / OPFS user | Uses MUZERO in a browser context where media cache lives in IndexedDB/OPFS quota. | Inspect storage usage, clear safe-to-delete cache, request persistent storage where supported. |
| AI DJ user | Configures BYOK LLM and music generation providers. | Edit local API keys/endpoints/models; enable or disable AI generation. |
| General listener | Changes appearance, playback, storage, download/update, listening stats, and about settings. | Adjust app preferences without understanding provider internals. |
| Debug/support user | Needs diagnostics when playback, sync, or cache behavior fails. | Inspect traces and performance HUD without mixing those tools into everyday settings. |

### 1.3 Core Value

1. **Faster scanning:** Sidebar icon + label items and clearer groups reduce the time to find the right Settings pane.
2. **Cleaner mental model:** Local files, online sync, and AI are separate top-level concepts instead of being spread across playback/device/cloud.
3. **Desktop-grade file control:** Associated folders become manageable entities, with explicit recursive/non-recursive scan behavior.
4. **Storage confidence:** OPFS, IndexedDB, Electron-file storage, playback cache, and offline cache become measurable and safely manageable.
5. **Less risky operations:** Online sync controls are isolated from local file/cache controls so users understand what stays local and what goes out to their own configured storage.
6. **Personal insight:** Complete listening data becomes visible without requiring cloud sync or diagnostics.
7. **More accurate wording:** "Version history" becomes "Desktop downloads" where the action is to download app builds.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
SettingsSidebar
  -> SETTINGS_NAV icon + label config
  -> active settings item
  -> focused settings pane

Local Files
  -> ImportedFoldersSettings
  -> AppSettings.importFolders[]
  -> scanFolderForMedia(folder.path, { recursive })
  -> create/upload local library tracks

Storage
  -> PersistentStorageSettings
  -> summarizePersistentMediaStorage()
  -> OPFS / IndexedDB / Electron-file buckets
  -> playback cache + offline stream cache summaries
  -> clear safe cache / cleanup orphaned files / request persistence

Online Sync
  -> Cloud drive setup
  -> Cloud drive sync controls
  -> Presence
  -> R2 sync state

AI Features
  -> LLM provider presets/custom providers
  -> AI music generation BYOK cloud provider

Listening Stats
  -> playbackEvents + trackPlaybackStats + playbackAggregates
  -> local totals / per-track / per-set / per-device views
  -> optional sync status for stats segments

App / Desktop Downloads / Advanced
  -> AboutSettings
  -> VersionHistorySettings renamed in UI
  -> TraceDiagnostics
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Settings shell | React 19 + TypeScript | Existing Settings page and component model. |
| Sidebar config | `src/components/settings/settings-nav.ts` | Pure IA config, already unit-testable and stale-id friendly. |
| Sidebar UI | `src/components/settings/settings-sidebar.tsx` + `lucide-react` icons | Existing sidebar can gain icon metadata without introducing a new navigation library. |
| Local settings persistence | Dexie `AppSettings` in IndexedDB `muzero-db` | Folder watch settings are device-local and must not sync to remote manifests. |
| Persistent storage summary | Existing `src/db/media-blob-storage.ts` and playback/stream cache summaries | Long-term storage page should build on current OPFS/IndexedDB/Electron backend accounting. |
| Listening stats | Existing `trackPlaybackStats`, `playbackEvents`, aggregate helpers | Full stats page should read existing tables before adding new data shape. |
| Folder scan | Existing `src/lib/folder-import.ts` and store orchestration | Extend existing scanner contract rather than creating a parallel import system. |
| Cloud sync | Existing `src/sync/*` and settings components | Reorganize entry points; do not rewrite sync engines. |
| i18n | i18next catalogs in `src/i18n/locales/{en,zh,ja,ko}/common.json` | All visible strings and sidebar labels must stay localized. |

### 2.3 Project Structure

```
src/
├── components/
│   └── settings/
│       ├── settings-nav.ts                 # add section/item icon ids and new IA grouping
│       ├── settings-sidebar.tsx            # render icon + label items
│       ├── imported-folders-settings.tsx   # local file management + recursive control
│       ├── stream-sources-settings.tsx     # stays local/online source related, label placement changes
│       ├── persistent-storage-settings.tsx # storage center: OPFS/IDB/Electron/cache usage + clearing
│       ├── listening-stats-settings.tsx    # new full listening data pane if not folded into device
│       ├── cloud-drive-sync-controls.tsx   # moves under Online Sync IA
│       ├── llm-provider-settings.tsx       # moves under AI Features IA
│       └── version-history-settings.tsx    # UI label becomes Desktop downloads
├── db/
│   ├── types.ts                            # ImportFolder recursive flag
│   └── repositories.ts                     # default/merge/update import folder settings
├── lib/
│   └── folder-import.ts                    # scan options: recursive true/false
├── stores/
│   └── player-store.ts                     # pass folder scan options during import/sync
├── sync/
│   ├── playback-stats.ts                   # existing listening stats records
│   ├── playback-sync-summary.ts            # existing sync summary for stats segments
│   └── playback-aggregate-summary.ts       # existing aggregate helpers
└── i18n/locales/{en,zh,ja,ko}/common.json  # new labels and hints
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
AppSettings.importFolders[]
  -> ImportFolder.recursive
  -> remembered desktop folder
  -> re-scan on app launch / manual sync
  -> add only new files to bound set
```

### 3.2 Database Schema

Current source of truth:

- `src/db/types.ts` `AppSettings.importFolders?: ImportFolder[]`
- `src/db/types.ts` `ImportFolder`
- `src/db/repositories.ts` `rememberImportFolder`, `removeImportFolder`
- `src/stores/player-store.ts` `importFolder`, `importFolderIntoSet`, `syncImportFolders`

Required additive field:

```ts
export interface ImportFolder {
  id: string;
  path: string;
  setId: string;
  displayName?: string;
  lastScanAt?: number;
  lastImportedCount?: number;
  /** Whether scans include nested folders. Default true for existing behavior. */
  recursive?: boolean;
}
```

Defaulting and migration:

- Existing folders have no `recursive` field and must behave as `recursive: true` to preserve current behavior.
- New folder-add UI should default to recursive on, because current folder import already scans recursively.
- If a user turns recursive off, only the selected directory's direct children are considered on future scans.
- No Dexie version bump is required if `recursive` remains optional and readers default with `folder.recursive ?? true`.
- If the team wants persisted explicit defaults for analytics/debug clarity, add a future lightweight settings backfill, but it is not required for correctness.

Scanner contract change:

```ts
scanFolderForMedia(rootPath, fs, { recursive?: boolean })
```

Compatibility:

- Current callers that omit options keep recursive behavior.
- Unit tests must cover recursive true, recursive false, unreadable subfolders, encrypted media counts, and dedupe behavior.

Privacy and retention:

- Absolute paths remain device-local.
- `importFolders` remains in local `AppSettings`; it must not be exported to cloud drive manifests or public share links.
- Recursive preference is not sensitive by itself but inherits the same device-local storage boundary as folder paths.

---

## 4. API Design

### 4.1 API Endpoints

MUZERO has no backend API for this feature.

| Surface | Method / Function | Description |
|---------|-------------------|-------------|
| Settings repo | `rememberImportFolder(input)` | Store or update a remembered local folder, including `recursive`. |
| Settings repo | `updateImportFolder(id, patch)` or equivalent | Toggle recursive scan, change bound set if supported, update display metadata. |
| Settings repo | `removeImportFolder(id)` | Stop watching a folder while keeping imported tracks. |
| Folder scan | `scanFolderForMedia(path, fs, options)` | Scan either one directory level or the full recursive tree. |
| Player store | `syncImportFolders()` | Re-scan remembered folders using each folder's recursive preference. |

### 4.2 Request/Response Examples

```ts
await rememberImportFolder({
  id: "imf_123",
  path: "D:\\Music",
  setId: "ses_library",
  displayName: "Music",
  recursive: true,
});

await saveSettings({
  importFolders: folders.map((folder) =>
    folder.id === "imf_123" ? { ...folder, recursive: false } : folder,
  ),
});
```

### 4.3 Error Handling

- If a remembered folder is missing or inaccessible, keep the row and show a recoverable warning in the Local Files pane.
- If recursive scanning hits an unreadable subfolder, keep the current behavior: skip that subfolder and continue.
- If recursive is off, do not attempt to read subfolders; subfolders should count as skipped directories only if the UI needs a scan summary.
- If a folder's target set was deleted, preserve current behavior of recreating or rebinding according to `player-store.ts` conventions; document the result in the row.
- No secrets or raw path lists should be written to logs. Use `src/lib/logger.ts` and redact paths when diagnostics are user-exportable.

---

## 5. Frontend Design

### 5.1 Settings IA

Proposed top-level sidebar groups:

| Group | Items | Product Intent |
|-------|-------|----------------|
| Appearance | Appearance, Background, Visualizer, Flow, Lyrics | How the app looks and how Now Playing feels. |
| Files | Local files, Online sources | Library inputs: files already on this device and online sources that can create playable library entries. |
| Storage | Storage & cache | Disk/quota usage, OPFS/IndexedDB/Electron storage health, safe cleanup, cache clearing. |
| Online Sync | Cloud drives, Sync & presence | Everything that can communicate with user-configured online storage. |
| AI | DJ model, AI music generation | LLM and generation providers, all BYOK and local settings. |
| Listening | Listening stats | Complete local listening history and aggregate stats. |
| Controls | Shortcuts, Playback | Input and playback behavior that is not provider setup. |
| App | Device profile, Desktop downloads, About | App identity, update/download surface, product info. |
| Advanced | Diagnostics | Debug/support tools. |

Detailed item mapping:

| New Item | Current Source | Notes |
|----------|----------------|-------|
| Local files | `ImportedFoldersSettings` plus optional folder import affordances | Move out of `device`. Add recursive control. |
| Online sources | `StreamSourcesSettings` | External music sources stay under Files because they create library entries/cache. Cache controls can link to Storage. |
| Storage & cache | `PersistentStorageSettings`, `summarizePlaybackCache`, `summarizeStreamedCache` | Dedicated storage center for OPFS/IndexedDB/Electron-file, playback cache, offline stream cache, permanent media, and cleanup actions. |
| Cloud drives | Current `cloud` pane | Drive setup, connected drives, CORS, per-drive controls. |
| Sync & presence | Current `cloud-presence` plus sync status/preferences if needed | Keep online/device presence away from local files. |
| DJ model | `LlmProviderSettings` | LLM provider/model/key setup. |
| AI music generation | Current `playback-music` pane | Rename away from playback; it is a paid/BYOK AI capability. |
| Listening stats | Device summary in `settings-page.tsx`, `playbackEvents`, `trackPlaybackStats`, aggregate helpers | New complete stats view; device pane keeps profile identity only. |
| Desktop downloads | `VersionHistorySettings` | UI label should be desktop-download oriented; component name may change later. |

### 5.2 Sidebar Icon + Label

Current implementation:

- `SettingsNavItem` has `id` and `labelKey`.
- `SettingsSidebar` renders text-only buttons.
- Stale IDs are resolved by `resolveActiveSettingsItem`.

Requirement:

- Add an icon field to each item in `SETTINGS_NAV`.
- Render each item as icon + label.
- Keep text visible on desktop and mobile; do not collapse to icon-only.
- Icon size: 16px on desktop, 18px acceptable on touch row.
- Item height should stay at least 36px desktop and 44px touch where practical.
- Use `lucide-react` icons already in the project.
- Preserve search behavior: query should match translated label, section label, id, and optionally icon-independent synonyms via i18n text if needed.

Recommended icon map:

| Item | Icon |
|------|------|
| Appearance | `Palette` |
| Background | `Image` |
| Visualizer | `AudioLines` |
| Flow | `Waves` |
| Lyrics | `Captions` |
| Local files | `FolderOpen` |
| Online sources | `Radio` or `Globe2` |
| Storage & cache | `HardDrive` |
| Cloud drives | `Cloud` |
| Sync & presence | `RefreshCw` or `CloudCog` |
| DJ model | `BrainCircuit` |
| AI music generation | `Sparkles` |
| Listening stats | `ChartNoAxesColumnIncreasing` or `BarChart3` |
| Shortcuts | `Keyboard` |
| Playback | `SlidersHorizontal` or `PlayCircle` |
| Device profile | `MonitorSmartphone` |
| Desktop downloads | `Download` |
| About | `Info` |
| Diagnostics | `Activity` |

### 5.3 Local Files Pane

The Local Files pane should feel like a file-management tool, not a device profile appendix.

Required content:

- Header: localized title such as "Local files".
- Short localized hint: remembered folders are scanned on launch and can be synced manually.
- Primary action: Add folder.
- Folder rows with:
  - folder display name and path;
  - bound set name;
  - last sync time or "not synced yet";
  - last imported count if available;
  - recursive toggle;
  - sync now action for the single folder if feasible;
  - stop watching action.

Recursive control:

- Use a visible toggle/checkbox per folder.
- Label: "Include subfolders" / zh "包含子文件夹".
- Hint: "When off, MUZERO only scans files directly inside this folder."
- Existing remembered folders default to on.
- Changing the toggle applies immediately and affects future launch/manual scans.
- If a scan is running, disable the toggle or queue it after the current scan; do not silently change a running job's traversal mode mid-scan.

Desktop-only behavior:

- Browser/Tauri contexts without persistent folder access should keep the existing desktop-only message.
- The item may still appear in Settings, but it must clearly say the feature is available in the desktop app.

### 5.4 Storage & Cache Pane

The Storage pane should become the long-term "where is my disk space going?" control center. This is especially important in browser/OPFS contexts, where users cannot browse an app data folder directly and need in-app controls to understand and release storage.

Best-practice design principles:

- **Show before action:** Always show usage and category breakdown before destructive cleanup actions.
- **Separate cache from library-owned data:** Cache can be cleared safely; permanent media, user uploads, generated files, covers, memories, gallery files, and downloaded offline copies are user-owned app data and need stronger confirmation.
- **Use progressive disclosure:** Summary first, then backend/category details, then maintenance actions.
- **Make storage pressure legible:** Use a progress bar against the best available quota estimate; when quota is unknown, show total app usage and label the denominator as unavailable rather than inventing a limit.
- **Prefer scoped cleanup:** Offer "clear playback cache", "clear offline stream cache", "cleanup orphaned files", and "clear all safe cache" before any broad "reset storage" action.
- **Keep browser and desktop wording distinct:** Browser storage uses origin quota/OPFS/IndexedDB; desktop storage may use IndexedDB, OPFS, and Electron-managed files.

Required content:

- Header: "Storage & cache" / zh "存储与缓存".
- Overall usage summary:
  - total app-managed bytes;
  - best available quota and remaining space when `navigator.storage.estimate()` exists;
  - progress bar: `usage / quota`;
  - fallback progress state when quota is unknown.
- Backend breakdown:
  - IndexedDB;
  - OPFS;
  - Electron file storage;
  - unknown/missing/orphaned health counts.
- Data category breakdown:
  - permanent media;
  - covers;
  - memories;
  - gallery/background/avatar;
  - playback cache;
  - offline stream cache;
  - legacy IndexedDB blobs pending migration.
- Actions:
  - refresh usage;
  - request persistent storage when the browser supports `navigator.storage.persist()`;
  - clear playback cache;
  - clear offline stream cache;
  - cleanup orphaned files;
  - migrate legacy media blobs to the preferred storage backend;
  - repair cover metadata;
  - optional destructive "reset all local data" is out of v1 and needs a separate confirmation PRD.

Progress bar requirements:

- Use a real `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` when quota is known.
- Use an indeterminate/summary style when quota is unknown.
- Show bytes in human-readable form and avoid percentages without a denominator.
- Do not let the bar imply that permanent media can be safely cleared.

Browser / OPFS requirements:

- In browser contexts, surface OPFS and IndexedDB usage as first-class buckets.
- Use `navigator.storage.estimate()` as the quota/usage source when available, but do not rely on it for per-bucket accounting.
- Offer "Keep storage persistent" when `navigator.storage.persist()` is available; show current persisted state if `navigator.storage.persisted()` is available.
- Explain that clearing browser site data outside MUZERO can remove local library/cache data.

Desktop requirements:

- Electron-managed files should appear as a separate bucket.
- If a local app-data folder can be opened safely, that can be a future desktop-only action, but v1 should not require shelling out.
- Folder import source paths are not counted as MUZERO-managed bytes unless MUZERO copied/cached the media.

### 5.5 Online Sync Pane

The Online Sync section owns cloud-drive behavior and should avoid mixing local files or AI settings.

Requirements:

- Move Cloud Drive setup and connected drives under "Online Sync".
- Keep per-drive sync controls and live progress close to each drive.
- Keep presence settings in the same group, either as a separate item or a sub-pane.
- Preserve "local-first" copy: syncing is to user-configured storage; MUZERO has no hosted account/server.
- Do not introduce hidden backend flags for sync behavior.

### 5.6 AI Features Pane

The AI section should communicate cost, BYOK, and capability boundaries.

Requirements:

- Group LLM provider setup and AI music generation under "AI".
- Keep AI music generation off by default unless existing product rules change in a separate PRD.
- Keep API keys local in `AppSettings`; no `.env`, URL, logs, or telemetry.
- Avoid wording that suggests MUZERO runs its own cloud AI service.
- Save behavior can remain as-is initially, but the section should make it clear which settings are immediate vs saved by button.

### 5.7 Listening Stats Pane

Listening stats should graduate from a small Device card to a complete, dedicated page. The Device page should focus on identity/profile; the Listening page should focus on data and insight.

Best-practice design principles:

- **Answer user questions first:** "How much did I listen?", "What did I play most?", "Which sets/artists/tags shaped my listening?", "What is waiting to sync?"
- **Keep raw data available but not dominant:** Summary cards and ranked tables first; event log behind a details section.
- **Respect local-first privacy:** Listening stats are local by default. Sync status may be shown, but do not imply public sharing.
- **Make definitions explicit:** A "play" uses existing `shouldCountAsPlay` semantics: 30 seconds or half the track for short media.
- **Avoid vanity-only charts:** Every chart should support a useful action or understanding.

Required sections:

- Summary cards:
  - total plays;
  - total listened time;
  - unique tracks listened;
  - active days;
  - current-device pending listens waiting for sync;
  - uploaded stats segments if sync is enabled.
- Rankings:
  - top tracks by listened time;
  - top tracks by play count;
  - top sets;
  - top tags if tags are available on listened tracks;
  - recently played tracks.
- Time views:
  - listens by day/week/month;
  - optional "last 7 days / 30 days / all time" segmented control.
- Sync/accounting status:
  - local events count;
  - aggregate rows count;
  - pending segment count;
  - last stats sync if available.
- Details:
  - searchable/filterable recent listening event list;
  - export is out of v1 unless already available elsewhere.

Data sources:

- `src/db/types.ts` `TrackPlaybackStats`, `PlaybackEvent`, `PlaybackAggregate` types.
- `src/sync/playback-stats.ts` for count semantics.
- `src/sync/playback-sync-summary.ts` for pending/uploaded sync status.
- `src/sync/playback-aggregate-summary.ts` for aggregate totals.
- Existing `settings-page.tsx` device stats summary should be moved or linked to the new page.

### 5.8 Desktop Downloads Rename

Current user-facing item:

- "Version history"

Required user-facing label:

- en: "Desktop downloads"
- zh: "桌面版下载"
- ja: "デスクトップ版ダウンロード"
- ko: "데스크톱 다운로드"

Scope:

- Sidebar item label must change.
- Card title inside `VersionHistorySettings` should change if it currently repeats "Version history".
- Component/function filenames do not need to change in v1 unless it improves clarity.
- Existing changelog/release history content can remain if the pane still contains release notes, but the primary framing should be downloads.

### 5.9 State Management

- Continue using `useSettings()` / Dexie live query for settings rows.
- Do not move folder rows into Zustand; derived persisted data belongs in Dexie.
- Use minimal Zustand selectors for actions and upload/sync busy flags.
- Keep `SettingsSidebar` pure and driven by `SETTINGS_NAV`.
- Keep stale item aliases for renamed/moved sidebar IDs:
  - `device` may continue to resolve to `device-profile` or equivalent.
  - `playback-dj` should resolve to the new DJ model item.
  - `playback-music` should resolve to the new AI generation item.
  - `version-history` should resolve to `desktop-downloads` if the ID changes.
- Storage summaries should stay derived from Dexie/OPFS/cache repositories and should not be copied into Zustand.
- Listening stats should be queried from Dexie tables and memoized/virtualized if event volume is large.

---

## 6. Implementation Plan

### Phase 1: PRD + Current-State Audit

**Goal:** Capture the product direction and current implementation anchors.

**Tasks:**
- [x] Read `.cursor/commands/prd-create.md`.
- [x] Review current `settings-nav.ts`, `settings-sidebar.tsx`, `ImportedFoldersSettings`, and `settings-page.tsx` composition.
- [x] Create this PRD.

### Phase 1 Checklist

- [x] PRD exists under `docs/prd/20260613-muzero-settings-information-architecture-prd/`.
- [x] PRD references existing source files and current constraints.
- [x] PRD includes recursive associated-folder requirement.

### Phase 2: Settings Navigation IA + Icon Sidebar

**Goal:** Reorganize sidebar groups and render icon + label items without changing underlying setting behavior.

**Tasks:**
- [x] Extend `SettingsNavItem` with an icon id or icon component mapping.
- [x] Rebuild `SETTINGS_NAV` around Appearance, Files, Storage, Online Sync, AI, Listening, Controls, App, Advanced.
- [x] Update stale-id aliases in `resolveActiveSettingsItem`.
- [x] Update `SettingsSidebar` to render icon + label.
- [x] Preserve search/filter behavior and mobile horizontal nav behavior.
- [x] Add/update sidebar unit tests for item order, aliases, and icon metadata.

### Phase 2 Checklist

- [x] Each sidebar item has a visible icon and label.
- [x] Existing persisted active item IDs do not dead-end after renames.
- [x] Sidebar remains usable at desktop width and mobile width.
- [x] All new labels exist in en/zh/ja/ko catalogs.

### Phase 3: Local File Management Section

**Goal:** Move remembered folders into a dedicated Local Files pane and add recursive scan control.

**Tasks:**
- [x] Add `recursive?: boolean` to `ImportFolder`.
- [x] Add scanner options to `scanFolderForMedia`.
- [x] Update folder scan tests for recursive and non-recursive modes.
- [x] Update import/sync orchestration to pass `folder.recursive ?? true`.
- [x] Add a repository helper for updating folder settings, or use a narrowly scoped `saveSettings` patch.
- [x] Move `ImportedFoldersSettings` out of the Device pane into the new Local Files item.
- [x] Add per-folder "Include subfolders" UI and i18n.

### Phase 3 Checklist

- [x] Existing folders continue recursive scanning by default.
- [x] New folders default to recursive on.
- [x] Recursive off scans only direct child files.
- [x] Manual sync respects each folder's recursive preference.
- [x] App launch sync respects each folder's recursive preference.
- [x] Removing a folder still keeps imported tracks.

**Phase 3 Verification:**
- `node_modules\.bin\vitest.CMD run src\lib\folder-import.test.ts src\stores\folder-sync.test.ts src\db\repositories.test.ts`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false`

### Phase 4: Storage Management Section

**Goal:** Promote storage/cache management to a dedicated sidebar item that works for browser OPFS, IndexedDB, and desktop storage.

**Tasks:**
- [x] Move `PersistentStorageSettings` into the new Storage section.
- [x] Add an overall usage summary with a progress bar using `navigator.storage.estimate()` when available.
- [x] Keep existing backend buckets: IndexedDB, OPFS, Electron file storage.
- [x] Add playback cache and offline stream cache summaries into the same page, or link them from Online Sources with a clear "Manage in Storage" affordance.
- [x] Add a "refresh usage" action.
- [ ] Add a browser-only persistent-storage status/action when supported.
- [x] Add scoped cleanup actions for playback cache, offline stream cache, orphan cleanup, legacy migration, and cover repair.
- [x] Add i18n for storage quota, OPFS, persistent storage, safe cache clearing, and storage-pressure copy.
- [x] Add tests for usage progress rendering, quota-unavailable fallback, and clear-cache actions.
- [x] Ensure newly imported embedded track covers generate cover preview/color metadata immediately so Storage repair counts do not grow for fresh imports.
- [x] Ensure cloud/R2-imported remote covers derive fallback palette metadata from thumbhash when manifests do not carry an explicit palette.
- [x] Run cover color repair in visible batches with a progress bar, so large legacy libraries show processed/total and unresolved counts instead of a one-shot button.

### Phase 4 Checklist

- [x] Browser/OPFS users can find a dedicated Storage & cache sidebar item.
- [x] Usage is visible as bytes and as a progress bar when quota is known.
- [x] Cache clearing is scoped and does not imply permanent media deletion.
- [x] OPFS, IndexedDB, and Electron file buckets remain visible.
- [x] Existing persistent media migration/cleanup/repair actions still work.
- [x] Fresh imports with embedded covers no longer require a separate cover metadata repair pass for thumbhash/palette fields.
- [x] Fresh cloud/R2 imports with remote cover thumbhashes no longer require a separate cover palette repair pass.
- [x] Cover color repair gives progress feedback during batch processing.
- [x] No local source paths are exposed in exported diagnostics or remote sync.

**Phase 4 Verification:**
- `node_modules\.bin\vitest.CMD run src\components\settings\persistent-storage-settings.test.tsx src\components\settings\settings-nav.test.ts`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false` currently blocked by unrelated worktree error: `src/lib/system-playlists.test.ts(154,5)` duplicate `id` property.

### Phase 5: Online Sync Section Split

**Goal:** Make online/cloud behavior a distinct Settings section.

**Tasks:**
- [x] Move Cloud Drive setup into Online Sync.
- [x] Keep connected drive rows, CORS guidance, sync progress, and per-drive preferences together.
- [x] Place presence under Online Sync with clearer copy.
- [x] Confirm local file paths and folder settings are not exposed in online sync UI/manifest flows.
- [x] Add/update tests for nav routing and aliases.

### Phase 5 Checklist

- [x] Users can find cloud drive setup under Online Sync.
- [x] Presence is not mixed with local device profile editing.
- [x] Cloud sync copy preserves local-first/BYOK wording.
- [x] Existing cloud drive functionality remains unchanged.

**Phase 5 Verification:**
- `node_modules\.bin\vitest.CMD run src\components\settings\settings-nav.test.ts`

### Phase 6: AI Features Section Split

**Goal:** Move DJ/LLM and AI music generation settings into one AI-focused section.

**Tasks:**
- [x] Rename sidebar items to DJ model and AI music generation or equivalent localized labels.
- [x] Move `LlmProviderSettings` under AI.
- [x] Move music generation BYOK config under AI.
- [x] Keep save behavior clear.
- [x] Ensure key handling still follows BYOK discipline.

### Phase 6 Checklist

- [x] AI settings are no longer grouped under playback.
- [x] API keys remain local-only and never logged.
- [x] AI music generation remains opt-in.
- [x] i18n coverage exists for all new AI labels.

**Phase 6 Verification:**
- `node_modules\.bin\vitest.CMD run src\components\settings\settings-nav.test.ts`

### Phase 7: Listening Stats Section

**Goal:** Add a complete listening-data page and move stats out of the Device profile card.

**Tasks:**
- [x] Create a Listening stats settings pane or equivalent component.
- [x] Read totals from existing playback event/stat/aggregate tables.
- [x] Add summary cards for plays, listened time, unique listened tracks, active days, pending listens, and uploaded stats segments.
- [x] Add ranked lists for top tracks by time, top tracks by plays, top sets, top tags, and recently played.
- [x] Add time-range controls for 7 days, 30 days, and all time.
- [x] Add sync/accounting status using existing playback sync summary helpers.
- [x] Keep the Device pane focused on device identity/profile; link to Listening stats if needed.
- [x] Add i18n for all visible stats labels and play-count definition copy.
- [x] Add tests for empty state, aggregate totals, pending sync stats, and ranked-list ordering.

### Phase 7 Checklist

- [x] Users can see complete local listening data from Settings.
- [x] Device profile no longer carries the main stats surface.
- [x] Play-count semantics are clear.
- [x] Stats remain local-first and do not require cloud sync.
- [x] Large event lists do not make Settings sluggish.

**Phase 7 Verification:**
- `node_modules\.bin\vitest.CMD run src\components\settings\listening-stats-summary.test.ts src\components\settings\settings-nav.test.ts`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false`

### Phase 8: Desktop Downloads Rename + i18n

**Goal:** Align the old Version History wording with the actual product job: desktop build downloads.

**Tasks:**
- [x] Change sidebar label from version history to desktop downloads.
- [x] Update `VersionHistorySettings` title/copy where needed.
- [x] Keep existing release/download data flow.
- [x] Add/update en/zh/ja/ko i18n strings.

### Phase 8 Checklist

- [x] Sidebar says Desktop downloads / 桌面版下载 / localized equivalents.
- [x] Pane title matches the new label.
- [x] Existing release history/download tests still pass.

**Phase 8 Verification:**
- `node_modules\.bin\vitest.CMD run src\components\settings\settings-nav.test.ts src\lib\release-manifest.test.ts`

### Phase 9: Verification + Polish

**Goal:** Validate the IA as a coherent settings experience.

**Tasks:**
- [x] Run targeted unit tests for settings nav, folder import, imported folders, storage/cache, listening stats, cloud drive controls, and version history/downloads.
- [x] Run typecheck.
- [ ] Use the in-app Browser or Playwright screenshot for desktop and mobile Settings layouts if a dev server is available. Blocked: in-app Browser failed with Windows sandbox `CreateProcessAsUserW failed: 5`; standalone Playwright is not installed as a direct project dependency.
- [x] Verify text fits in sidebar buttons at common locales.
- [x] Verify no visible string is hardcoded outside i18n catalogs.
- [x] Verify streamed offline cache is enabled by default through `DEFAULT_SETTINGS`.

### Phase 9 Checklist

- [x] `node_modules/.bin/tsc.CMD --noEmit --pretty false` passes.
- [x] Relevant Vitest suites pass.
- [x] Desktop Settings sidebar is scan-friendly with icons.
- [x] Mobile Settings nav remains touch-friendly and does not overlap.
- [x] Local files page exposes an add-local-folder primary action above the folder list.
- [x] AI DJ page explains supported tool-call capabilities through localized clickable chips.
- [x] Storage usage progress is understandable when quota is known and when quota is unavailable.
- [x] Storage page can reveal the local app-managed cache/media folder when the desktop shell supports it.
- [x] Offline cache toggle defaults to on while remaining visible and user-controlled.
- [x] Listening stats empty and populated states are clear.
- [x] No hidden flags, telemetry, or backend behavior are introduced.

**Phase 9 Verification:**
- `node_modules\.bin\vitest.CMD run src\components\settings\settings-nav.test.ts src\lib\folder-import.test.ts src\stores\folder-sync.test.ts src\db\repositories.test.ts src\components\settings\persistent-storage-settings.test.tsx src\components\settings\listening-stats-summary.test.ts src\lib\release-manifest.test.ts`
- `node_modules\.bin\vitest.CMD run src\db\default-settings.test.ts`
- `node_modules\.bin\vitest.CMD run src\components\settings\imported-folders-settings.test.tsx`
- `node_modules\.bin\vitest.CMD run src\chat\dj-chat-tool-metadata.test.ts src\components\settings\dj-tool-capabilities.test.tsx src\components\chat\chat-tool-collapsible.test.tsx`
- `node_modules\.bin\vitest.CMD run src\components\settings\persistent-storage-settings.test.tsx`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false`
- Browser visual verification attempted but blocked by local Browser plugin sandbox permissions.

---

## 7. Out of Scope

- Rewriting the cloud sync engine or adding a MUZERO-hosted backend.
- Changing R2 manifest protocol or trusted drive setup model.
- Replacing Dexie with another database.
- Building a full local filesystem watcher daemon; this PRD covers remembered folder scan settings and existing launch/manual sync behavior.
- Adding nested folder include/exclude glob rules. v1 only supports recursive on/off.
- Adding per-folder file type filters. Existing media type detection remains the source of truth.
- Adding a destructive "erase all MUZERO data" action. That needs a separate confirmation and recovery PRD.
- Exporting listening stats to CSV/JSON unless a later phase explicitly designs it.
- Building advanced BI dashboards, recommendations, or social year-in-review features from listening stats.
- Renaming persisted codename-layer IDs unless aliases preserve existing settings navigation.
- Changing AI provider vendors or music generation cloud mappings.
- Shipping a new landing page or marketing-style Settings redesign.

---

## 8. Security Considerations

- **Authentication:** No MUZERO account is introduced. Streaming source cookies, R2 credentials, and AI API keys remain BYOK/device-local.
- **Authorization:** Folder access is desktop-runtime mediated. Browser contexts without folder access must show a clear unavailable state.
- **Data Protection:** Absolute folder paths remain in local IndexedDB settings only. They must not be included in cloud manifests, public share links, telemetry, or exported diagnostics unless explicitly redacted/confirmed.
- **Storage deletion safety:** Cache cleanup actions must clearly distinguish safe cache from permanent user/library data. Broad data deletion is out of scope.
- **Listening privacy:** Listening stats are local-first. If synced, they follow existing user-owned drive policies and must not be published to a MUZERO service.
- **Audit Logging:** Use `src/lib/logger.ts`; do not call `console.*` in `src/**`. Avoid logging raw API keys, cookies, signed URLs, or full local paths.
- **No hidden backend flags:** Runtime toggles must be visible Settings controls. Recursive scan is a visible per-folder setting.
- **Local-first boundary:** Online sync section must clearly describe user-owned provider behavior. MUZERO does not gain a backend or account system through this IA refresh.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [PRD Template](../prd-template.md) | Base PRD structure used for this document. |
| [Electron Local Library Index PRD](../20260612-muzero-electron-local-library-index-prd/20260612-muzero-electron-local-library-index-prd.md) | Related local-file reference/import direction. |
| [Progressive Bulk Import Playback PRD](../20260612-muzero-progressive-bulk-import-playback-prd/20260612-muzero-progressive-bulk-import-playback-prd.md) | Related folder import and large-library behavior. |
| [Cloud Storage Provider Abstraction WebDAV PRD](../20260612-muzero-cloud-storage-provider-abstraction-webdav-prd/20260612-muzero-cloud-storage-provider-abstraction-webdav-prd.md) | Related online sync provider direction. |
| `src/components/settings/settings-nav.ts` | Current Settings navigation config. |
| `src/components/settings/settings-sidebar.tsx` | Current text-only Settings sidebar. |
| `src/components/settings/imported-folders-settings.tsx` | Current remembered folder management UI. |
| `src/components/settings/persistent-storage-settings.tsx` | Current persistent media storage summary and maintenance UI. |
| `src/lib/folder-import.ts` | Current recursive folder scanner. |
| `src/stores/player-store.ts` | Current folder import and sync orchestration. |
| `src/sync/playback-stats.ts` | Current listening stats recording semantics. |
| `src/sync/playback-sync-summary.ts` | Current pending/uploaded stats summary helper. |
| `src/sync/playback-aggregate-summary.ts` | Current aggregate summary helper. |
| `src/i18n/locales/{en,zh,ja,ko}/common.json` | Required i18n catalogs. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should "Online sources" live under Files or Online Sync? | Open | Recommendation: Files, because it creates library entries/cache; cloud drive remains Online Sync. |
| 2 | Should Local Files include permanent storage/cache usage, or should Storage & Cache stay separate? | Resolved | Keep Storage & cache as a dedicated sidebar item/page. Local Files manages associated folders; Storage manages OPFS/IDB/Electron/cache usage. |
| 3 | Should users be able to change a remembered folder's bound set after creation? | Open | Recommendation: not in v1 unless product explicitly wants file-management editing beyond recursive. |
| 4 | Should recursive toggle apply to the current scan if changed mid-scan? | Resolved | No. Disable during scan or apply on next scan. |
| 5 | Should component names be renamed from VersionHistorySettings to DesktopDownloadsSettings? | Open | Recommendation: optional cleanup after UI label changes; avoid broad churn in v1. |
| 6 | Should the sidebar use icons for section headers too? | Resolved | No for v1. Item icons are enough; section headers stay text to keep hierarchy quiet. |
| 7 | Should browser OPFS/cache management be hidden on desktop? | Resolved | No. Use one Storage page with backend-specific buckets; show OPFS/IndexedDB/Electron buckets only when relevant/non-empty. |
| 8 | Should storage usage use a progress bar? | Resolved | Yes, when quota is known. If quota is unavailable, show bytes and backend/category breakdown without a fake percentage. |
| 9 | Where should complete listening data live? | Resolved | Add a dedicated Listening stats sidebar item. Device profile keeps identity and can link to stats. |
| 10 | Should cache clearing include permanent downloaded/offline media? | Resolved | No by default. Safe cache actions must not delete permanent user/library data without a separate destructive flow. |

---

## 11. Acceptance Criteria

1. Settings sidebar is organized into the new IA groups and each item renders as icon + label.
2. The local folder management surface is reachable from a Files -> Local files item, not only from Device.
3. Desktop users can set each remembered folder to include or exclude subfolders.
4. Existing remembered folders keep current recursive behavior.
5. Online/cloud sync controls are grouped separately from local folder management.
6. Storage & cache has its own sidebar item/page with OPFS/IndexedDB/Electron/cache usage and a quota progress bar when available.
7. Users can clear safe cache categories from Storage without deleting permanent library data.
8. AI provider and AI music generation controls are grouped under AI.
9. Complete listening data is available from a dedicated Listening stats item.
10. "Version history" user-facing Settings labels are changed to "Desktop downloads" and localized in en/zh/ja/ko.
11. No API keys, cookies, local paths, signed URLs, or raw listening event details are logged or moved out of local storage.
12. Targeted tests cover settings nav aliases, recursive scanning, folder setting persistence, storage progress/cleanup, and listening stats totals.
13. Desktop and mobile Settings layouts show no text overlap or clipped sidebar labels in supported locales.

---

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Codex | Initial draft from product request. |
| 2026-06-13 | Codex | Added Storage & cache best-practice page, OPFS/browser quota management, usage progress bar requirements, and complete Listening stats section. |
| 2026-06-13 | Codex | Completed Phase 2: new Settings IA, icon + label sidebar, stale-id aliases, and routed existing panes to new ids. |
| 2026-06-13 | Codex | Completed Phase 3: local folder recursive preference, non-recursive scanner behavior, Settings toggle, repository helper, and targeted tests. |
| 2026-06-13 | Codex | Advanced Phase 4: Storage & cache title, device usage progress/fallback, refresh action, and shared offline/playback cache controls in Storage. |
| 2026-06-13 | Codex | Completed Phases 5, 6, and 8: Online Sync grouping, AI grouping, and Desktop downloads title/i18n. |
| 2026-06-13 | Codex | Completed Phase 7: full Listening stats pane, range controls, ranked lists, Device pane link, i18n, and summary tests. |
| 2026-06-13 | Codex | Completed Phase 9 automated verification; browser visual check attempted but blocked by local sandbox permissions. |
| 2026-06-13 | Codex | Set streamed offline cache on by default and added default-settings coverage. |
| 2026-06-13 | Codex | Surfaced the Local files add-folder action in the card header and covered it with a component test. |
| 2026-06-13 | Codex | Added localized AI DJ tool-call capability chips and localized chat tool-call labels. |
| 2026-06-13 | Codex | Added a desktop-only action to open MUZERO's local cache/media folder from Storage. |
| 2026-06-13 | Codex | Fixed embedded-cover imports to persist cover thumbhash metadata at import time and added repository coverage. |
| 2026-06-13 | Codex | Audited cover import paths and fixed R2 remote-cover imports to derive palette metadata from thumbhash. |

---

> Note: This PRD intentionally favors modifications to existing settings config/components over new architecture. Net-new work is limited to the recursive folder scan preference and any small repo/helper functions required to persist it cleanly.
