import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { listAllTracks, listTrackPlaybackStats, memoryNotesByTrack } from "@/db/repositories";
import { readPerfCounter, resetPerfCounters, setPerfCountersEnabled } from "@/lib/perf-counters";

/**
 * Heavyweight full-table queries note each execution to the perf HUD (PRD
 * F-3 observability) — and stay silent while the HUD is unmounted.
 */
describe("repository perf requery notes", () => {
  let db: MuzeroDB;
  let seq = 0;

  beforeEach(() => {
    db = new MuzeroDB(`perf-note-test-${seq++}`);
    resetPerfCounters();
    setPerfCountersEnabled(true);
  });

  afterEach(async () => {
    setPerfCountersEnabled(false);
    resetPerfCounters();
    await db.delete();
  });

  it("listAllTracks notes a db requery", async () => {
    await listAllTracks(db);
    await listAllTracks(db);
    expect(readPerfCounter("db.listAllTracks")).toBe(2);
  });

  it("memoryNotesByTrack notes a db requery", async () => {
    await memoryNotesByTrack(["trk_x"], db);
    expect(readPerfCounter("db.memoryNotesByTrack")).toBe(1);
  });

  it("listTrackPlaybackStats notes a db requery", async () => {
    await listTrackPlaybackStats(db);
    expect(readPerfCounter("db.trackPlaybackStats")).toBe(1);
  });

  it("stays silent while the HUD is not mounted", async () => {
    setPerfCountersEnabled(false);
    await listAllTracks(db);
    expect(readPerfCounter("db.listAllTracks")).toBe(0);
  });
});
