import { describe, expect, it } from "vitest";
import {
  buildTranscribeForm,
  classifyGroqError,
  extensionFromMime,
  parseTranscript,
} from "./groq-mapping";

describe("extensionFromMime", () => {
  it("maps known audio MIME types to file extensions", () => {
    expect(extensionFromMime("audio/webm")).toBe("webm");
    expect(extensionFromMime("audio/ogg")).toBe("ogg");
    expect(extensionFromMime("audio/mp4")).toBe("mp4");
    expect(extensionFromMime("audio/mpeg")).toBe("mp3");
    expect(extensionFromMime("audio/wav")).toBe("wav");
    expect(extensionFromMime("audio/flac")).toBe("flac");
  });

  it("strips a codecs= parameter before matching (webm;codecs=opus → webm)", () => {
    expect(extensionFromMime("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFromMime("audio/ogg; codecs=opus")).toBe("ogg");
  });

  it("falls back to webm for empty / unknown types", () => {
    expect(extensionFromMime("")).toBe("webm");
    expect(extensionFromMime("audio/x-weird")).toBe("webm");
  });
});

describe("buildTranscribeForm", () => {
  const blob = new Blob(["fake-audio-bytes"], { type: "audio/webm;codecs=opus" });

  it("names the file by MIME-derived extension and sets required fields", () => {
    const form = buildTranscribeForm(blob, { model: "whisper-large-v3-turbo" });
    const file = form.get("file") as File;
    expect(file).toBeInstanceOf(Blob);
    expect(file.name).toBe("audio.webm");
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("response_format")).toBe("json");
    expect(form.get("temperature")).toBe("0");
  });

  it("omits language when unset or 'auto'", () => {
    expect(buildTranscribeForm(blob, { model: "m" }).get("language")).toBeNull();
    expect(buildTranscribeForm(blob, { model: "m", language: "auto" }).get("language")).toBeNull();
    expect(buildTranscribeForm(blob, { model: "m", language: "" }).get("language")).toBeNull();
  });

  it("includes a concrete language code when provided", () => {
    expect(buildTranscribeForm(blob, { model: "m", language: "zh" }).get("language")).toBe("zh");
  });
});

describe("parseTranscript", () => {
  it("extracts the transcribed text", () => {
    expect(parseTranscript({ text: "放点更 chill 的" }).text).toBe("放点更 chill 的");
  });

  it("defaults to empty text when missing", () => {
    expect(parseTranscript({}).text).toBe("");
    expect(parseTranscript(null).text).toBe("");
  });

  it("reads rate-limit headers when present", () => {
    const headers = new Headers({
      "x-ratelimit-remaining-audio-seconds": "1234",
      "x-ratelimit-remaining-requests": "42",
    });
    const result = parseTranscript({ text: "hi" }, headers);
    expect(result.remainingAudioSeconds).toBe(1234);
    expect(result.remainingRequests).toBe(42);
  });

  it("leaves quota undefined when headers are absent or unparseable", () => {
    const result = parseTranscript(
      { text: "hi" },
      new Headers({ "x-ratelimit-remaining-requests": "nope" }),
    );
    expect(result.remainingAudioSeconds).toBeUndefined();
    expect(result.remainingRequests).toBeUndefined();
  });
});

describe("classifyGroqError", () => {
  it("classifies auth / rate-limit / unknown by status code", () => {
    expect(classifyGroqError(401)).toBe("auth");
    expect(classifyGroqError(403)).toBe("auth");
    expect(classifyGroqError(429)).toBe("rate-limit");
    expect(classifyGroqError(400)).toBe("unknown");
    expect(classifyGroqError(500)).toBe("unknown");
  });
});
