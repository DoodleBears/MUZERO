import { describe, expect, it } from "vitest";
import {
  createTraceId,
  type DiagnosticEntry,
  finishDiagnosticSpan,
  matchesDiagnosticFilter,
  sanitizeDiagnosticData,
  sanitizeUrlForTrace,
  startDiagnosticSpan,
} from "@/lib/diagnostics";

describe("sanitizeDiagnosticData", () => {
  it("redacts secrets, signed urls, and raw user input recursively", () => {
    const sanitized = sanitizeDiagnosticData({
      Authorization: "Bearer sk-secret",
      cookie: "MUSIC_U=session",
      nested: {
        apiKey: "sk-live",
        prompt: "make a song about private memories",
        lyrics: "secret lyrics",
        note: "private note",
        searchQuery: "private search",
        fileName: "vacation-memory.mp3",
        url: "https://rr2---sn.example.googlevideo.com/videoplayback?itag=140&pot=token&sig=sig&mime=audio%2Fmp4",
      },
      safe: {
        trackId: "trk_1",
        httpStatus: 403,
      },
    });

    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("sk-secret");
    expect(text).not.toContain("MUSIC_U=session");
    expect(text).not.toContain("private memories");
    expect(text).not.toContain("secret lyrics");
    expect(text).not.toContain("private note");
    expect(text).not.toContain("private search");
    expect(text).not.toContain("vacation-memory.mp3");
    expect(text).not.toContain("pot=token");
    expect(text).not.toContain("sig=sig");
    expect(sanitized).toMatchObject({
      Authorization: "[redacted:authorization]",
      cookie: "[redacted:cookie]",
      nested: {
        apiKey: "[redacted:secret]",
        prompt: "[redacted:user-input]",
        lyrics: "[redacted:user-input]",
        note: "[redacted:user-input]",
        searchQuery: "[redacted:user-input]",
        fileName: "[redacted:user-input]",
        url: {
          host: "rr2---sn.example.googlevideo.com",
          redactions: expect.arrayContaining(["url.query.pot", "url.query.sig"]),
        },
      },
      safe: {
        trackId: "trk_1",
        httpStatus: 403,
      },
    });
  });

  it("summarizes Error/Event/Element without leaking large objects", () => {
    const err = new Error("boom");
    const button = document.createElement("button");
    button.id = "play";
    button.className = "primary";

    expect(sanitizeDiagnosticData({ err, event: new Event("click"), button })).toMatchObject({
      err: {
        name: "Error",
        message: "boom",
      },
      event: { type: "click" },
      button: {
        tagName: "BUTTON",
        id: "play",
        className: "primary",
      },
    });
  });
});

describe("sanitizeUrlForTrace", () => {
  it("keeps host and safe media facts while redacting signed query params", () => {
    expect(
      sanitizeUrlForTrace(
        "https://rr2---sn.example.googlevideo.com/videoplayback?itag=140&mime=audio%2Fmp4&dur=273.6&pot=token&sig=sig&cpn=abc",
      ),
    ).toEqual({
      host: "rr2---sn.example.googlevideo.com",
      pathHash: expect.any(String),
      safeQuery: {
        dur: "273.6",
        itag: "140",
        mime: "audio/mp4",
      },
      redactions: ["url.query.cpn", "url.query.pot", "url.query.sig"],
    });
  });

  it("returns a stable invalid-url summary for malformed input", () => {
    expect(sanitizeUrlForTrace("not a url")).toEqual({
      host: null,
      pathHash: expect.any(String),
      safeQuery: {},
      redactions: ["url.invalid"],
    });
  });
});

describe("matchesDiagnosticFilter", () => {
  const entry: DiagnosticEntry = {
    id: 1,
    at: 1,
    level: "error",
    scope: "stream.youtube",
    event: "download.failed",
    message: "youtube download failed",
    context: {
      traceId: "ply_1",
      trackId: "trk_1",
      sourceId: "youtube",
      videoId: "Ci_zad39Uhw",
      category: "network",
      phase: "fail",
      errorKind: "http_status",
      source: "renderer",
    },
  };

  it("filters by level/category/error kind and ids", () => {
    expect(matchesDiagnosticFilter(entry, { levels: ["error"] })).toBe(true);
    expect(matchesDiagnosticFilter(entry, { categories: ["network"] })).toBe(true);
    expect(matchesDiagnosticFilter(entry, { errorKinds: ["http_status"] })).toBe(true);
    expect(matchesDiagnosticFilter(entry, { traceId: "ply_1" })).toBe(true);
    expect(matchesDiagnosticFilter(entry, { entityId: "Ci_zad39Uhw" })).toBe(true);
    expect(matchesDiagnosticFilter(entry, { categories: ["media"] })).toBe(false);
    expect(matchesDiagnosticFilter(entry, { levels: ["warn"] })).toBe(false);
  });

  it("searches stable fields without requiring raw user input", () => {
    expect(matchesDiagnosticFilter(entry, { text: "download.failed" })).toBe(true);
    expect(matchesDiagnosticFilter(entry, { text: "youtube" })).toBe(true);
    expect(matchesDiagnosticFilter(entry, { text: "track-row" })).toBe(false);
  });
});

describe("trace id and span helpers", () => {
  it("creates readable trace ids with a caller prefix", () => {
    expect(createTraceId("ply")).toMatch(/^ply_[a-z0-9]+$/);
  });

  it("tracks span duration and merges finish context", () => {
    const span = startDiagnosticSpan("ply_1", "youtube.resolve", 1000);

    expect(span).toMatchObject({
      traceId: "ply_1",
      operation: "youtube.resolve",
      startedAt: 1000,
    });
    expect(finishDiagnosticSpan(span, "success", { sourceId: "youtube" }, 1250)).toEqual({
      traceId: "ply_1",
      spanId: span.spanId,
      operation: "youtube.resolve",
      phase: "success",
      durationMs: 250,
      sourceId: "youtube",
    });
  });
});
