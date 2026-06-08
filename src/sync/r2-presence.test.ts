import { describe, expect, it } from "vitest";
import { type CloudDrive, DEFAULT_SETTINGS } from "@/db/types";
import {
  canWritePresenceToDrive,
  filterActivePresence,
  presenceObjectKey,
  r2PresenceSchema,
  shouldWritePresence,
  toR2Presence,
} from "./r2-presence";

describe("r2 presence schema", () => {
  it("validates a low-frequency now-playing object", () => {
    const presence = toR2Presence({
      devicePublicId: "dvc_1",
      deviceName: "Mac",
      trackId: "trk_1",
      setId: "ses_1",
      state: "playing",
      positionSec: 12,
      now: 1000,
      ttlMs: 120_000,
    });

    expect(r2PresenceSchema.parse(presence)).toMatchObject({
      schema: "muzero-r2-presence-v1",
      devicePublicId: "dvc_1",
      expiresAt: 121000,
    });
    expect(presenceObjectKey("dvc_1")).toBe("presence/devices/dvc_1.json");
  });

  it("filters expired presence rows", () => {
    expect(
      filterActivePresence(
        [
          toR2Presence({
            devicePublicId: "dvc_live",
            state: "playing",
            now: 20_000,
            ttlMs: 60_000,
          }),
          toR2Presence({
            devicePublicId: "dvc_old",
            state: "playing",
            now: 1000,
            ttlMs: 60_000,
          }),
        ],
        70_000,
      ).map((presence) => presence.devicePublicId),
    ).toEqual(["dvc_live"]);
  });
});

describe("presence write policy", () => {
  it("throttles unchanged heartbeat writes to at most once per minute", () => {
    const last = toR2Presence({
      devicePublicId: "dvc_1",
      trackId: "trk_1",
      state: "playing",
      now: 1000,
      ttlMs: 120_000,
    });

    expect(
      shouldWritePresence(last, {
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        state: "playing",
        now: 30_000,
      }),
    ).toBe(false);
    expect(
      shouldWritePresence(last, {
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        state: "playing",
        now: 61_000,
      }),
    ).toBe(true);
  });

  it("allows immediate writes on track or state changes", () => {
    const last = toR2Presence({
      devicePublicId: "dvc_1",
      trackId: "trk_1",
      state: "playing",
      now: 1000,
      ttlMs: 120_000,
    });

    expect(
      shouldWritePresence(last, {
        devicePublicId: "dvc_1",
        trackId: "trk_2",
        state: "playing",
        now: 10_000,
      }),
    ).toBe(true);
    expect(
      shouldWritePresence(last, {
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        state: "paused",
        now: 10_000,
      }),
    ).toBe(true);
  });

  it("requires an owner/trusted drive with presence write capability and enabled setting", () => {
    const drive: CloudDrive = {
      id: "drv_1",
      label: "R2",
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

    expect(canWritePresenceToDrive({ ...DEFAULT_SETTINGS, presenceEnabled: false }, drive)).toBe(
      false,
    );
    expect(canWritePresenceToDrive({ ...DEFAULT_SETTINGS, presenceEnabled: true }, drive)).toBe(
      true,
    );
    expect(
      canWritePresenceToDrive(
        { ...DEFAULT_SETTINGS, presenceEnabled: true },
        {
          ...drive,
          kind: "shared",
        },
      ),
    ).toBe(false);
  });
});
