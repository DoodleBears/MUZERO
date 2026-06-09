import type { R2LocalCredentials } from "@/db/types";
import { normalizeManifestUrl } from "./r2-url";

/**
 * Minimal owner R2 setup: the user pastes their S3 endpoint (or bare account id),
 * access key + secret, the bucket (auto-discovered via ListBuckets in the UI), and
 * the public bucket URL. We derive everything else — the S3 endpoint host comes
 * from the account id, the manifest URL from the public URL, and the prefix is
 * always empty ("occupy the whole bucket"). Keeping this a pure function makes the
 * parsing/derivation unit-testable without the form or network.
 */
export interface OwnerR2ConnectionInput {
  /** "https://<acct>.r2.cloudflarestorage.com" or just "<acct>". */
  endpointOrAccountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public bucket base URL or a direct manifest URL. */
  publicUrl: string;
}

export interface OwnerR2Connection {
  credentials: R2LocalCredentials;
  publicBaseUrl: string;
  manifestUrl: string;
}

const R2_S3_HOST_SUFFIX = ".r2.cloudflarestorage.com";

/** Pull the account id out of an S3 API endpoint, or pass a bare id through. */
export function parseR2AccountId(endpointOrAccountId: string): string {
  const trimmed = endpointOrAccountId.trim();
  if (trimmed.includes(R2_S3_HOST_SUFFIX)) {
    const host = trimmed.includes("://") ? new URL(trimmed).host : trimmed;
    return host.slice(0, host.indexOf(R2_S3_HOST_SUFFIX));
  }
  return trimmed;
}

export function buildOwnerR2Connection(input: OwnerR2ConnectionInput): OwnerR2Connection {
  const manifestUrl = normalizeManifestUrl(input.publicUrl);
  const base = new URL(manifestUrl);
  base.pathname = base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);

  return {
    credentials: {
      accountId: parseR2AccountId(input.endpointOrAccountId),
      bucket: input.bucket.trim(),
      accessKeyId: input.accessKeyId.trim(),
      secretAccessKey: input.secretAccessKey.trim(),
    },
    publicBaseUrl: base.href,
    manifestUrl,
  };
}
