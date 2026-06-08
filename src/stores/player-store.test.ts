import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzeroDB } from "@/db/muzero-db";
import type { Track } from "@/db/types";

let openedDb: MuzeroDB | null = null;

async function deleteDefaultDb() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("muzero-db");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  vi.resetModules();
  await deleteDefaultDb();
});

afterEach(async () => {
  openedDb?.close();
  openedDb = null;
  document.body.innerHTML = "";
  await deleteDefaultDb();
});

async function loadRuntime() {
  const dbMod = await import("@/db/muzero-db");
  openedDb = dbMod.db;
  const repos = await import("@/db/repositories");
  const store = await import("./player-store");
  return { db: dbMod.db, repos, usePlayerStore: store.usePlayerStore };
}

async function seedQueue(currentIndex = 1) {
  const { db, repos, usePlayerStore } = await loadRuntime();
  const session = await repos.createSession({
    seedPrompt: "",
    config: { autoExtend: false },
    displayMode: "cover",
  });
  const first = track("trk_first", session.id, "First");
  const second = track("trk_second", session.id, "Second");
  await db.tracks.bulkAdd([first, second]);
  await repos.prependTrackIds(session.id, [first.id, second.id]);
  await repos.playQueueSet([first.id, second.id], {
    contextSetId: session.id,
    currentIndex,
  });
  return { repos, session, first, second, usePlayerStore };
}

function track(id: string, sessionId: string, title: string): Track {
  return {
    id,
    sessionId,
    title,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "failed",
    durationSec: 30,
    createdAt: Date.now(),
    playCount: 0,
    liked: false,
    tags: [],
  };
}

describe("player-store playback resume", () => {
  it("hydrates the last queue cursor and active set from IndexedDB", async () => {
    const { session, first, second, usePlayerStore } = await seedQueue(1);

    usePlayerStore.getState().init();

    await waitFor(() => {
      const state = usePlayerStore.getState();
      expect(state.activeSessionId).toBe(session.id);
      expect(state.queue.map((t) => t.id)).toEqual([first.id, second.id]);
      expect(state.currentIndex).toBe(1);
      expect(state.displayMode).toBe("cover");
      expect(state.djEnabled).toBe(false);
    });
  });

  it("persists the queue cursor when the user picks another track", async () => {
    const { repos, usePlayerStore } = await seedQueue(0);
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));

    await usePlayerStore.getState().playIndex(1);

    await waitFor(async () => {
      await expect(repos.getPlayQueue()).resolves.toMatchObject({ currentIndex: 1 });
    });
  });
});
