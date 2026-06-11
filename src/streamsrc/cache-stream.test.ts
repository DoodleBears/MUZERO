import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTrace, getTraceEntries } from "@/lib/trace";
import { runStreamCache } from "./cache-stream";
import type { StreamPlaybackResult } from "./resolve-playback";

const ok: StreamPlaybackResult = {
  kind: "ok",
  url: "https://cdn/song.mp3",
  mime: "audio/mpeg",
  headers: { Referer: "https://music.163.com" },
};

describe("runStreamCache", () => {
  afterEach(() => {
    clearTrace();
    vi.restoreAllMocks();
  });

  it("resolves, downloads, stores, and reports the cached blob", async () => {
    const blob = new Blob([new Uint8Array(2048)], { type: "audio/mpeg" });
    const fetchBytes = vi.fn(async () => blob);
    const store = vi.fn(async () => "blb_1");
    const res = await runStreamCache({ resolve: async () => ok, fetchBytes, store });

    expect(res).toEqual({ kind: "cached", blobId: "blb_1", bytes: 2048 });
    expect(fetchBytes).toHaveBeenCalledWith("https://cdn/song.mp3", ok.headers);
    expect(store).toHaveBeenCalledWith(blob, "audio/mpeg");
  });

  it("does not download/store a login- or VIP-gated track", async () => {
    const fetchBytes = vi.fn();
    const store = vi.fn();
    expect(
      await runStreamCache({
        resolve: async () => ({ kind: "requires-login", source: "netease" }),
        fetchBytes,
        store,
      }),
    ).toEqual({ kind: "requires-login" });
    expect(
      await runStreamCache({
        resolve: async () => ({ kind: "no-permission", source: "netease", reason: "vip" }),
        fetchBytes,
        store,
      }),
    ).toEqual({ kind: "no-permission", reason: "vip" });
    expect(fetchBytes).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });

  it("reports an error when resolve or download throws (nothing stored)", async () => {
    const store = vi.fn();
    expect(
      await runStreamCache({
        resolve: async () => {
          throw new Error("network down");
        },
        fetchBytes: vi.fn(),
        store,
      }),
    ).toEqual({ kind: "error", message: "network down" });

    expect(
      await runStreamCache({
        resolve: async () => ok,
        fetchBytes: async () => {
          throw new Error("403");
        },
        store,
      }),
    ).toEqual({ kind: "error", message: "403" });
    expect(store).not.toHaveBeenCalled();
  });

  it("falls back to the blob's mime when the resolve omits it", async () => {
    const blob = new Blob([new Uint8Array(10)], { type: "audio/flac" });
    const store = vi.fn(async () => "blb_2");
    await runStreamCache({
      resolve: async () => ({ kind: "ok", url: "u", mime: "" }),
      fetchBytes: async () => blob,
      store,
    });
    expect(store).toHaveBeenCalledWith(blob, "audio/flac");
  });

  it("emits structured trace events for cache success and download failure", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const blob = new Blob([new Uint8Array(12)], { type: "audio/mpeg" });

    await runStreamCache({
      resolve: async () => ok,
      fetchBytes: async () => blob,
      store: async () => "blb_1",
      trace: { traceId: "ply_1", trackId: "trk_1" },
    });
    await runStreamCache({
      resolve: async () => ok,
      fetchBytes: async () => {
        throw new Error("403");
      },
      store: vi.fn(),
      trace: { traceId: "ply_2", trackId: "trk_2" },
    });

    expect(getTraceEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          scope: "stream.cache",
          event: "cache.start",
          context: expect.objectContaining({
            traceId: "ply_1",
            trackId: "trk_1",
            category: "cache",
            phase: "start",
          }),
        }),
        expect.objectContaining({
          level: "info",
          scope: "stream.cache",
          event: "cache.success",
          context: expect.objectContaining({
            traceId: "ply_1",
            trackId: "trk_1",
            bytes: 12,
            mime: "audio/mpeg",
          }),
        }),
        expect.objectContaining({
          level: "error",
          scope: "stream.cache",
          event: "cache.failed",
          context: expect.objectContaining({
            traceId: "ply_2",
            trackId: "trk_2",
            category: "cache",
            phase: "fail",
            errorKind: "network_error",
          }),
        }),
      ]),
    );
  });
});
