import { describe, expect, it, vi } from "vitest";
import { warmDecode } from "./cover-warm-decode";

type FakeImage = {
  src: string;
  decoding: string;
  referrerPolicy: string;
  decode?: () => Promise<void>;
};

function fakeImage(decode?: () => Promise<void>): FakeImage {
  return { src: "", decoding: "", referrerPolicy: "", decode };
}

describe("warmDecode", () => {
  it("sets the src + async decoding and triggers an off-thread decode", () => {
    const img = fakeImage(vi.fn(async () => {}));
    warmDecode("blob:cover", () => img);
    expect(img.src).toBe("blob:cover");
    expect(img.decoding).toBe("async");
    expect(img.decode).toHaveBeenCalledTimes(1);
  });

  it("swallows a rejected decode() (never throws to the caller)", async () => {
    const img = fakeImage(
      vi.fn(async () => {
        throw new Error("decode failed");
      }),
    );
    expect(() => warmDecode("blob:bad", () => img)).not.toThrow();
    // Let the rejected promise settle; the .catch keeps it from going unhandled.
    await Promise.resolve();
  });

  it("is safe when the image has no decode() (older engines) — still warms the src", () => {
    const img = fakeImage(undefined);
    expect(() => warmDecode("blob:x", () => img)).not.toThrow();
    expect(img.src).toBe("blob:x");
  });

  it("is a no-op when no image factory is available", () => {
    expect(() => warmDecode("blob:none", null)).not.toThrow();
  });
});
