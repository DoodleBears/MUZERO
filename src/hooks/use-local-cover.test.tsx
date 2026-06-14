import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaBlob } from "@/db/types";
import { useLocalCoverResource } from "./use-local-cover";

const mocks = vi.hoisted(() => ({
  buildUrl: vi.fn(),
  liveRow: undefined as MediaBlob | null | undefined,
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => mocks.liveRow,
}));

vi.mock("@/db/muzero-db", () => ({
  db: {
    mediaBlobs: {
      get: vi.fn(),
    },
  },
}));

vi.mock("@/lib/desktop/bridge", () => ({
  resolveDesktopBridge: () => ({
    localMediaUrlForStorageKey: mocks.buildUrl,
  }),
}));

describe("useLocalCoverResource", () => {
  it("treats a stale liveQuery row for the previous cover as pending", () => {
    mocks.liveRow = makeCoverRow("blb_previous", {
      storageBackend: "electron-file",
      storageKey: "cover/previous.jpg",
    });

    const { result } = renderHook(() => useLocalCoverResource({ coverBlobId: "blb_current" }));

    expect(result.current).toMatchObject({
      canServe: null,
      coverBlobId: "blb_current",
      pending: true,
      pendingReason: "row",
      storageKey: null,
      url: null,
    });
    expect(mocks.buildUrl).not.toHaveBeenCalled();
  });
});

function makeCoverRow(id: string, overrides: Partial<MediaBlob> = {}): MediaBlob {
  return {
    bytes: 1,
    id,
    mime: "image/jpeg",
    role: "cover",
    trackId: "trk_1",
    ...overrides,
  };
}
