import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveRequestIntake } from "../electron/live-request-intake.cjs";

const running = [];

afterEach(async () => {
  while (running.length > 0) {
    await running.pop().stop();
  }
});

describe("Electron live request intake", () => {
  it("accepts authorized loopback requests and emits raw payloads", async () => {
    const emitted = [];
    const intake = createLiveRequestIntake({ emit: (payload) => emitted.push(payload) });
    running.push(intake);
    const status = await intake.start({ port: 0, token: "secret" });

    const response = await postJson({
      body: JSON.stringify({ message: "点歌 晴天" }),
      path: "/v1/audience/request?token=secret",
      port: status.port,
    });

    expect(response.statusCode).toBe(202);
    expect(JSON.parse(response.body)).toEqual({ accepted: true, status: "queued" });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].body).toBe(JSON.stringify({ message: "点歌 晴天" }));
    expect(emitted[0].receivedAt).toEqual(expect.any(Number));
  });

  it("rejects invalid tokens before emitting to the renderer", async () => {
    const emitted = [];
    const intake = createLiveRequestIntake({ emit: (payload) => emitted.push(payload) });
    running.push(intake);
    const status = await intake.start({ port: 0, token: "secret" });

    const response = await postJson({
      body: JSON.stringify({ message: "点歌 晴天" }),
      path: "/v1/audience/request?token=wrong",
      port: status.port,
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ accepted: false, message: "unauthorized" });
    expect(emitted).toEqual([]);
  });

  it("enforces a bounded body before emitting", async () => {
    const emitted = [];
    const intake = createLiveRequestIntake({ emit: (payload) => emitted.push(payload) });
    running.push(intake);
    const status = await intake.start({ maxBodyBytes: 8, port: 0, token: "secret" });

    const response = await postJson({
      body: JSON.stringify({ message: "too large" }),
      headers: { authorization: "Bearer secret" },
      path: "/v1/audience/request",
      port: status.port,
    });

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      accepted: false,
      message: "request body too large",
    });
    expect(emitted).toEqual([]);
  });
});

function postJson({ body, headers = {}, path, port }) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        headers: {
          "content-length": Buffer.byteLength(body),
          "content-type": "application/json",
          ...headers,
        },
        hostname: "127.0.0.1",
        method: "POST",
        path,
        port,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            statusCode: res.statusCode,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
