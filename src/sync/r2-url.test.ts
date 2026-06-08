import { describe, expect, it } from "vitest";
import { normalizeManifestUrl, resolveRemoteObjectUrl } from "./r2-url";

describe("normalizeManifestUrl", () => {
  it("accepts a direct manifest URL", () => {
    expect(normalizeManifestUrl("https://music.example.com/muzero/manifest.json")).toBe(
      "https://music.example.com/muzero/manifest.json",
    );
  });

  it("turns a public base URL into a manifest URL", () => {
    expect(normalizeManifestUrl("https://music.example.com/muzero")).toBe(
      "https://music.example.com/muzero/manifest.json",
    );
  });

  it("rejects non-http URLs", () => {
    expect(() => normalizeManifestUrl("file:///tmp/manifest.json")).toThrow(/http/i);
  });
});

describe("resolveRemoteObjectUrl", () => {
  it("resolves relative object refs against the manifest base", () => {
    expect(resolveRemoteObjectUrl("https://music.example.com/muzero/", "sets/a/index.json")).toBe(
      "https://music.example.com/muzero/sets/a/index.json",
    );
  });

  it("preserves valid absolute HTTP object refs", () => {
    expect(
      resolveRemoteObjectUrl(
        "https://music.example.com/muzero/",
        "https://cdn.example.com/media/a.mp3",
      ),
    ).toBe("https://cdn.example.com/media/a.mp3");
  });

  it("rejects relative refs that escape the base prefix", () => {
    expect(() =>
      resolveRemoteObjectUrl("https://music.example.com/muzero/", "../secret.json"),
    ).toThrow(/outside/i);
  });

  it("rejects script-like object refs", () => {
    expect(() =>
      resolveRemoteObjectUrl("https://music.example.com/muzero/", "javascript:alert(1)"),
    ).toThrow(/http/i);
  });
});
