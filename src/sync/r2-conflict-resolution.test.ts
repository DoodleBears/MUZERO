import { describe, expect, it } from "vitest";
import {
  buildConflictResolutionChoices,
  resolveUserAuthoredConflict,
} from "./r2-conflict-resolution";
import type { SetSyncIndicatorConflict } from "./r2-set-sync-indicators";

const conflict: SetSyncIndicatorConflict = {
  entityType: "track",
  entityId: "trk_blue",
  field: "title",
  reason: "local-and-remote-changed",
  mutationIds: ["mut_local_title"],
};

describe("R2 conflict resolution", () => {
  it("offers only explicit choices for user-authored set/track/memory conflicts", () => {
    expect(buildConflictResolutionChoices(conflict).map((choice) => choice.action)).toEqual([
      "keep-local",
      "use-remote",
      "duplicate-both",
    ]);
  });

  it("requires an explicit user action before resolving a user-authored conflict", () => {
    expect(() => resolveUserAuthoredConflict(conflict)).toThrow(/explicit/i);
  });

  it("keeps local mutations when the user chooses keep local", () => {
    expect(resolveUserAuthoredConflict(conflict, "keep-local")).toMatchObject({
      action: "keep-local",
      applyRemote: false,
      discardLocalMutationIds: [],
      preserveLocalMutationIds: ["mut_local_title"],
      duplicateLocal: false,
    });
  });

  it("discards local mutations only when the user chooses use remote", () => {
    expect(resolveUserAuthoredConflict(conflict, "use-remote")).toMatchObject({
      action: "use-remote",
      applyRemote: true,
      discardLocalMutationIds: ["mut_local_title"],
      preserveLocalMutationIds: [],
      duplicateLocal: false,
    });
  });

  it("preserves both sides when the user chooses duplicate both", () => {
    expect(resolveUserAuthoredConflict(conflict, "duplicate-both")).toMatchObject({
      action: "duplicate-both",
      applyRemote: true,
      discardLocalMutationIds: [],
      preserveLocalMutationIds: ["mut_local_title"],
      duplicateLocal: true,
    });
  });
});
