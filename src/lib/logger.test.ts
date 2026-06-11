import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiagnosticLogger, log, recordUserAction } from "@/lib/logger";
import { clearTrace, formatTraceEntries, getTraceEntries } from "@/lib/trace";

describe("structured logger", () => {
  afterEach(() => {
    clearTrace();
    vi.restoreAllMocks();
  });

  it("writes a sanitized structured event into trace", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    createDiagnosticLogger("stream.youtube").error("download.failed", {
      message: "youtube download failed",
      category: "network",
      phase: "fail",
      errorKind: "http_status",
      traceId: "ply_1",
      trackId: "trk_1",
      url: "https://rr2---sn.example.googlevideo.com/videoplayback?itag=140&pot=token&sig=sig",
    });

    expect(getTraceEntries()).toHaveLength(1);
    expect(getTraceEntries()[0]).toMatchObject({
      level: "error",
      scope: "stream.youtube",
      event: "download.failed",
      message: "youtube download failed",
      context: {
        category: "network",
        phase: "fail",
        errorKind: "http_status",
        traceId: "ply_1",
        trackId: "trk_1",
        url: {
          host: "rr2---sn.example.googlevideo.com",
          redactions: expect.arrayContaining(["url.query.pot", "url.query.sig"]),
        },
      },
    });
    expect(formatTraceEntries()).toContain(
      "ERROR [stream.youtube] download.failed youtube download failed",
    );
    expect(formatTraceEntries()).toContain("trace=ply_1");
    expect(formatTraceEntries()).not.toContain("pot=token");
  });

  it("keeps legacy log calls compatible and sanitizes trace data", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    log.info("legacy", "resolved", {
      apiKey: "sk-secret",
      trackId: "trk_1",
    });

    expect(getTraceEntries()[0]).toMatchObject({
      level: "info",
      scope: "legacy",
      message: "resolved",
      data: [
        {
          apiKey: "[redacted:secret]",
          trackId: "trk_1",
        },
      ],
    });
  });

  it("records safe user-action breadcrumbs without raw input", () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    recordUserAction("play.click", {
      message: "track play clicked",
      traceId: "ply_2",
      trackId: "trk_2",
      route: "search",
      uiSurface: "track-row",
      controlId: "track.play",
      actionKind: "click",
      searchQuery: "private query",
    });

    expect(getTraceEntries()[0]).toMatchObject({
      level: "info",
      scope: "ui.action",
      event: "play.click",
      context: {
        category: "user-action",
        phase: "start",
        traceId: "ply_2",
        trackId: "trk_2",
        route: "search",
        uiSurface: "track-row",
        controlId: "track.play",
        actionKind: "click",
        searchQuery: "[redacted:user-input]",
      },
    });
  });
});
