import { describe, expect, it } from "vitest";
import type { DevicePublicProfile, DeviceRecord } from "@/db/types";
import { decideDeviceProfileMerge } from "./r2-profile-conflict";

describe("decideDeviceProfileMerge", () => {
  it("uses the higher remote profile revision automatically", () => {
    expect(
      decideDeviceProfileMerge(localDevice({ profileRevision: 1 }), remoteProfile({ revision: 2 })),
    ).toMatchObject({
      action: "use-remote",
      reason: "remote-revision-newer",
    });
  });

  it("keeps local profile when the local revision is newer", () => {
    expect(
      decideDeviceProfileMerge(localDevice({ profileRevision: 3 }), remoteProfile({ revision: 2 })),
    ).toMatchObject({
      action: "keep-local",
      reason: "local-revision-newer",
    });
  });

  it("requires explicit user choice when the same revision has different user-authored fields", () => {
    expect(
      decideDeviceProfileMerge(
        localDevice({ profileRevision: 2, name: "Studio Mac" }),
        remoteProfile({ revision: 2, displayName: "Phone" }),
      ),
    ).toMatchObject({
      action: "needs-review",
      reason: "same-revision-different-profile",
      conflicts: ["displayName"],
    });
  });

  it("treats identical same-revision profiles as unchanged", () => {
    expect(
      decideDeviceProfileMerge(
        localDevice({ profileRevision: 2, name: "Studio Mac", avatarSeed: "blue" }),
        remoteProfile({ revision: 2, displayName: "Studio Mac", avatarSeed: "blue" }),
      ),
    ).toMatchObject({
      action: "unchanged",
      reason: "same-revision-same-profile",
    });
  });
});

function localDevice(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: "dev_local",
    publicId: "dvc_1",
    name: "Studio Mac",
    avatarSeed: "blue",
    platform: "browser",
    appVersion: "0.1.0",
    publishProfile: true,
    profileRevision: 1,
    createdAt: 100,
    lastSeenAt: 200,
    ...overrides,
  };
}

function remoteProfile(overrides: Partial<DevicePublicProfile> = {}): DevicePublicProfile {
  return {
    schema: "muzero-r2-device-profile-v1",
    devicePublicId: "dvc_1",
    displayName: "Studio Mac",
    avatarSeed: "blue",
    appVersion: "0.1.0",
    revision: 1,
    updatedAt: 300,
    ...overrides,
  };
}
