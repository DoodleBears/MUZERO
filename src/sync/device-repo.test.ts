import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { getLocalDevice, getOrCreateLocalDevice, updateLocalDeviceProfile } from "./device-repo";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-device-repo-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("device repository", () => {
  it("creates one stable anonymous local device per app profile", async () => {
    const first = await getOrCreateLocalDevice(
      {
        now: 1000,
        publicIdFactory: () => "dvc_test",
        platform: "browser",
        appVersion: "0.1.0",
      },
      db,
    );
    const second = await getOrCreateLocalDevice(
      {
        now: 2000,
        publicIdFactory: () => "dvc_other",
        platform: "tauri",
        appVersion: "0.1.1",
      },
      db,
    );

    expect(first.publicId).toBe("dvc_test");
    expect(second.publicId).toBe("dvc_test");
    expect(second.lastSeenAt).toBe(2000);
    expect(await db.devices.count()).toBe(1);
  });

  it("updates display name and avatar seed without changing public id", async () => {
    const device = await getOrCreateLocalDevice(
      {
        now: 1000,
        publicIdFactory: () => "dvc_test",
        platform: "browser",
        appVersion: "0.1.0",
      },
      db,
    );

    const updated = await updateLocalDeviceProfile(
      {
        name: "Mac desktop",
        avatarSeed: "ocean-blue",
        now: 2000,
      },
      db,
    );

    expect(updated).toMatchObject({
      id: device.id,
      publicId: "dvc_test",
      name: "Mac desktop",
      avatarSeed: "ocean-blue",
      profileRevision: 2,
      lastSeenAt: 2000,
    });
  });

  it("reads the local device without touching lastSeenAt", async () => {
    await getOrCreateLocalDevice(
      {
        now: 1000,
        publicIdFactory: () => "dvc_test",
        platform: "browser",
      },
      db,
    );

    expect(await getLocalDevice(db)).toMatchObject({
      publicId: "dvc_test",
      lastSeenAt: 1000,
    });
  });

  it("keeps the previous display name when the profile form submits a blank value", async () => {
    await getOrCreateLocalDevice(
      {
        now: 1000,
        publicIdFactory: () => "dvc_test",
        platform: "browser",
      },
      db,
    );
    await updateLocalDeviceProfile({ name: "Studio laptop", avatarSeed: "violet", now: 2000 }, db);

    const updated = await updateLocalDeviceProfile({ name: "   ", avatarSeed: "", now: 3000 }, db);

    expect(updated).toMatchObject({
      name: "Studio laptop",
      avatarSeed: "violet",
      profileRevision: 3,
      lastSeenAt: 3000,
    });
  });
});
