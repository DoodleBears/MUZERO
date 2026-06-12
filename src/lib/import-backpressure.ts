const MIB = 1024 * 1024;

export const PLAINTEXT_IMPORT_BACKPRESSURE_THRESHOLD_BYTES = 64 * MIB;
export const DECODED_IMPORT_BACKPRESSURE_THRESHOLD_BYTES = 16 * MIB;
export const IMPORT_BACKPRESSURE_MAX_DELAY_MS = 200;

export interface ImportBackpressureInput {
  inputBytes?: number;
  decodedBytes?: number;
  decodedContainer?: boolean;
}

export type ImportBackpressureScheduler = (delayMs: number) => Promise<void>;

export function importBackpressureDelayMs(input: ImportBackpressureInput): number {
  const inputBytes = finiteBytes(input.inputBytes);
  const decodedBytes = finiteBytes(input.decodedBytes);
  const largest = Math.max(inputBytes, decodedBytes);
  const threshold = input.decodedContainer
    ? DECODED_IMPORT_BACKPRESSURE_THRESHOLD_BYTES
    : PLAINTEXT_IMPORT_BACKPRESSURE_THRESHOLD_BYTES;
  if (largest < threshold) return 0;
  const steps = Math.max(1, Math.ceil(largest / threshold));
  return Math.min(IMPORT_BACKPRESSURE_MAX_DELAY_MS, 25 + steps * 25);
}

export async function yieldForImportBackpressure(
  input: ImportBackpressureInput,
  scheduler: ImportBackpressureScheduler = sleep,
): Promise<number> {
  const delayMs = importBackpressureDelayMs(input);
  if (delayMs <= 0) return 0;
  await scheduler(delayMs);
  return delayMs;
}

function finiteBytes(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
