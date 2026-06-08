import { describe, expect, it } from "vitest";
import type { AppSettings, CloudDrive, DeviceRecord } from "@/db/types";
import { DEFAULT_SETTINGS } from "@/db/types";
import { canPublishDeviceProfileToDrive, canWriteStatsToDrive } from "./r2-stats-policy";

const ownedDrive: CloudDrive = {
  id: "drv_owned",
  label: "Owner R2",
  kind: "owned",
  provider: "r2",
  capabilities: {
    read: true,
    write: true,
    manageInvites: false,
    writeStats: true,
    writePresence: true,
  },
  createdAt: 1,
  updatedAt: 1,
};

const trustedDrive: CloudDrive = {
  ...ownedDrive,
  id: "drv_trusted",
  kind: "trusted",
};

const sharedDrive: CloudDrive = {
  ...ownedDrive,
  id: "drv_shared",
  kind: "shared",
  capabilities: {
    read: true,
    write: false,
    manageInvites: false,
    writeStats: false,
    writePresence: false,
  },
};

const settingsWithCredentials: AppSettings = {
  ...DEFAULT_SETTINGS,
  r2CredentialsByDriveId: {
    drv_owned: {
      accountId: "abc123",
      bucket: "muzero",
      accessKeyId: "key",
      secretAccessKey: "secret",
    },
    drv_trusted: {
      accountId: "abc123",
      bucket: "muzero",
      accessKeyId: "trusted",
      secretAccessKey: "secret",
    },
  },
};

const publishingDevice: DeviceRecord = {
  id: "dev_local",
  publicId: "dvc_1",
  name: "Studio laptop",
  platform: "browser",
  appVersion: "0.1.0",
  publishProfile: true,
  profileRevision: 1,
  createdAt: 1,
  lastSeenAt: 2,
};

describe("r2 stats/profile write policy", () => {
  it("allows stats writes only to owner/trusted drives with write credentials", () => {
    expect(canWriteStatsToDrive(settingsWithCredentials, ownedDrive)).toBe(true);
    expect(canWriteStatsToDrive(settingsWithCredentials, trustedDrive)).toBe(true);
    expect(canWriteStatsToDrive(settingsWithCredentials, sharedDrive)).toBe(false);
    expect(canWriteStatsToDrive(DEFAULT_SETTINGS, ownedDrive)).toBe(false);
    expect(
      canWriteStatsToDrive(settingsWithCredentials, {
        ...ownedDrive,
        capabilities: { ...ownedDrive.capabilities, writeStats: false },
      }),
    ).toBe(false);
  });

  it("keeps read-only shared-link stats local even when another drive has credentials", () => {
    expect(canWriteStatsToDrive(settingsWithCredentials, sharedDrive)).toBe(false);
  });

  it("publishes device profiles only when the device opts in and the target is writable", () => {
    expect(
      canPublishDeviceProfileToDrive(publishingDevice, settingsWithCredentials, ownedDrive),
    ).toBe(true);
    expect(
      canPublishDeviceProfileToDrive(
        { ...publishingDevice, publishProfile: false },
        settingsWithCredentials,
        ownedDrive,
      ),
    ).toBe(false);
    expect(
      canPublishDeviceProfileToDrive(publishingDevice, settingsWithCredentials, sharedDrive),
    ).toBe(false);
  });
});
