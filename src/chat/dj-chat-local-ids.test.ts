import { describe, expect, it } from "vitest";
import {
  createDjChatLocalIdRegistry,
  resolveResultRef,
  resolveSetRef,
  resolveTrackRef,
  UnknownDjChatLocalIdError,
  WrongDjChatLocalIdTypeError,
} from "./dj-chat-local-ids";

describe("DjChatLocalIdRegistry", () => {
  it("encodes real ids idempotently with independent per-prefix counters", () => {
    const registry = createDjChatLocalIdRegistry();

    expect(registry.toLocal("trk_a", "T")).toBe("#T1");
    expect(registry.toLocal("trk_a", "T")).toBe("#T1");
    expect(registry.toLocal("trk_b", "T")).toBe("#T2");
    expect(registry.toLocal("ses_a", "S")).toBe("#S1");
    expect(registry.toLocal("mem_a", "M")).toBe("#M1");
    expect(registry.toLocal("pqe_a", "Q")).toBe("#Q1");
    expect(registry.toLocal("result:call_1", "R")).toBe("#R1");
  });

  it("hydrates from snapshots, resumes counters, and skips corrupt rows", () => {
    const registry = createDjChatLocalIdRegistry([
      { local: "#T4", real: "trk_old", type: "T" },
      { local: "#S2", real: "ses_old", type: "S" },
      { local: "#Z1", real: "bad_prefix", type: "T" },
      { local: "#Tbad", real: "bad_index", type: "T" },
      { local: "#T5", real: "", type: "T" },
    ]);

    expect(registry.toLocal("trk_old", "T")).toBe("#T4");
    expect(registry.toLocal("trk_new", "T")).toBe("#T5");
    expect(registry.toLocal("ses_new", "S")).toBe("#S3");
    expect(registry.snapshot()).toEqual([
      { local: "#T4", real: "trk_old", type: "T" },
      { local: "#S2", real: "ses_old", type: "S" },
      { local: "#T5", real: "trk_new", type: "T" },
      { local: "#S3", real: "ses_new", type: "S" },
    ]);
  });

  it("passes raw ids through but throws typed errors for unknown known-prefix refs", () => {
    const registry = createDjChatLocalIdRegistry();

    expect(registry.fromLocal("trk_raw")).toBe("trk_raw");
    expect(registry.resolveLocal("#Z1")).toEqual({ real: "#Z1", type: null });
    expect(() => registry.fromLocal("#T999")).toThrow(UnknownDjChatLocalIdError);
  });

  it("resolves typed refs and rejects wrong-type/result refs", () => {
    const registry = createDjChatLocalIdRegistry();
    const trackRef = registry.toLocal("trk_a", "T");
    const setRef = registry.toLocal("ses_a", "S");
    const resultRef = registry.toLocal("result:library_search:1", "R", {
      toolName: "library_search",
    });

    expect(resolveTrackRef(trackRef, registry)).toBe("trk_a");
    expect(resolveSetRef(setRef, registry)).toBe("ses_a");
    expect(resolveResultRef(resultRef, registry)).toMatchObject({
      real: "result:library_search:1",
      type: "R",
      meta: { toolName: "library_search" },
    });
    expect(() => resolveTrackRef(setRef, registry)).toThrow(WrongDjChatLocalIdTypeError);
    expect(() => resolveTrackRef(resultRef, registry)).toThrow(WrongDjChatLocalIdTypeError);
    expect(resolveTrackRef("trk_raw", registry)).toBe("trk_raw");
  });
});
