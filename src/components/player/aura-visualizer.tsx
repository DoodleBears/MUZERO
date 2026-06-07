import { VisualizerHost } from "@/visualizer/host";

/**
 * Back-compat shim. The now-playing stage's reactive backdrop — historically the
 * "aura" bloom, now whichever visualizer style the user selected (default aura),
 * rendered via the pluggable VisualizerHost. Kept under this name + props so call
 * sites (media-stage, now-playing-sheet) don't need to change.
 */
export function AuraVisualizer({ className, active }: { className?: string; active: boolean }) {
  return <VisualizerHost className={className} active={active} />;
}
