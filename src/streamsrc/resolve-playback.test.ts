import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTrace, getTraceEntries } from "@/lib/trace";
import type { StreamResolveResult, StreamSourceProvider } from "./provider";
import { resolveStreamedTrackMedia } from "./resolve-playback";

function fakeSource(result: StreamResolveResult): StreamSourceProvider {
  return {
    id: "netease",
    label: "x",
    requiresLogin: false,
    isAuthed: () => true,
    search: async () => [],
    resolve: vi.fn(async () => result),
  };
}

const track = { streamSourceId: "netease" as const, streamExternalId: "123" };

describe("resolveStreamedTrackMedia", () => {
  afterEach(() => {
    clearTrace();
    vi.restoreAllMocks();
  });

  it("maps an ok resolve to a playable url + mime + headers", async () => {
    const source = fakeSource({
      kind: "ok",
      stream: {
        mediaUrl: "https://m7.music.126.net/x.flac",
        mime: "audio/flac",
        headers: { Referer: "https://music.163.com" },
        quality: "lossless",
      },
    });
    const res = await resolveStreamedTrackMedia(track, { resolveSource: () => source });
    expect(res).toEqual({
      kind: "ok",
      url: "https://m7.music.126.net/x.flac",
      mime: "audio/flac",
      headers: { Referer: "https://music.163.com" },
      quality: "lossless",
    });
  });

  it("passes a blob-only stream through without a url (blob transport, PRD F-1)", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp4" });
    const source = fakeSource({
      kind: "ok",
      stream: { blob, mime: "audio/mp4", quality: "aac" },
    });
    const res = await resolveStreamedTrackMedia(track, { resolveSource: () => source });
    expect(res).toEqual({
      kind: "ok",
      url: undefined,
      mime: "audio/mp4",
      blob,
      headers: undefined,
      quality: "aac",
    });
  });

  it("threads the per-source quality preference into resolve()", async () => {
    const source = fakeSource({ kind: "ok", stream: { mediaUrl: "u", mime: "audio/mpeg" } });
    await resolveStreamedTrackMedia(track, {
      resolveSource: () => source,
      getQuality: (id) => (id === "netease" ? "hires" : undefined),
    });
    expect(source.resolve).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ quality: "hires" }),
    );
  });

  it("passes through requires-login / no-permission verdicts with the source id", async () => {
    expect(
      await resolveStreamedTrackMedia(track, {
        resolveSource: () => fakeSource({ kind: "requires-login" }),
      }),
    ).toEqual({ kind: "requires-login", source: "netease" });

    expect(
      await resolveStreamedTrackMedia(track, {
        resolveSource: () => fakeSource({ kind: "no-permission", reason: "vip" }),
      }),
    ).toEqual({ kind: "no-permission", source: "netease", reason: "vip" });
  });

  it("maps provider errors and unavailable sources to error", async () => {
    expect(
      await resolveStreamedTrackMedia(track, {
        resolveSource: () => fakeSource({ kind: "error", message: "boom" }),
      }),
    ).toEqual({ kind: "error", message: "boom" });

    expect((await resolveStreamedTrackMedia(track, { resolveSource: () => null })).kind).toBe(
      "error",
    );
  });

  it("errors when the track has no stream ref", async () => {
    expect((await resolveStreamedTrackMedia({}, { resolveSource: () => null })).kind).toBe("error");
  });

  it("emits structured trace events for resolve success and failure", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const source = fakeSource({
      kind: "ok",
      stream: { mediaUrl: "https://cdn.example/song.mp3?sig=secret", mime: "audio/mpeg" },
    });

    await resolveStreamedTrackMedia(track, {
      resolveSource: () => source,
      trace: { traceId: "ply_1", trackId: "trk_1" },
    });
    await resolveStreamedTrackMedia(track, {
      resolveSource: () => fakeSource({ kind: "error", message: "boom" }),
      trace: { traceId: "ply_2", trackId: "trk_2" },
    });

    expect(getTraceEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "info",
          scope: "stream.resolve",
          event: "resolve.start",
          context: expect.objectContaining({
            traceId: "ply_1",
            trackId: "trk_1",
            sourceId: "netease",
            category: "stream",
            phase: "start",
          }),
        }),
        expect.objectContaining({
          level: "info",
          scope: "stream.resolve",
          event: "resolve.success",
          context: expect.objectContaining({
            traceId: "ply_1",
            mime: "audio/mpeg",
            requestHost: "cdn.example",
            redactions: expect.arrayContaining(["url.query.sig"]),
          }),
        }),
        expect.objectContaining({
          level: "error",
          scope: "stream.resolve",
          event: "resolve.failed",
          context: expect.objectContaining({
            traceId: "ply_2",
            trackId: "trk_2",
            sourceId: "netease",
            category: "stream",
            phase: "fail",
            errorKind: "unknown",
          }),
        }),
      ]),
    );
  });
});
