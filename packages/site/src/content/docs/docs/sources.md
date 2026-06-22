---
title: Sources & importing
description: Upload your own audio and music videos, or search and play from NetEase Cloud Music, Bilibili, and YouTube — then keep it all in one local library.
sidebar:
  order: 2
---

MUZERO pulls your music together from three places: files you upload, online
sources you search, and tracks an AI DJ generates. Everything lands in the same
local library.

## Upload your own

- Drop in **audio files, whole folders, or music videos** — they go into mixed
  sets (a set can hold audio + video together).
- Add **notes, tags, memory photos, and custom covers** to any track.
- Search by title, artist, album, tag, note, lyrics, transliteration, and source
  metadata.
- Browse artists, albums, sets, memories, lyrics, and playback history from the
  same local library.

Media bytes are content-addressed and stored outside the lightweight track rows,
so large libraries stay fast and searchable.

## Online sources (desktop)

Search and resolve streams from:

- **NetEase Cloud Music**
- **Bilibili**
- **YouTube**

Tips:

- Paste a link — or just a **BV ID / video ID / playlist link** — into `⌘F`
  search and MUZERO resolves it directly instead of running a keyword search.
- **Sign in locally** to a source for higher-quality or account-gated content.
  Logins are stored on your device ([BYOK](/docs/agent-dj/#byok)).
- Streamed tracks and covers are **cached locally** for offline playback.
- On desktop you can **download** Bilibili / YouTube videos as local, playable
  tracks (pick a quality), or import a whole 收藏夹 / playlist as a set.

> Online sources work best in the **desktop app** — it can send the custom
> request headers some sources require. The web build may be limited by CORS.

## Next

- [Cloud sync](/docs/sync/) — back up and share your library.
- [Agent DJ](/docs/agent-dj/) — generate new tracks.
