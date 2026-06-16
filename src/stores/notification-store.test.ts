import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notify, useNotificationStore } from "@/stores/notification-store";

describe("notification store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationStore.getState().clear();
  });
  afterEach(() => {
    useNotificationStore.getState().clear();
    vi.useRealTimers();
  });

  const queue = () => useNotificationStore.getState().queue;

  it("keeps errors persistent (no auto-dismiss)", () => {
    notify.error("boom");
    vi.advanceTimersByTime(60_000);
    expect(queue()).toHaveLength(1);
    expect(queue()[0].type).toBe("error");
  });

  it("auto-dismisses a success after its default duration", () => {
    notify.success("ok");
    expect(queue()).toHaveLength(1);
    vi.advanceTimersByTime(3000);
    expect(queue()).toHaveLength(0);
  });

  it("dismisses by id", () => {
    const id = notify.error("boom");
    notify.dismiss(id);
    expect(queue()).toHaveLength(0);
  });

  it("captures debug info + detail from an Error for the copy payload", () => {
    notify.error("Playback error", {
      error: new Error("decode failed"),
      detail: "MEDIA_ERR_DECODE",
    });
    const item = queue()[0];
    expect(item.detail).toBe("MEDIA_ERR_DECODE");
    expect(item.debug?.message).toBe("decode failed");
    // A real Error already carries its own stack — keep it, don't synthesize.
    expect(item.debug?.stack).toContain("decode failed");
  });

  it("synthesizes a report-site stack when the error carries none", () => {
    // Bare message, no thrown value — the copy payload would otherwise be
    // stack-less, so we capture one at the call site.
    notify.error("boom");
    expect(queue()[0].debug?.stack).toBeTruthy();
  });

  it("synthesizes a stack for stack-less thrown values (string / MediaError)", () => {
    notify.error("Playback error", { error: "MEDIA_ERR_DECODE" });
    const item = queue()[0];
    expect(item.debug?.stack).toBeTruthy();
  });

  it("caps transient notifications so the queue can't grow unbounded", () => {
    for (let i = 0; i < 8; i++) notify.success(`s${i}`);
    expect(queue().filter((n) => n.duration > 0).length).toBeLessThanOrEqual(5);
  });

  it("resolves a loading notification via update()", () => {
    const id = notify.loading("working");
    expect(queue()[0].type).toBe("loading");
    notify.update(id, { type: "success", message: "done" });
    expect(queue().find((n) => n.id === id)?.type).toBe("success");
  });
});
