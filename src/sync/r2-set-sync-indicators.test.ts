import { describe, expect, it } from "vitest";
import { buildSetSyncIndicator } from "./r2-set-sync-indicators";

describe("buildSetSyncIndicator", () => {
  it("marks remote changes from pull previews", () => {
    expect(
      buildSetSyncIndicator({
        setId: "ses_1",
        pull: {
          action: "apply-remote",
          reasons: ["remote-updated"],
        },
      }),
    ).toMatchObject({
      setId: "ses_1",
      localChanges: false,
      remoteChanged: true,
      autoMerged: false,
      needsReview: false,
      flags: ["remote-changed"],
    });
  });

  it("marks unsynced local changes and auto-merged mutations", () => {
    expect(
      buildSetSyncIndicator({
        setId: "ses_1",
        unsyncedMutationCount: 2,
        appliedMutationCount: 2,
      }),
    ).toMatchObject({
      localChanges: true,
      remoteChanged: false,
      autoMerged: true,
      needsReview: false,
      flags: ["local-changes", "auto-merged"],
    });
  });

  it("marks conflicts as needing review and preserves conflict metadata", () => {
    expect(
      buildSetSyncIndicator({
        setId: "ses_1",
        pull: {
          action: "conflict",
          reasons: ["local-and-remote-changed"],
          conflict: {
            entityType: "track",
            entityId: "trk_1",
            reason: "local-and-remote-changed",
            localMutationIds: ["mut_1"],
          },
        },
        exportConflicts: [
          {
            setId: "ses_1",
            entityType: "set",
            entityId: "ses_1",
            field: "name",
            reason: "overlapping-mutations",
            mutationIds: ["mut_a", "mut_b"],
          },
        ],
      }),
    ).toMatchObject({
      localChanges: true,
      remoteChanged: true,
      needsReview: true,
      flags: ["local-changes", "remote-changed", "needs-review"],
      conflicts: [
        {
          entityType: "track",
          entityId: "trk_1",
          mutationIds: ["mut_1"],
        },
        {
          entityType: "set",
          entityId: "ses_1",
          field: "name",
          mutationIds: ["mut_a", "mut_b"],
        },
      ],
    });
  });
});
