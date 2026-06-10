import { create } from "zustand";

/**
 * Live progress for a local-folder import run. The heavy work lives in
 * `player-store`'s `runFolderSync`; this store is the thin reactive surface the
 * persistent sync indicator (and any UI) subscribes to, plus the cancel handle.
 * The `AbortController` is a module-scope singleton (never selected → no rerenders).
 */

export type FolderImportPhase = "scanning" | "importing" | "covers" | "completed" | "cancelled";

export interface FolderImportProgress {
  phase: FolderImportPhase;
  /** Files processed so far (this run, across all folders). */
  done: number;
  /** Total fresh files to import (known after scanning). */
  total: number;
  /** Tracks actually imported. */
  imported: number;
  /** Basename of the file currently importing. */
  currentName?: string;
  /** Remote covers fetched so far (the `covers` phase, after the audio is in). */
  coverDone?: number;
  /** Total remote covers to fetch this run (the `covers` phase). */
  coverTotal?: number;
  /** Encrypted store-format files skipped (not decoded). */
  encrypted: number;
  /** Files that decoded as media but this runtime can't play. */
  decodeFailed: number;
}

interface FolderImportState {
  progress: FolderImportProgress | null;
  /** Request cancellation of the in-flight run (checked between files). */
  cancel: () => void;
}

let controller: AbortController | null = null;

export const useFolderImportStore = create<FolderImportState>(() => ({
  progress: null,
  cancel: () => controller?.abort(),
}));

/** Start a run: fresh AbortController + reset progress. Returns its signal. */
export function beginFolderImport(): AbortSignal {
  controller = new AbortController();
  return controller.signal;
}

/** End a run (clears the controller; progress is left at its terminal value). */
export function endFolderImport(): void {
  controller = null;
}

/** Push the latest progress snapshot (called by `runFolderSync`). */
export function setFolderImportProgress(progress: FolderImportProgress | null): void {
  useFolderImportStore.setState({ progress });
}
