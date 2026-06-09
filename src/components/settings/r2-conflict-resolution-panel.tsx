import { Button } from "@/components/ui/button";
import type { R2ConflictResolutionAction } from "@/sync/r2-conflict-resolution";
import type { SetSyncIndicatorConflict } from "@/sync/r2-set-sync-indicators";

export interface R2ConflictResolutionPanelLabels {
  title: string;
  empty: string;
  keepLocal: string;
  useRemote: string;
  duplicateBoth: string;
  field: string;
  reason: string;
}

export interface R2ConflictResolutionPanelProps {
  conflicts: SetSyncIndicatorConflict[];
  labels: R2ConflictResolutionPanelLabels;
  onResolve: (conflict: SetSyncIndicatorConflict, action: R2ConflictResolutionAction) => void;
}

export function R2ConflictResolutionPanel({
  conflicts,
  labels,
  onResolve,
}: R2ConflictResolutionPanelProps) {
  return (
    <section aria-label={labels.title} className="space-y-3">
      <h3 className="font-medium text-sm">{labels.title}</h3>
      {conflicts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{labels.empty}</p>
      ) : (
        <ul className="space-y-2">
          {conflicts.map((conflict) => (
            <li
              className="rounded-lg border border-border bg-card/60 p-3"
              key={`${conflict.entityType}:${conflict.entityId}:${conflict.field ?? ""}`}
            >
              <div className="space-y-1">
                <p className="font-medium text-sm">
                  {conflict.entityType}: {conflict.entityId}
                </p>
                {conflict.field && (
                  <p className="text-muted-foreground text-xs">
                    {labels.field}: {conflict.field}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  {labels.reason}: {conflict.reason}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  onClick={() => onResolve(conflict, "keep-local")}
                  size="xs"
                  variant="outline"
                >
                  {labels.keepLocal}
                </Button>
                <Button
                  onClick={() => onResolve(conflict, "use-remote")}
                  size="xs"
                  variant="outline"
                >
                  {labels.useRemote}
                </Button>
                <Button
                  onClick={() => onResolve(conflict, "duplicate-both")}
                  size="xs"
                  variant="secondary"
                >
                  {labels.duplicateBoth}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
