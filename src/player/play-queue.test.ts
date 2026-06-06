import { describe, expect, it } from "vitest";
import type { PlayQueueEntry } from "@/db/types";
import {
  appendEntries,
  insertNext,
  moveEntry,
  type PlayQueueState,
  removeEntry,
  replaceEntries,
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
});
