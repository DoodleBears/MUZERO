import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { TraceEntry } from "@/lib/trace";
import {
  appendTraceArchiveEntries,
  clearTraceArchive,
  createTraceArchive,
  exportTraceArchiveJsonl,
  isTraceArchiveEnabled,
  readTraceArchiveEntries,
  setTraceArchiveEnabled,
} from "./trace-archive";

const dbName = "muzero-trace-archive-test";

describe("trace archive", () => {
  afterEach(async () => {
    await clearTraceArchive(createTraceArchive({ dbName }));
    await deleteDb(dbName);
    window.localStorage.clear();
  });

  it("keeps archive persistence disabled until explicitly enabled", () => {
    expect(isTraceArchiveEnabled()).toBe(false);

    setTraceArchiveEnabled(true);

    expect(isTraceArchiveEnabled()).toBe(true);
  });

  it("stores entries and prunes by count", async () => {
    const archive = createTraceArchive({
      dbName,
      maxEntries: 2,
      maxAgeMs: 60_000,
      now: () => 3_000,
    });

    await appendTraceArchiveEntries([entry(1), entry(2), entry(3)], archive);

    const rows = await readTraceArchiveEntries(archive);
    expect(rows.map((row) => row.message)).toEqual(["entry 2", "entry 3"]);
  });

  it("prunes old entries by age", async () => {
    const archive = createTraceArchive({
      dbName,
      maxEntries: 10,
      maxAgeMs: 1_000,
      now: () => 5_000,
    });

    await appendTraceArchiveEntries([entry(1, 3_000), entry(2, 4_500)], archive);

    const rows = await readTraceArchiveEntries(archive);
    expect(rows.map((row) => row.message)).toEqual(["entry 2"]);
  });

  it("clears archived entries", async () => {
    const archive = createTraceArchive({ dbName, now: () => 1_000 });
    await appendTraceArchiveEntries([entry(1)], archive);

    await clearTraceArchive(archive);

    await expect(readTraceArchiveEntries(archive)).resolves.toEqual([]);
  });

  it("exports redacted jsonl with metadata", async () => {
    const archive = createTraceArchive({ dbName, now: () => 1_000 });
    await appendTraceArchiveEntries(
      [
        {
          ...entry(1),
          context: {
            category: "network",
            url: "https://rr.example.com/videoplayback?sig=secret&itag=140",
            cookie: "secret-cookie",
          },
        },
      ],
      archive,
    );

    const jsonl = await exportTraceArchiveJsonl(archive, {
      appVersion: "1.2.3",
      gitSha: "abc123",
      platform: "test",
    });

    const lines = jsonl
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ kind: "metadata", appVersion: "1.2.3" });
    expect(lines[1]).toMatchObject({ kind: "trace", entry: { message: "entry 1" } });
    expect(jsonl).not.toContain("secret");
    expect(jsonl).not.toContain("sig=secret");
    expect(jsonl).toContain("[redacted:cookie]");
  });
});

function entry(id: number, at = id * 1_000): TraceEntry {
  return {
    id,
    at,
    level: "info",
    scope: "test.scope",
    event: "test.event",
    message: `entry ${id}`,
    context: { category: "app", traceId: "trc_1" },
  };
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
