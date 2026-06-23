/**
 * Desktop auto-update indicator. Surfaces the background app-update flow
 * ({@link getDesktopUpdateApi} status broadcasts) onto the notification store — the
 * fourth source of "background activity" alongside {@link download-indicator} /
 * {@link playback-indicator} / sync-indicator, so the unified left stack is the single
 * home for everything happening in the background (the unified-progress PRD surface).
 *
 * What it shows:
 *  - `available` / `downloading` → ONE persistent loading toast with a real progress bar
 *    (the auto-downloaded installer is a ~100MB background download — same affordance as
 *    the download queue).
 *  - `downloaded` → swaps to a persistent, actionable success toast ("vX 已就绪" +
 *    「重启以更新」) — the key moment the user must act on.
 *
 * What it deliberately stays SILENT for:
 *  - `checking` / `idle` — happen on every launch + every 6h; would be pure noise.
 *  - `error` — a background auto-check failing every 6h shouldn't nag; the failure is
 *    still visible inline in Settings → About (and a manual check shows it there).
 *  - `manual-required` — on macOS the main process broadcasts this on EVERY check
 *    regardless of whether a newer version exists (unsigned mac can't self-apply), so a
 *    toast would fire on every launch. mac users go through About / the download page.
 *
 * The reconcile lifecycle is pure + injectable (view / t / install) so it unit-tests
 * without a real bridge; `startUpdateIndicator` wires the real notify + update bridge.
 */

import i18n from "@/i18n/i18n";
import { getDesktopUpdateApi, type UpdateStatus } from "@/lib/desktop/desktop-update";
import { type NotificationAction, notify } from "@/stores/notification-store";

/** Minimal notification surface the reconciler needs (injectable for tests). */
export interface UpdateIndicatorView {
  loading: (message: string, opts?: { progress?: number }) => string;
  update: (id: string, patch: { progress?: number }) => void;
  success: (
    message: string,
    opts?: { duration?: number; actions?: NotificationAction[] },
  ) => string;
  dismiss: (id: string) => void;
}

export interface UpdateReconcilerDeps {
  view: UpdateIndicatorView;
  t: (key: string, opts?: Record<string, unknown>) => string;
  install: () => void;
}

/**
 * Stateful reconciler fed each update-status broadcast. Holds one download toast id and
 * the version (captured from `available`, since the `downloading` ticks carry only a
 * percent). `readyShown` guards against re-pushing the success toast on repeated
 * `downloaded` broadcasts within a session.
 */
export function createUpdateReconciler(deps: UpdateReconcilerDeps): (status: UpdateStatus) => void {
  let toastId: string | null = null;
  let version = "";
  let readyShown = false;

  const clearToast = () => {
    if (toastId !== null) {
      deps.view.dismiss(toastId);
      toastId = null;
    }
  };

  return (status) => {
    switch (status.kind) {
      case "available":
      case "downloading": {
        if (status.version) version = status.version;
        const progress =
          status.kind === "downloading" && typeof status.percent === "number"
            ? status.percent / 100
            : undefined;
        if (toastId !== null) {
          deps.view.update(toastId, { progress });
        } else {
          toastId = deps.view.loading(deps.t("update.available", { version }), { progress });
        }
        return;
      }
      case "downloaded": {
        clearToast();
        if (readyShown) return;
        readyShown = true;
        deps.view.success(deps.t("update.downloaded", { version: status.version || version }), {
          duration: 0, // persist until the user restarts or dismisses
          actions: [
            { label: deps.t("update.restartToUpdate"), onClick: deps.install, keepOpen: true },
          ],
        });
        return;
      }
      default:
        // idle | checking | error | manual-required → no proactive toast (see file header).
        clearToast();
        return;
    }
  };
}

let started = false;

/** Subscribe the desktop updater to the notification stack. No-op on web / Tauri (no
 *  updater bridge). Idempotent (StrictMode-safe). */
export function startUpdateIndicator(): void {
  if (started) return;
  const api = getDesktopUpdateApi();
  if (!api) return; // web / Tauri shells have no auto-updater
  started = true;
  const reconcile = createUpdateReconciler({
    view: notify,
    t: (key, opts) => i18n.t(key as never, opts as never) as unknown as string,
    install: () => void api.install().catch(() => undefined),
  });
  api.onStatus(reconcile);
}
