import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  arePerfCountersEnabled,
  blobUrlStats,
  bumpPerfCounter,
  installBlobUrlTracker,
  noteDbRequery,
  notePerfWork,
  readPerfCounter,
  resetPerfCounters,
  setPerfCountersEnabled,
} from "@/lib/perf-counters";
import { clearTrace, getTraceEntries } from "@/lib/trace";

describe("perf counters", () => {
  beforeEach(() => {
    resetPerfCounters();
    clearTrace();
  });

  afterEach(() => {
    setPerfCountersEnabled(false);
    resetPerfCounters();
  });

  it("is disabled by default and bump is a no-op while disabled", () => {
    expect(arePerfCountersEnabled()).toBe(false);
    bumpPerfCounter("db.listAllTracks");
    expect(readPerfCounter("db.listAllTracks")).toBe(0);
  });

  it("counts bumps while enabled and reads back per name", () => {
    setPerfCountersEnabled(true);
    bumpPerfCounter("db.listAllTracks");
    bumpPerfCounter("db.listAllTracks");
    bumpPerfCounter("db.memoryNotesByTrack", 3);
    expect(readPerfCounter("db.listAllTracks")).toBe(2);
    expect(readPerfCounter("db.memoryNotesByTrack")).toBe(3);
    expect(readPerfCounter("db.unknown")).toBe(0);
  });

  it("reset clears all counters", () => {
    setPerfCountersEnabled(true);
    bumpPerfCounter("db.listAllTracks");
    resetPerfCounters();
    expect(readPerfCounter("db.listAllTracks")).toBe(0);
  });

  describe("noteDbRequery", () => {
    it("is a no-op while disabled (no counter, no trace entry)", () => {
      noteDbRequery("listAllTracks");
      expect(readPerfCounter("db.listAllTracks")).toBe(0);
      expect(getTraceEntries()).toHaveLength(0);
    });

    it("bumps the db counter and emits a debug trace entry while enabled", () => {
      setPerfCountersEnabled(true);
      noteDbRequery("listAllTracks");
      expect(readPerfCounter("db.listAllTracks")).toBe(1);
      const entries = getTraceEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ level: "debug", scope: "db" });
      expect(entries[0].message).toContain("listAllTracks");
    });

    it("coalesces trace emission during a requery burst while keeping the counter exact (PRD F-L4)", () => {
      vi.useFakeTimers();
      try {
        setPerfCountersEnabled(true);
        noteDbRequery("listAllTracks");
        noteDbRequery("listAllTracks");
        noteDbRequery("listAllTracks");
        // Counter counts every execution; the trace ring gets one line per window.
        expect(readPerfCounter("db.listAllTracks")).toBe(3);
        expect(getTraceEntries()).toHaveLength(1);

        vi.advanceTimersByTime(1100);
        noteDbRequery("listAllTracks");
        const entries = getTraceEntries();
        expect(entries).toHaveLength(2);
        // The next line carries the count it swallowed during the window.
        expect(entries[1].message).toContain("+2");
      } finally {
        vi.useRealTimers();
      }
    });

    it("rate-limits per query name, not globally", () => {
      setPerfCountersEnabled(true);
      noteDbRequery("listAllTracks");
      noteDbRequery("memoryNotesByTrack");
      expect(getTraceEntries()).toHaveLength(2);
    });
  });

  describe("notePerfWork", () => {
    it("is a no-op while disabled", () => {
      notePerfWork("lyrics.cascade.frame", 24, { rows: 17 });
      expect(readPerfCounter("work.lyrics.cascade.frame")).toBe(0);
      expect(getTraceEntries()).toHaveLength(0);
    });

    it("coalesces fast work and emits slow spans with summary data", () => {
      vi.useFakeTimers();
      try {
        setPerfCountersEnabled(true);
        notePerfWork("lyrics.cascade.frame", 2, { rows: 17 });
        notePerfWork("lyrics.cascade.frame", 3, { rows: 17 });
        expect(readPerfCounter("work.lyrics.cascade.frame")).toBe(2);
        expect(getTraceEntries()).toHaveLength(0);

        vi.advanceTimersByTime(1600);
        notePerfWork("lyrics.cascade.frame", 4, { rows: 19 });
        let entries = getTraceEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          level: "debug",
          message: "lyrics.cascade.frame",
          scope: "performance.work",
        });
        expect(entries[0].data?.[0]).toMatchObject({
          count: 3,
          maxMs: 4,
          rows: 19,
        });

        notePerfWork("lyrics.cascade.frame", 12, { rows: 21 });
        entries = getTraceEntries();
        expect(entries).toHaveLength(2);
        expect(entries[1].data?.[0]).toMatchObject({
          count: 1,
          maxMs: 12,
          slowCount: 1,
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("blob URL tracker", () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let createMock: ReturnType<typeof vi.fn>;
    let revokeMock: ReturnType<typeof vi.fn>;
    let nextId = 0;

    beforeEach(() => {
      nextId = 0;
      createMock = vi.fn(() => `blob:test/${nextId++}`);
      revokeMock = vi.fn();
      URL.createObjectURL = createMock as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = revokeMock as unknown as typeof URL.revokeObjectURL;
    });

    afterEach(() => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    });

    it("counts live (created − revoked), total created, and blob kind groups while installed", () => {
      const uninstall = installBlobUrlTracker();
      const a = URL.createObjectURL(new Blob(["a"], { type: "image/png" }));
      const b = URL.createObjectURL(new Blob(["b"], { type: "audio/mpeg" }));
      const c = URL.createObjectURL(new Blob(["c"], { type: "video/mp4" }));
      const d = URL.createObjectURL(new Blob(["d"], { type: "application/octet-stream" }));
      expect(blobUrlStats()).toEqual({
        created: 4,
        createdByKind: { audio: 1, image: 1, other: 1, video: 1 },
        live: 4,
        liveByKind: { audio: 1, image: 1, other: 1, video: 1 },
        liveBytes: 4,
        liveBytesByKind: { audio: 1, image: 1, other: 1, video: 1 },
      });
      URL.revokeObjectURL(a);
      expect(blobUrlStats()).toEqual({
        created: 4,
        createdByKind: { audio: 1, image: 1, other: 1, video: 1 },
        live: 3,
        liveByKind: { audio: 1, image: 0, other: 1, video: 1 },
        liveBytes: 3,
        liveBytesByKind: { audio: 1, image: 0, other: 1, video: 1 },
      });
      URL.revokeObjectURL(b);
      URL.revokeObjectURL(c);
      URL.revokeObjectURL(d);
      expect(blobUrlStats()).toEqual({
        created: 4,
        createdByKind: { audio: 1, image: 1, other: 1, video: 1 },
        live: 0,
        liveByKind: { audio: 0, image: 0, other: 0, video: 0 },
        liveBytes: 0,
        liveBytesByKind: { audio: 0, image: 0, other: 0, video: 0 },
      });
      uninstall();
    });

    it("delegates to the original functions", () => {
      const uninstall = installBlobUrlTracker();
      const blob = new Blob(["x"]);
      const url = URL.createObjectURL(blob);
      expect(createMock).toHaveBeenCalledWith(blob);
      URL.revokeObjectURL(url);
      expect(revokeMock).toHaveBeenCalledWith(url);
      uninstall();
    });

    it("ignores revokes of URLs created before install (no negative live)", () => {
      const uninstall = installBlobUrlTracker();
      URL.revokeObjectURL("blob:test/pre-existing");
      expect(blobUrlStats().live).toBe(0);
      expect(revokeMock).toHaveBeenCalledWith("blob:test/pre-existing");
      uninstall();
    });

    it("restores the original functions on uninstall", () => {
      const uninstall = installBlobUrlTracker();
      expect(URL.createObjectURL).not.toBe(createMock);
      uninstall();
      expect(URL.createObjectURL).toBe(createMock);
      expect(URL.revokeObjectURL).toBe(revokeMock);
    });

    it("refcounts nested installs (StrictMode double-mount)", () => {
      const first = installBlobUrlTracker();
      const second = installBlobUrlTracker();
      URL.createObjectURL(new Blob(["a"]));
      expect(blobUrlStats().live).toBe(1);
      first();
      // Still installed — the second consumer holds it.
      expect(URL.createObjectURL).not.toBe(createMock);
      URL.createObjectURL(new Blob(["b"]));
      expect(blobUrlStats().live).toBe(2);
      second();
      expect(URL.createObjectURL).toBe(createMock);
    });

    it("double-calling the same uninstaller does not over-release", () => {
      const first = installBlobUrlTracker();
      const second = installBlobUrlTracker();
      first();
      first(); // idempotent
      expect(URL.createObjectURL).not.toBe(createMock);
      second();
      expect(URL.createObjectURL).toBe(createMock);
    });
  });
});
