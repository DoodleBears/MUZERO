import { getAppFetch } from "@/lib/platform";
import type { RemoteLibraryPreview, SyncFetch } from "./r2-subscription";
import { subscribeManifest } from "./r2-subscription";
import { normalizeManifestUrl } from "./r2-url";

export interface R2WriteCredentials {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  endpointUrl?: string;
}

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

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
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
  const objectUrl = buildR2ObjectUrl(credentials, ".muzero-healthcheck.json");
  const body = JSON.stringify({
    schema: "muzero-r2-healthcheck-v1",
    checkedAt: (options.now?.() ?? new Date()).toISOString(),
  });

  const checks: R2ConnectionCheck[] = [];
  const put = await signedFetch(fetcher, credentials, "PUT", objectUrl, body, options.now);
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

  const head = await signedFetch(fetcher, credentials, "HEAD", objectUrl, undefined, options.now);
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
    objectUrl,
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

function buildR2ObjectUrl(credentials: R2WriteCredentials, objectName: string): string {
  const endpoint =
    credentials.endpointUrl?.replace(/\/+$/, "") ??
    `https://${credentials.accountId}.r2.cloudflarestorage.com`;
  const parts = [credentials.bucket, trimSlashes(credentials.prefix), objectName].filter(Boolean);
  return `${endpoint}/${parts.map(encodePathSegment).join("/")}`;
}

async function signedFetch(
  fetcher: SyncFetch,
  credentials: R2WriteCredentials,
  method: "PUT" | "HEAD" | "DELETE",
  url: string,
  body?: string,
  now?: () => Date,
): Promise<{ ok: true } | { ok: false; message: string; hint?: string }> {
  try {
    const headers = await signS3Request({
      method,
      url,
      body,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      now: now?.() ?? new Date(),
    });
    const response = await fetcher(url, {
      method,
      headers,
      body,
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

async function signS3Request(input: {
  method: string;
  url: string;
  body?: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const amzDate = toAmzDate(input.now);
  const date = amzDate.slice(0, 8);
  const payloadHash = input.body == null ? EMPTY_SHA256 : await sha256Hex(input.body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]?.trim()}\n`)
    .join("");
  const canonicalRequest = [
    input.method,
    canonicalUri(url.pathname),
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const scope = `${date}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join(
    "\n",
  );
  const signingKey = await deriveSigningKey(input.secretAccessKey, date);
  const signature = await hmacHex(signingKey, stringToSign);
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

async function deriveSigningKey(secret: string, date: string): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(`AWS4${secret}`, date);
  const kRegion = await hmacRaw(kDate, "auto");
  const kService = await hmacRaw(kRegion, "s3");
  return hmacRaw(kService, "aws4_request");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(digest);
}

async function hmacRaw(key: string | ArrayBuffer, value: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? new TextEncoder().encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

async function hmacHex(key: ArrayBuffer, value: string): Promise<string> {
  return toHex(await hmacRaw(key, value));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalUri(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodePathSegment(decodeURIComponent(segment)))
    .join("/");
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function trimSlashes(value?: string): string {
  return value?.trim().replace(/^\/+|\/+$/g, "") ?? "";
}

function isLikelyCorsError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|cors/i.test(error.message);
}
