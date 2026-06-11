import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaStorageProvider } from "@/db/media-blob-storage";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession, createUploadedTrack, prependTrackIds } from "@/db/repositories";
import { buildR2ExportPlan } from "./r2-export-plan";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-r2-export-provider-media-${crypto.randomUUID()}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("buildR2ExportPlan provider-backed media", () => {
  it("reads provider-backed track media when creating binary upload objects", async () => {
    const provider = createMemoryProvider("opfs");
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "OPFS Song",
        kind: "audio",
        blob: new Blob(["provider-bytes"], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
        durationSec: 12,
      },
      db,
      { provider },
    );
    await prependTrackIds(session.id, [track.id], db);

    const plan = await buildR2ExportPlan({
      driveId: "drv_local",
      libraryId: "lib_local",
      baseUrl: "https://music.example.com/muzero/",
      setIds: [session.id],
      db,
      mediaStorage: { providers: [provider] },
    });

    const media = plan.objects.find((object) => object.kind === "media");
    expect(media).toBeTruthy();
    expect(media?.contentType).toBe("audio/mpeg");
    await expect((media?.body as Blob).text()).resolves.toBe("provider-bytes");
  });
});

function createMemoryProvider(id: "opfs" | "electron-file") {
  const files = new Map<string, Blob>();
  const provider: MediaStorageProvider = {
    id,
    userVisible: id === "electron-file",
    async put(input) {
      const storageKey = `media/${input.id}`;
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
