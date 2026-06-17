import { Profiler, type ReactNode, useRef } from "react";
import { recordCommit } from "@/lib/render-trace";

// Render-trace is on under DEV or the profiling build (VITE_MUZERO_PROFILE), matching
// the perf-control bridge — never in a plain prod release.
const ENABLED = import.meta.env.DEV || import.meta.env.VITE_MUZERO_PROFILE === "1";

/**
 * Wraps a SURFACE subtree in a React `<Profiler>` so the render-trace records when it
 * re-renders (PRD 20260617-reactivity-render-observability). `active` marks whether
 * the surface is currently visible — a commit with real `actualDuration` while
 * `active === false` is a wasted hidden re-render (the hidden-tab class). In a plain
 * prod build this is a transparent pass-through (no Profiler, zero overhead).
 */
export function RenderTraceBoundary({
  id,
  active = true,
  children,
}: {
  id: string;
  active?: boolean;
  children: ReactNode;
}) {
  // Read `active` fresh in onRender (which may fire from a parent commit where this
  // boundary didn't re-capture the prop) via a ref.
  const activeRef = useRef(active);
  activeRef.current = active;
  if (!ENABLED) return <>{children}</>;
  return (
    <Profiler
      id={id}
      onRender={(_id, phase, actualDuration) =>
        recordCommit(id, phase, actualDuration, activeRef.current)
      }
    >
      {children}
    </Profiler>
  );
}
