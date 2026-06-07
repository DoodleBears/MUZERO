import type { MuzeroDB } from "@/db/muzero-db";
import {
  appendTrackIds,
  createPendingTrack,
  getSession,
  getTracksByIds,
  markTrackFailed,
  markTrackGenerating,
  markTrackReady,
} from "@/db/repositories";
import type { Track } from "@/db/types";
import { log } from "@/lib/logger";
import type { MusicGenProvider } from "@/musicgen/provider";
import { shouldAutoExtend } from "@/player/queue";
import { type TrackBrief, trackBriefSchema } from "./dj-brief-schema";
import { applyConfigToBrief, type DjContext, type RecentTrack } from "./dj-prompt";

/**
 * DjBrain is the LLM side of the DJ — the only thing that talks to the model.
 * The engine depends on this interface, so tests inject a canned brain and the
 * whole draft→generate→enqueue loop runs without a network or API key.
 */
export interface DjBrain {
  draftBriefs(ctx: DjContext): Promise<TrackBrief[]>;
}

export interface DjEngine {
  /** Ask the brain for the next batch, persist as pending tracks, append to queue. */
  draft(sessionId: string): Promise<Track[]>;
  /** Generate audio for the first not-yet-ready track in the queue; null if none. */
  materializeNext(sessionId: string, signal?: AbortSignal): Promise<Track | null>;
  /**
   * Draft more for this 歌单 if the 播放列表(Play Queue) has run low. The threshold
   * is measured on the QUEUE (`queueLength`/`currentIndex`), not the set's member
   * count, so it stays correct after the user edits the queue.
   */
  refillIfNeeded(
    sessionId: string,
    queueLength: number,
    currentIndex: number,
  ): Promise<Track[] | null>;
}

export function createDjEngine(deps: {
  db: MuzeroDB;
  brain: DjBrain;
  provider: MusicGenProvider;
}): DjEngine {
  const { db, brain, provider } = deps;

  async function buildContext(sessionId: string, count: number): Promise<DjContext | null> {
    const session = await getSession(sessionId, db);
    if (!session) return null;
    const tracks = await getTracksByIds(session.trackIds, db);
    const recent: RecentTrack[] = tracks
      .filter((t) => t.status === "ready")
      .slice(-8)
      .map((t) => ({
        title: t.title,
        caption: t.brief?.caption ?? (t.origin === "uploaded" ? `uploaded ${t.kind}` : t.title),
        tags: t.tags,
        note: t.note,
      }));
    return { seedPrompt: session.seedPrompt, config: session.config, recent, count };
  }

  async function draft(sessionId: string): Promise<Track[]> {
    const session = await getSession(sessionId, db);
    if (!session) return [];
    const ctx = await buildContext(sessionId, session.config.batchSize);
    if (!ctx) return [];

    const raw = await brain.draftBriefs(ctx);
    // Validate + clamp each brief against the schema and session config. A brain
    // (real LLM) can return junk; never trust it straight into the queue.
    const briefs: TrackBrief[] = [];
    for (const candidate of raw) {
      const parsed = trackBriefSchema.safeParse(candidate);
      if (!parsed.success) {
        log.warn("dj-engine", "dropping invalid brief", parsed.error.issues);
        continue;
      }
      briefs.push(applyConfigToBrief(parsed.data, session.config));
    }
    if (briefs.length === 0) return [];

    const created: Track[] = [];
    for (const brief of briefs) {
      const track = await createPendingTrack({ sessionId, brief, provider: provider.id }, db);
      created.push(track);
    }
    await appendTrackIds(
      sessionId,
      created.map((t) => t.id),
      db,
    );
    log.info("dj-engine", `drafted ${created.length} track(s) for ${sessionId}`);
    return created;
  }

  async function materializeNext(sessionId: string, signal?: AbortSignal): Promise<Track | null> {
    const session = await getSession(sessionId, db);
    if (!session) return null;
    const tracks = await getTracksByIds(session.trackIds, db);
    // Only generated tracks have a brief to materialize; uploads are born ready.
    const target = tracks.find(
      (t) => (t.status === "pending" || t.status === "generating") && t.brief,
    );
    if (!target?.brief) return null;
    const brief = target.brief;

    await markTrackGenerating(target.id, db);
    try {
      const result = await provider.generate({ brief, signal });
      await markTrackReady(
        {
          trackId: target.id,
          blob: result.blob,
          mime: result.mime,
          durationSec: result.durationSec,
        },
        db,
      );
      log.info("dj-engine", `materialized "${target.title}" (${result.durationSec.toFixed(1)}s)`);
      return { ...target, status: "ready", durationSec: result.durationSec };
    } catch (err) {
      if (signal?.aborted) throw err;
      const message = err instanceof Error ? err.message : String(err);
      await markTrackFailed(target.id, message, db);
      log.error("dj-engine", `materialize failed for "${target.title}"`, message);
      return { ...target, status: "failed", error: message };
    }
  }

  async function refillIfNeeded(
    sessionId: string,
    queueLength: number,
    currentIndex: number,
  ): Promise<Track[] | null> {
    const session = await getSession(sessionId, db);
    if (!session) return null;
    // Only DJ-enabled sets auto-generate; pure upload/curated sets never refill.
    if (!session.config.autoExtend) return null;
    // Measured on the play queue (what's actually left to play), not the set count.
    if (!shouldAutoExtend(queueLength, currentIndex, session.config.refillThreshold)) {
      return null;
    }
    return draft(sessionId);
  }

  return { draft, materializeNext, refillIfNeeded };
}
