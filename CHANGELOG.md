# Changelog

All notable changes to MUZERO. Generated from `src/content/changelog` — do not edit by hand (`make changelog-md`).

## v1.2.2 — 2026-06-18 · Jump back to source, clearer imports, and smarter video covers

Now Playing can take you straight back to the song's source list, complete with a smooth cover-to-row transition and a current-track marker. Dropped media now asks which set to join, desktop imports can reference files in place with visible progress and recovery tools, and uploaded videos get automatic poster covers. Video tracks also gained separate background, visualizer, flow, dim, and immersive controls. Online tracks are downloaded before playback so seeking works, and volume shortcuts behave cleanly.

### Highlights
- **player** Jump from Now Playing back to the source list — Use the title row, context menu, or cover swipe to return to the exact library or search list that started the current track. MUZERO scrolls to the right row, marks the current song, and morphs the cover into place so the jump feels connected instead of disorienting.

### Added
- **sets** Dropped media asks which set to join — Dropping or pasting audio and video outside a set now opens the set picker instead of silently choosing for you. The currently playing set is shown first with a current badge, so mixing new songs and videos into the set you are hearing takes one deliberate click.
- **library** Reference desktop files in place, with progress and recovery — Desktop drag-and-drop can now keep media referenced from its original disk path instead of copying bytes into IndexedDB. Imports show real byte-level progress when copying is needed, and Settings / track inspection expose recovery actions for referenced media that moved or went missing. _(desktop)_
- **library** Uploaded videos get automatic poster covers — MUZERO now samples uploaded videos and scores candidate frames for a useful cover instead of leaving the track title as the fallback. Native browser capture handles common files, with a Mediabunny fallback for formats that need deeper probing.

### Changed
- **visualizer** Video tracks get their own visual layers — Settings and the Now Playing effect panel now include video-specific controls for the background effect, visualizer, flow layer, dim amount, and dim-layer blur. Normal video playback keeps the rich layers on by default, while immersive video defaults to a cleaner view that you can opt back into.

### Fixed
- **streaming** Online tracks can seek from the first play — QQ Music and other proxied online sources are downloaded to a local blob before playback when needed, so the scrubber, Dock drag, and lyric clicks can seek reliably. If the download fails, MUZERO falls back to streaming so the song still starts. _(desktop)_
- **player** Video effects recover when leaving immersive mode — Video background effects no longer stay in their immersive profile just because the desktop Dock is still waiting for the bottom hot zone. Moving the pointer or interacting with Now Playing exits the immersive effect state immediately, so visualizer, flow, background effects, and video dim settings return reliably.
- **library** Referenced-media checks are lighter and clearer — Storage health checks now use provider file stats when available instead of reading the whole media file. Missing referenced files are reported as recoverable missing media instead of failing the scan, making Settings recovery tools more dependable for large desktop libraries. _(desktop)_
- **player** Cleaner volume shortcuts and mute toggle — On Now Playing, up and down arrows are reserved for volume instead of being swallowed by progress sliders. The volume button also remembers your last audible level, so unmuting restores where you were instead of jumping back to the default.

## v1.2.1 — 2026-06-18 · Sortable Hearted playlist and rock-solid covers

Sort the Hearted playlist — newest-hearted first by default, or by name, added, played, or duration. Remote/R2 covers now show on the web and can be saved to your device, while covers stay solid everywhere: no blanking while you scroll, and no sticking on the previous track when you skip a streamed song. The Dock queue drawer is now a pure up-next list.

### Added
- **library** Sort the Hearted playlist — The Hearted playlist gains gallery-style sort chips: by when you hearted each song (the new default — most recently hearted first), or by name, added, last played, or duration. Tap the active chip again to flip the direction.
- **library** Remote covers on the web, and download covers to your device — Remote / R2 covers now display across the web shell — now-playing stage, Dock, gallery grid, and track-row list — instead of falling back to a blank or thumbhash. On desktop you can also save a streamed track's cover to a local blob (single or whole-set), with optional auto-caching on first play.

### Changed
- **player** Dock queue drawer is a pure up-next list — The Dock queue drawer now mirrors only the current playback queue. The pinned Hearted / Recently Played / Most Played sources moved to the library page, so the drawer stays a focused up-next view and no longer reads the whole library to build them.

### Fixed
- **player** Skipping a streamed song no longer leaves the previous cover — When you skipped via the next button or a Dock drag, a streamed / R2 cover that resolves over the network could leave the stage showing the previous track's cover while the title, artist, and audio had already advanced. Every commit path now waits for the new cover to paint before handing off.
- **library** Remote cover thumbnails stay visible while scrolling — In the virtualized track list, an already-loaded remote / R2 cover used to blank back to its thumbhash while you scrolled, reappearing only when you stopped. It now keeps showing during the scroll — matching how local covers behave — while never-seen covers still defer so a fast fling doesn't trigger a fetch-per-row storm.
- **app** Dragging a cover no longer triggers the drop overlay — Dragging an in-app cover (e.g. the artist page album strip) falsely tripped the “drop to add” overlay, which should react only to external OS files. Covers are now non-draggable everywhere, and the overlay gains a close button as an escape hatch for the rare case a browser drops the drag-end event and leaves it stuck. _(desktop)_

## v1.2.0 — 2026-06-18 · QQ Music, coverflow, and silky-smooth big libraries

Search and import from QQ Music, switch songs by dragging a 3D coverflow where the cover, background, palette, and backlight move as one, and keep smooth playback, search, and editing even on libraries of thousands of tracks. Live requests gain command-prefix gating, and the flow background now glides between covers.

### Highlights
- **streaming** QQ Music as an online source — Search QQ Music and play tracks right inside MUZERO. Log in through a built-in window to reach your own library, sync 我的歌单 (your playlists), and import any playlist by pasting its link or share short-link. Guest playback stays within the plaintext quality ceiling — encrypted VIP files are never decrypted. _(desktop)_
- **player** Coverflow Now Playing — Drag the album cover to flip through your queue in a 3D coverflow. The cover, blurred background, color palette, backlight, and shadow all travel and crossfade together — with no black frames or flicker at the hand-off, on both drag and external switches.

### Added
- **settings** Command-prefix gating for live requests — Require chat messages to start with a command prefix — entered as chips — before they count as song requests, so ordinary chatter is ignored. Requests run through a FIFO queue, and play-now / play-next cut in relative to the track you're actually on.
- **player** Dim-layer backdrop blur control — Now Playing gains a slider to blur the backdrop behind the dim layer, for a softer, more focused stage.

### Changed
- **player** Smooth on libraries of thousands of tracks — Switching songs and editing track metadata no longer drop frames on very large queues and libraries. Likes and play counts moved off the catalog row into side tables, the queue and search indexes were split so a single edit re-renders one row instead of the whole list, and hidden tabs stop reconciling on every playback heartbeat.
- **search** Faster global search on large libraries — Global search opens and responds instantly even with thousands of tracks. Search-variant indexes are precomputed, the open-window index burst is pre-warmed, and facet/set/lyrics matching runs off the keystroke frame so typing stays fluid.
- **visualizer** Flow background glides between songs — The cover-painted flow background now crossfades its color palette from one song to the next instead of snapping, and the spectrum's cover-derived accent color glides along with it.
- **app** Window border reacts to cover drag — On Windows, the desktop window border color follows the cover-drag progress, stays uniform on every edge, and disappears in F-key fullscreen. _(desktop)_

### Fixed
- **app** Error notifications copy the full stack trace — Copying an error notification now always includes the complete stack trace, making problems easier to report and diagnose.
- **memory** Memory mode uses a quote icon — The memory (DJ context) mode now shows a quote icon, a better fit for “music carries memories.”

## v1.1.1 — 2026-06-16 · Live chat song requests

Viewers can request songs from your live chat — through Social Stream Ninja or any webhook — and MUZERO maps each request to a query and routes it to library search or the AI DJ. The hosted mu0.app web build can take requests too, over the SSN relay.

### Highlights
- **settings** Take song requests from live chat — Connect Social Stream Ninja (or any webhook) and let viewers request songs from chat. Each request is matched against your library or sent to the AI DJ, with per-user cooldowns, a rate limit, and duplicate suppression.

### Added
- **settings** Build a mapping from a real request — Each source starts in testing mode: send it a request to capture a sanitized sample, then click fields in the JSON tree to build the mapping and see a live preview of the resolved query — using presets (Social Stream Ninja, generic) or custom {{ payload.… }} templates. Go live when it looks right.
- **app** mu0.app takes requests over the SSN relay — The hosted web app subscribes outbound to the Social Stream Ninja relay with your session ID, so it can take live chat requests with no MUZERO backend. AI generation and online sourcing remain desktop-first (they depend on the browser allowing CORS). _(web)_
- **settings** Multiple webhook sources, routed independently — The desktop app exposes a local /v1/intake/<source> webhook per source. Give each one its own mapping and route it to library search or the AI DJ — e.g. one platform to search, another to generation. _(desktop)_

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
