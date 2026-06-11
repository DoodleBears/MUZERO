import type { R2LocalCredentials } from "@/db/types";
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import type { R2ExportObject, R2ExportPlan } from "./r2-export-plan";
import { r2SignedFetch } from "./r2-s3";
import type { SyncFetch } from "./r2-subscription";

export type R2PublishObjectStatus = "uploading" | "uploaded" | "skipped";

/**
 * An upload that failed with a definite HTTP status. A 412 means a conditional
 * write lost a race with another publisher — the orchestrator refetches the
 * remote base, re-merges, and retries (PRD §12.4).
 */
export class R2PublishHttpError extends Error {
  readonly status: number;
  readonly key: string;
  readonly responseText?: string;

  constructor(key: string, status: number, responseText?: string) {
    super(`Failed to upload ${key}: HTTP ${status}${responseText ? ` (${responseText})` : ""}`);
    this.name = "R2PublishHttpError";
    this.status = status;
    this.key = key;
    this.responseText = responseText;
  }
}

export function isPreconditionFailure(error: unknown): boolean {
  return error instanceof R2PublishHttpError && error.status === 412;
}

export function preconditionFailureKey(error: unknown): string | undefined {
  return error instanceof R2PublishHttpError && error.status === 412 ? error.key : undefined;
}

export interface R2PublishProgressEvent {
  object: R2ExportObject;
  status: R2PublishObjectStatus;
  uploaded: number;
  skipped: number;
  bytesDone: number;
  bytesTotal: number;
  activeUploads?: number;
}

export interface R2PublishResult {
  uploaded: number;
  skipped: number;
  failed: number;
  bytesDone: number;
  bytesTotal: number;
}

export interface R2PublishOptions {
  fetcher?: SyncFetch;
  now?: () => Date;
  signal?: AbortSignal;
  onProgress?: (event: R2PublishProgressEvent) => void;
  onObjectSynced?: (object: R2ExportObject, status: R2PublishObjectStatus) => void | Promise<void>;
  retry?: R2PublishRetryOptions;
  /** First publish into an empty remote can PUT content-addressed objects directly. */
  skipExistingChecks?: boolean;
  isKnownUploaded?: (object: R2ExportObject) => boolean;
  /** Max parallel immutable/resumable object uploads. Mutable JSON remains ordered. */
  uploadConcurrency?: number;
}

/**
 * Transient-failure retry for object uploads (audit F7). Only network errors and
 * 5xx/429 responses retry; other HTTP failures (e.g. a 412 precondition) surface
 * immediately. Backoff doubles per retry; `sleep` is injectable for tests.
 */
export interface R2PublishRetryOptions {
  /** Total attempts per object, including the first (default 3). */
  attempts?: number;
  /** Base backoff in ms, doubled each retry (default 500). */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function publishR2ExportPlan(
  plan: R2ExportPlan,
  credentials: R2LocalCredentials,
  options: R2PublishOptions = {},
): Promise<R2PublishResult> {
  const fetcher = options.fetcher ?? (await getAppFetch());
  const result: R2PublishResult = {
    uploaded: 0,
    skipped: 0,
    failed: 0,
    bytesDone: 0,
    bytesTotal: plan.totalBytes,
  };

  const uploadConcurrency = clampUploadConcurrency(options.uploadConcurrency);
  let concurrentGroup: R2ExportObject[] = [];
  const activeUploads = { count: 0 };

  const flushConcurrentGroup = async (): Promise<void> => {
    if (concurrentGroup.length === 0) return;
    const group = concurrentGroup;
    concurrentGroup = [];
    for (let index = 0; index < group.length; index += uploadConcurrency) {
      const chunk = group.slice(index, index + uploadConcurrency);
      await Promise.all(
        chunk.map((object) =>
          publishObject(object, credentials, fetcher, options, result, activeUploads),
        ),
      );
    }
  };

  for (const object of plan.objects) {
    throwIfAborted(options.signal);
    if (uploadConcurrency > 1 && isConcurrentSafeObject(object)) {
      concurrentGroup.push(object);
    } else {
      await flushConcurrentGroup();
      await publishObject(object, credentials, fetcher, options, result, activeUploads);
    }
  }
  await flushConcurrentGroup();

  return result;
}

async function publishObject(
  object: R2ExportObject,
  credentials: R2LocalCredentials,
  fetcher: SyncFetch,
  options: R2PublishOptions,
  result: R2PublishResult,
  activeUploads: { count: number },
): Promise<void> {
  throwIfAborted(options.signal);
  if (options.isKnownUploaded?.(object)) {
    await markObjectSynced(object, "skipped", options);
    result.skipped += 1;
    result.bytesDone += object.bytes;
    options.onProgress?.({ object, status: "skipped", ...result });
    return;
  }
  if (
    !options.skipExistingChecks &&
    (await shouldSkipObject(object, credentials, fetcher, options))
  ) {
    await markObjectSynced(object, "skipped", options);
    result.skipped += 1;
    result.bytesDone += object.bytes;
    options.onProgress?.({ object, status: "skipped", ...result });
    return;
  }

  let response: Response;
  try {
    activeUploads.count += 1;
    options.onProgress?.({
      object,
      status: "uploading",
      activeUploads: activeUploads.count,
      ...result,
    });
    response = await putObjectWithRetry(object, credentials, fetcher, options);
  } catch (error) {
    result.failed += 1;
    throw error;
  } finally {
    activeUploads.count = Math.max(0, activeUploads.count - 1);
  }
  if (!response.ok) {
    result.failed += 1;
    if (response.status === 412) {
      log.warn("sync", "publish object precondition failed", {
        key: object.key,
        kind: object.kind,
        status: response.status,
        precondition: object.precondition,
      });
    }
    throw new R2PublishHttpError(object.key, response.status);
  }
  result.uploaded += 1;
  result.bytesDone += object.bytes;
  await markObjectSynced(object, "uploaded", options);
  options.onProgress?.({
    object,
    status: "uploaded",
    activeUploads: activeUploads.count,
    ...result,
  });
}

async function markObjectSynced(
  object: R2ExportObject,
  status: R2PublishObjectStatus,
  options: R2PublishOptions,
): Promise<void> {
  await options.onObjectSynced?.(object, status);
}

async function putObjectWithRetry(
  object: R2ExportObject,
  credentials: R2LocalCredentials,
  fetcher: SyncFetch,
  options: Pick<R2PublishOptions, "now" | "signal" | "retry">,
): Promise<Response> {
  const attempts = Math.max(1, options.retry?.attempts ?? 3);
  const backoffMs = options.retry?.backoffMs ?? 500;
  const sleep =
    options.retry?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastFailure: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      throwIfAborted(options.signal);
      await sleep(backoffMs * 2 ** (attempt - 1));
      throwIfAborted(options.signal);
    }
    try {
      const response = await r2SignedFetch({
        fetcher,
        credentials,
        method: "PUT",
        key: object.key,
        body: object.body,
        contentType: object.contentType,
        headers: preconditionHeaders(object),
        now: options.now,
        signal: options.signal,
      });
      // Non-transient HTTP failures (e.g. 412 If-Match) surface to the caller.
      if (response.ok || !isTransientStatus(response.status)) return response;
      lastFailure = new R2PublishHttpError(
        object.key,
        response.status,
        await responseSummary(response),
      );
    } catch (error) {
      if (isAbortError(error)) throw error;
      lastFailure = error;
    }
  }
  throw lastFailure instanceof Error
    ? lastFailure
    : new Error(`Failed to upload ${object.key}: ${String(lastFailure)}`);
}

async function responseSummary(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    const normalized = text.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, 300) : undefined;
  } catch {
    return undefined;
  }
}

async function shouldSkipObject(
  object: R2ExportObject,
  credentials: R2LocalCredentials,
  fetcher: SyncFetch,
  options: Pick<R2PublishOptions, "now" | "signal">,
): Promise<boolean> {
  if (!isSkippableObject(object)) return false;
  try {
    const response = await r2SignedFetch({
      fetcher,
      credentials,
      method: "HEAD",
      key: object.key,
      contentType: object.contentType,
      now: options.now,
      signal: options.signal,
    });
    return response.ok;
  } catch (error) {
    if (isAbortError(error)) throw error;
    // A failed probe just means "can't prove it exists" — fall through to the
    // PUT (which has its own retry) instead of failing the whole publish (F7).
    return false;
  }
}

function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

function preconditionHeaders(object: R2ExportObject): Record<string, string> | undefined {
  if (!object.precondition) return undefined;
  return {
    ...(object.precondition.ifMatch ? { "if-match": object.precondition.ifMatch } : {}),
    ...(object.precondition.ifNoneMatch
      ? { "if-none-match": object.precondition.ifNoneMatch }
      : {}),
  };
}

function isSkippableObject(object: R2ExportObject): boolean {
  return isImmutableUploadObject(object);
}

function isConcurrentSafeObject(object: R2ExportObject): boolean {
  return isImmutableUploadObject(object);
}

function isImmutableUploadObject(object: R2ExportObject): boolean {
  return (
    object.kind === "media" ||
    object.kind === "cover" ||
    object.kind === "memory-photo" ||
    object.kind === "device-avatar" ||
    object.kind === "entity-cover" ||
    object.kind === "stats-events-segment"
  );
}

function clampUploadConcurrency(value: number | undefined): number {
  if (value === 1 || value === 2 || value === 3) return value;
  return 1;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException("R2 publish was cancelled.", "AbortError");
}
