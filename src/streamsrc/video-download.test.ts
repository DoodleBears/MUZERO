import { describe, expect, it, vi } from "vitest";
import type { DownloadPlan } from "./download-plan";
import type { PlayableStream, PlayableVideoTrack } from "./provider";
import { type RunVideoDownloadDeps, runVideoDownload } from "./video-download";

const VIDEO: PlayableVideoTrack = {
  url: "https://cdn/v.m4s",
  headers: { Referer: "https://www.bilibili.com" },
  mime: "video/mp4",
  codec: "avc",
  height: 1080,
};
const AUDIO: PlayableStream = { mediaUrl: "https://cdn/a.m4s", mime: "audio/mp4" };
const COPY_MP4_PLAN: DownloadPlan = {
  video: VIDEO,
  audio: AUDIO,
  strategy: { kind: "copy", container: "mp4" },
};

function deps(over: Partial<RunVideoDownloadDeps> = {}): RunVideoDownloadDeps {
  return {
    resolvePlan: async () => ({ kind: "ok", plan: COPY_MP4_PLAN }),
    fetchBytes: async () => new Blob([new Uint8Array(10)]),
    mux: async () => new Blob([new Uint8Array(30)], { type: "video/mp4" }),
    store: async () => ({ blobId: "blb_1", storageKey: "media/blb_1" }),
    ...over,
  };
}

describe("runVideoDownload", () => {
  it("fetches both tracks, muxes, stores, and reports a downloaded verdict", async () => {
    const onProgress = vi.fn();
    const fetchBytes = vi.fn(async () => new Blob([new Uint8Array(10)]));
    const mux = vi.fn(async () => new Blob([new Uint8Array(30)], { type: "video/mp4" }));
    const res = await runVideoDownload(deps({ fetchBytes, mux, onProgress }));
    expect(res).toEqual({
      kind: "downloaded",
      blobId: "blb_1",
      storageKey: "media/blb_1",
      bytes: 30,
      height: 1080,
    });
    // both video + audio fetched, with their headers
    expect(fetchBytes).toHaveBeenCalledTimes(2);
    expect(fetchBytes).toHaveBeenCalledWith("https://cdn/v.m4s", VIDEO.headers);
    expect(fetchBytes).toHaveBeenCalledWith("https://cdn/a.m4s", undefined);
    expect(mux).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith("store", 1);
  });

  it("stores with a container-derived mime (mp4/webm/mkv)", async () => {
    const store = vi.fn(async () => ({ blobId: "blb_1" }));
    await runVideoDownload(deps({ store }));
    expect(store).toHaveBeenCalledWith(expect.any(Blob), "video/mp4");

    const webm = vi.fn(async () => ({ blobId: "b" }));
    await runVideoDownload(
      deps({
        store: webm,
        resolvePlan: async () => ({
          kind: "ok",
          plan: { ...COPY_MP4_PLAN, strategy: { kind: "copy", container: "webm" } },
        }),
      }),
    );
    expect(webm).toHaveBeenCalledWith(expect.any(Blob), "video/webm");
  });

  it("propagates a login wall as requires-login (no fetch/mux/store)", async () => {
    const fetchBytes = vi.fn();
    const res = await runVideoDownload(
      deps({ fetchBytes, resolvePlan: async () => ({ kind: "requires-login" }) }),
    );
    expect(res).toEqual({ kind: "requires-login" });
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it("propagates a VIP/permission wall", async () => {
    const res = await runVideoDownload(
      deps({ resolvePlan: async () => ({ kind: "no-permission", reason: "vip" }) }),
    );
    expect(res).toEqual({ kind: "no-permission", reason: "vip" });
  });

  it("returns error when the strategy is unsupported (force mp4, no transcode)", async () => {
    const res = await runVideoDownload(
      deps({
        resolvePlan: async () => ({
          kind: "ok",
          plan: {
            ...COPY_MP4_PLAN,
            strategy: { kind: "unsupported", reason: "no encoder" },
          },
        }),
      }),
    );
    expect(res.kind).toBe("error");
  });

  it("never throws — fetch/mux failures become an error verdict", async () => {
    const boom = deps({
      fetchBytes: async () => {
        throw new Error("network down");
      },
    });
    const res = await runVideoDownload(boom);
    expect(res).toEqual({ kind: "error", message: "network down" });

    const muxBoom = deps({
      mux: async () => {
        throw new Error("mux failed");
      },
    });
    expect((await runVideoDownload(muxBoom)).kind).toBe("error");
  });
});
