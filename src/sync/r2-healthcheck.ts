import type { R2LocalCredentials } from "@/db/types";
import { getAppFetch } from "@/lib/platform";
import { r2SignedFetch } from "./r2-s3";
import type { RemoteLibraryPreview, SyncFetch } from "./r2-subscription";
import { subscribeManifest } from "./r2-subscription";
import { normalizeManifestUrl } from "./r2-url";

export type R2WriteCredentials = R2LocalCredentials;

export type R2CheckStatus = "passed" | "failed" | "skipped";

export interface R2ConnectionCheck {
  id: string;
  status: R2CheckStatus;
  message: string;
}

export interface R2PublicReadResult {
  ok: boolean;
  checks: R2ConnectionCheck[];
  preview?: RemoteLibraryPreview;
  hint?: string;
}

export interface R2WriteResult {
  ok: boolean;
  checks: R2ConnectionCheck[];
  hint?: string;
}

export interface R2HealthcheckOptions {
  fetcher?: SyncFetch;
  now?: () => Date;
}

const CORS_HINT =
  "Check the R2 bucket CORS policy. Browser mode needs GET/HEAD for public read and PUT/DELETE with Authorization headers for owner sync.";

export async function checkR2PublicRead(
  manifestOrBaseUrl: string,
  options: R2HealthcheckOptions = {},
): Promise<R2PublicReadResult> {
  const checks: R2ConnectionCheck[] = [];
  let manifestUrl: string;
  try {
    manifestUrl = normalizeManifestUrl(manifestOrBaseUrl);
    checks.push({
      id: "manifest-url",
      status: "passed",
      message: "Manifest URL is valid.",
    });
  } catch (error) {
    checks.push({
      id: "manifest-url",
      status: "failed",
      message: error instanceof Error ? error.message : "Manifest URL is invalid.",
    });
    return { ok: false, checks };
  }

  try {
    const preview = await subscribeManifest(manifestUrl, {
      fetcher: options.fetcher ?? (await getAppFetch()),
    });
    checks.push({
      id: "manifest-fetch",
      status: "passed",
      message: "Manifest can be fetched and parsed.",
    });
    return { ok: true, checks, preview };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      id: message.startsWith("Invalid manifest") ? "manifest-schema" : "manifest-fetch",
      status: "failed",
      message,
    });
    return {
      ok: false,
      checks,
      hint: isLikelyCorsError(error) ? CORS_HINT : undefined,
    };
  }
}

export async function checkR2WriteAccess(
  credentials: R2WriteCredentials,
  options: R2HealthcheckOptions = {},
): Promise<R2WriteResult> {
  const validation = validateR2WriteCredentials(credentials);
  if (validation) {
    return {
      ok: false,
      checks: [{ id: "credentials", status: "failed", message: validation }],
    };
  }

  const fetcher = options.fetcher ?? (await getAppFetch());
  const body = JSON.stringify({
    schema: "muzero-r2-healthcheck-v1",
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
  });

  const checks: R2ConnectionCheck[] = [];
  const put = await signedFetch(
    fetcher,
    credentials,
    "PUT",
    ".muzero-healthcheck.json",
    body,
    options.now,
  );
  if (!put.ok) {
    return {
      ok: false,
      checks: [
        {
          id: "write-put",
          status: "failed",
          message: put.message,
        },
      ],
      hint: put.hint,
    };
  }
  checks.push({ id: "write-put", status: "passed", message: "Probe object uploaded." });

  const head = await signedFetch(
    fetcher,
    credentials,
    "HEAD",
    ".muzero-healthcheck.json",
    undefined,
    options.now,
  );
  if (!head.ok) {
    return {
      ok: false,
      checks: [
        ...checks,
        {
          id: "write-head",
          status: "failed",
          message: head.message,
        },
      ],
      hint: head.hint,
    };
  }
  checks.push({ id: "write-head", status: "passed", message: "Probe object is readable." });

  const deletion = await signedFetch(
    fetcher,
    credentials,
    "DELETE",
    ".muzero-healthcheck.json",
    undefined,
    options.now,
  );
  if (!deletion.ok) {
    return {
      ok: false,
      checks: [
        ...checks,
        {
          id: "write-delete",
          status: "failed",
          message: deletion.message,
        },
      ],
      hint: deletion.hint,
    };
  }
  checks.push({ id: "write-delete", status: "passed", message: "Probe object cleaned up." });

  return { ok: true, checks };
}

export function buildRecommendedR2Cors(origin: string) {
  return [
    {
      AllowedOrigins: [origin],
      AllowedMethods: ["GET", "HEAD", "PUT", "DELETE"],
      AllowedHeaders: ["authorization", "content-type", "x-amz-content-sha256", "x-amz-date"],
      ExposeHeaders: ["etag"],
      MaxAgeSeconds: 3600,
    },
  ];
}

export function maskSecret(value: string): string {
  if (value.length < 8) return "••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function validateR2WriteCredentials(credentials: R2WriteCredentials): string | null {
  if (!credentials.accountId.trim()) return "Cloudflare account id is required.";
  if (!credentials.bucket.trim()) return "R2 bucket name is required.";
  if (!credentials.accessKeyId.trim()) return "R2 access key id is required.";
  if (!credentials.secretAccessKey.trim()) return "R2 secret access key is required.";
  return null;
}

async function signedFetch(
  fetcher: SyncFetch,
  credentials: R2WriteCredentials,
  method: "PUT" | "HEAD" | "DELETE",
  key: string,
  body?: string,
  now?: () => Date,
): Promise<{ ok: true } | { ok: false; message: string; hint?: string }> {
  try {
    const response = await r2SignedFetch({
      fetcher,
      credentials,
      method,
      key,
      body,
      contentType: "application/json",
      now,
    });
    if (!response.ok) {
      return { ok: false, message: `R2 ${method} failed with HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : `R2 ${method} failed.`,
      hint: isLikelyCorsError(error) ? CORS_HINT : undefined,
    };
  }
}

function isLikelyCorsError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|cors/i.test(error.message);
}
