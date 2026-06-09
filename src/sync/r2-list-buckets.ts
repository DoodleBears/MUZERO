import { getAppFetch } from "@/lib/platform";
import { signR2S3Request } from "./r2-s3";
import type { SyncFetch } from "./r2-subscription";

/**
 * S3 ListBuckets against the account root, signed with the owner's R2 keys. Lets
 * the setup UI auto-select the bucket (or offer a picker) so the user never types
 * a bucket name — "occupy the user's one R2 bucket". Defaults its fetch to the
 * shared `getAppFetch()` path (Tauri http plugin / browser fetch).
 */
export interface ListR2BucketsInput {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Override the derived `https://<accountId>.r2.cloudflarestorage.com` endpoint. */
  endpointUrl?: string;
}

export interface ListR2BucketsOptions {
  fetcher?: SyncFetch;
  now?: () => Date;
}

export async function listR2Buckets(
  input: ListR2BucketsInput,
  options: ListR2BucketsOptions = {},
): Promise<string[]> {
  const fetcher = options.fetcher ?? (await getAppFetch());
  const endpoint =
    input.endpointUrl?.replace(/\/+$/, "") ?? `https://${input.accountId}.r2.cloudflarestorage.com`;
  const url = `${endpoint}/`;

  const headers = await signR2S3Request({
    method: "GET",
    url,
    accessKeyId: input.accessKeyId,
    secretAccessKey: input.secretAccessKey,
    now: options.now?.() ?? new Date(),
  });

  const response = await fetcher(url, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`Failed to list R2 buckets: HTTP ${response.status}`);
  }
  return parseBucketNames(await response.text());
}

/** Bucket names appear only inside `<Bucket><Name>…</Name></Bucket>` entries. */
function parseBucketNames(xml: string): string[] {
  const names: string[] = [];
  const re = /<Name>([^<]+)<\/Name>/g;
  let match = re.exec(xml);
  while (match !== null) {
    if (match[1]) names.push(match[1].trim());
    match = re.exec(xml);
  }
  return names;
}
