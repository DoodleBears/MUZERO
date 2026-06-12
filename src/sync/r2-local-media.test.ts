import { afterEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { __setDesktopBridge, type DesktopBridge } from "@/lib/desktop/bridge";
import { createDesktopR2LocalMedia } from "./r2-local-media";

const dataSha256 = "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7";

afterEach(() => {
  __setDesktopBridge(null);
  vi.unstubAllGlobals();
});

describe("createDesktopR2LocalMedia", () => {
  it("resolves referenced local media through the desktop bridge for R2 sync", async () => {
    const reads: string[] = [];
    __setDesktopBridge({
      kind: "electron",
      fetch: globalThis.fetch,
      openExternal: async () => {},
      readFile: async (path) => {
        reads.push(path);
        return new TextEncoder().encode("data");
      },
    } as DesktopBridge);

    const localMedia = createDesktopR2LocalMedia();
    const resolved = await localMedia?.resolver.resolve(localTrack);
    const opened = await localMedia?.publisher.open({
      kind: "local-file",
      path: "/music/Blue Song.mp3",
      bytes: 4,
      mime: "audio/mpeg",
      sha256: dataSha256,
    });

    expect(resolved).toEqual({
      body: {
        kind: "local-file",
        path: "/music/Blue Song.mp3",
        bytes: 4,
        mime: "audio/mpeg",
        sha256: dataSha256,
      },
      bytes: 4,
      mime: "audio/mpeg",
      sha256: dataSha256,
    });
    expect(ArrayBuffer.isView(opened)).toBe(true);
    expect(new TextDecoder().decode(opened as Uint8Array)).toBe("data");
    expect(reads).toEqual(["/music/Blue Song.mp3", "/music/Blue Song.mp3"]);
  });

  it("streams publish bodies through tokenized local-media URLs when available", async () => {
    const reads: string[] = [];
    const urls: Array<{ path: string; mime?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("streamed", { status: 200 })),
    );
    __setDesktopBridge({
      kind: "electron",
      fetch: globalThis.fetch,
      openExternal: async () => {},
      readFile: async (path) => {
        reads.push(path);
        return new TextEncoder().encode("data");
      },
      localMediaUrl: async (input) => {
        urls.push(input);
        return "muzfetch://local-media/?__mztoken=tok_1";
      },
    } as DesktopBridge);

    const localMedia = createDesktopR2LocalMedia();
    await localMedia?.resolver.resolve(localTrack);
    const opened = await localMedia?.publisher.open({
      kind: "local-file",
      path: "/music/Blue Song.mp3",
      bytes: 4,
      mime: "audio/mpeg",
      sha256: dataSha256,
    });

    expect(await new Response(opened).text()).toBe("streamed");
    expect(globalThis.fetch).toHaveBeenCalledWith("muzfetch://local-media/?__mztoken=tok_1");
    expect(urls).toEqual([{ path: "/music/Blue Song.mp3", mime: "audio/mpeg" }]);
    expect(reads).toEqual(["/music/Blue Song.mp3"]);
  });

  it("stays disabled when the current runtime cannot read local files", () => {
    __setDesktopBridge({
      kind: "web",
      fetch: globalThis.fetch,
      openExternal: async () => {},
    });

    expect(createDesktopR2LocalMedia()).toBeUndefined();
  });
});

const localTrack: Track = {
  id: "trk_local",
  sessionId: "ses_local",
  title: "Blue Song",
  kind: "audio",
  origin: "uploaded",
  provider: "upload",
  status: "ready",
  durationSec: 180,
  sourcePath: "/music/Blue Song.mp3",
  createdAt: 1,
  playCount: 0,
  liked: false,
  tags: [],
  mediaMetadata: {
    originalFileName: "Blue Song.mp3",
    originalMime: "audio/mpeg",
    parser: "music-metadata",
    parsedAt: 1,
  },
};
