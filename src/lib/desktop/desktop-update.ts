/**
 * Renderer side of the desktop auto-update IPC (electron/updater.cjs). Subscribes
 * to `window.muzero.update` status broadcasts; degrades to `supported: false` on
 * web / Tauri (where `window.muzero.update` is absent). This module is the single
 * isolated access point for the update bridge — no scattered `window.muzero`
 * checks elsewhere. See docs/prd/20260611-muzero-release-pipeline-changelog-prd §4.1/§5.3.
 */
import { useCallback, useEffect, useState } from "react";

export type UpdateStatusKind =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "manual-required"
  | "error";

export interface UpdateStatus {
  kind: UpdateStatusKind;
  version?: string;
  percent?: number;
  error?: string;
  downloadUrl?: string;
}

export type UpdateChannel = "stable" | "beta";

export interface DesktopUpdateApi {
  onStatus(cb: (status: UpdateStatus) => void): () => void;
  /** Last-known status from the main process (seeds late-mounting UI). Optional
   * for older shells whose preload predates the getter. */
  getStatus?(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  install(): Promise<boolean>;
  setChannel(channel: UpdateChannel): Promise<UpdateStatus>;
}

export function getDesktopUpdateApi(): DesktopUpdateApi | null {
  if (typeof window === "undefined") return null;
  const muzero = window.muzero as
    | ({ update?: DesktopUpdateApi } & Record<string, unknown>)
    | undefined;
  return muzero?.update ?? null;
}

export interface UseDesktopUpdate {
  /** True only on the Electron desktop shell (where the updater exists). */
  supported: boolean;
  status: UpdateStatus;
  check(): void;
  install(): void;
  setChannel(channel: UpdateChannel): void;
}

export function useDesktopUpdate(): UseDesktopUpdate {
  const [api] = useState(getDesktopUpdateApi);
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });

  useEffect(() => {
    if (!api) return;
    const unsubscribe = api.onStatus(setStatus);
    // The startup auto-check (electron/updater.cjs) broadcasts before this hook
    // mounts — with no listener attached yet, those status updates are dropped,
    // so a background check/download stays invisible until a manual re-check.
    // Seed from the main process's last-known status, but don't clobber a live
    // broadcast that already advanced us past idle.
    let active = true;
    api
      .getStatus?.()
      .then((seed) => {
        if (active) setStatus((prev) => (prev.kind === "idle" ? seed : prev));
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const check = useCallback(() => {
    void api
      ?.check()
      .then(setStatus)
      .catch(() => undefined);
  }, [api]);
  const install = useCallback(() => {
    void api?.install().catch(() => undefined);
  }, [api]);
  const setChannel = useCallback(
    (channel: UpdateChannel) => {
      void api
        ?.setChannel(channel)
        .then(setStatus)
        .catch(() => undefined);
    },
    [api],
  );

  return { supported: !!api, status, check, install, setChannel };
}
