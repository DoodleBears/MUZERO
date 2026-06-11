import { describe, expect, it } from "vitest";
import { shouldAutoDispatchQueued } from "./dj-chat-auto-dispatch";

const base = {
  enabled: true,
  status: "idle" as const,
  queueLength: 2,
  pendingApprovalCount: 0,
};

describe("shouldAutoDispatchQueued", () => {
  it("dispatches when enabled, idle, queue non-empty, and nothing pending", () => {
    expect(shouldAutoDispatchQueued(base)).toBe(true);
  });

  it("never dispatches while the auto switch is off", () => {
    expect(shouldAutoDispatchQueued({ ...base, enabled: false })).toBe(false);
  });

  it("waits until the current turn finishes (idle only)", () => {
    expect(shouldAutoDispatchQueued({ ...base, status: "submitted" })).toBe(false);
    expect(shouldAutoDispatchQueued({ ...base, status: "streaming" })).toBe(false);
    expect(shouldAutoDispatchQueued({ ...base, status: "error" })).toBe(false);
  });

  it("does nothing with an empty queue", () => {
    expect(shouldAutoDispatchQueued({ ...base, queueLength: 0 })).toBe(false);
  });

  it("pauses while a tool approval is pending (cost gate outranks auto-dispatch)", () => {
    expect(shouldAutoDispatchQueued({ ...base, pendingApprovalCount: 1 })).toBe(false);
  });
});
