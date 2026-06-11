import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  createSession,
  getPlayQueue,
  getSession,
  getTrack,
  getTrackBlob,
  memoryNotesByTrack,
  saveSettings,
} from "@/db/repositories";
import { trackBriefSchema } from "@/dj/dj-brief-schema";
import { createDjEngine } from "@/dj/dj-engine";
import { createMockMusicGenProvider } from "@/musicgen/mock-provider";
import {
  createDjChatTools,
  executeGenerateTracks,
  executeOnlineAddTracks,
  executeOnlineSearchTracks,
  executeProposeBriefs,
  executeSearchTracks,
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
    expect(result.tracks.map((track) => track.title)).toEqual(["Metro Bloom"]);
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
