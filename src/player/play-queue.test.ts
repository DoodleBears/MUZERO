import { describe, expect, it } from "vitest";
import type { PlayQueueEntry } from "@/db/types";
import {
  appendEntries,
  insertNext,
  insertRequest,
  moveEntry,
  type PlayQueueState,
  reconcileCurrentIndex,
  removeEntriesByTrackIds,
  removeEntry,
  replaceEntries,
  unconsumedTrackIds,
} from "./play-queue";

/** Deterministic entry for tests: id derived from trackId. */
function e(trackId: string): PlayQueueEntry {
  return { id: `${trackId}-e`, trackId };
}
function state(trackIds: string[], currentIndex: number): PlayQueueState {
  return { entries: trackIds.map(e), currentIndex };
}
const ids = (s: PlayQueueState) => s.entries.map((x) => x.trackId);

describe("appendEntries", () => {
  it("adds to the end and keeps currentIndex", () => {
    const s = appendEntries(state(["a", "b"], 0), [e("c"), e("d")]);
    expect(ids(s)).toEqual(["a", "b", "c", "d"]);
    expect(s.currentIndex).toBe(0);
  });
});

describe("insertNext", () => {
  it("inserts right after the current index (play-next)", () => {
    const s = insertNext(state(["a", "b", "c"], 0), [e("x")]);
    expect(ids(s)).toEqual(["a", "x", "b", "c"]);
    expect(s.currentIndex).toBe(0);
  });

  it("appends when nothing is playing (currentIndex < 0)", () => {
    const s = insertNext(state([], -1), [e("x"), e("y")]);
    expect(ids(s)).toEqual(["x", "y"]);
  });
});

describe("insertRequest", () => {
  it("queues the first request right after the current track and marks it", () => {
    const s = insertRequest(state(["a1", "a2", "a3"], 0), [e("b1")]);
    expect(ids(s)).toEqual(["a1", "b1", "a2", "a3"]);
    expect(s.currentIndex).toBe(0);
    expect(s.entries[1].requested).toBe(true);
  });

  it("queues later requests FIFO after the existing request block (no line-jumping)", () => {
    // A1 playing, B1 already requested → a second request B2 goes AFTER B1.
    const after1 = insertRequest(state(["a1", "a2"], 0), [e("b1")]);
    const after2 = insertRequest(after1, [e("b2")]);
    expect(ids(after2)).toEqual(["a1", "b1", "b2", "a2"]);
    const after3 = insertRequest(after2, [e("b3")]);
    expect(ids(after3)).toEqual(["a1", "b1", "b2", "b3", "a2"]);
  });

  it("does not skip past the host's own upcoming tracks", () => {
    // Only the contiguous requested run after current is skipped, not plain entries.
    const s = insertRequest(state(["a1", "a2", "a3"], 0), [e("b1")]);
    const s2 = insertRequest(s, [e("b2")]);
    // b1,b2 stay grouped right after a1; a2,a3 untouched at the tail.
    expect(ids(s2)).toEqual(["a1", "b1", "b2", "a2", "a3"]);
  });

  it("appends when the queue is idle", () => {
    const s = insertRequest(state([], -1), [e("b1")]);
    expect(ids(s)).toEqual(["b1"]);
    expect(s.entries[0].requested).toBe(true);
  });
});

describe("removeEntry", () => {
  it("removing before current shifts current to keep the same track", () => {
    const s = removeEntry(state(["a", "b", "c"], 2), "a-e");
    expect(ids(s)).toEqual(["b", "c"]);
    expect(s.entries[s.currentIndex].trackId).toBe("c");
  });

  it("removing after current leaves current untouched", () => {
    const s = removeEntry(state(["a", "b", "c"], 0), "c-e");
    expect(ids(s)).toEqual(["a", "b"]);
    expect(s.currentIndex).toBe(0);
  });

  it("removing the current entry points current at what was next", () => {
    const s = removeEntry(state(["a", "b", "c"], 1), "b-e");
    expect(ids(s)).toEqual(["a", "c"]);
    expect(s.entries[s.currentIndex].trackId).toBe("c");
  });

  it("removing the current last entry clamps current into range", () => {
    const s = removeEntry(state(["a", "b"], 1), "b-e");
    expect(ids(s)).toEqual(["a"]);
    expect(s.currentIndex).toBe(0);
  });

  it("removing the only entry yields empty / -1", () => {
    const s = removeEntry(state(["a"], 0), "a-e");
    expect(s.entries).toEqual([]);
    expect(s.currentIndex).toBe(-1);
  });
});

describe("moveEntry", () => {
  it("reorders and keeps current pointing at the same track", () => {
    const s = moveEntry(state(["a", "b", "c"], 0), 2, 0); // move c to front
    expect(ids(s)).toEqual(["c", "a", "b"]);
    expect(s.entries[s.currentIndex].trackId).toBe("a");
  });

  it("moving the current entry follows it", () => {
    const s = moveEntry(state(["a", "b", "c"], 1), 1, 2); // move b to end
    expect(ids(s)).toEqual(["a", "c", "b"]);
    expect(s.entries[s.currentIndex].trackId).toBe("b");
  });
});

describe("replaceEntries", () => {
  it("replaces all and clamps the requested index", () => {
    const s = replaceEntries([e("x"), e("y")], 0);
    expect(ids(s)).toEqual(["x", "y"]);
    expect(s.currentIndex).toBe(0);
  });

  it("clamps an out-of-range index", () => {
    expect(replaceEntries([e("x")], 5).currentIndex).toBe(0);
    expect(replaceEntries([], 0).currentIndex).toBe(-1);
  });

  it("keeps an explicit idle cursor", () => {
    const s = replaceEntries([e("x"), e("y")], -1);
    expect(ids(s)).toEqual(["x", "y"]);
    expect(s.currentIndex).toBe(-1);
  });
});

describe("reconcileCurrentIndex (pin the cursor to the playing track by id)", () => {
  it("follows the playing track when other tracks are removed", () => {
    // [a,b,c] playing c (idx 2); remove a → [b,c]; c is now at idx 1.
    expect(reconcileCurrentIndex(["b", "c"], "c", 2)).toBe(1);
  });

  it("stays on the playing track when a later track is removed", () => {
    // [a,b,c] playing a (idx 0); remove c → [a,b]; a stays at 0.
    expect(reconcileCurrentIndex(["a", "b"], "a", 0)).toBe(0);
  });

  it("moves to the track now at the slot when the CURRENT track is removed", () => {
    // [a,b,c] playing b (idx 1); remove b → [a,c]; slot 1 now holds c.
    expect(reconcileCurrentIndex(["a", "c"], "b", 1)).toBe(1);
  });

  it("stays idle (-1) when nothing is playing", () => {
    expect(reconcileCurrentIndex(["a", "b"], null, -1)).toBe(-1);
  });

  it("returns -1 for an empty queue", () => {
    expect(reconcileCurrentIndex([], "a", 0)).toBe(-1);
  });

  it("clamps a removed-current at the end", () => {
    // playing c (idx 2); remove c → [a,b]; clamp old idx 2 → 1.
    expect(reconcileCurrentIndex(["a", "b"], "c", 2)).toBe(1);
  });
});

describe("unconsumedTrackIds (high-water by id, prepend-safe)", () => {
  it("finds newly-PREPENDED tracks (new ids at the front)", () => {
    expect(unconsumedTrackIds(["c", "b", "a"], new Set(["a", "b"]))).toEqual(["c"]);
  });

  it("finds newly-APPENDED tracks (new ids at the end)", () => {
    expect(unconsumedTrackIds(["a", "b", "c"], new Set(["a", "b"]))).toEqual(["c"]);
  });

  it("returns a prepended batch in set order", () => {
    expect(unconsumedTrackIds(["d", "c", "b", "a"], new Set(["a", "b"]))).toEqual(["d", "c"]);
  });

  it("returns nothing when all are consumed, everything when none are", () => {
    expect(unconsumedTrackIds(["a", "b"], new Set(["a", "b"]))).toEqual([]);
    expect(unconsumedTrackIds(["a", "b"], new Set())).toEqual(["a", "b"]);
  });
});

describe("removeEntriesByTrackIds", () => {
  it("removes the entries and keeps the cursor on the playing track", () => {
    const next = removeEntriesByTrackIds(state(["a", "b", "c", "d"], 2), new Set(["a", "b"]));
    expect(next.entries.map((e) => e.trackId)).toEqual(["c", "d"]);
    expect(next.currentIndex).toBe(0); // still on "c"
  });

  it("falls back to the held slot when the playing track is removed", () => {
    const next = removeEntriesByTrackIds(state(["a", "b", "c", "d"], 1), new Set(["b"]));
    expect(next.entries.map((e) => e.trackId)).toEqual(["a", "c", "d"]);
    expect(next.currentIndex).toBe(1); // slot 1 now holds "c"
  });

  it("clamps to the last entry when the removed playing track was last", () => {
    const next = removeEntriesByTrackIds(state(["a", "b", "c"], 2), new Set(["c"]));
    expect(next.entries.map((e) => e.trackId)).toEqual(["a", "b"]);
    expect(next.currentIndex).toBe(1);
  });

  it("goes idle (-1) when every entry is removed", () => {
    const next = removeEntriesByTrackIds(state(["a", "b"], 0), new Set(["a", "b"]));
    expect(next.entries).toEqual([]);
    expect(next.currentIndex).toBe(-1);
  });

  it("keeps an idle queue idle", () => {
    const next = removeEntriesByTrackIds(state(["a", "b", "c"], -1), new Set(["a"]));
    expect(next.entries.map((e) => e.trackId)).toEqual(["b", "c"]);
    expect(next.currentIndex).toBe(-1);
  });

  it("removes ALL entries sharing a removed trackId (duplicates)", () => {
    const next = removeEntriesByTrackIds(state(["a", "b", "a", "c"], 3), new Set(["a"]));
    expect(next.entries.map((e) => e.trackId)).toEqual(["b", "c"]);
    expect(next.currentIndex).toBe(1); // still on "c"
  });

  it("returns the same state when nothing matches", () => {
    const before = state(["a", "b"], 1);
    expect(removeEntriesByTrackIds(before, new Set())).toBe(before);
  });
});
