import { afterEach, describe, expect, it } from "vitest";
import { useNavStore } from "./nav-store";

afterEach(() => {
  useNavStore.setState({ tab: "sessions" });
  localStorage.clear();
});

describe("nav-store — persisted active tab", () => {
  it("defaults to the sessions tab", () => {
    expect(useNavStore.getState().tab).toBe("sessions");
  });

  it("setTab updates the active tab and persists it", () => {
    useNavStore.getState().setTab("search");
    expect(useNavStore.getState().tab).toBe("search");
    // zustand persist writes to localStorage under the configured key.
    expect(localStorage.getItem("muzero-nav")).toContain("search");
  });
});
