import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/muzero-db";
import { setTrackTags } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useTrack } from "./use-track";

async function deleteDefaultDb() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("muzero-db");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  db.close();
  await deleteDefaultDb();
  await db.open();
});
afterEach(() => {
  db.close();
});

let seq = 0;
async function seedTrack(title: string): Promise<Track> {
  seq += 1;
  const track: Track = {
    id: `trk_${title}_${seq}`,
    sessionId: "ses_test",
    title,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 1,
    createdAt: seq,
    playCount: 0,
    liked: false,
    tags: [],
  };
  await db.tracks.add(track);
  return track;
}

describe("useTrack", () => {
  it("returns undefined for a missing id and never subscribes", async () => {
    const { result } = renderHook(() => useTrack(undefined));
    expect(result.current).toBeUndefined();
  });

  it("resolves the row, then reacts to ITS OWN edit", async () => {
    const track = await seedTrack("One");
    const { result } = renderHook(() => useTrack(track.id));
    await waitFor(() => expect(result.current?.id).toBe(track.id));

    await setTrackTags(track.id, ["mood:calm"], db);
    await waitFor(() => expect(result.current?.tags).toContain("mood:calm"));
  });

  it("does NOT re-fire when a DIFFERENT track is edited (single-key observation)", async () => {
    const a = await seedTrack("A");
    const b = await seedTrack("B");
    const { result } = renderHook(() => useTrack(a.id));
    await waitFor(() => expect(result.current?.id).toBe(a.id));
    const observed = result.current;

    // Edit the OTHER track — a single-key get(a) must not observe b's row.
    await setTrackTags(b.id, ["mood:hype"], db);
    await new Promise((r) => setTimeout(r, 60));

    // Same object reference → this hook did not re-query.
    expect(result.current).toBe(observed);
  });
});
