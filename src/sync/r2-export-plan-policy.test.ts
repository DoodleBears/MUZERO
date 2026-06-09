import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { type AppSettings, type CloudDrive, DEFAULT_SETTINGS } from "@/db/types";
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
