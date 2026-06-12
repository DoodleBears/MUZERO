import { describe, expect, it, vi } from "vitest";
import { importBackpressureDelayMs, yieldForImportBackpressure } from "./import-backpressure";

const mib = (n: number) => n * 1024 * 1024;

describe("import backpressure", () => {
  it("does not delay small plaintext imports", () => {
    expect(importBackpressureDelayMs({ inputBytes: mib(12) })).toBe(0);
  });

  it("delays large plaintext byte imports", () => {
    expect(importBackpressureDelayMs({ inputBytes: mib(96) })).toBeGreaterThan(0);
  });

  it("uses a lower threshold when decoded media bytes are present", () => {
    const ncmDelay = importBackpressureDelayMs({
      inputBytes: mib(12),
      decodedBytes: mib(24),
      decodedContainer: true,
    });
    expect(ncmDelay).toBeGreaterThan(0);
  });

  it("caps very large import delays", () => {
    expect(
      importBackpressureDelayMs({
        inputBytes: mib(900),
        decodedBytes: mib(900),
        decodedContainer: true,
      }),
    ).toBeLessThanOrEqual(200);
  });

  it("invokes the scheduler only when a delay is needed", async () => {
    const scheduler = vi.fn(async () => {});

    expect(await yieldForImportBackpressure({ inputBytes: mib(1) }, scheduler)).toBe(0);
    expect(scheduler).not.toHaveBeenCalled();

    const delayed = await yieldForImportBackpressure(
      { inputBytes: mib(20), decodedBytes: mib(20), decodedContainer: true },
      scheduler,
    );
    expect(delayed).toBeGreaterThan(0);
    expect(scheduler).toHaveBeenCalledWith(delayed);
  });
});
