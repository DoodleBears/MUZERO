---
title: Agent DJ
description: Connect a local model or an online LLM and let it curate sets, take requests, and generate the next song — like a DJ for your private library.
sidebar:
  order: 4
---

The Agent DJ turns an LLM into a librarian, curator, and music-generation
orchestrator for your library. Run MUZERO on a side monitor as a radio while you
code, design, write, or drift through a long session.

## What it does

- **Search & curate** — the agent can search your library, use your tags and
  notes as context, and build or continue a set.
- **Take requests** — tell it a mood, seed it with a set, and let it keep the
  queue moving without babysitting the player.
- **Generate** — when you want a brand-new track, the DJ writes a `TrackBrief`
  (caption, lyrics, style, BPM, key, structure, generation hints) and hands it to
  a music-generation provider.

## Providers

Music generation is pluggable:

- **Mock** — an offline placeholder provider (default), so the loop works with no
  network or keys.
- **Cloud (BYOK)** — a real generation API you configure. The DJ never talks to a
  specific vendor directly; an adapter translates the brief, so the library never
  depends on one vendor.

## BYOK

LLM and music-generation API keys are **bring-your-own-key**: you enter them in
Settings, and they are stored locally on your device. MUZERO holds no server-side
keys and makes no outbound calls except to the third-party APIs you configure.

> Keys are never written into the app bundle, a committed `.env`, a URL, logs, or
> telemetry.

## Next

- [Sources & importing](/docs/sources/) — give the DJ more to work with.
- [Architecture](/docs/architecture/) — how the DJ → generation → queue loop works.
