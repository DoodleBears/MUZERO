import type { AppSettings, CloudDrive, R2LocalCredentials } from "@/db/types";

export interface OwnedR2DriveInput {
  id: string;
  label: string;
  manifestUrl: string;
  publicBaseUrl?: string;
  now?: number;
}

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
