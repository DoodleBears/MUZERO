import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stable blob the mocked liveQuery hands back (as if mediaBlobs.get resolved).
const { coverBlob } = vi.hoisted(() => ({
  coverBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
}));

// Isolate the hook from Dexie + settings: the blob is "already resolved", and
// covers render uncropped so no canvas (jsdom has none) is touched.
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => coverBlob }));
vi.mock("@/hooks/use-app-data", () => ({ useSettings: () => ({ coverCropped: false }) }));

import { useTrackCoverUrl } from "./use-media";

let created = 0;

beforeEach(() => {
  created = 0;
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:cover-${++created}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTrackCoverUrl — cross-mount object-URL cache (Phase 1)", () => {
  it("reuses the cached URL across re-mounts: created once, returned synchronously, not revoked on unmount", async () => {
    // Unique id keeps the module-singleton cache isolated from other cases.
    const track = { coverBlobId: "blb_remount_a" };

    const first = renderHook(() => useTrackCoverUrl(track));
    await act(async () => {}); // flush the async produce → store
    const url = first.result.current;
    expect(url).toMatch(/^blob:cover-/);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    first.unmount();
    // The cache owns the URL now — unmount must NOT revoke a still-cached cover.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    // Re-mount (the "switch back to this tab" case): the URL is available on the
    // very first render, with no second createObjectURL.
    const second = renderHook(() => useTrackCoverUrl(track));
    expect(second.result.current).toBe(url);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("returns the remote cover URL when there is no local blob id", () => {
    const { result } = renderHook(() =>
      useTrackCoverUrl({ remoteCoverUrl: "https://example.com/c.jpg" }),
    );
    expect(result.current).toBe("https://example.com/c.jpg");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
