import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/db/types";
import {
  buildOwnedR2Drive,
  getR2CredentialsForDrive,
  saveR2CredentialsForDrive,
} from "./cloud-drive-settings";

describe("cloud drive settings helpers", () => {
  it("builds an owned R2 drive without embedding credentials", () => {
    const drive = buildOwnedR2Drive({
      id: "drv_1",
      label: "Personal R2",
      manifestUrl: "https://music.example.com/muzero/manifest.json",
      publicBaseUrl: "https://music.example.com/muzero/",
      now: 1000,
    });

    expect(drive).toMatchObject({
      id: "drv_1",
      label: "Personal R2",
      kind: "owned",
      provider: "r2",
      manifestUrl: "https://music.example.com/muzero/manifest.json",
      publicBaseUrl: "https://music.example.com/muzero/",
      capabilities: {
        read: true,
        write: true,
        manageInvites: false,
        writeStats: true,
        writePresence: true,
      },
    });
    expect(JSON.stringify(drive)).not.toContain("secret");
  });

  it("stores R2 credentials only under local AppSettings", () => {
    const patch = saveR2CredentialsForDrive(DEFAULT_SETTINGS, "drv_1", {
      accountId: "abc123",
      bucket: "muzero",
      accessKeyId: "key",
      secretAccessKey: "secret",
      prefix: "library",
    });
    const next = { ...DEFAULT_SETTINGS, ...patch };

    expect(next.defaultCloudDriveId).toBe("drv_1");
    expect(next.r2CredentialsByDriveId?.drv_1?.secretAccessKey).toBe("secret");
    expect(getR2CredentialsForDrive(next, "drv_1")).toMatchObject({
      accountId: "abc123",
      bucket: "muzero",
      prefix: "library",
    });
  });

  it("preserves existing drive credentials while updating one drive", () => {
    const current = {
      ...DEFAULT_SETTINGS,
      r2CredentialsByDriveId: {
        drv_old: {
          accountId: "old",
          bucket: "old-bucket",
          accessKeyId: "old-key",
          secretAccessKey: "old-secret",
        },
      },
    };

    const patch = saveR2CredentialsForDrive(current, "drv_new", {
      accountId: "new",
      bucket: "new-bucket",
      accessKeyId: "new-key",
      secretAccessKey: "new-secret",
    });
    const next = { ...current, ...patch };

    expect(Object.keys(next.r2CredentialsByDriveId ?? {}).sort()).toEqual(["drv_new", "drv_old"]);
  });
});
