# Changelog

All notable changes to MUZERO. Generated from `src/content/changelog` — do not edit by hand (`make changelog-md`).

## v1.5.1 — 2026-06-25 · Scope your search: @online, @local, @video, @audio

Global search (⌘/Ctrl+F) gains four quick filters. Type @ and pick: @online searches only your enabled streaming sources, @local searches only your device library, and @video / @audio narrow your local library to just videos or just audio. Local-scoped filters skip the network entirely, so searching your own library never waits on online sources.

### Highlights
- **search** Four new @ filters in global search — In the ⌘/Ctrl+F search box, type @ to scope your search. @online looks only at your enabled online sources; @local stays on your device library; @video and @audio show only videos or only audio from your library. @local / @video / @audio never touch the network, so local searches stay instant. (CJK aliases work too — e.g. @视频 / @在线.)

## v1.5.0 — 2026-06-25 · Live song requests land where they should

Live chat song requests (弹幕点歌) now route reliably no matter what you are playing. In online playlists (like NetEase imports) and other non-DJ playlists, a viewer's 'play next' request finds the song and queues it right after the current track — under shuffle, repeat-all, and when you switch playlists mid-stream. Songs matched online always land in one dedicated request playlist (with the cover cached for offline) instead of drifting into whichever set was playing; songs you already own are reused instead of re-downloaded; and a request that arrives while nothing is playing now starts playback immediately. Single-track repeat intentionally keeps looping the current song and holds requests until you move on.

### Highlights
- **player** Live requests queue correctly in online & other playlists — When you are listening to an online playlist (e.g. imported from NetEase) or any non-DJ playlist, a viewer's 'play next' request now reliably finds the song and queues it right after the current track — including while shuffle or repeat-all is on, and when you switch playlists mid-stream. Previously, a request made while playing certain playlists could silently match nothing and never play. _(desktop)_

### Changed
- **player** Requests start playing when nothing is on — If nothing is playing when a 'play next' request comes in, MUZERO now starts playing it right away, instead of quietly adding it to an idle queue that never advances. _(desktop)_

### Fixed
- **streaming** Online-matched requests land in one dedicated request playlist — When a requested song is not in your library and is matched online, it now always goes into one dedicated request playlist (with its cover cached for offline), instead of drifting into whichever set happened to be playing. Requests for songs you already have reuse your local copy — no duplicate downloads or second versions. _(desktop)_

## v1.4.2 — 2026-06-23 · Cooler playback for big local libraries

A performance and release-polish update for desktop listening. MUZERO now treats lazy .ncm metadata work as a gentle background trickle instead of a disk storm, backs it off further while music is playing, and remembers files that cannot be decoded so they are not re-read on every launch. Video playback is lighter too: the cover stays in the foreground, live video moves to the immersive background, cover mode stops decoding the hidden video stream, and occluded Pixi layers are skipped. Desktop auto-updates now appear in the same notification stack as downloads, with progress and a restart action, and release feeds point at the correct versioned installer paths.

### Highlights
- **player** Playback no longer fights background .ncm scanning — Large libraries with many referenced NetEase .ncm files no longer hammer the disk at launch or while a song is playing. Metadata hydration is paced, slowed further during playback, and failed decodes are marked durably so the same unreadable file is not re-opened on every start. _(desktop)_

### Added
- **app** Desktop updates join the notification stack — When an auto-update is found or downloading, MUZERO now shows it beside download and playback activity with a real progress bar. Once the installer is ready, the notification stays visible and offers a restart-to-update action. _(desktop)_

### Changed
- **player** Video tracks use one live video path — Now Playing keeps the cover card in the foreground and moves the live video into the immersive background. The Pixi cover-effect background no longer samples the full video as a texture, and fully covered background layers are skipped, cutting duplicate video work without changing the look.
- **player** Cover mode stops hidden video decoding — A video track shown as a cover now plays audio through the audio driver while the muted visual video element is detached. That frees decode surfaces and VRAM immediately, then resumes the visual layer when you switch back to video mode.
- **visualizer** Sharper ambient cover backgrounds — The ambient Pixi background now uses the original cover image instead of a small downscaled derivative, so pixel, noise, CRT, and related cover effects stay sharper and avoid an extra thumbnail-generation pass.

### Fixed
- **app** Updater feeds point at the right installers — Release publishing now rewrites electron-builder update feeds so their file references include the version folder. Auto-update downloads no longer 404 after a correctly published release. _(desktop)_

## v1.4.1 — 2026-06-23 · Playback that does exactly what you see

A refinement release built around one idea: the queue you see is the queue that plays. Songs now play from the playlist you're actually viewing — not wherever they were first saved — and the visible queue is the real play order, shuffle included, so 'play next' and song requests land exactly where you expect and your queue survives a restart. Background progress for downloads, song loading, and syncing collapses into a single notification stack with real, cancelable progress. Search can now find Japanese songs by romaji (type 'sakura' to find 桜), cover art looks sharper, favlist / playlist downloads are sturdier, and several Now Playing and tab-switching glitches are fixed.

### Highlights
- **player** Songs play from the playlist you're in — and the queue you see is the queue that plays — Start a song and it now plays from the playlist you're actually viewing, instead of jumping to wherever the song was first saved (which could silently play nothing, or switch you to a different set). The visible queue is now the real play order — shuffle materializes into the list you see — so 'play next' and song requests land exactly next instead of being skipped, and the queue, its source, and its order all survive a restart.

### Added
- **player** Stable shuffle you can actually see — Shuffle now lays out a fixed order into the visible queue once, instead of silently re-rolling every time the queue changes (which used to throw away a just-inserted 'next' track). A new setting controls whether toggling shuffle reshuffles the order or keeps the current one.
- **app** All background progress in one place — Downloads, song loading, syncing, and imports now all report into a single notification stack with real progress bars you can cancel — no more hunting across a floating badge, a tiny cover spinner, and a separate toast. Quick local track switches stay silent; only loads that actually take a moment surface a 'Downloading …' notification with byte-level progress.
- **search** Find Japanese songs by romaji — ⌘F search now reads kanji the Japanese way, so typing 'sakura' finds 桜 even when the title has no kana at all. Chinese titles still match by pinyin, and a pure-kanji title is searchable by either reading.

### Changed
- **search** A smarter ⌘F — A new @songs filter narrows results to just track names, the Songs section always shows its header so it reads as a distinct group, a pasted link jumps to the top of results, and result covers load right away instead of only on hover.
- **library** Crisper cover art — List thumbnails now render at higher resolution (320px / quality 0.9) so they no longer look soft on hi-DPI screens, and the gallery grid uses the full-resolution original cover. Existing thumbnails regenerate sharper the next time they're shown.
- **streaming** Sturdier favlist & playlist downloads — Re-syncing a 收藏夹 / playlist now routes through the persistent download queue and skips items you've already saved, so it resumes, retries, and shows progress like everything else. You can choose video or audio for auto-sync downloads, single ⌘F downloads get the same retry queue, and a failed download now shows a copyable, detailed error instead of a vague failure. _(desktop)_

### Fixed
- **player** Now Playing video and glow fixes — Switching to a video track by dragging the cover or using a shortcut no longer leaves the Now Playing stage stuck on the still cover while the background plays the video — the foreground now follows the live current track. The cover backlight glow also shows at rest again, not only while you're dragging the cover.
- **app** Faithful tab switching — Switching tabs with Ctrl+1 / Ctrl+2 no longer resets your library scroll position, sort order, or selected set — keyboard switching now behaves exactly like clicking the nav or a Dock song.

## v1.4.0 — 2026-06-21 · Download Bilibili & YouTube videos to your library

MUZERO is now a real video downloader. Pick a quality and save Bilibili or YouTube videos as local, playable tracks — no FFmpeg, no extra tools. Paste a link (or just a BV ID / video ID) in ⌘F to grab one, or import a whole 收藏夹 / playlist and download every item as video. A persistent download queue resumes after a restart, retries failures, limits concurrency, and shows progress in a panel and a floating badge. You can also subscribe a favlist or playlist so new items sync in automatically.

### Highlights
- **streaming** Download Bilibili & YouTube videos to your library — Resolve a video, pick a resolution, and save it as a local, playable track — video and audio merged into a standard file (copy-remux, no FFmpeg bundled). Defaults to 1080p and degrades to the closest available quality when your pick isn't offered. Log in to a source to unlock higher / VIP qualities. _(desktop)_

### Added
- **search** Paste a link or ID in ⌘F to download — Paste a Bilibili or YouTube URL — or just a BV ID / video ID / shorts / playlist link — into ⌘F search and MUZERO resolves it directly instead of running a keyword search. Press Enter to download the video at your default quality (a Settings toggle keeps Enter = play), or use the audio / video buttons. _(desktop)_
- **streaming** Import whole 收藏夹 / playlists as video — Import a Bilibili 收藏夹 or a YouTube / YouTube Music playlist as its own set and download every item as video by default (a Settings toggle turns this off). YouTube Music entries with no real video fall back to audio. Each item shows its own progress, and Bilibili multi-part (分P) videos let you pick parts or grab them all. _(desktop)_
- **sync** Subscribe a favlist or playlist for auto-sync — Bind a 收藏夹 / playlist to a set and let MUZERO pull in new items automatically — choose a cadence (manual, on app start, or every 15 / 30 / 60 minutes) and optionally auto-download new videos. It runs only while the app is visible and online, with jitter and failure backoff to stay gentle on the source. _(desktop)_
- **streaming** Persistent download queue — Downloads run through a queue that survives a restart: interrupted jobs resume on next launch, failures retry with backoff, and a concurrency limit keeps things from overwhelming your machine or the source. Track everything in the Downloads panel (Settings) and a floating progress badge. _(desktop)_

### Changed
- **streaming** Smoother, more informative downloads — Official covers are preferred for downloaded videos, real byte-level progress shows for both single and batch downloads, and the audio + video merge runs off the main thread so the UI stays responsive. _(desktop)_

### Fixed
- **streaming** YouTube download reliability + quieter console — Fixed YouTube items that failed to merge with a 'timestamps must be non-negative' error, and audio-only YouTube Music entries now download as audio instead of failing. Also quieted occasional non-fatal console errors (transient network-proxy failures and YouTube parser warnings). _(desktop)_

## v1.3.1 — 2026-06-20 · Background update checks now show up on their own

The desktop app already checked for updates on its own shortly after launch, but the About screen only reflected an update after you pressed Check for updates — so the automatic check looked like it wasn't working. About now reads the latest known status when it opens, so a background check or download shows up without a manual nudge.

### Fixed
- **app** Automatic update checks surface without a manual click — The startup auto-check runs a few seconds after launch, before the About screen is usually open, so its result used to be missed and About opened looking up to date until you pressed Check for updates. About now seeds from the last known update status when it mounts, so a found, downloading, or ready-to-install update appears on its own. _(desktop)_

## v1.3.0 — 2026-06-20 · Much more accurate lyrics matching, and a friendlier empty library

Automatic lyrics matching got a lot smarter: titles and artists are normalized before lookup, a relaxation ladder recovers misses without caching the wrong version, a duration gate rejects same-length covers, and across sources MUZERO now prefers word-by-word karaoke. A match-progress toast shows what's happening with a one-tap Search fallback. Starting from an empty library is easier too — direct import actions and a one-click sample song — while large local folder sync and overall import/playback stay smoother with lower memory.

### Highlights
- **lyrics** Much more accurate automatic lyrics matching — MUZERO now normalizes titles and artists (stripping version, feat., and full-width brackets) before looking up lyrics, then walks a relaxation ladder so a near-miss still finds a match without caching the wrong version. A duration gate rejects same-length covers, and when several sources have lyrics it prefers word-by-word karaoke — so a NetEase per-syllable file can win over a first-arriving plain text one.

### Added
- **lyrics** Match-progress toast with a one-tap Search fallback — While a track auto-fetches lyrics, a small toast shows matching → matched, and when MUZERO is unsure or finds nothing it offers a Search action that jumps straight to manual lyric search on Now Playing. Low-confidence results are no longer written to the negative cache, so a later retry can still find the right words. A Settings toggle turns the toasts off.
- **library** Get started from an empty library — The empty-library screen now offers direct import actions — pick files or a folder right there — plus a one-click sample song so you can hear MUZERO play before importing anything of your own. Search reaches the same actions when it has nothing to show yet.

### Changed
- **library** Large local folder sync stays smooth — Syncing big local folders no longer stalls the app: the import path was optimized and appending freshly found tracks to the active queue is deferred during a sync, so the first songs stay playable while the rest stream in. _(desktop)_
- **player** Less jank and lower memory in import and playback — A round of profiling trimmed jank across importing and playback and reduced how much memory the Now Playing background holds, so long listening sessions and big libraries stay lighter on the machine.

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
