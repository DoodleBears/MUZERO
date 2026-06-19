import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePausedLiveQuery } from "./use-paused-live-query";

describe("usePausedLiveQuery", () => {
  it("does not call the query while inactive and returns the cached value", async () => {
    const query = vi.fn(async () => "live-a");
    const { result, rerender } = renderHook(
      ({ active }) => usePausedLiveQuery(query, [], active, "initial"),
      { initialProps: { active: false } },
    );

    expect(result.current).toBe("initial");
    expect(query).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ active: true });
    });
    await waitFor(() => expect(result.current).toBe("live-a"));
    expect(query).toHaveBeenCalledTimes(1);

    query.mockResolvedValue("live-b");
    await act(async () => {
      rerender({ active: false });
    });
    expect(result.current).toBe("live-a");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("delays re-subscribing on resume when it already has a cached active value", async () => {
    let seq = 0;
    const query = vi.fn(async () => `live-${++seq}`);
    const { result, rerender } = renderHook(
      ({ active }) => usePausedLiveQuery(query, [], active, "initial", { resumeDelayMs: 40 }),
      { initialProps: { active: true } },
    );

    await waitFor(() => expect(result.current).toBe("live-1"));
    expect(query).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ active: false });
    });
    expect(result.current).toBe("live-1");

    await act(async () => {
      rerender({ active: true });
    });
    expect(result.current).toBe("live-1");
    expect(query).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(query).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  });
});
