import { describe, expect, it, vi } from "vitest";
import { buildEmotionText, type ReplyPart } from "./emotion-markup";
import type { FishTtsBackend } from "./fish-mapping";
import { createFishTtsProvider } from "./fish-provider";
import { TtsError } from "./provider";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("createFishTtsProvider", () => {
  it("lists the owner's voices with self_only + bearer auth", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/model?");
      expect(url).toContain("self_only=true");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-fish");
      return jsonResponse({ items: [{ _id: "a", title: "A" }], total: 1 });
    });
    const provider = createFishTtsProvider({ apiKey: "sk-fish", fetchImpl: fetchImpl as never });
    const voices = await provider.listVoices({ ownedOnly: true });
    expect(voices.map((v) => v.id)).toEqual(["a"]);
  });

  it("passes a title= query when searching", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("title=warm");
      return jsonResponse({ items: [] });
    });
    const provider = createFishTtsProvider({ apiKey: "k", fetchImpl: fetchImpl as never });
    await provider.listVoices({ query: "warm" });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("gets a single voice by id and returns null on 404", async () => {
    const ok = createFishTtsProvider({
      apiKey: "k",
      fetchImpl: (async () => jsonResponse({ _id: "vox", title: "Vox" })) as never,
    });
    expect((await ok.getVoice("vox"))?.id).toBe("vox");

    const missing = createFishTtsProvider({
      apiKey: "k",
      fetchImpl: (async () => new Response("", { status: 404 })) as never,
    });
    expect(await missing.getVoice("nope")).toBeNull();
  });

  it("synthesizes with the backend header and returns the audio blob", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/v1/tts");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("model")).toBe("s2-pro");
      const body = JSON.parse(init?.body as string);
      expect(body.reference_id).toBe("vox");
      return new Response(new Uint8Array(8), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    const provider = createFishTtsProvider({
      apiKey: "k",
      backend: "s2-pro",
      fetchImpl: fetchImpl as never,
    });
    const result = await provider.synthesize({ text: "hi", voiceId: "vox" });
    expect(result.mime).toBe("audio/mpeg");
    expect(result.blob.size).toBe(8);
  });

  it("defaults the backend to s2.1-pro-free (free model)", async () => {
    let modelHeader: string | null = null;
    const provider = createFishTtsProvider({
      apiKey: "k",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        modelHeader = new Headers(init?.headers).get("model");
        return new Response(new Uint8Array(4), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }) as never,
    });
    await provider.synthesize({ text: "hi", voiceId: "v" });
    expect(modelHeader).toBe("s2.1-pro-free");
  });

  it("throws a classified TtsError on auth failure", async () => {
    const provider = createFishTtsProvider({
      apiKey: "bad",
      fetchImpl: (async () => jsonResponse({ message: "unauthorized" }, { status: 401 })) as never,
    });
    await expect(provider.synthesize({ text: "hi", voiceId: "v" })).rejects.toMatchObject({
      name: "TtsError",
      kind: "auth",
    });
  });

  it("wraps synthesis network failures", async () => {
    const provider = createFishTtsProvider({
      apiKey: "k",
      fetchImpl: (async () => {
        throw new TypeError("offline");
      }) as never,
    });
    await expect(provider.synthesize({ text: "hi", voiceId: "v" })).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("refuses to synthesize without a key", async () => {
    const provider = createFishTtsProvider({ apiKey: "", fetchImpl: vi.fn() as never });
    await expect(provider.synthesize({ text: "hi", voiceId: "v" })).rejects.toBeInstanceOf(
      TtsError,
    );
  });
});

/**
 * The end-to-end wire form of an emotion reply: dj_say parts → buildEmotionText →
 * provider.synthesize → the actual Fish `/v1/tts` request body. Confirms the
 * inline emotion markers Fish documents ([emotion] for S2, (emotion) for S1)
 * arrive VERBATIM in `body.text`, and that the marker syntax always matches the
 * backend that the `model` header targets (so an S1 request never sends S2
 * brackets, and vice-versa).
 */
describe("Fish request carries emotion markers inline in the text field", () => {
  const parts: ReplyPart[] = [
    { text: "Great pick!", emotion: "happy" },
    { text: "Cueing it up.", emotion: "gentle" },
  ];

  async function captureSynthBody(backend: FishTtsBackend, text: string) {
    let body: Record<string, unknown> | undefined;
    let modelHeader: string | null = null;
    const provider = createFishTtsProvider({
      apiKey: "k",
      backend,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        modelHeader = new Headers(init?.headers).get("model");
        body = JSON.parse(init?.body as string);
        return new Response(new Uint8Array(4), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }) as never,
    });
    await provider.synthesize({ text, voiceId: "vox", speed: 1 });
    return { body: body as Record<string, unknown>, modelHeader };
  }

  it("S2 family sends [emotion] brackets verbatim in body.text (normalize left on)", async () => {
    const text = buildEmotionText(parts, "s2.1-pro-free");
    const { body, modelHeader } = await captureSynthBody("s2.1-pro-free", text);
    expect(body.text).toBe("[happy] Great pick! [gentle] Cueing it up.");
    expect(body.reference_id).toBe("vox");
    // Fish docs: emotion markers are unaffected by normalization — we keep it on.
    expect(body.normalize).toBe(true);
    expect(modelHeader).toBe("s2.1-pro-free");
  });

  it("S1 sends (emotion) parentheses verbatim in body.text", async () => {
    const text = buildEmotionText(parts, "s1");
    const { body, modelHeader } = await captureSynthBody("s1", text);
    expect(body.text).toBe("(happy) Great pick! (gentle) Cueing it up.");
    expect(modelHeader).toBe("s1");
  });

  it("marker syntax always matches the backend the model header targets", async () => {
    for (const backend of ["s2.1-pro-free", "s2.1-pro", "s2-pro", "s1"] as const) {
      const text = buildEmotionText([{ text: "Here we go.", emotion: "excited" }], backend);
      const { body, modelHeader } = await captureSynthBody(backend, text);
      const expected = backend === "s1" ? "(excited) Here we go." : "[excited] Here we go.";
      expect(body.text, backend).toBe(expected);
      expect(modelHeader, backend).toBe(backend);
    }
  });
});
