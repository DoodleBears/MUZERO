import { beforeEach, describe, expect, it } from "vitest";
import {
  setSetBulkDownloading,
  setStreamDownloading,
  useStreamCacheStore,
} from "./stream-cache-store";

describe("stream-cache-store", () => {
  beforeEach(() => {
    useStreamCacheStore.setState({ downloading: new Set(), bulkSets: new Set() });
  });

  it("marks and clears a track's in-flight download", () => {
    setStreamDownloading("trk_1", true);
    expect(useStreamCacheStore.getState().downloading.has("trk_1")).toBe(true);

    setStreamDownloading("trk_1", false);
    expect(useStreamCacheStore.getState().downloading.has("trk_1")).toBe(false);
  });

  it("tracks multiple downloads independently", () => {
    setStreamDownloading("trk_1", true);
    setStreamDownloading("trk_2", true);
    const { downloading } = useStreamCacheStore.getState();
    expect([...downloading].sort()).toEqual(["trk_1", "trk_2"]);
  });

  it("is a no-op (stable reference) when the state would not change", () => {
    setStreamDownloading("trk_1", true);
    const before = useStreamCacheStore.getState().downloading;
    setStreamDownloading("trk_1", true); // already downloading
    expect(useStreamCacheStore.getState().downloading).toBe(before);

    setStreamDownloading("trk_2", false); // not downloading → still no change
    expect(useStreamCacheStore.getState().downloading).toBe(before);
  });

  it("tracks a set's bulk download independently of per-track downloads", () => {
    setSetBulkDownloading("ses_1", true);
    setStreamDownloading("trk_1", true);
    expect(useStreamCacheStore.getState().bulkSets.has("ses_1")).toBe(true);
    // The two fields are independent — a bulk run doesn't leak into `downloading`.
    expect(useStreamCacheStore.getState().downloading.has("ses_1")).toBe(false);

    setSetBulkDownloading("ses_1", false);
    expect(useStreamCacheStore.getState().bulkSets.has("ses_1")).toBe(false);
    expect(useStreamCacheStore.getState().downloading.has("trk_1")).toBe(true);
  });
});
