import type { AppSettings, CloudDrive, R2LocalCredentials, SyncDirection } from "@/db/types";
import type {
  buildR2ExportPlanForDrive,
  R2ExportConflict,
  R2ExportPlan,
  R2ExportPlanForDriveInput,
} from "./r2-export-plan";
import type { runR2PublishSync } from "./r2-publish-sync";
import type { RemoteSetConflict } from "./r2-pull-diff";
import type {
  ApplyRemoteSetPullInput,
  applyRemoteSetPull,
  dryRunRemoteSetPull,
} from "./r2-pull-sync";

/**
 * Pure publish/pull orchestration: maps the already-tested export-plan builder
 * and publish executor into a single user-triggerable run that emits ephemeral
 * progress (PRD §5.3) and respects cancellation. It owns NO IndexedDB or network
 * access — the Zustand store resolves the drive/settings/credentials context and
 * injects the real `buildPlan`/`runPublish`, so this layer stays deterministic
 * and unit-testable without a DB or HTTP.
 */
export type SyncPhase =
  | "planning"
  | "uploading"
  | "downloading"
  | "applying"
  | "completed"
  | "failed"
  | "cancelled"
  | "needs-review";

export interface SyncProgress {
  driveId: string;
  direction: SyncDirection;
  phase: SyncPhase;
  objectsDone: number;
  objectsTotal: number;
  bytesDone: number;
  bytesTotal: number;
  currentKey?: string;
  runId?: string;
  error?: string;
  conflicts?: R2ExportConflict[];
}

export interface PublishDriveContext {
  drive: CloudDrive;
  settings: AppSettings;
  credentials: R2LocalCredentials;
  libraryId: string;
  baseUrl: string;
  setIds: string[];
  /** Forwarded to the plan builder (manual sync flushes a small pending stats segment). */
  planInput?: Partial<R2ExportPlanForDriveInput>;
}

export interface SyncOrchestratorDeps {
  buildPlan: typeof buildR2ExportPlanForDrive;
  runPublish: typeof runR2PublishSync;
  /** Pull deps are optional so a publish-only orchestrator can omit them. */
  dryRunPull?: typeof dryRunRemoteSetPull;
  applyPull?: typeof applyRemoteSetPull;
}

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (progress: SyncProgress) => void;
}

export type PublishRunResult =
  | { status: "completed"; runId: string }
  | { status: "needs-review"; conflicts: R2ExportConflict[] }
  | { status: "cancelled" };

export type PullRunResult =
  | { status: "completed"; mutated: boolean; runId?: string; sessionId?: string }
  | { status: "needs-review"; conflict?: RemoteSetConflict }
  | { status: "blocked"; reason: string }
  | { status: "cancelled" };

export interface SyncOrchestrator {
  publish(ctx: PublishDriveContext, options?: RunOptions): Promise<PublishRunResult>;
  pull(input: ApplyRemoteSetPullInput, options?: RunOptions): Promise<PullRunResult>;
}

export function createSyncOrchestrator(deps: SyncOrchestratorDeps): SyncOrchestrator {
  return {
    async publish(ctx, options = {}) {
      const base = (): SyncProgress => ({
        driveId: ctx.drive.id,
        direction: "push",
        phase: "planning",
        objectsDone: 0,
        objectsTotal: 0,
        bytesDone: 0,
        bytesTotal: 0,
      });
      const emit = (patch: Partial<SyncProgress> & { phase: SyncPhase }): void => {
        options.onProgress?.({ ...base(), ...patch });
      };

      emit({ phase: "planning" });

      const plan: R2ExportPlan = await deps.buildPlan({
        drive: ctx.drive,
        settings: ctx.settings,
        libraryId: ctx.libraryId,
        baseUrl: ctx.baseUrl,
        setIds: ctx.setIds,
        ...ctx.planInput,
      });

      const objectsTotal = plan.objects.length;
      const bytesTotal = plan.totalBytes;

      if (plan.conflicts && plan.conflicts.length > 0) {
        emit({ phase: "needs-review", objectsTotal, bytesTotal, conflicts: plan.conflicts });
        return { status: "needs-review", conflicts: plan.conflicts };
      }

      emit({ phase: "uploading", objectsTotal, bytesTotal });

      try {
        const { runId } = await deps.runPublish(plan, ctx.credentials, {
          signal: options.signal,
          onProgress: (event) =>
            emit({
              phase: "uploading",
              objectsDone: event.uploaded + event.skipped,
              objectsTotal,
              bytesDone: event.bytesDone,
              bytesTotal: event.bytesTotal,
              currentKey: event.object.key,
            }),
        });
        emit({
          phase: "completed",
          objectsDone: objectsTotal,
          objectsTotal,
          bytesDone: bytesTotal,
          bytesTotal,
          runId,
        });
        return { status: "completed", runId };
      } catch (error) {
        if (options.signal?.aborted) {
          emit({ phase: "cancelled", objectsTotal, bytesTotal });
          return { status: "cancelled" };
        }
        emit({
          phase: "failed",
          objectsTotal,
          bytesTotal,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async pull(input, options = {}) {
      const { dryRunPull, applyPull } = deps;
      if (!dryRunPull || !applyPull) {
        throw new Error("sync orchestrator was created without pull dependencies");
      }
      const base = (): SyncProgress => ({
        driveId: input.driveId,
        direction: "pull",
        phase: "planning",
        objectsDone: 0,
        objectsTotal: 0,
        bytesDone: 0,
        bytesTotal: 0,
      });
      const emit = (patch: Partial<SyncProgress> & { phase: SyncPhase }): void => {
        options.onProgress?.({ ...base(), ...patch });
      };

      emit({ phase: "planning" });

      const preview = await dryRunPull(input);
      const objectsTotal = preview.trackCount;
      const bytesTotal = preview.bytes;

      if (preview.action === "blocked") {
        const reason = preview.reason ?? "blocked";
        emit({ phase: "failed", objectsTotal, bytesTotal, error: reason });
        return { status: "blocked", reason };
      }
      if (preview.action === "conflict") {
        emit({ phase: "needs-review", objectsTotal, bytesTotal });
        return { status: "needs-review", conflict: preview.conflict };
      }
      if (!preview.willMutate) {
        emit({ phase: "completed", objectsTotal, bytesTotal });
        return { status: "completed", mutated: false };
      }

      emit({ phase: "applying", objectsTotal, bytesTotal });

      try {
        // Forward the signal so the apply can abort mid-flight (F6), mirroring publish.
        const result = await applyPull({ ...input, signal: options.signal });
        emit({
          phase: "completed",
          objectsDone: objectsTotal,
          objectsTotal,
          bytesDone: bytesTotal,
          bytesTotal,
          runId: result.runId,
        });
        return {
          status: "completed",
          mutated: true,
          runId: result.runId,
          sessionId: result.sessionId,
        };
      } catch (error) {
        if (options.signal?.aborted) {
          emit({ phase: "cancelled", objectsTotal, bytesTotal });
          return { status: "cancelled" };
        }
        emit({
          phase: "failed",
          objectsTotal,
          bytesTotal,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}
