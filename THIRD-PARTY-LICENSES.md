# Third-Party Licenses & Attributions

MUZERO is local-first and BYOK; the only outbound requests are to user-configured
third-party APIs and the read-only public sources listed here. This file records
external data sources / assets whose content MUZERO fetches or bundles, with their
license and attribution (CLAUDE.md rule 5 + prd-create §3).

## Lyrics data sources (fetched at runtime, not bundled)

| Source | What | License | URL |
|--------|------|---------|-----|
| **LRCLIB** | Synced + plain lyrics (LRC) | Public domain (CC0-style); free, keyless API | https://lrclib.net |
| **NetEase Cloud Music** | Official synced LRC + word-level `yrc` + translation/romanization | Provider data; fetched via the user's own account (BYOK). Personal use, per platform terms | https://music.163.com |
| **AMLL TTML Database** (`amll-ttml-db`) | Community word-by-word **TTML** lyrics (Apple-Music-like; word timing + translation + romanization + duet) | **CC0-1.0** for contributor-authored content; external data follows its original provider's terms | https://github.com/amll-dev/amll-ttml-db |

Notes:

- These are **read-only** sources fetched on demand through the desktop bridge
  (`getAppFetch()` / `muzfetch://`); MUZERO holds no copy of the databases and runs
  no server of its own.
- The **AMLL TTML DB** provider is **opt-in** (Settings → Lyrics source). It is keyed
  by NetEase song id, so it resolves only NetEase-id tracks. CC0-1.0 lets us fetch
  and display the contributor-authored TTML freely; underlying lyric ownership stays
  with the original rights holders.

## Bundled code dependencies

Runtime/library licenses for bundled npm packages are covered by their respective
entries in `node_modules/*/LICENSE` and the project `package.json`. Notable
self-authored or MIT-class components (e.g. the visualizer shaders, the lyric format
parsers) are authored in-house: **MIT (MUZERO)**.
