import { afterEach, describe, expect, it, vi } from "vitest";
import type { R2Presence } from "./r2-presence";
import { createR2PresencePoller } from "./r2-presence-poller";

describe("createR2PresencePoller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads presence only while visible and at a low polling interval", async () => {
    vi.useFakeTimers();
    const readPresence = vi.fn(async () => [
      presence({ devicePublicId: "dvc_live", updatedAt: 1_000, expiresAt: 121_000 }),
    ]);
    const onPresence = vi.fn();
    const poller = createR2PresencePoller({
      readPresence,
      onPresence,
      now: () => 60_000,
    });

    poller.setVisible(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(readPresence).toHaveBeenCalledTimes(1);
    expect(onPresence).toHaveBeenCalledWith([
      expect.objectContaining({ devicePublicId: "dvc_live" }),
    ]);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(readPresence).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(readPresence).toHaveBeenCalledTimes(2);

    poller.setVisible(false);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(readPresence).toHaveBeenCalledTimes(2);
    poller.dispose();
  });

  it("drops an in-flight read result after the UI becomes hidden", async () => {
    vi.useFakeTimers();
    let resolveRead: (rows: R2Presence[]) => void = () => {};
    const readPresence = vi.fn(
      () =>
        new Promise<R2Presence[]>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const onPresence = vi.fn();
    const poller = createR2PresencePoller({
      readPresence,
      onPresence,
      now: () => 60_000,
    });

    poller.setVisible(true);
    await Promise.resolve();
    poller.setVisible(false);
    resolveRead([presence({ devicePublicId: "dvc_late" })]);
    await Promise.resolve();

    expect(onPresence).not.toHaveBeenCalled();
    poller.dispose();
  });
});

function presence(overrides: Partial<R2Presence> = {}): R2Presence {
  return {
    schema: "muzero-r2-presence-v1",
    devicePublicId: "dvc_1",
    deviceName: "Studio",
    trackId: "trk_1",
    setId: "ses_1",
    state: "playing",
    positionSec: 12,
    updatedAt: 1_000,
    expiresAt: 121_000,
    ...overrides,
  };
}
