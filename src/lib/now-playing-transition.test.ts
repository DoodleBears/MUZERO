import { beforeEach, describe, expect, it } from "vitest";
import { useNowPlayingTransition } from "./now-playing-transition";

const reset = () =>
  useNowPlayingTransition.setState({ active: false, fromCoverUrl: null, toCoverUrl: null });

describe("useNowPlayingTransition", () => {
  beforeEach(reset);

  it("begin freezes the from/to endpoints and activates", () => {
    useNowPlayingTransition.getState().begin("a.jpg", "b.jpg");
    const s = useNowPlayingTransition.getState();
    expect(s).toMatchObject({ active: true, fromCoverUrl: "a.jpg", toCoverUrl: "b.jpg" });
  });

  it("keeps the frozen endpoints stable — a same-endpoints begin is a no-op", () => {
    const store = useNowPlayingTransition.getState();
    store.begin("a.jpg", "b.jpg");
    const before = useNowPlayingTransition.getState();
    store.begin("a.jpg", "b.jpg");
    // Reference-equal state object → no spurious re-render mid-transition.
    expect(useNowPlayingTransition.getState()).toBe(before);
  });

  it("end deactivates without clearing endpoints (background can fade out from them)", () => {
    const store = useNowPlayingTransition.getState();
    store.begin("a.jpg", "b.jpg");
    store.end();
    expect(useNowPlayingTransition.getState()).toMatchObject({
      active: false,
      fromCoverUrl: "a.jpg",
      toCoverUrl: "b.jpg",
    });
  });

  it("a new transition can re-point to different endpoints", () => {
    const store = useNowPlayingTransition.getState();
    store.begin("a.jpg", "b.jpg");
    store.begin("b.jpg", "c.jpg");
    expect(useNowPlayingTransition.getState()).toMatchObject({
      active: true,
      fromCoverUrl: "b.jpg",
      toCoverUrl: "c.jpg",
    });
  });
});
