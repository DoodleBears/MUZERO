import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { orderedSetTrackIds } from "@/player/set-order";
import { MuzeroDB } from "./muzero-db";
import {
  createSession,
  getSession,
  prependTrackIds,
  removeTracksFromSession,
  reorderTracksInSession,
} from "./repositories";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

/** Create a set whose membership order is exactly `ids`. */
async function makeSet(ids: string[]): Promise<string> {
  const s = await createSession({ seedPrompt: "" }, db);
  await prependTrackIds(s.id, ids, db); // bulk prepend onto empty keeps array order
  return s.id;
}

/** The set's resolved display/play order (the single arbiter). */
async function order(setId: string): Promise<string[]> {
  const s = await getSession(setId, db);
  return orderedSetTrackIds(s?.trackIds ?? [], s?.trackRanks);
}

describe("reorderTracksInSession", () => {
  it("first reorder lazily materializes ranks and moves a track to the top", async () => {
    const id = await makeSet(["a", "b", "c", "d"]);
    expect((await getSession(id, db))?.trackRanks).toBeUndefined();

    await reorderTracksInSession(id, ["c"], "a", db); // drop c before a (very top)

    expect(await order(id)).toEqual(["c", "a", "b", "d"]);
    expect((await getSession(id, db))?.trackRanks).toBeDefined();
  });

  it("drops a track at the very end", async () => {
    const id = await makeSet(["a", "b", "c", "d"]);
    await reorderTracksInSession(id, ["a"], null, db);
    expect(await order(id)).toEqual(["b", "c", "d", "a"]);
  });

  it("moves a multi-select block to the end keeping its relative order", async () => {
    const id = await makeSet(["a", "b", "c", "d"]);
    await reorderTracksInSession(id, ["b", "a"], null, db); // selection {a,b} → end
    expect(await order(id)).toEqual(["c", "d", "a", "b"]);
  });

  it("is a no-op when dropped back in place (set stays unmaterialized)", async () => {
    const id = await makeSet(["a", "b", "c"]);
    await reorderTracksInSession(id, ["a"], "b", db); // a already sits before b
    expect((await getSession(id, db))?.trackRanks).toBeUndefined();
    expect(await order(id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op (no throw) for an empty block or a missing set", async () => {
    const id = await makeSet(["a", "b"]);
    await reorderTracksInSession(id, [], "a", db);
    await reorderTracksInSession("ses_does_not_exist", ["a"], null, db);
    expect((await getSession(id, db))?.trackRanks).toBeUndefined();
  });
});

describe("membership ops keep the rank invariant", () => {
  it("prepend assigns front ranks on a materialized set (new track stays on top)", async () => {
    const id = await makeSet(["a", "b", "c"]);
    await reorderTracksInSession(id, ["c"], "a", db); // materialize → order c, a, b
    await prependTrackIds(id, ["z"], db);
    expect(await order(id)).toEqual(["z", "c", "a", "b"]);
  });

  it("prepend leaves an unmaterialized set unmaterialized", async () => {
    const id = await makeSet(["a", "b"]);
    await prependTrackIds(id, ["z"], db);
    expect((await getSession(id, db))?.trackRanks).toBeUndefined();
    expect(await order(id)).toEqual(["z", "a", "b"]);
  });

  it("remove drops the rank key, preserving the invariant", async () => {
    const id = await makeSet(["a", "b", "c", "d"]);
    await reorderTracksInSession(id, ["d"], "a", db); // materialize → order d, a, b, c
    await removeTracksFromSession(id, ["a"], db);
    const s = await getSession(id, db);
    expect(s?.trackRanks?.a).toBeUndefined();
    expect(Object.keys(s?.trackRanks ?? {}).sort()).toEqual(["b", "c", "d"]);
    expect(await order(id)).toEqual(["d", "b", "c"]);
  });
});
