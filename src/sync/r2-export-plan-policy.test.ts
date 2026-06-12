import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { type AppSettings, type CloudDrive, DEFAULT_SETTINGS, type Track } from "@/db/types";
import { buildR2ExportPlanForDrive } from "./r2-export-plan";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-r2-export-policy-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("buildR2ExportPlanForDrive", () => {
  it("publishes device profile and avatar only for writable owner/trusted drives", async () => {
    await seedDevice();

    const ownedPlan = await buildR2ExportPlanForDrive({
      drive: ownedDrive,
      settings: settingsWithCredentials,
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: [],
      db,
    });

    expect(ownedPlan.objects.some((object) => object.kind === "device-profile")).toBe(true);
    expect(ownedPlan.objects.some((object) => object.kind === "device-avatar")).toBe(true);
    expect(ownedPlan.objects.some((object) => object.kind === "devices-index")).toBe(true);

    const sharedPlan = await buildR2ExportPlanForDrive({
      drive: sharedDrive,
      settings: settingsWithCredentials,
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: [],
      db,
    });

    expect(sharedPlan.objects.some((object) => object.kind === "device-profile")).toBe(false);
    expect(sharedPlan.objects.some((object) => object.kind === "device-avatar")).toBe(false);
    expect(sharedPlan.objects.some((object) => object.kind === "devices-index")).toBe(false);
  });

  it("does not publish stats/profile objects when credentials are missing", async () => {
    await seedDevice();
    await db.playbackAggregates.put({
      id: "dvc_1:track:trk_1",
      devicePublicId: "dvc_1",
      scope: "track",
      trackId: "trk_1",
      playCount: 1,
      listenedSec: 45,
      updatedAt: 45_000,
    });

    const plan = await buildR2ExportPlanForDrive({
      drive: ownedDrive,
      settings: DEFAULT_SETTINGS,
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: [],
      db,
    });

    expect(plan.objects.map((object) => object.kind)).toEqual(["manifest"]);
  });

  it("forwards the remote publish base into the plan (MW-3)", async () => {
    await seedDevice();

    const plan = await buildR2ExportPlanForDrive({
      drive: ownedDrive,
      settings: settingsWithCredentials,
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: [],
      db,
      remoteBase: {
        manifest: {
          etag: '"m1"',
          value: {
            schema: "muzero-r2-manifest-v1",
            libraryId: "lib_1",
            title: "MUZERO Library",
            createdAt: "2026-06-01T00:00:00.000Z",
            updatedAt: "2026-06-10T00:00:00.000Z",
            baseUrl: "https://music.example.com/muzero/",
            sets: [
              {
                id: "ses_theirs",
                title: "Their set",
                index: "sets/ses_theirs/index.json",
                updatedAt: "2026-06-10T00:00:00.000Z",
                trackCount: 3,
                bytes: 300,
                publishedBy: "dvc_other",
              },
            ],
          },
        },
      },
    });

    const manifestObject = plan.objects.find((object) => object.kind === "manifest");
    expect(manifestObject?.precondition).toEqual({ ifMatch: '"m1"' });
    const manifest = JSON.parse(String(manifestObject?.body));
    expect(manifest.sets.map((set: { id: string }) => set.id)).toEqual(["ses_theirs"]);
  });

  it("forwards referenced local-media resolution into drive plans", async () => {
    const sha256 = "b".repeat(64);
    await db.sessions.put({
      id: "ses_local",
      name: "Local refs",
      seedPrompt: "",
      trackIds: ["trk_local"],
      status: "idle",
      config: {
        autoExtend: false,
        refillThreshold: 2,
        batchSize: 1,
        targetDurationSec: 180,
        allowVocals: true,
      },
      displayMode: "cover",
      createdAt: 100,
      updatedAt: 200,
    });
    await db.tracks.put({
      id: "trk_local",
      sessionId: "ses_local",
      title: "Reference Only",
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      status: "ready",
      durationSec: 180,
      sourcePath: "/music/reference-only.mp3",
      createdAt: 100,
      playCount: 0,
      liked: false,
      tags: [],
    });

    const plan = await buildR2ExportPlanForDrive({
      drive: ownedDrive,
      settings: settingsWithCredentials,
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_local"],
      db,
      localMedia: {
        resolve: async (track: Track) => ({
          body: {
            kind: "local-file",
            path: track.sourcePath ?? "",
            bytes: 4,
            mime: "audio/mpeg",
            sha256,
          },
          bytes: 4,
          mime: "audio/mpeg",
          sha256,
        }),
      },
    });

    expect(plan.objects.find((object) => object.kind === "media")).toMatchObject({
      body: { kind: "local-file", path: "/music/reference-only.mp3" },
      key: `objects/media/sha256-${sha256}.mp3`,
      sha256,
    });
  });

  it("attaches an observed profile ETag precondition before overwriting the remote profile", async () => {
    await seedDevice();

    const plan = await buildR2ExportPlanForDrive({
      drive: ownedDrive,
      settings: settingsWithCredentials,
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: [],
      db,
      deviceProfileBase: {
        etag: '"profile-etag-1"',
      },
    });

    expect(plan.objects.find((object) => object.kind === "device-profile")).toMatchObject({
      precondition: { ifMatch: '"profile-etag-1"' },
    });
  });

  it("publishes owner-maintained discovery indexes and references them from manifest", async () => {
    await seedDevice();
    await db.playbackAggregates.put({
      id: "dvc_1:track:trk_1",
      devicePublicId: "dvc_1",
      scope: "track",
      trackId: "trk_1",
      playCount: 1,
      listenedSec: 45,
      updatedAt: 45_000,
    });

    const plan = await buildR2ExportPlanForDrive({
      drive: ownedDrive,
      settings: { ...settingsWithCredentials, presenceEnabled: true },
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: [],
      db,
    });
    const manifest = JSON.parse(
      String(plan.objects.find((object) => object.kind === "manifest")?.body),
    );
    const presenceIndex = JSON.parse(
      String(plan.objects.find((object) => object.kind === "presence-index")?.body),
    );

    expect(plan.objects.map((object) => object.kind)).toEqual([
      "device-avatar",
      "device-profile",
      "stats-aggregate",
      "devices-index",
      "stats-index",
      "presence-index",
      "manifest",
    ]);
    expect(manifest).toMatchObject({
      devicesIndex: "devices/index.json",
      statsIndex: "stats/index.json",
      presenceIndex: "presence/index.json",
    });
    expect(presenceIndex.devices[0]).toMatchObject({
      devicePublicId: "dvc_1",
      presence: "presence/devices/dvc_1.json",
    });
  });
});

async function seedDevice() {
  await db.devices.put({
    id: "dev_local",
    publicId: "dvc_1",
    name: "Studio laptop",
    avatarSeed: "ocean-blue",
    avatarBlobId: "blb_avatar",
    platform: "browser",
    appVersion: "0.1.0",
    publishProfile: true,
    profileRevision: 2,
    createdAt: 100,
    lastSeenAt: 200,
  });
  await db.mediaBlobs.put({
    id: "blb_avatar",
    trackId: "dev_local",
    role: "avatar",
    mime: "image/png",
    bytes: 6,
    blob: new Blob(["avatar"], { type: "image/png" }),
  });
}

const ownedDrive: CloudDrive = {
  id: "drv_owned",
  label: "Owner R2",
  kind: "owned",
  provider: "r2",
  capabilities: {
    read: true,
    write: true,
    manageInvites: false,
    writeStats: true,
    writePresence: true,
  },
  createdAt: 1,
  updatedAt: 1,
};

const sharedDrive: CloudDrive = {
  ...ownedDrive,
  id: "drv_shared",
  kind: "shared",
  capabilities: {
    read: true,
    write: false,
    manageInvites: false,
    writeStats: false,
    writePresence: false,
  },
};

const settingsWithCredentials: AppSettings = {
  ...DEFAULT_SETTINGS,
  r2CredentialsByDriveId: {
    drv_owned: {
      accountId: "abc123",
      bucket: "muzero",
      accessKeyId: "key",
      secretAccessKey: "secret",
    },
  },
};
