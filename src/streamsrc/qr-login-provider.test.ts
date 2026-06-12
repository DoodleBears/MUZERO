import { describe, expect, it, vi } from "vitest";
import type { StreamHttp, StreamHttpRequest } from "./http";
import type { QrStatus } from "./qr-login";
import { createBiliQrApi, type QrSourceApi, qrPollLoop } from "./qr-login-provider";

/** A virtual clock so the poll loop is deterministic (no real sleeping). */
function virtualClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

function apiFromStatuses(statuses: QrStatus[]): QrSourceApi {
  let i = 0;
  return {
    generate: async () => ({ qrKey: "k", qrContent: "https://q" }),
    poll: vi.fn(async () => statuses[Math.min(i++, statuses.length - 1)]),
  };
}

describe("qrPollLoop", () => {
  it("walks waiting → scanned → success and returns the cookie", async () => {
    const clock = virtualClock();
    const seen: QrStatus[] = [];
    const out = await qrPollLoop(apiFromStatuses(["waiting", "scanned", "success"]), "k", {
      ...clock,
      readCookie: async () => "SESSDATA=tok",
      onStatus: (s) => seen.push(s),
      intervalMs: 1000,
    });
    expect(out).toEqual({ outcome: "success", cookie: "SESSDATA=tok" });
    expect(seen).toEqual(["waiting", "scanned", "success"]); // distinct transitions only
  });

  it("stops on expired", async () => {
    const clock = virtualClock();
    const out = await qrPollLoop(apiFromStatuses(["waiting", "expired"]), "k", {
      ...clock,
      readCookie: async () => null,
      intervalMs: 1000,
    });
    expect(out.outcome).toBe("expired");
  });

  it("times out after the deadline", async () => {
    const clock = virtualClock();
    const out = await qrPollLoop(apiFromStatuses(["waiting"]), "k", {
      ...clock,
      readCookie: async () => null,
      intervalMs: 1000,
      timeoutMs: 3000,
    });
    expect(out.outcome).toBe("timeout");
  });

  it("aborts when the signal is set", async () => {
    const clock = virtualClock();
    const signal = { aborted: true };
    const out = await qrPollLoop(apiFromStatuses(["waiting"]), "k", {
      ...clock,
      readCookie: async () => null,
      signal,
    });
    expect(out.outcome).toBe("cancelled");
  });
});

describe("createBiliQrApi", () => {
  function http(routes: Array<[string, unknown]>): {
    http: StreamHttp;
    calls: StreamHttpRequest[];
  } {
    const calls: StreamHttpRequest[] = [];
    return {
      calls,
      http: async (req) => {
        calls.push(req);
        const body = routes.find(([frag]) => req.url.includes(frag))?.[1] ?? {};
        return { status: 200, text: async () => JSON.stringify(body), json: async () => body };
      },
    };
  }

  it("generates a QR (url + key) and maps poll status", async () => {
    const { http: h, calls } = http([
      ["qrcode/generate", { code: 0, data: { url: "https://scan", qrcode_key: "kk" } }],
      ["qrcode/poll", { code: 0, data: { code: 86090 } }],
    ]);
    const api = createBiliQrApi(h);
    expect(await api.generate()).toEqual({ qrKey: "kk", qrContent: "https://scan" });
    expect(await api.poll("kk")).toBe("scanned");
    expect(calls[1].url).toContain("qrcode_key=kk");
  });
});
