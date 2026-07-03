import { describe, expect, it, vi } from "vitest";
import { GROQ_TRANSCRIBE_URL } from "./groq-mapping";
import { createGroqAsrProvider } from "./groq-provider";
import { AsrError } from "./provider";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const blob = new Blob(["audio"], { type: "audio/webm" });

describe("createGroqAsrProvider", () => {
  it("posts a multipart form to Groq with a bearer key and returns the text", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk-test");
      expect(init?.body).toBeInstanceOf(FormData);
      return jsonResponse(
        { text: "换点安静的" },
        { headers: { "x-ratelimit-remaining-requests": "9" } },
      );
    });
    const provider = createGroqAsrProvider({ apiKey: "sk-test", fetchImpl: fetchImpl as never });

    const result = await provider.transcribe({ blob });

    expect(fetchImpl).toHaveBeenCalledWith(GROQ_TRANSCRIBE_URL, expect.anything());
    expect(result.text).toBe("换点安静的");
    expect(result.remainingRequests).toBe(9);
  });

  it("throws an auth AsrError on 401", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid API Key" } }, { status: 401 }),
    );
    const provider = createGroqAsrProvider({ apiKey: "bad", fetchImpl: fetchImpl as never });
    await expect(provider.transcribe({ blob })).rejects.toMatchObject({
      name: "AsrError",
      kind: "auth",
      statusCode: 401,
    });
  });

  it("throws a rate-limit AsrError on 429", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 429 }));
    const provider = createGroqAsrProvider({ apiKey: "ok", fetchImpl: fetchImpl as never });
    await expect(provider.transcribe({ blob })).rejects.toMatchObject({ kind: "rate-limit" });
  });

  it("wraps network failures as a network AsrError", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const provider = createGroqAsrProvider({ apiKey: "ok", fetchImpl: fetchImpl as never });
    await expect(provider.transcribe({ blob })).rejects.toMatchObject({ kind: "network" });
  });

  it("refuses to call the API without a key", async () => {
    const fetchImpl = vi.fn();
    const provider = createGroqAsrProvider({ apiKey: "", fetchImpl: fetchImpl as never });
    await expect(provider.transcribe({ blob })).rejects.toBeInstanceOf(AsrError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
