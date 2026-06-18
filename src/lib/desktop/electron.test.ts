import { describe, expect, it, vi } from "vitest";
import type { MediaProxyTrace } from "./bridge";
import { createElectronBridge, electronMediaProxyUrl } from "./electron";

describe("electronMediaProxyUrl", () => {
  it("carries media headers and playback trace context for main-process diagnostics", () => {
    const url = electronMediaProxyUrl(
      "https://rr.example.com/videoplayback?itag=140&pot=secret",
      {
        Referer: "https://www.youtube.com",
        Origin: "https://www.youtube.com",
      },
      {
        traceId: "ply_1",
        trackId: "trk_1",
        sessionId: "ses_1",
        sourceId: "youtube",
        videoId: "v1",
      },
    );

    const parsed = new URL(url);
    expect(parsed.protocol).toBe("muzfetch:");
    expect(parsed.hostname).toBe("media");
    expect(parsed.searchParams.get("__mztrace")).toBe("ply_1");
    expect(parsed.searchParams.get("__mztrack")).toBe("trk_1");
    expect(parsed.searchParams.get("__mzsession")).toBe("ses_1");
    expect(parsed.searchParams.get("__mzsource")).toBe("youtube");
    expect(parsed.searchParams.get("__mzvideo")).toBe("v1");
    expect(parsed.searchParams.get("__mzh_referer")).toBe("https://www.youtube.com");
    expect(parsed.searchParams.get("__mzh_origin")).toBe("https://www.youtube.com");
  });

  it("keeps backward-compatible traceId strings", () => {
    const url = electronMediaProxyUrl("https://cdn.example/a.mp3", undefined, "ply_2");
    expect(new URL(url).searchParams.get("__mztrace")).toBe("ply_2");
  });
});

describe("electronLocalMediaUrl", () => {
  it("builds a tokenized local-media URL without leaking absolute source paths", async () => {
    const electron = (await import("./electron")) as typeof import("./electron") & {
      electronLocalMediaUrl?: (input: {
        token: string;
        mime?: string;
        sourcePath?: string;
        trace?: string | MediaProxyTrace;
      }) => string;
    };

    expect(electron.electronLocalMediaUrl).toBeTypeOf("function");

    const url =
      electron.electronLocalMediaUrl?.({
        token: "lm_abc123",
        mime: "audio/mpeg",
        sourcePath: "/Users/alice/Music/private/demo.mp3",
        trace: {
          traceId: "ply_1",
          trackId: "trk_1",
          sessionId: "ses_1",
        },
      }) ?? "";
    const parsed = new URL(url);

    expect(parsed.protocol).toBe("muzfetch:");
    expect(parsed.hostname).toBe("local-media");
    expect(parsed.searchParams.get("__mztoken")).toBe("lm_abc123");
    expect(parsed.searchParams.get("__mzmime")).toBe("audio/mpeg");
    expect(parsed.searchParams.get("__mztrack")).toBe("trk_1");
    expect(url).not.toContain("/Users/alice");
    expect(url).not.toContain("private/demo.mp3");
  });
});

describe("createElectronBridge", () => {
  function installApi(overrides: Record<string, unknown>) {
    const api = {
      kind: "electron",
      pickFolder: vi.fn(),
      readDir: vi.fn(),
      readFile: vi.fn(),
      grantFolderAccess: vi.fn(),
      grantFileAccess: vi.fn(),
      getPathForFile: vi.fn(),
      localMediaToken: vi.fn(),
      saveFile: vi.fn(),
      writeMediaStorageFile: vi.fn(),
      readMediaStorageFile: vi.fn(),
      deleteMediaStorageFile: vi.fn(),
      statMediaStorageFile: vi.fn(),
      openMediaStorageFolder: vi.fn(),
      openExternal: vi.fn(),
      setAppIcon: vi.fn(),
      openSourceLogin: vi.fn(),
      readSourceCookies: vi.fn(),
      evalYoutubeN: vi.fn(),
      ...overrides,
    };
    Object.defineProperty(window, "muzero", {
      configurable: true,
      value: api,
    });
    return api;
  }

  it("resolves and grants dropped file paths", async () => {
    const api = installApi({ getPathForFile: vi.fn(() => "D:/Music/clip.mp4") });
    const bridge = createElectronBridge();

    await expect(bridge.getDroppedFilePath?.(new File(["x"], "clip.mp4"))).resolves.toBe(
      "D:/Music/clip.mp4",
    );
    expect(api.grantFileAccess).toHaveBeenCalledWith("D:/Music/clip.mp4");
  });

  it("exposes exact-file grants for restoring referenced imports after restart", async () => {
    const api = installApi({});
    const bridge = createElectronBridge();

    await bridge.grantFileAccess?.("D:/Music/clip.mp4");

    expect(api.grantFileAccess).toHaveBeenCalledWith("D:/Music/clip.mp4");
  });

  it("returns undefined without granting when Electron has no path", async () => {
    const api = installApi({ getPathForFile: vi.fn(() => "") });
    const bridge = createElectronBridge();

    await expect(bridge.getDroppedFilePath?.(new File(["x"], "memory.mp4"))).resolves.toBe(
      undefined,
    );
    expect(api.grantFileAccess).not.toHaveBeenCalled();
  });
});
