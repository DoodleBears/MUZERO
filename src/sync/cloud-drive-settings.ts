import type {
  AppSettings,
  CloudDrive,
  CloudDriveAutoSyncFrequency,
  CloudDriveUploadConcurrency,
  R2LocalCredentials,
} from "@/db/types";

export interface OwnedR2DriveInput {
  id: string;
  label: string;
  manifestUrl: string;
  publicBaseUrl?: string;
  now?: number;
}

export interface TrustedR2DriveSetupPayload {
  schema: "muzero-r2-trusted-drive-v1";
  label: string;
  manifestUrl: string;
  publicBaseUrl?: string;
  credentials: R2LocalCredentials;
  autoSyncFrequency?: CloudDriveAutoSyncFrequency;
  uploadConcurrency?: CloudDriveUploadConcurrency;
  exportedAt: number;
}

export const TRUSTED_R2_DRIVE_SETUP_PREFIX = "muzero://trusted-r2-drive#v1=";

export function buildOwnedR2Drive(input: OwnedR2DriveInput): CloudDrive {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    label: input.label.trim() || "R2 Drive",
    kind: "owned",
    provider: "r2",
    manifestUrl: input.manifestUrl.trim(),
    publicBaseUrl: input.publicBaseUrl?.trim() || undefined,
    capabilities: {
      read: true,
      write: true,
      manageInvites: false,
      writeStats: true,
      writePresence: true,
    },
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: now,
  };
}

export function buildTrustedR2DriveSetupLink(input: {
  drive: CloudDrive;
  credentials: R2LocalCredentials;
  now?: number;
}): string {
  const payload: TrustedR2DriveSetupPayload = {
    schema: "muzero-r2-trusted-drive-v1",
    label: input.drive.label.trim() || input.credentials.bucket.trim() || "Trusted R2 Drive",
    manifestUrl: input.drive.manifestUrl?.trim() ?? "",
    publicBaseUrl: input.drive.publicBaseUrl?.trim() || undefined,
    credentials: trimR2Credentials(input.credentials),
    autoSyncFrequency: input.drive.autoSyncFrequency,
    uploadConcurrency: input.drive.uploadConcurrency,
    exportedAt: input.now ?? Date.now(),
  };

  return `${TRUSTED_R2_DRIVE_SETUP_PREFIX}${encodeSetupPayload(payload)}`;
}

export function parseTrustedR2DriveSetupLink(
  value: string,
): TrustedR2DriveSetupPayload | undefined {
  const bundle = extractTrustedSetupBundle(value);
  if (!bundle) return undefined;
  try {
    const parsed = JSON.parse(decodeSetupPayload(bundle));
    if (!isRecord(parsed) || parsed.schema !== "muzero-r2-trusted-drive-v1") return undefined;
    const credentials = readCredentials(parsed.credentials);
    const manifestUrl = readNonEmptyString(parsed.manifestUrl);
    if (!credentials || !manifestUrl) return undefined;
    const autoSyncFrequency = readAutoSyncFrequency(parsed.autoSyncFrequency);
    const uploadConcurrency = readUploadConcurrency(parsed.uploadConcurrency);
    const exportedAt = typeof parsed.exportedAt === "number" ? parsed.exportedAt : Date.now();
    return {
      schema: "muzero-r2-trusted-drive-v1",
      label: readNonEmptyString(parsed.label) ?? credentials.bucket,
      manifestUrl,
      publicBaseUrl: readOptionalString(parsed.publicBaseUrl),
      credentials,
      autoSyncFrequency,
      uploadConcurrency,
      exportedAt,
    };
  } catch {
    return undefined;
  }
}

export function buildTrustedR2DriveFromSetup(input: {
  id: string;
  setup: TrustedR2DriveSetupPayload;
  label?: string;
  now?: number;
}): CloudDrive {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    label:
      input.label?.trim() ||
      input.setup.label.trim() ||
      input.setup.credentials.bucket.trim() ||
      "Trusted R2 Drive",
    kind: "trusted",
    provider: "r2",
    manifestUrl: input.setup.manifestUrl.trim(),
    publicBaseUrl: input.setup.publicBaseUrl?.trim() || undefined,
    capabilities: {
      read: true,
      write: true,
      manageInvites: false,
      writeStats: true,
      writePresence: true,
    },
    autoSyncFrequency: input.setup.autoSyncFrequency,
    uploadConcurrency: input.setup.uploadConcurrency,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: now,
  };
}

export function saveR2CredentialsForDrive(
  settings: AppSettings,
  driveId: string,
  credentials: R2LocalCredentials,
): Partial<AppSettings> {
  return {
    defaultCloudDriveId: driveId,
    r2CredentialsByDriveId: {
      ...(settings.r2CredentialsByDriveId ?? {}),
      [driveId]: trimR2Credentials(credentials),
    },
  };
}

export function getR2CredentialsForDrive(
  settings: AppSettings,
  driveId: string,
): R2LocalCredentials | undefined {
  return settings.r2CredentialsByDriveId?.[driveId];
}

function trimR2Credentials(credentials: R2LocalCredentials): R2LocalCredentials {
  return {
    accountId: credentials.accountId.trim(),
    bucket: credentials.bucket.trim(),
    accessKeyId: credentials.accessKeyId.trim(),
    secretAccessKey: credentials.secretAccessKey.trim(),
    prefix: credentials.prefix?.trim() || undefined,
    endpointUrl: credentials.endpointUrl?.trim() || undefined,
  };
}

function extractTrustedSetupBundle(value: string): string | undefined {
  const text = value.trim();
  if (text.startsWith(TRUSTED_R2_DRIVE_SETUP_PREFIX)) {
    return text.slice(TRUSTED_R2_DRIVE_SETUP_PREFIX.length).trim() || undefined;
  }
  try {
    const url = new URL(text);
    if (url.protocol !== "muzero:" || url.hostname !== "trusted-r2-drive") return undefined;
    const hash = url.hash.replace(/^#/, "");
    if (hash.startsWith("v1=")) return hash.slice(3) || undefined;
  } catch {
    return undefined;
  }
  return undefined;
}

function encodeSetupPayload(payload: TrustedR2DriveSetupPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return bytesToBase64Url(bytes);
}

function decodeSetupPayload(value: string): string {
  const bytes = base64UrlToBytes(value);
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readCredentials(value: unknown): R2LocalCredentials | undefined {
  if (!isRecord(value)) return undefined;
  const accountId = readNonEmptyString(value.accountId);
  const bucket = readNonEmptyString(value.bucket);
  const accessKeyId = readNonEmptyString(value.accessKeyId);
  const secretAccessKey = readNonEmptyString(value.secretAccessKey);
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return undefined;
  return trimR2Credentials({
    accountId,
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: readOptionalString(value.prefix),
    endpointUrl: readOptionalString(value.endpointUrl),
  });
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim() || undefined;
}

function readAutoSyncFrequency(value: unknown): CloudDriveAutoSyncFrequency | undefined {
  return value === "manual" ||
    value === "app-start" ||
    value === "change-debounce" ||
    value === "15min" ||
    value === "30min" ||
    value === "60min"
    ? value
    : undefined;
}

function readUploadConcurrency(value: unknown): CloudDriveUploadConcurrency | undefined {
  return value === 1 || value === 2 || value === 3 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
