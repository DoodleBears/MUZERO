import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/db/types";

// The provider methods are spied; the hooks must route through them and never write DB.
const getDaily = vi.fn();
const getRecommended = vi.fn();
let settingsValue: Partial<AppSettings>;

vi.mock("@/hooks/use-app-data", () => ({ useSettings: () => settingsValue }));
vi.mock("@/streamsrc/stream-http", () => ({ createStreamHttp: () => async () => ({}) }));
vi.mock("@/streamsrc/registry", () => ({
  createStreamSource: () => ({
    getDailyRecommendedTracks: getDaily,
    getRecommendedPlaylists: getRecommended,
  }),
}));

import { useNeteaseDailyTracks, useNeteaseRecommendedPlaylists } from "./use-netease-recommend";

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  getDaily.mockReset().mockResolvedValue([{ externalId: "1", title: "x", source: "netease" }]);
  getRecommended
    .mockReset()
    .mockResolvedValue([{ id: "p1", name: "n", trackCount: 1, source: "netease" }]);
});

describe("useNeteaseDailyTracks", () => {
  it("stays idle and never requests when logged out (no MUSIC_U)", () => {
    settingsValue = { streamSources: { netease: { enabled: true } } };
    const { result } = renderHook(() => useNeteaseDailyTracks(), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle"); // enabled:false → no request
    expect(getDaily).not.toHaveBeenCalled();
  });

  it("fetches daily tracks when logged in (MUSIC_U present)", async () => {
    settingsValue = { streamSources: { netease: { enabled: true, cookie: "MUSIC_U=abc" } } };
    const { result } = renderHook(() => useNeteaseDailyTracks(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getDaily).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([{ externalId: "1", title: "x", source: "netease" }]);
  });
});

describe("useNeteaseRecommendedPlaylists", () => {
  it("fetches even when anonymous (login not required)", async () => {
    settingsValue = { streamSources: {} };
    const { result } = renderHook(() => useNeteaseRecommendedPlaylists(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getRecommended).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([
      { id: "p1", name: "n", trackCount: 1, source: "netease" },
    ]);
  });
});
