import { z } from "zod";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { PlaybackAggregate } from "@/db/types";

const playbackAggregateScopeSchema = z.enum([
  "track",
  "track-in-set",
  "track-in-share",
  "set",
  "share",
  "drive",
]);

const playbackAggregateCacheSchema = z.object({
  schema: z.literal("muzero-r2-playback-aggregate-v1"),
  devicePublicId: z.string().min(1),
  updatedAt: z.number().nonnegative(),
  aggregates: z.array(
    z.object({
      id: z.string().min(1),
      scope: playbackAggregateScopeSchema,
      driveId: z.string().optional(),
      shareId: z.string().optional(),
      setId: z.string().optional(),
      trackId: z.string().optional(),
      remoteTrackId: z.string().optional(),
      mediaSha256: z.string().optional(),
      playCount: z.number().int().nonnegative(),
      listenedSec: z.number().nonnegative(),
      lastPlayedAt: z.number().nonnegative().optional(),
      updatedAt: z.number().nonnegative(),
    }),
  ),
});

export type R2PlaybackAggregateCache = z.infer<typeof playbackAggregateCacheSchema>;

export interface ImportR2PlaybackAggregateCacheResult {
  devicePublicId: string;
  imported: number;
}

export async function importR2PlaybackAggregateCache(
  value: unknown,
  db: MuzeroDB = defaultDb,
): Promise<ImportR2PlaybackAggregateCacheResult> {
  const parsed = playbackAggregateCacheSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Invalid R2 playback aggregate cache");
  }

  const rows: PlaybackAggregate[] = parsed.data.aggregates.map((aggregate) => ({
    ...aggregate,
    devicePublicId: parsed.data.devicePublicId,
  }));
  if (rows.length > 0) await db.playbackAggregates.bulkPut(rows);
  return {
    devicePublicId: parsed.data.devicePublicId,
    imported: rows.length,
  };
}
