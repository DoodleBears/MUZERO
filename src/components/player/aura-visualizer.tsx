import { VisualizerHost } from "@/visualizer/host";

/**
 * Back-compat shim. The now-playing stage's reactive backdrop now renders
 * whichever visualizer style the user selected via the pluggable VisualizerHost.
 * Kept under this name + props so call sites like media-stage don't need to change.
 */
export function AuraVisualizer({ className, active }: { className?: string; active: boolean }) {
  return <VisualizerHost className={className} active={active} coverColor />;
}
