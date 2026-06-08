import type { R2LocalCredentials } from "@/db/types";
import { getAppFetch } from "@/lib/platform";
import type { R2ExportObject, R2ExportPlan } from "./r2-export-plan";
import { r2SignedFetch } from "./r2-s3";
import type { SyncFetch } from "./r2-subscription";

export type R2PublishObjectStatus = "uploaded" | "skipped";

export interface R2PublishProgressEvent {
  object: R2ExportObject;
  status: R2PublishObjectStatus;
  uploaded: number;
  skipped: number;
  bytesDone: number;
  bytesTotal: number;
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

  for (const object of plan.objects) {
    throwIfAborted(options.signal);
    if (await shouldSkipObject(object, credentials, fetcher, options)) {
      result.skipped += 1;
      result.bytesDone += object.bytes;
      options.onProgress?.({ object, status: "skipped", ...result });
      continue;
    }

    const response = await r2SignedFetch({
      fetcher,
      credentials,
      method: "PUT",
      key: object.key,
      body: object.body,
      contentType: object.contentType,
      now: options.now,
    });
    if (!response.ok) {
      result.failed += 1;
      throw new Error(`Failed to upload ${object.key}: HTTP ${response.status}`);
    }
    result.uploaded += 1;
    result.bytesDone += object.bytes;
    options.onProgress?.({ object, status: "uploaded", ...result });
  }

  return result;
}

async function shouldSkipObject(
  object: R2ExportObject,
  credentials: R2LocalCredentials,
  fetcher: SyncFetch,
  options: Pick<R2PublishOptions, "now">,
): Promise<boolean> {
  if (!object.sha256) return false;
  const response = await r2SignedFetch({
    fetcher,
    credentials,
    method: "HEAD",
    key: object.key,
    contentType: object.contentType,
    now: options.now,
  });
  return response.ok;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException("R2 publish was cancelled.", "AbortError");
}
