import type { R2LocalCredentials } from "@/db/types";
import type { SyncFetch } from "./r2-subscription";

export type R2S3Method = "PUT" | "HEAD" | "DELETE";

export interface R2SignedFetchOptions {
  fetcher: SyncFetch;
  credentials: R2LocalCredentials;
  method: R2S3Method;
  key: string;
  body?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
  now?: () => Date;
  /** Abort the in-flight request itself, not just between requests (audit F6). */
  signal?: AbortSignal;
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function buildR2ObjectUrl(credentials: R2LocalCredentials, key: string): string {
  const endpoint =
    credentials.endpointUrl?.replace(/\/+$/, "") ??
    `https://${credentials.accountId}.r2.cloudflarestorage.com`;
  const parts = [
    credentials.bucket,
    ...pathSegments(credentials.prefix),
    ...pathSegments(key),
  ].filter(Boolean);
  return `${endpoint}/${parts.map(encodePathSegment).join("/")}`;
}

export async function r2SignedFetch(options: R2SignedFetchOptions): Promise<Response> {
  const url = buildR2ObjectUrl(options.credentials, options.key);
  const headers = await signR2S3Request({
    method: options.method,
    url,
    body: options.body,
    contentType: options.contentType,
    headers: options.headers,
    accessKeyId: options.credentials.accessKeyId,
    secretAccessKey: options.credentials.secretAccessKey,
    now: options.now?.() ?? new Date(),
  });
  return options.fetcher(url, {
    method: options.method,
    headers,
    body: options.method === "HEAD" ? undefined : options.body,
    signal: options.signal,
  });
}

export async function signR2S3Request(input: {
  method: string;
  url: string;
  body?: BodyInit;
  contentType?: string;
  headers?: Record<string, string>;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}): Promise<Record<string, string>> {
  const url = new URL(input.url);
  const amzDate = toAmzDate(input.now);
  const date = amzDate.slice(0, 8);
  const payloadHash =
    input.body == null ? EMPTY_SHA256 : await sha256Hex(await bodyBytes(input.body));
  const headers: Record<string, string> = {
    "content-type": input.contentType ?? "application/octet-stream",
    ...normalizeExtraHeaders(input.headers),
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

async function bodyBytes(body: BodyInit): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof body === "string") return copyBytes(new TextEncoder().encode(body));
  if (body instanceof Blob) return copyBytes(new Uint8Array(await body.arrayBuffer()));
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return copyBytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
  }
  return copyBytes(new Uint8Array(await new Response(body).arrayBuffer()));
}

async function deriveSigningKey(secret: string, date: string): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(`AWS4${secret}`, date);
  const kRegion = await hmacRaw(kDate, "auto");
  const kService = await hmacRaw(kRegion, "s3");
  return hmacRaw(kService, "aws4_request");
}

async function sha256Hex(value: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes = typeof value === "string" ? copyBytes(new TextEncoder().encode(value)) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(digest);
}

async function hmacRaw(key: string | ArrayBuffer, value: string): Promise<ArrayBuffer> {
  const keyBytes =
    typeof key === "string" ? copyBytes(new TextEncoder().encode(key)) : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
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

function pathSegments(value?: string): string[] {
  return trimSlashes(value).split("/").filter(Boolean);
}

function normalizeExtraHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value.trim()]),
  );
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
