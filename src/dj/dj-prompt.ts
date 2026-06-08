import type { DjConfig } from "@/db/types";
import type { TrackBrief } from "./dj-brief-schema";

/** Minimal view of an already-played/queued track the DJ uses for continuity. */
export interface RecentTrack {
  title: string;
  caption: string;
  /** Imported/generation-neutral music identity used for better DJ continuity. */
  metadata?: {
    artists?: string[];
    album?: string;
    genres?: string[];
    year?: number;
  };
  /** Listener annotations — "music carries memories" — steer the DJ's choices. */
  tags?: string[];
  note?: string;
}

export interface DjContext {
  seedPrompt: string;
  config: DjConfig;
  /** Most recent tracks (newest last) so the DJ can segue and avoid repeats. */
  recent: RecentTrack[];
  /** How many briefs to draft this turn. */
  count: number;
}

export const DJ_SYSTEM_PROMPT = `You are MUZERO, an AI DJ curating an endless, coherent set of AI-generated songs.
You receive a vibe and the tracks played so far, and you write the brief for the next song(s).
Principles:
- Keep the set coherent but evolving — segue from the previous track (tempo, key, energy), don't jump randomly.
- Avoid repeating titles, hooks, or near-identical captions you've already used.
- Write a vivid, specific "caption": genre, instrumentation, mood, production, era. This drives the music model.
- Write lyrics only when vocals fit; otherwise return "[instrumental]". Use structure tags like [verse]/[chorus].
- Choose musical params (bpm, key, time signature) that fit the vibe and flow from the last track.
- Each song should feel like a deliberate DJ pick, with a short djNote explaining the segue.`;

/** Build the user-turn prompt describing what to draft next. */
export function buildDjUserPrompt(ctx: DjContext): string {
  const lines: string[] = [];
  lines.push(`Vibe / seed: ${ctx.seedPrompt || "(open — surprise me)"}`);
  lines.push(`Vocals allowed: ${ctx.config.allowVocals ? "yes" : "no — instrumental only"}`);
  lines.push(`Target length: ~${ctx.config.targetDurationSec}s per track.`);
  if (ctx.recent.length > 0) {
    lines.push("");
    lines.push("Recently played (oldest → newest):");
    for (const t of ctx.recent.slice(-8)) {
      const metadata = recentTrackMetadataSummary(t);
      const tags = t.tags && t.tags.length > 0 ? `  [tags: ${t.tags.join(", ")}]` : "";
      const note = t.note ? `  (listener note: ${t.note})` : "";
      lines.push(`- "${t.title}" — ${t.caption}${metadata}${tags}${note}`);
    }
    lines.push("");
    lines.push(
      "Let the listener's tags and notes guide the mood — they capture what these songs mean to them.",
    );
    lines.push(
      `Now write ${ctx.count} brief(s) for the NEXT song(s) that segue from the most recent track.`,
    );
  } else {
    lines.push("");
    lines.push(
      `This is the start of the set. Write ${ctx.count} brief(s) that open the vibe strongly.`,
    );
  }
  if (!ctx.config.allowVocals) {
    lines.push('Set "lyrics" to "[instrumental]" for every track.');
  }
  return lines.join("\n");
}

function recentTrackMetadataSummary(track: RecentTrack): string {
  const metadata = track.metadata;
  if (!metadata) return "";
  const parts = [
    metadata.artists?.length ? `artist: ${metadata.artists.join(", ")}` : undefined,
    metadata.album ? `album: ${metadata.album}` : undefined,
    metadata.genres?.length ? `genres: ${metadata.genres.join(", ")}` : undefined,
    metadata.year ? `year: ${metadata.year}` : undefined,
  ].filter((part): part is string => !!part);
  return parts.length > 0 ? `  [metadata: ${parts.join("; ")}]` : "";
}

/** Post-process a model draft to honor hard config constraints. */
export function applyConfigToBrief(brief: TrackBrief, config: DjConfig): TrackBrief {
  const next: TrackBrief = { ...brief };
  if (!config.allowVocals) next.lyrics = "[instrumental]";
  if (!next.durationSec) next.durationSec = config.targetDurationSec;
  return next;
}
