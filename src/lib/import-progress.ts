export type ImportProgressPhase = "scanning" | "importing" | "done";
export type ImportProgressMode = "reference" | "copy";

export interface ImportProgress {
  phase: ImportProgressPhase;
  total: number;
  completed: number;
  current?: {
    name: string;
    mode: ImportProgressMode;
    bytesLoaded?: number;
    bytesTotal?: number;
  };
}

export interface BlobCopyProgress {
  bytesLoaded: number;
  bytesTotal: number;
}

export interface CopyBlobWithProgressOptions {
  chunkSizeBytes?: number;
  minEmitIntervalMs?: number;
  minEmitBytes?: number;
  now?: () => number;
  onProgress?: (progress: BlobCopyProgress) => void;
}

const DEFAULT_CHUNK_SIZE_BYTES = 256 * 1024;
const DEFAULT_MIN_EMIT_INTERVAL_MS = 100;
const DEFAULT_MIN_EMIT_BYTES = 256 * 1024;

export async function copyBlobWithProgress(
  blob: Blob,
  options: CopyBlobWithProgressOptions = {},
): Promise<Blob> {
  const chunkSize = Math.max(1, options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES);
  const minEmitIntervalMs = Math.max(0, options.minEmitIntervalMs ?? DEFAULT_MIN_EMIT_INTERVAL_MS);
  const minEmitBytes = Math.max(1, options.minEmitBytes ?? DEFAULT_MIN_EMIT_BYTES);
  const now = options.now ?? (() => performance.now());
  const bytesTotal = blob.size;
  const chunks: ArrayBuffer[] = [];
  let bytesLoaded = 0;
  let lastEmitBytes = 0;
  let lastEmitAt = now();

  const emit = (force = false) => {
    if (!options.onProgress) return;
    const currentTime = now();
    const loadedDelta = bytesLoaded - lastEmitBytes;
    if (
      force ||
      bytesLoaded === bytesTotal ||
      loadedDelta >= minEmitBytes ||
      currentTime - lastEmitAt >= minEmitIntervalMs
    ) {
      lastEmitBytes = bytesLoaded;
      lastEmitAt = currentTime;
      options.onProgress({ bytesLoaded, bytesTotal });
    }
  };

  emit(true);
  while (bytesLoaded < bytesTotal) {
    const end = Math.min(bytesLoaded + chunkSize, bytesTotal);
    chunks.push(await blob.slice(bytesLoaded, end).arrayBuffer());
    bytesLoaded = end;
    emit();
  }
  if (lastEmitBytes !== bytesTotal) emit(true);
  return new Blob(chunks, { type: blob.type });
}

export function importProgressPercent(progress: ImportProgress): number | null {
  const current = progress.current;
  if (
    current?.mode !== "copy" ||
    current.bytesLoaded === undefined ||
    current.bytesTotal === undefined ||
    current.bytesTotal <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((current.bytesLoaded / current.bytesTotal) * 100)));
}
