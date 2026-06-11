import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createMainDiagnostics } = require("../electron/diagnostics.cjs");

describe("electron main diagnostics", () => {
  it("buffers recent events and flushes them to new subscribers", () => {
    const diagnostics = createMainDiagnostics();
    diagnostics.emit("error", "stream.proxy", "request.failed", "media request failed", {
      traceId: "ply_1",
      targetUrl: "https://rr2.example/videoplayback?pot=token&sig=sig",
      cookie: "secret",
    });

    const received = [];
    diagnostics.subscribe((entry) => received.push(entry));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      level: "error",
      scope: "stream.proxy",
      event: "request.failed",
      message: "media request failed",
      context: {
        traceId: "ply_1",
        targetUrl: {
          host: "rr2.example",
          redactions: ["url.query.pot", "url.query.sig"],
        },
        cookie: "[redacted:secret]",
      },
    });
    expect(JSON.stringify(received[0])).not.toContain("pot=token");
    expect(JSON.stringify(received[0])).not.toContain('"cookie":"secret"');
  });
});
