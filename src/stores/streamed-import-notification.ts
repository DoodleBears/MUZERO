/**
 * Surface a streamed-playlist import as a BACKGROUND task through the top-left
 * notification stack instead of a blocking modal.
 *
 * Mirrors the sync-indicator / download-indicator lifecycle: one persistent loading
 * toast → live progress (counter + thin bar) → a terminal success toast, or an error
 * toast on failure. The import dialog fires this and closes immediately, so the user
 * keeps browsing/playing while a 1000+ track playlist writes in the background.
 *
 * Kept as a tiny module-scope helper (not inline in the giant player-store, not a full
 * liveQuery indicator) so the notification lifecycle is unit-testable in isolation.
 */
import { notify as defaultNotify } from "@/stores/notification-store";

/** The slice of the notification API this helper needs — injectable for tests. */
export interface ImportNotifier {
  loading: (message: string) => string;
  update: (
    id: string,
    patch: { type?: "success"; message?: string; detail?: string; progress?: number },
  ) => void;
  dismiss: (id: string) => void;
  error: (message: string, opts?: { error?: unknown }) => void;
}

export interface StreamedImportRun {
  /** Persistent loading toast text shown while the import runs. */
  loadingLabel: string;
  /** Toast text if the import throws. */
  errorLabel: string;
  /**
   * The async import. Receives a progress reporter (wire it to the batched-fetch
   * `onProgress` of `importPlaylist` etc.) and resolves to the terminal success toast text.
   * `total` may be omitted when the source can't know it upfront — then the toast shows a
   * growing counter instead of a determinate bar.
   */
  run: (onProgress: (done: number, total?: number) => void) => Promise<string>;
}

/**
 * Drive one import op end-to-end against the notification stack. Never rejects — a
 * thrown import becomes an error toast — so callers can safely fire-and-forget (`void`).
 */
export async function runStreamedImportWithNotification(
  op: StreamedImportRun,
  notifier: ImportNotifier = defaultNotify,
): Promise<void> {
  const id = notifier.loading(op.loadingLabel);
  try {
    const message = await op.run((done, total) =>
      notifier.update(id, {
        detail: total != null ? `${done} / ${total}` : `${done}`,
        progress: total != null && total > 0 ? done / total : undefined,
      }),
    );
    // Flip loading → success (auto-dismisses); clear the counter/bar for a clean line.
    notifier.update(id, { type: "success", message, detail: undefined, progress: undefined });
  } catch (error) {
    notifier.dismiss(id);
    notifier.error(op.errorLabel, { error });
  }
}
