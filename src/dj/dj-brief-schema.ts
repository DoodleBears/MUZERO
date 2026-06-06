import { z } from "zod";

/**
 * TrackBrief — the canonical contract the AI DJ writes and the music-generation
 * provider consumes. This Zod schema is the single source of truth:
 *  - the DJ LLM emits it via structured output (`generateObject`)
 *  - music-gen providers map it onto their request (ACE-Step caption/lyrics/...)
 *  - the DB stores it on each Track row
 *
 * Shape is provider-agnostic and maps cleanly onto common music-gen APIs: a
 * free-text `caption` (genre/instrumentation/mood prompt) plus optional musical
 * params and `lyrics`. Adapters translate it to each vendor — they don't leak
 * vendor concepts back into the brief.
 */
export const trackBriefSchema = z.object({
  /** Human-facing song title the DJ invents. */
  title: z.string().min(1).max(80),
  /** Style prompt: genre, instrumentation, mood, production. ACE-Step "caption". */
  caption: z.string().min(1).max(600),
  /**
   * Lyrics with optional structure tags ("[verse]", "[chorus]", "[instrumental]").
   * Empty string ⇒ instrumental.
   */
  lyrics: z.string().max(4000).default(""),
  /** Target length in seconds. */
  durationSec: z.number().int().min(10).max(240).default(60),
  /** Tempo. */
  bpm: z.number().int().min(40).max(220).optional(),
  /** e.g. "A minor", "C major". */
  keyscale: z.string().max(40).optional(),
  /** e.g. "4" (4/4), "3" (3/4). */
  timeSignature: z.string().max(8).optional(),
  /** BCP-47-ish hint for sung vocals, e.g. "en", "zh", "ja". */
  vocalLanguage: z.string().max(16).optional(),
  /** The DJ's own note: why this track now, how it segues from the last one. */
  djNote: z.string().max(400).optional(),
});

export type TrackBrief = z.infer<typeof trackBriefSchema>;

/** A short, model-agnostic summary used in prompts / UI chips. */
export function describeBrief(brief: TrackBrief): string {
  const bits = [brief.caption];
  if (brief.bpm) bits.push(`${brief.bpm}bpm`);
  if (brief.keyscale) bits.push(brief.keyscale);
  return bits.join(" · ");
}
