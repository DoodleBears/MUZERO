import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaStorageProvider } from "@/db/media-blob-storage";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession } from "@/db/repositories";
import {
  type DownloadStreamedVideoDeps,
  downloadStreamedVideoToLibrary,
} from "./download-to-library";
import type {
  StreamResolveResult,
  StreamSourceProvider,
  StreamVideoResolveResult,
} from "./provider";

let db: MuzeroDB;
let counter = 0;

beforeEach(() => {
  db = new MuzeroDB(`dl-to-lib-test-${counter++}`);
});

function memoryStorage(): MediaStorageProvider {
  const files = new Map<string, Blob>();
  return {
    id: "electron-file",
    userVisible: true,
    async put(input) {
      const storageKey = `media/${input.id}`;
      files.set(storageKey, input.blob);
      return { storageKey };
    },
    async get(input) {
      return input.storageKey ? (files.get(input.storageKey) ?? null) : null;
    },
    async delete(input) {
      if (input.storageKey) files.delete(input.storageKey);
    },
  };
}

/** A stub Bilibili-like source: url video transport + url audio. */
function stubSource(over: Partial<StreamSourceProvider> = {}): StreamSourceProvider {
  return {
    id: "bili",
    label: "Bilibili",
    requiresLogin: false,
    isAuthed: () => false,
    search: async () => [],
    resolve: async (): Promise<StreamResolveResult> => ({
      kind: "ok",
      stream: { mediaUrl: "https://cdn/a.m4s", mime: "audio/mp4", headers: { Referer: "x" } },
    }),
    resolveVideo: async (): Promise<StreamVideoResolveResult> => ({
      kind: "ok",
      video: {
        url: "https://cdn/v.m4s",
        mime: "video/mp4",
        codec: "avc",
        height: 1080,
        headers: { Referer: "x" },
      },
    }),
    ...over,
  };
}

function deps(over: Partial<DownloadStreamedVideoDeps> = {}): DownloadStreamedVideoDeps {
  return {
    fetchBytes: async () => new Blob([new Uint8Array(1000)]),
    mux: async () => new Blob([new Uint8Array(2000)], { type: "video/mp4" }),
    db,
    storage: { provider: memoryStorage() },
    ...over,
  };
}

describe("downloadStreamedVideoToLibrary", () => {
  it("creates a local-backed video track in the set (kind/blobId/downloaded fields)", async () => {
    const session = await createSession(
      { name: "Downloads", seedPrompt: "", config: { autoExtend: false }, displayMode: "video" },
      db,
    );
    const res = await downloadStreamedVideoToLibrary(
      {
        source: stubSource(),
        sessionId: session.id,
        externalId: "BV1X163BQEo8",
        title: "Test video",
        meta: { durationSec: 42, coverUrl: "https://cdn/cover.jpg" },
        coverUrl: "https://cdn/cover.jpg",
        quality: "1080",
      },
      deps(),
    );
    expect(res.kind).toBe("downloaded");
    if (res.kind !== "downloaded") return;
    expect(res.height).toBe(1080);
    expect(res.container).toBe("mp4");

    const track = await db.tracks.get(res.trackId);
    expect(track?.kind).toBe("video");
    expect(track?.origin).toBe("streamed");
    expect(track?.blobId).toBeTruthy(); // local-backed → plays offline
    expect(track?.coverBlobId).toBeTruthy(); // official cover downloaded to a local blob
    expect(track?.downloadedVideoHeight).toBe(1080);
    expect(track?.downloadedContainer).toBe("mp4");
    expect(track?.downloadedCodecs).toBe("avc+aac");
    expect(track?.streamSourceId).toBe("bili");

    const inSet = await db.sessions.get(session.id);
    expect(inSet?.trackIds).toContain(res.trackId);
  });

  it("falls back to a poster frame when there is no source cover URL", async () => {
    const session = await createSession(
      { name: "Downloads", seedPrompt: "", config: { autoExtend: false }, displayMode: "video" },
      db,
    );
    const posterFrame = vi.fn(async () => ({
      blob: new Blob([new Uint8Array(80)], { type: "image/webp" }),
      mime: "image/webp",
    }));
    const res = await downloadStreamedVideoToLibrary(
      { source: stubSource(), sessionId: session.id, externalId: "BVx", title: "No cover" },
      deps({ posterFrame }),
    );
    expect(res.kind).toBe("downloaded");
    if (res.kind !== "downloaded") return;
    expect(posterFrame).toHaveBeenCalledOnce();
    expect((await db.tracks.get(res.trackId))?.coverBlobId).toBeTruthy();
  });

  it("uses the blob transport (YouTube) without fetching a URL", async () => {
    const session = await createSession(
      { name: "Downloads", seedPrompt: "", config: { autoExtend: false }, displayMode: "video" },
      db,
    );
    const fetchBytes = vi.fn();
    const ytSource = stubSource({
      id: "youtube",
      resolveVideo: async () => ({
        kind: "ok",
        video: {
          blob: new Blob([new Uint8Array(500)]),
          mime: "video/mp4",
          codec: "avc",
          height: 720,
        },
      }),
      resolve: async () => ({
        kind: "ok",
        stream: { blob: new Blob([new Uint8Array(300)]), mime: "audio/mp4" },
      }),
    });
    const res = await downloadStreamedVideoToLibrary(
      { source: ytSource, sessionId: session.id, externalId: "abc", title: "YT" },
      deps({ fetchBytes }),
    );
    expect(res.kind).toBe("downloaded");
    expect(fetchBytes).not.toHaveBeenCalled(); // blob transport → no network fetch
  });

  it("propagates a login wall without creating a track", async () => {
    const session = await createSession(
      { name: "Downloads", seedPrompt: "", config: { autoExtend: false }, displayMode: "video" },
      db,
    );
    const res = await downloadStreamedVideoToLibrary(
      {
        source: stubSource({ resolveVideo: async () => ({ kind: "requires-login" }) }),
        sessionId: session.id,
        externalId: "x",
        title: "T",
      },
      deps(),
    );
    expect(res.kind).toBe("requires-login");
    const after = await db.sessions.get(session.id);
    expect(after?.trackIds ?? []).toHaveLength(0);
  });
});
