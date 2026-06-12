import { flushSync } from "react-dom";
import { startViewTransition } from "./view-transition";

/**
 * Run a React state update as a whole-page view transition. `flushSync` forces
 * React to apply the update synchronously inside the transition callback so the
 * native API snapshots the post-update DOM (without it, React's async batching
 * would let the snapshot capture the old tree). Falls back to a plain flushed
 * update when the native API is unavailable — see `startViewTransition`.
 *
 * Lives separately from the React-agnostic `view-transition.ts` so that helper
 * stays free of a react-dom dependency.
 */
export function transitionState(update: () => void): void {
  startViewTransition(() => flushSync(update));
}
