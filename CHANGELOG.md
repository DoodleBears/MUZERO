# Changelog

All notable changes to MUZERO. Generated from `src/content/changelog` — do not edit by hand (`make changelog-md`).

## v1.1.0 — 2026-06-15 · Smoother playback, smarter browsing, and desktop controls

Now Playing switches faster and stays visually in sync, the library gains system playlists, A-Z navigation, and online discovery, and desktop users get tray controls, global shortcuts, pinned lyrics, and live request intake.

### Highlights
- **player** Fast, synchronized Now Playing switches — Cover, background, backlight, and queue identity now move together through rapid next/previous bursts, with persistent Pixi backgrounds, settled cover work, and off-thread image decoding reducing switch jank.

### Added
- **library** System playlists and A-Z library navigation — The library now has built-in system playlist cards and details, stats-aware sorting, reading-aware name sort, A-Z fast jump rails, and hover scrollbars for large set, album, and artist walls.
- **streaming** Discover tab for online recommendations — NetEase daily recommendations and recommended playlists can be browsed, played, saved, rerolled, and opened in a dedicated online playlist detail flow.
- **lyrics** Cascade lyrics and lyrics-only stage mode — A new lyric layout engine powers cascade word timing, inertial follow, row motion, and a lyrics-only visualizer mode with dedicated tuning for cover color and backlight.
- **app** Tray, global shortcuts, and pinned lyrics — Electron desktop now supports a native tray playback menu, close-to-tray lifecycle, system global shortcuts, DevTools shortcuts in development, window pinning, and lockable pinned lyrics controls. _(desktop)_
- **dj** Live requests can reach the AI DJ — Live request intake now has Electron runtime support, webhook presets, secure request parsing, library search, routing primitives, and an AI DJ handoff path. _(desktop)_

### Changed
- **dj** AI DJ understands local library references — The chat tools now expose compact local IDs, a library tree tool, tool metadata, and activity UI so DJ workflows can refer to sets, tracks, albums, and artists more precisely.
- **settings** Performance, cache, and import controls — Settings now includes a Performance pane with graphics quality presets and GPU backend controls, storage usage and cache tools, recursive folder sync, local cache opening, and cover repair progress.
- **visualizer** Unified visualizer tuning — Visualizer controls are now unified across styles with per-style help, updated defaults, better placement, background tuning, and cleaner mode icons.

### Fixed
- **library** Covers stay sharp without scroll flashes — Cover derivatives are cached and repaired in batches, imported cover metadata extraction is workerized with backpressure, and list scrolling keeps already loaded covers instead of flashing placeholders.
- **player** More reliable playback state — Volume persists, selected current tracks resume correctly, held transport shortcuts are throttled, stale cover loads are ignored, and remote/local cover assets are deduped before they can disturb playback.

## v1.0.0 — 2026-06-12 · Faster imports and a cleaner desktop shell

Large imports now become playable while they are still running, Windows gets native-feeling frameless controls, and player identity updates stay in sync.

### Highlights
- **library** Progressive bulk imports — Large uploads and folder syncs publish tracks in chunks, so the first songs appear and can play before the whole import finishes, without reversing file order.

### Added
- **app** Frameless Windows desktop chrome — Electron on Windows now uses a rounded transparent shell with custom minimize, maximize, restore, and close controls. _(desktop)_

### Changed
- **visualizer** Cleaner visualizer tuning — The FFT size control now uses the shared select component, matching the rest of the settings UI.

### Fixed
- **player** Current track identity stays current — The dock title and artist line now update immediately when the queue cursor changes, and long stage titles fit without forced scrolling.
- **app** Safer desktop updater startup — The Electron updater only loads when a packaged semver build can apply updates, avoiding noisy checks in development or invalid-version builds. _(desktop)_

## v0.7.0 — 2026-06-11 · Immersive, fluid, and self-updating

A cover-painted flow background, smooth scrolling, drag-to-reorder, and built-in updates with a version-history download center.

### Highlights
- **visualizer** Cover-palette flow background — A multi-color aurora that paints itself from your cover art, with 14 styles.

### Added
- **library** Drag to reorder — Multi-select drag-and-drop reordering that merges cleanly across devices.
- **app** In-app updates & version history — Automatic desktop updates, plus a Settings download center for every past release.

### Changed
- **app** Smooth scrolling — Fluid, inertial scrolling across lists, grids, and pages.

## v0.6.0 — 2026-06-11 · Online sources & word-by-word lyrics

Stream from popular online sources on desktop, with Apple-Music-style karaoke lyrics everywhere.

### Highlights
- **streaming** Play from online sources — Resolve and stream from NetEase, bilibili, and YouTube on desktop. _(desktop)_
- **lyrics** Word-by-word lyrics — Apple-Music-style synced lyrics with per-syllable karaoke from LRC, yrc, qrc, and TTML.

### Added
- **streaming** Sign in to your sources — Capture a source login, including QR login, for VIP and higher-quality streams. _(desktop)_
- **lyrics** Translations & romanization — Show translated and romanized sub-lines beneath each lyric line.
- **streaming** Cache streams offline — Download streamed media to a local blob for offline playback. _(desktop)_

## v0.5.0 — 2026-06-10 · A real music library

Artists, albums, transliteration search, and fully configurable shortcuts.

### Highlights
- **library** Artist & album browsing — Auto-derived artists and albums with detail pages and cross-linking.

### Added
- **search** Search in any script — Pinyin, kana, and romaji transliteration search, run off the main thread.
- **app** Configurable shortcuts — Rebind keys with a recorder and a built-in cheat sheet.
- **library** Editable entity covers — Set custom cover art for artists and albums.

### Changed
- **settings** Two-column Settings — A master-detail Settings layout with a searchable sidebar.

## v0.4.0 — 2026-06-09 · Sync to your own cloud

Publish and pull your whole library to a cloud drive you own — still no backend, no account.

### Highlights
- **sync** Your own cloud drive — Publish and pull your library to a bring-your-own Cloudflare R2 bucket — no MUZERO account.

### Added
- **sync** Stream shared libraries — Import and stream sets from a shared library manifest.
- **library** Playback stats & presence — Per-device listening stats and an optional 'listening now' presence.
- **sync** Conflict-aware merge — Additive merges, with an explicit panel to resolve any conflicts.
- **library** Metadata import/export — Read and write MP3, FLAC, and M4A tags.

## v0.3.0 — 2026-06-08 · Music carries memories

A richer Now Playing and a memory wall that ties photos and notes to your songs.

### Highlights
- **memory** Sticky-note memories — A masonry wall of photo-and-text notes attached to your songs.

### Added
- **player** Swipeable Now Playing — Swipe between covers with fluid transitions on the Now Playing stage.
- **memory** Memory rail — A collapsible timeline of a track's memories beside Now Playing.

### Changed
- **sets** Cover from a memory — Promote any memory photo to be the set cover.

## v0.2.0 — 2026-06-07 · Chat with your DJ

A conversational AI DJ you can steer in natural language, with tool calls that curate and generate.

### Highlights
- **dj** Talk to the DJ — Steer the music in natural language; the DJ proposes tracks and curates with tool calls.

### Added
- **dj** Branching sessions — Fork a conversation to explore a different vibe without losing your place.
- **app** Bring your own LLM — Configure OpenAI or Anthropic keys, with presets and per-session model selection.

### Changed
- **dj** Approve before generating — Queue prompts and approve tool actions; the queue pauses for your call.

## v0.1.0 — 2026-06-07 · An AI DJ and a player in one

The foundation: an LLM DJ that endlessly extends your playlist, plus a YouTube-Music-style player for your own audio and video.

### Highlights
- **dj** An AI DJ that never stops — An LLM writes track briefs and an endless playlist materializes as you listen.

### Added
- **sets** Mixed music + video sets — Build sets that mix AI-generated audio with your own uploaded songs and music videos.
- **player** Player-first dock — A unified bottom dock: cover and title, full-width progress, and flat navigation.
- **memory** Songs carry memories — Tag a track, add a note, and set a cover photo so each song holds a moment.

### Changed
- **visualizer** Built-in visualizers — Octave-band canvas spectrum styles that follow your theme color.
