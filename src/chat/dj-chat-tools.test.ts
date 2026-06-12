import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  createSession,
  getPlayQueue,
  getSession,
  getTrack,
  getTrackBlob,
  memoryNotesByTrack,
  playQueueSet,
  saveSettings,
} from "@/db/repositories";
import { trackBriefSchema } from "@/dj/dj-brief-schema";
import { createDjEngine } from "@/dj/dj-engine";
import { createMockMusicGenProvider } from "@/musicgen/mock-provider";
import {
  createDjChatTools,
  executeAddMemory,
  executeCreateSet,
  executeGenerateTracks,
  executeMemorySearch,
  executeOnlineAddTracks,
  executeOnlineSearchTracks,
  executeProposeBriefs,
  executeSearchTracks,
  executeSetAddBySearch,
  executeSetAddTracks,
  generateTracksInputSchema,
  proposeBriefsInputSchema,
} from "./dj-chat-tools";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-chat-tools-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("DJ chat tools", () => {
  it("marks only dj_generate_tracks as approval-gated", () => {
    const tools = createDjChatTools({ db });
    expect(tools.dj_generate_tracks.needsApproval).toBe(true);
    expect(tools.dj_propose_briefs.needsApproval).toBeUndefined();
    expect(tools.library_search_tracks.needsApproval).toBeUndefined();
    expect(tools.set_create.needsApproval).toBeUndefined();
  });

  it("rejects invalid TrackBrief input before any DB write", async () => {
    const session = await createSession({ seedPrompt: "lofi" }, db);
    const parsed = generateTracksInputSchema.safeParse({
      sessionId: session.id,
      briefs: [{ title: "", caption: "", durationSec: 1 }],
    });

    expect(parsed.success).toBe(false);
    expect(await db.tracks.count()).toBe(0);
    expect((await getSession(session.id, db))?.trackIds).toEqual([]);
  });

  it("generates pending tracks into the target set and play-next queue", async () => {
    const session = await createSession({ seedPrompt: "lofi" }, db);
    const brief = trackBriefSchema.parse({
      title: "Rain Mirror",
      caption: "lofi piano with brushed drums",
      lyrics: "",
      durationSec: 60,
    });

    const result = await executeGenerateTracks(
      {
        sessionId: session.id,
        briefs: [brief],
        playNext: true,
      },
      { db, providerId: "cloud" },
    );

    expect(result.status).toBe("ok");
    expect(result.diff.createdTrackIds).toHaveLength(1);
    const track = await db.tracks.get(result.diff.createdTrackIds[0]);
    expect(track).toMatchObject({
      title: "Rain Mirror",
      provider: "cloud",
      status: "pending",
      sessionId: session.id,
    });
    expect((await getSession(session.id, db))?.trackIds).toEqual(result.diff.createdTrackIds);
    expect((await getPlayQueue(db)).entries.map((entry) => entry.trackId)).toEqual(
      result.diff.createdTrackIds,
    );
  });

  it("records cloud preset provenance and a generated memory note", async () => {
    await saveSettings(
      {
        musicGenProvider: "cloud",
        musicCloudPreset: "mureka",
        musicCloudModel: "mureka-6",
      },
      db,
    );
    const session = await createSession({ seedPrompt: "rain city" }, db);
    const brief = trackBriefSchema.parse({
      title: "Rain Memory",
      caption: "rainy city pop",
      lyrics: "",
      durationSec: 60,
      djNote: "keeps the walk moving",
    });

    const result = await executeGenerateTracks(
      {
        sessionId: session.id,
        briefs: [brief],
        playNext: false,
      },
      { db },
    );

    const track = await db.tracks.get(result.diff.createdTrackIds[0]);
    expect(track?.providerPreset).toBe("mureka:mureka-6");
    expect(await memoryNotesByTrack(result.diff.createdTrackIds, db)).toEqual(
      new Map([
        [
          result.diff.createdTrackIds[0],
          ["DJ generated for rain city · mureka:mureka-6 · keeps the walk moving"],
        ],
      ]),
    );
  });

  it("proposes validated briefs without writing pending tracks", async () => {
    const session = await createSession({ seedPrompt: "rain" }, db);
    const input = proposeBriefsInputSchema.parse({
      sessionId: session.id,
      rationale: "Keep the set rainy but add more pulse.",
      briefs: [
        {
          title: "Umbrella Relay",
          caption: "rainy garage pulse, soft sub bass, glassy keys",
          lyrics: "",
          durationSec: 70,
          bpm: 132,
          keyscale: "D minor",
        },
      ],
    });

    const result = await executeProposeBriefs(input);

    expect(result.proposalId).toMatch(/^prp_/);
    expect(result.sessionId).toBe(session.id);
    expect(result.summaries).toEqual([
      "Umbrella Relay: rainy garage pulse, soft sub bass, glassy keys · 132bpm · D minor",
    ]);
    expect(result.rationale).toBe("Keep the set rainy but add more pulse.");
    expect(await db.tracks.count()).toBe(0);
    expect((await getSession(session.id, db))?.trackIds).toEqual([]);
  });

  it("runs the core propose to generate to materialize flow with the mock provider", async () => {
    const session = await createSession({ seedPrompt: "lofi" }, db);
    const brief = trackBriefSchema.parse({
      title: "Cassette Garden",
      caption: "warm lofi beat with tape hiss and soft keys",
      lyrics: "",
      durationSec: 45,
      bpm: 86,
    });

    const proposal = await executeProposeBriefs({
      sessionId: session.id,
      rationale: "Keep it warm and playable.",
      briefs: [brief],
    });

    expect(proposal.summaries).toEqual([
      "Cassette Garden: warm lofi beat with tape hiss and soft keys · 86bpm",
    ]);
    expect(await db.tracks.count()).toBe(0);

    const generated = await executeGenerateTracks(
      {
        sessionId: session.id,
        briefs: proposal.briefs,
        playNext: true,
      },
      { db, providerId: "mock" },
    );
    const [trackId] = generated.diff.createdTrackIds;
    expect(trackId).toBeTruthy();
    expect((await getSession(session.id, db))?.trackIds).toEqual([trackId]);
    expect((await getPlayQueue(db)).entries.map((entry) => entry.trackId)).toEqual([trackId]);
    expect(await getTrack(trackId, db)).toMatchObject({
      provider: "mock",
      providerPreset: "mock",
      status: "pending",
      title: "Cassette Garden",
    });

    const engine = createDjEngine({
      db,
      brain: { draftBriefs: async () => [] },
      provider: createMockMusicGenProvider({ seconds: 1 }),
    });
    const ready = await engine.materializeNext(session.id);

    expect(ready).toMatchObject({ id: trackId, status: "ready" });
    const reloaded = await getTrack(trackId, db);
    expect(reloaded).toMatchObject({ status: "ready", durationSec: 1 });
    const media = await getTrackBlob(reloaded!, db);
    expect(media).toMatchObject({
      role: "media",
      mime: "audio/wav",
      trackId,
    });
    expect(media?.bytes).toBeGreaterThan(44);
  });

  it("searches tracks with memory-aware matching", async () => {
    const session = await createSession({ seedPrompt: "" }, db);
    const created = await executeGenerateTracks(
      {
        sessionId: session.id,
        briefs: [
          trackBriefSchema.parse({
            title: "Metro Bloom",
            caption: "bright city pop",
            lyrics: "",
            durationSec: 60,
          }),
        ],
      },
      { db, providerId: "mock" },
    );
    await db.memories.add({
      id: "mem_1",
      trackId: created.diff.createdTrackIds[0],
      note: "Shibuya morning walk",
      createdAt: 1,
    });

    const result = await executeSearchTracks({ query: "shibuya", limit: 10 }, { db });
    expect(result.total).toBe(1);
    expect(result.returned).toBe(1);
    expect(result.nextCursor).toBeNull(); // single match, nothing more to page
    expect(result.tracks.map((track) => track.title)).toEqual(["Metro Bloom"]);
    // default projection is id+title only — keep the JSON payload tiny.
    expect(Object.keys(result.tracks[0]).sort()).toEqual(["id", "title"]);
  });
});

describe("search projection + multi-keyword + curate-by-search", () => {
  function brief(title: string, caption: string) {
    return trackBriefSchema.parse({ title, caption, lyrics: "", durationSec: 60 });
  }

  async function seed() {
    const src = await createSession({ seedPrompt: "lib" }, db);
    const gen = await executeGenerateTracks(
      {
        sessionId: src.id,
        briefs: [
          brief("Night Drive", "deep techno warehouse"),
          brief("Rain Loop", "lofi piano beat"),
          brief("Sunset Tape", "lofi chillhop with techno bass"),
        ],
      },
      { db, providerId: "mock" },
    );
    return { src, ids: gen.diff.createdTrackIds };
  }

  it("merges queries[] with match 'any' (union) and 'all' (intersection)", async () => {
    await seed();
    const anyHit = await executeSearchTracks({ queries: ["techno", "lofi"], match: "any" }, { db });
    expect(anyHit.total).toBe(3); // every track matches at least one keyword

    const allHit = await executeSearchTracks({ queries: ["techno", "lofi"], match: "all" }, { db });
    expect(allHit.tracks.map((t) => t.title)).toEqual(["Sunset Tape"]); // only the one with both
  });

  it("projects only requested fields and reports total vs returned under a limit", async () => {
    await seed();
    const out = await executeSearchTracks(
      { query: "lofi", fields: ["id", "kind"], limit: 1 },
      { db },
    );
    expect(out.total).toBe(2); // Rain Loop + Sunset Tape match "lofi"
    expect(out.returned).toBe(1); // capped by limit
    expect(out.nextCursor).toBe(1); // one more page available
    expect(out.tracks).toHaveLength(1);
    expect(Object.keys(out.tracks[0]).sort()).toEqual(["id", "kind"]);
  });

  it("pages through capped matches with cursor / nextCursor", async () => {
    await seed(); // 3 tracks all match "techno" OR "lofi"
    const opts = { queries: ["techno", "lofi"], match: "any" as const, limit: 2 };

    const page1 = await executeSearchTracks(opts, { db });
    expect(page1.total).toBe(3);
    expect(page1.returned).toBe(2);
    expect(page1.nextCursor).toBe(2);

    const page2 = await executeSearchTracks({ ...opts, cursor: page1.nextCursor ?? 0 }, { db });
    expect(page2.returned).toBe(1);
    expect(page2.nextCursor).toBeNull(); // last page

    // the two pages are disjoint and together cover every match
    const ids = [...page1.tracks, ...page2.tracks].map((track) => track.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("set_add_by_search grows an EXISTING set that already has members", async () => {
    const { ids } = await seed();
    const target = await createSession({ seedPrompt: "existing" }, db);
    await executeSetAddTracks({ sessionId: target.id, trackIds: [ids[0]] }, { db }); // pre-existing member

    const grown = await executeSetAddBySearch(
      { sessionId: target.id, queries: ["lofi"], match: "any" },
      { db },
    );
    expect(grown.diff.matched).toBe(2); // Rain Loop + Sunset Tape
    expect(grown.diff.added).toBe(2); // both new; the pre-existing techno track stays
    expect((await getSession(target.id, db))?.trackIds.length).toBe(3);
  });

  it("set_add_by_search curates every match into a set (deduped) without listing ids", async () => {
    await seed();
    const target = await createSession({ seedPrompt: "playlist" }, db);

    const first = await executeSetAddBySearch(
      { sessionId: target.id, queries: ["lofi"], match: "any" },
      { db },
    );
    expect(first.status).toBe("ok");
    expect(first.diff.matched).toBe(2);
    expect(first.diff.added).toBe(2);
    expect((await getSession(target.id, db))?.trackIds.length).toBe(2);

    // Re-running is idempotent: same matches, nothing new added.
    const again = await executeSetAddBySearch({ sessionId: target.id, queries: ["lofi"] }, { db });
    expect(again.diff.matched).toBe(2);
    expect(again.diff.added).toBe(0);
    expect(again.diff.skipped).toBe(2);

    const missing = await executeSetAddBySearch(
      { sessionId: "ses_missing", queries: ["lofi"] },
      { db },
    );
    expect(missing.status).toBe("error");
    expect(missing.warnings).toContain("missing-session");
  });
});

describe("DJ chat tools — conditional tool set", () => {
  it("omits the paid generate tools when includeGenerate is false", () => {
    const tools = createDjChatTools({ db, includeGenerate: false });
    expect(tools.dj_generate_tracks).toBeUndefined();
    expect(tools.dj_propose_briefs).toBeUndefined();
    expect(tools.library_search_tracks).toBeDefined(); // base tools stay
  });

  it("adds the online tools only when includeOnline is true", () => {
    expect(createDjChatTools({ db }).online_search_tracks).toBeUndefined();
    const withOnline = createDjChatTools({ db, includeOnline: true });
    expect(withOnline.online_search_tracks).toBeDefined();
    expect(withOnline.online_add_tracks).toBeDefined();
    expect(withOnline.online_add_tracks.needsApproval).toBeUndefined(); // free, no approval
  });
});

describe("online search / ingest tools", () => {
  it("searches enabled sources via the injected resolver and flattens hits", async () => {
    const fakeSource = {
      id: "netease" as const,
      label: "NetEase",
      requiresLogin: false,
      isAuthed: () => true,
      search: async () => [
        { externalId: "n1", title: "Online Song", source: "netease" as const, artist: "A" },
      ],
    };
    const out = await executeOnlineSearchTracks(
      { query: "rain", limit: 5 },
      { db, resolveSources: () => [fakeSource as never] },
    );
    expect(out.hits.map((h) => h.title)).toEqual(["Online Song"]);
    expect(out.sources).toEqual(["netease"]);
  });

  it("ingests hits into a set (deduped) without playing them", async () => {
    const session = await createSession({ seedPrompt: "online" }, db);
    const hit = { externalId: "yt1", title: "From YouTube", source: "youtube" as const };

    const first = await executeOnlineAddTracks({ sessionId: session.id, hits: [hit] }, { db });
    expect(first.status).toBe("ok");
    expect(first.diff.added).toBe(1);

    const tracks = await getSession(session.id, db);
    expect(tracks?.trackIds.length).toBe(1);
    const row = await db.tracks.get(tracks?.trackIds[0] ?? "");
    expect(row?.origin).toBe("streamed");
    expect(row?.streamSourceId).toBe("youtube");

    // Re-adding the same hit is a no-op (deduped by source + externalId).
    const second = await executeOnlineAddTracks({ sessionId: session.id, hits: [hit] }, { db });
    expect(second.diff.added).toBe(0);
    expect(second.diff.skipped).toBe(1);
  });

  it("errors when the target set is missing", async () => {
    const out = await executeOnlineAddTracks(
      { sessionId: "ses_missing", hits: [{ externalId: "x", title: "X", source: "bili" }] },
      { db },
    );
    expect(out.status).toBe("error");
    expect(out.warnings).toContain("missing-session");
  });
});

describe("curation + queue clear", () => {
  function brief(title: string) {
    return trackBriefSchema.parse({ title, caption: "c", lyrics: "", durationSec: 60 });
  }

  it("set_add_tracks adds existing local ids to a set (idempotent; skips unknown)", async () => {
    const src = await createSession({ seedPrompt: "src" }, db);
    const gen = await executeGenerateTracks(
      { sessionId: src.id, briefs: [brief("A"), brief("B")] },
      { db, providerId: "mock" },
    );
    const [a, b] = gen.diff.createdTrackIds;

    const target = await createSession({ seedPrompt: "playlist" }, db);
    const r1 = await executeSetAddTracks(
      { sessionId: target.id, trackIds: [a, b, "trk_missing"] },
      { db },
    );
    expect(r1.diff.added).toBe(2);
    expect(r1.diff.skipped).toBe(1); // the unknown id
    expect((await getSession(target.id, db))?.trackIds.sort()).toEqual([a, b].sort());

    const r2 = await executeSetAddTracks({ sessionId: target.id, trackIds: [a] }, { db });
    expect(r2.diff.added).toBe(0); // already present

    const missing = await executeSetAddTracks({ sessionId: "ses_x", trackIds: [a] }, { db });
    expect(missing.status).toBe("error");
  });

  it("queue_clear empties the play queue", async () => {
    const src = await createSession({ seedPrompt: "q" }, db);
    const gen = await executeGenerateTracks(
      { sessionId: src.id, briefs: [brief("Q")] },
      { db, providerId: "mock" },
    );
    await playQueueSet(gen.diff.createdTrackIds, {}, db);
    expect((await getPlayQueue(db)).entries.length).toBe(1);

    const tools = createDjChatTools({ db });
    await tools.queue_clear.execute?.({}, { toolCallId: "t", messages: [] } as never);
    expect((await getPlayQueue(db)).entries.length).toBe(0);
  });

  it("play_set / play_track drive the injected player control", async () => {
    const calls: string[] = [];
    const player = {
      playSet: async (id: string) => {
        calls.push(`set:${id}`);
      },
      playTrack: async (id: string) => {
        calls.push(`track:${id}`);
      },
    };
    const tools = createDjChatTools({ db, player });
    const opts = { toolCallId: "t", messages: [] } as never;
    await tools.play_set.execute?.({ sessionId: "ses_1" }, opts);
    await tools.play_track.execute?.({ trackId: "trk_1" }, opts);
    expect(calls).toEqual(["set:ses_1", "track:trk_1"]);
  });

  it("set_create seeds the new set with given track ids in order (one call)", async () => {
    const src = await createSession({ seedPrompt: "src" }, db);
    const gen = await executeGenerateTracks(
      { sessionId: src.id, briefs: [brief("A"), brief("B"), brief("C")] },
      { db, providerId: "mock" },
    );
    const [a, b, c] = gen.diff.createdTrackIds;

    const created = await executeCreateSet(
      { name: "Mix", autoExtend: false, trackIds: [a, b, c, "trk_missing"] },
      { db },
    );
    expect(created.addedTrackCount).toBe(3); // unknown id skipped
    expect(created.name).toBe("Mix");
    expect(created.trackIds).toEqual([a, b, c]); // order preserved

    const reloaded = await getSession(created.id, db);
    expect(reloaded?.trackIds).toEqual([a, b, c]);
  });

  it("set_create with no track ids makes an empty set", async () => {
    const created = await executeCreateSet({ name: "Empty" }, { db });
    expect(created.addedTrackCount).toBe(0);
    expect(created.trackIds).toEqual([]);
  });
});

describe("memory search + add", () => {
  function brief(title: string) {
    return trackBriefSchema.parse({ title, caption: "c", lyrics: "", durationSec: 60 });
  }
  async function seedTracks() {
    const src = await createSession({ seedPrompt: "src" }, db);
    const gen = await executeGenerateTracks(
      { sessionId: src.id, briefs: [brief("Rain Mirror"), brief("Sun Drive")] },
      { db, providerId: "mock" },
    );
    return gen.diff.createdTrackIds; // [rain, sun]
  }

  it("add_memory attaches a note to the given track", async () => {
    const [rain] = await seedTracks();
    const res = await executeAddMemory({ trackId: rain, note: "coding in the rain" }, { db });
    expect(res.status).toBe("ok");
    expect(res.diff.trackId).toBe(rain);
    expect(res.diff.memoryId).toBeTruthy();
    expect((await db.memories.where("trackId").equals(rain).count()) > 0).toBe(true);
  });

  it("add_memory with no trackId targets the currently playing track", async () => {
    const [rain, sun] = await seedTracks();
    await playQueueSet([rain, sun], { currentIndex: 1 }, db); // current = sun
    const res = await executeAddMemory({ note: "summer, windows down" }, { db });
    expect(res.status).toBe("ok");
    expect(res.diff.trackId).toBe(sun);
  });

  it("add_memory errors when nothing is playing and no trackId is given", async () => {
    const res = await executeAddMemory({ note: "orphan" }, { db });
    expect(res.status).toBe("error");
    expect(res.warnings).toContain("no-track");
  });

  it("memory_search finds memories by keyword, each with its track info", async () => {
    const [rain, sun] = await seedTracks();
    await executeAddMemory({ trackId: rain, note: "rainy commute focus" }, { db });
    await executeAddMemory({ trackId: sun, note: "beach roadtrip 2019" }, { db });

    const hit = await executeMemorySearch({ queries: ["roadtrip"] }, { db });
    expect(hit.total).toBe(1);
    expect(hit.memories[0].trackId).toBe(sun);
    expect(hit.memories[0].trackTitle).toBe("Sun Drive");
    expect(hit.memories[0].note).toContain("roadtrip");
  });

  it("memory_search also matches via the track's title", async () => {
    const [rain] = await seedTracks();
    await executeAddMemory({ trackId: rain, note: "morning vibes" }, { db }); // note has no 'rain'
    const hit = await executeMemorySearch({ queries: ["rain"] }, { db }); // matches title 'Rain Mirror'
    expect(hit.memories.map((m) => m.trackId)).toEqual([rain]);
  });

  it("memory_search match 'all' requires every keyword", async () => {
    const [rain] = await seedTracks();
    await executeAddMemory({ trackId: rain, note: "late night focus coding" }, { db });
    const both = await executeMemorySearch({ queries: ["focus", "coding"], match: "all" }, { db });
    expect(both.total).toBe(1);
    const missing = await executeMemorySearch(
      { queries: ["focus", "beach"], match: "all" },
      { db },
    );
    expect(missing.total).toBe(0);
  });
});
