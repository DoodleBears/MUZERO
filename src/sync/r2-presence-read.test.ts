import { describe, expect, it } from "vitest";
import { readRemotePresence } from "./r2-presence-read";
import type { SyncFetch } from "./r2-subscription";

const BASE = "https://drive.example.com/muzero/";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fetchMap(entries: Record<string, unknown | "missing">): SyncFetch {
  return async (input) => {
    const hit = entries[String(input)];
    if (hit === undefined || hit === "missing") return new Response("nope", { status: 404 });
    return jsonResponse(hit);
  };
}

const presenceIndex = {
  schema: "muzero-r2-presence-index-v1",
  updatedAt: 1780944000000,
  devices: [
    {
      devicePublicId: "dvc_a",
      presence: "presence/devices/dvc_a.json",
      updatedAt: 1780944000000,
    },
    {
      devicePublicId: "dvc_b",
      presence: "presence/devices/dvc_b.json",
      updatedAt: 1780944000000,
    },
  ],
};

function presence(devicePublicId: string, trackId: string) {
  return {
    schema: "muzero-r2-presence-v1",
    devicePublicId,
    deviceName: `${devicePublicId} phone`,
    trackId,
    setId: "ses_x",
    state: "playing",
    positionSec: 12,
    updatedAt: 1780944000000,
    expiresAt: 1780944120000,
  };
}

describe("readRemotePresence", () => {
  it("reads the presence index and resolves each device's presence object", async () => {
    const rows = await readRemotePresence(
      { baseUrl: BASE },
      {
        fetcher: fetchMap({
          "https://drive.example.com/muzero/presence/index.json": presenceIndex,
          "https://drive.example.com/muzero/presence/devices/dvc_a.json": presence(
            "dvc_a",
            "trk_1",
          ),
          "https://drive.example.com/muzero/presence/devices/dvc_b.json": presence(
            "dvc_b",
            "trk_2",
          ),
        }),
      },
    );

    expect(rows.map((row) => row.devicePublicId)).toEqual(["dvc_a", "dvc_b"]);
    expect(rows[0]).toMatchObject({
      trackId: "trk_1",
      state: "playing",
      deviceName: "dvc_a phone",
    });
  });

  it("returns an empty list when the presence index is missing", async () => {
    const rows = await readRemotePresence({ baseUrl: BASE }, { fetcher: fetchMap({}) });
    expect(rows).toEqual([]);
  });

  it("skips missing or invalid per-device presence objects without throwing", async () => {
    const rows = await readRemotePresence(
      { baseUrl: BASE },
      {
        fetcher: fetchMap({
          "https://drive.example.com/muzero/presence/index.json": presenceIndex,
          "https://drive.example.com/muzero/presence/devices/dvc_a.json": presence(
            "dvc_a",
            "trk_1",
          ),
          // dvc_b is present in the index but its object is malformed.
          "https://drive.example.com/muzero/presence/devices/dvc_b.json": { schema: "wrong" },
        }),
      },
    );

    expect(rows.map((row) => row.devicePublicId)).toEqual(["dvc_a"]);
  });

  it("honors a custom presence index path from the manifest", async () => {
    const rows = await readRemotePresence(
      { baseUrl: BASE, presenceIndexPath: "p/idx.json" },
      {
        fetcher: fetchMap({
          "https://drive.example.com/muzero/p/idx.json": presenceIndex,
          "https://drive.example.com/muzero/presence/devices/dvc_a.json": presence(
            "dvc_a",
            "trk_1",
          ),
          "https://drive.example.com/muzero/presence/devices/dvc_b.json": presence(
            "dvc_b",
            "trk_2",
          ),
        }),
      },
    );
    expect(rows).toHaveLength(2);
  });
});
