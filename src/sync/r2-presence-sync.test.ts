import { describe, expect, it } from "vitest";
import type { AppSettings, CloudDrive } from "@/db/types";
import { DEFAULT_SETTINGS } from "@/db/types";
import { toR2Presence } from "./r2-presence";
import { writeR2Presence } from "./r2-presence-sync";
import type { SyncFetch } from "./r2-subscription";

const ownedPresenceDrive: CloudDrive = {
  id: "drv_1",
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

const settingsWithCredentials: AppSettings = {
  ...DEFAULT_SETTINGS,
  presenceEnabled: true,
  r2CredentialsByDriveId: {
    drv_1: {
      accountId: "abc123",
      bucket: "muzero",
      accessKeyId: "key",
      secretAccessKey: "secret",
      prefix: "library",
    },
  },
};

describe("writeR2Presence", () => {
  it("writes a signed per-device presence object to R2", async () => {
    const seen: Array<{ method: string; url: string; body: string; contentType: string | null }> =
      [];
    const fetcher: SyncFetch = async (url, init) => {
      seen.push({
        method: init?.method ?? "GET",
        url: String(url),
        body: String(init?.body),
        contentType: new Headers(init?.headers).get("content-type"),
      });
      return new Response(null, { status: 204 });
    };

    const result = await writeR2Presence({
      settings: settingsWithCredentials,
      drive: ownedPresenceDrive,
      presence: toR2Presence({
        devicePublicId: "dvc_1",
        deviceName: "Studio",
        trackId: "trk_1",
        setId: "ses_1",
        state: "playing",
        positionSec: 12.3,
        now: 1000,
      }),
      fetcher,
      now: () => new Date("2026-06-09T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      key: "presence/devices/dvc_1.json",
      status: 204,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: "PUT",
      url: "https://abc123.r2.cloudflarestorage.com/muzero/library/presence/devices/dvc_1.json",
      contentType: "application/json",
    });
    expect(JSON.parse(seen[0]?.body ?? "{}")).toMatchObject({
      schema: "muzero-r2-presence-v1",
      devicePublicId: "dvc_1",
      state: "playing",
      positionSec: 12,
    });
  });

  it("refuses to write without owner/trusted presence permission and credentials", async () => {
    const fetcher: SyncFetch = async () => {
      throw new Error("fetch should not be called");
    };

    await expect(
      writeR2Presence({
        settings: { ...settingsWithCredentials, presenceEnabled: false },
        drive: ownedPresenceDrive,
        presence: toR2Presence({ devicePublicId: "dvc_1", state: "stopped", now: 1000 }),
        fetcher,
      }),
    ).rejects.toThrow(/not allowed/i);

    await expect(
      writeR2Presence({
        settings: { ...DEFAULT_SETTINGS, presenceEnabled: true },
        drive: ownedPresenceDrive,
        presence: toR2Presence({ devicePublicId: "dvc_1", state: "stopped", now: 1000 }),
        fetcher,
      }),
    ).rejects.toThrow(/credentials/i);
  });
});
