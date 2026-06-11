import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES,
  type MediaStorageProvider,
} from "@/db/media-blob-storage";
import { MuzeroDB } from "@/db/muzero-db";
import {
  getLocalDevice,
  getOrCreateLocalDevice,
  setLocalDeviceAvatar,
  updateLocalDeviceProfile,
} from "./device-repo";

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

function createMemoryProvider(id: "opfs" | "electron-file" = "opfs") {
  const files = new Map<string, Blob>();
  const provider: MediaStorageProvider & { files: Map<string, Blob> } = {
    id,
    userVisible: id === "electron-file",
    files,
    async put(input) {
      const storageKey = `avatar/${input.suggestedName ?? input.id}`;
      files.set(storageKey, input.blob);
      return { storageKey };
    },
    async get(input) {
      return input.storageKey ? (files.get(input.storageKey) ?? null) : null;
    },
    async delete(input) {
      if (input.storageKey) files.delete(input.storageKey);
    },
  };
  return provider;
}

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

  it("creates a conflict-free default display name for the local device", async () => {
    await db.devices.bulkPut([
      {
        id: "dev_remote_1",
        publicId: "dvc_remote_1",
        name: "Browser",
        platform: "browser",
        appVersion: "0.1.0",
        publishProfile: false,
        profileRevision: 1,
        createdAt: 900,
        lastSeenAt: 900,
      },
      {
        id: "dev_remote_2",
        publicId: "dvc_remote_2",
        name: "browser 2",
        platform: "browser",
        appVersion: "0.1.0",
        publishProfile: false,
        profileRevision: 1,
        createdAt: 950,
        lastSeenAt: 950,
      },
    ]);

    const device = await getOrCreateLocalDevice(
      {
        now: 1000,
        publicIdFactory: () => "dvc_test",
        platform: "browser",
      },
      db,
    );

    expect(device.name).toBe("Browser 3");
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

  it("stores an uploaded avatar as a device-bound media blob", async () => {
    await getOrCreateLocalDevice(
      {
        now: 1000,
        publicIdFactory: () => "dvc_test",
        platform: "browser",
      },
      db,
    );
    const blob = new Blob(["avatar-bytes"], { type: "image/png" });

    const updated = await setLocalDeviceAvatar({ blob, mime: "image/png", now: 2000 }, db);

    expect(updated.avatarBlobId).toMatch(/^blb_/);
    expect(updated.profileRevision).toBe(2);
    expect(updated.lastSeenAt).toBe(2000);
    const media = await db.mediaBlobs.get(updated.avatarBlobId ?? "");
    expect(media).toMatchObject({
      trackId: updated.id,
      role: "avatar",
      mime: "image/png",
      bytes: blob.size,
    });
    expect(media?.blob).toBeDefined();
  });

  it("stores large uploaded avatars through provider storage", async () => {
    await getOrCreateLocalDevice(
      {
        now: 1000,
        publicIdFactory: () => "dvc_test",
        platform: "browser",
      },
      db,
    );
    const provider = createMemoryProvider("opfs");
    const blob = new Blob([new Uint8Array(LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES)], {
      type: "image/png",
    });

    const updated = await setLocalDeviceAvatar({ blob, mime: "image/png", now: 2000 }, db, {
      provider,
    });

    const media = await db.mediaBlobs.get(updated.avatarBlobId ?? "");
    expect(media).toMatchObject({
      trackId: updated.id,
      role: "avatar",
      storageBackend: "opfs",
      blob: undefined,
    });
    expect(provider.files.has(media?.storageKey ?? "")).toBe(true);
  });
});
