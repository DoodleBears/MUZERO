import { describe, expect, it } from "vitest";
import {
  buildReferencedUploadedTrackInputs,
  type FolderSyncPlanInput,
  freshFilesFromPlan,
  planFolderSyncFiles,
} from "./folder-sync-core";

const media = [
  { path: "E:\\CloudMusic\\known.mp3", name: "known.mp3", kind: "audio" as const },
  { path: "E:\\CloudMusic\\recover.mp3", name: "recover.mp3", kind: "audio" as const },
  {
    path: "E:\\CloudMusic\\fresh.ncm",
    name: "fresh.ncm",
    kind: "audio" as const,
    decode: "ncm" as const,
  },
  { path: "E:\\CloudMusic\\other-set.mp3", name: "other-set.mp3", kind: "audio" as const },
];

function plan(overrides: Partial<FolderSyncPlanInput> = {}) {
  return planFolderSyncFiles({
    media,
    setId: "ses_current",
    sessionTrackIds: ["trk_known"],
    removedTrackIds: [],
    existingRefs: [
      {
        id: "trk_known",
        sessionId: "ses_current",
        sourcePath: "E:\\CloudMusic\\known.mp3",
      },
      {
        id: "trk_recover",
        sessionId: "ses_current",
        sourcePath: "E:\\CloudMusic\\recover.mp3",
      },
      {
        id: "trk_other_set",
        sessionId: "ses_other",
        sourcePath: "E:\\CloudMusic\\other-set.mp3",
      },
    ],
    ...overrides,
  });
}

describe("planFolderSyncFiles", () => {
  it("keeps only unknown files fresh and recovers unlinked same-session tracks", () => {
    const result = plan();

    expect(result.knownCount).toBe(3);
    expect(result.recoveredTrackIds).toEqual(["trk_recover"]);
    expect(result.freshIndexes).toEqual([2]);
    expect(freshFilesFromPlan(media, result).map((file) => file.path)).toEqual([
      "E:\\CloudMusic\\fresh.ncm",
    ]);
  });

  it("does not recover tombstoned tracks", () => {
    const result = plan({ removedTrackIds: ["trk_recover"] });

    expect(result.recoveredTrackIds).toEqual([]);
    expect(result.freshIndexes).toEqual([2]);
  });

  it("recovers in scanned-file order when existing refs are unordered", () => {
    const result = plan({
      media: [
        { path: "E:\\CloudMusic\\b.mp3", name: "b.mp3", kind: "audio" },
        { path: "E:\\CloudMusic\\a.mp3", name: "a.mp3", kind: "audio" },
      ],
      existingRefs: [
        { id: "trk_a", sessionId: "ses_current", sourcePath: "E:\\CloudMusic\\a.mp3" },
        { id: "trk_b", sessionId: "ses_current", sourcePath: "E:\\CloudMusic\\b.mp3" },
      ],
    });

    expect(result.recoveredTrackIds).toEqual(["trk_b", "trk_a"]);
    expect(result.freshIndexes).toEqual([]);
  });
});

describe("buildReferencedUploadedTrackInputs", () => {
  it("builds lightweight reference-only rows for plaintext files and lazy ncm placeholders", () => {
    const rows = buildReferencedUploadedTrackInputs(
      {
        setId: "ses_import",
        files: [
          { path: "E:\\CloudMusic\\plain.mp3", name: "plain.mp3", kind: "audio" },
          {
            path: "E:\\CloudMusic\\cloud.ncm",
            name: "cloud.ncm",
            kind: "audio",
            decode: "ncm",
          },
        ],
      },
      1234,
    );

    expect(rows).toMatchObject([
      {
        sessionId: "ses_import",
        title: "plain",
        kind: "audio",
        mime: "audio/mpeg",
        durationSec: 0,
        sourcePath: "E:\\CloudMusic\\plain.mp3",
        mediaMetadata: {
          originalMime: "audio/mpeg",
          originalExtension: "mp3",
          parser: "manual",
          parsedAt: 1234,
        },
      },
      {
        sessionId: "ses_import",
        title: "cloud",
        kind: "audio",
        mime: "audio/mpeg",
        durationSec: 0,
        sourcePath: "E:\\CloudMusic\\cloud.ncm",
        mediaMetadata: {
          originalMime: "audio/mpeg",
          originalExtension: "ncm",
          parser: "manual",
          parsedAt: 1234,
        },
      },
    ]);
  });
});
