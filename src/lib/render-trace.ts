// Dev-only render-commit recorder (PRD 20260617-reactivity-render-observability).
//
// React <Profiler> boundaries around each app SURFACE call `recordCommit` on every
// commit. A harness scenario resets before + snapshots after, so we can see WHICH
// surfaces re-rendered during an interaction — and crucially whether a surface that
// was INACTIVE (a hidden tab / collapsed overlay) still did real render work
// (`hiddenActualMs` > ~0 = wasted reconcile, the class of bug that was invisible to
// span-level tracing). Pure in-memory counters; the boundary is a no-op in prod
// builds (children pass straight through), so this ships nothing.

interface SurfaceStat {
  commits: number;
  mountCommits: number;
  updateCommits: number;
  /** Sum of React's `actualDuration` — ≈0 when the subtree bailed (parent re-rendered
   *  but this surface didn't), > a few tenths of a ms when it actually re-rendered. */
  actualMs: number;
  /** Commits + actualMs accrued while `active === false` (surface not visible). */
  hiddenCommits: number;
  hiddenActualMs: number;
}

const stats = new Map<string, SurfaceStat>();

function blank(): SurfaceStat {
  return {
    commits: 0,
    mountCommits: 0,
    updateCommits: 0,
    actualMs: 0,
    hiddenCommits: 0,
    hiddenActualMs: 0,
  };
}

export function recordCommit(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualMs: number,
  active: boolean,
): void {
  let s = stats.get(id);
  if (!s) {
    s = blank();
    stats.set(id, s);
  }
  s.commits += 1;
  if (phase === "mount") s.mountCommits += 1;
  else s.updateCommits += 1;
  s.actualMs += actualMs;
  if (!active) {
    s.hiddenCommits += 1;
    s.hiddenActualMs += actualMs;
  }
}

export function resetRenderTrace(): void {
  stats.clear();
}

export interface RenderTraceEntry extends SurfaceStat {
  id: string;
}

/** Snapshot, sorted by actual render time desc. `hiddenActualMs` is the red flag. */
export function snapshotRenderTrace(): RenderTraceEntry[] {
  return [...stats.entries()]
    .map(([id, s]) => ({
      id,
      ...s,
      actualMs: Math.round(s.actualMs * 10) / 10,
      hiddenActualMs: Math.round(s.hiddenActualMs * 10) / 10,
    }))
    .sort((a, b) => b.actualMs - a.actualMs);
}
