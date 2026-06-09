import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { buildR2ExportPlan } from "./r2-export-plan";
import { r2EntityCoversIndexSchema, r2ManifestSchema } from "./r2-manifest-schema";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-entity-cover-sync-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

async function seedEntityCover(
  id: string,
  kind: "artist" | "album",
  blobId: string,
  updatedAt = 1000,
) {
  await db.mediaBlobs.put({
    id: blobId,
    trackId: id,
    role: "cover",
    mime: "image/jpeg",
    bytes: 1234,
    blob: new Blob(["cover-bytes"], { type: "image/jpeg" }),
  });
  await db.entityCovers.put({ id, kind, coverBlobId: blobId, updatedAt });
}

const EXPORT_INPUT = {
  driveId: "drv_1",
  libraryId: "lib_1",
  baseUrl: "https://music.example.com/muzero/",
  setIds: [] as string[],
};

describe("entity-cover R2 schema", () => {
  it("parses a library entity-covers index", () => {
    const index = r2EntityCoversIndexSchema.parse({
      schema: "muzero-r2-entity-covers-v1",
      updatedAt: 1000,
      entries: [
        {
          id: "double j 姜峰",
          kind: "artist",
          cover: {
            url: "objects/covers/sha256-abc.jpg",
            mime: "image/jpeg",
            bytes: 10,
            sha256: "abc",
          },
          crop: { x: 1, y: 2, width: 3, height: 4 },
          updatedAt: 1000,
        },
      ],
    });
    expect(index.entries[0]?.kind).toBe("artist");
  });

  it("accepts an optional entityCoversIndex on the manifest", () => {
    const manifest = r2ManifestSchema.parse({
      schema: "muzero-r2-manifest-v1",
      libraryId: "lib_1",
      title: "MUZERO Library",
      createdAt: "2026-06-10T00:00:00.000Z",
      updatedAt: "2026-06-10T00:00:00.000Z",
      baseUrl: "https://music.example.com/muzero/",
      sets: [],
      entityCoversIndex: "library/entity-covers/index.json",
    });
    expect(manifest.entityCoversIndex).toBe("library/entity-covers/index.json");
  });
});

describe("buildR2ExportPlan — entity covers", () => {
  it("exports content-addressed bytes + a library index and links the manifest", async () => {
    await seedEntityCover("taylor swift", "artist", "blb_a", 1500);
    await seedEntityCover("1989::taylor swift", "album", "blb_b", 1000);

    const plan = await buildR2ExportPlan({ ...EXPORT_INPUT, db });

    const kinds = plan.objects.map((o) => o.kind);
    expect(kinds).toContain("entity-cover");
    expect(kinds).toContain("entity-covers-index");

    const cover = plan.objects.find((o) => o.kind === "entity-cover");
    expect(cover?.key).toMatch(/^objects\/covers\/sha256-[a-f0-9]{64}\.jpg$/);

    const indexObj = plan.objects.find((o) => o.kind === "entity-covers-index");
    expect(indexObj?.key).toBe("library/entity-covers/index.json");
    const index = JSON.parse(String(indexObj?.body));
    expect(index.schema).toBe("muzero-r2-entity-covers-v1");
    expect(index.updatedAt).toBe(1500); // newest entry clock
    expect(index.entries.map((e: { id: string }) => e.id).sort()).toEqual([
      "1989::taylor swift",
      "taylor swift",
    ]);

    const manifest = JSON.parse(String(plan.objects.find((o) => o.kind === "manifest")?.body));
    expect(manifest.entityCoversIndex).toBe("library/entity-covers/index.json");
  });

  it("omits the index and manifest link when there are no entity covers", async () => {
    const plan = await buildR2ExportPlan({ ...EXPORT_INPUT, db });
    expect(plan.objects.map((o) => o.kind)).not.toContain("entity-covers-index");
    const manifest = JSON.parse(String(plan.objects.find((o) => o.kind === "manifest")?.body));
    expect(manifest.entityCoversIndex).toBeUndefined();
  });
});
