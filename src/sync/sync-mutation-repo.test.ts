import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { listUnsyncedMutations, recordSyncMutation } from "./sync-mutation-repo";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-sync-mutation-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("sync mutation repository", () => {
  it("records local mutations with their observed remote base", async () => {
    const mutation = await recordSyncMutation(
      {
        driveId: "drv_1",
        devicePublicId: "dvc_1",
        scope: "set",
        entityId: "ses_1",
        action: "set-metadata-updated",
        base: {
          remoteKey: "sets/ses_1/index.json",
          etag: '"abc"',
          revision: 3,
          updatedAt: 1000,
        },
        payload: { name: "Renamed" },
        now: 2000,
      },
      db,
    );

    expect(mutation.id).toMatch(/^mut_/);
    expect(await listUnsyncedMutations("drv_1", db)).toMatchObject([
      {
        id: mutation.id,
        entityId: "ses_1",
        syncedAt: undefined,
      },
    ]);
  });
});
