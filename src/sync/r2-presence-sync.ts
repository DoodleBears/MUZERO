import type { AppSettings, CloudDrive } from "@/db/types";
import { getAppFetch } from "@/lib/platform";
import type { R2Presence } from "./r2-presence";
import { canWritePresenceToDrive, presenceObjectKey, r2PresenceSchema } from "./r2-presence";
import { r2SignedFetch } from "./r2-s3";
import type { SyncFetch } from "./r2-subscription";

export interface WriteR2PresenceInput {
  settings: AppSettings;
  drive: CloudDrive;
  presence: R2Presence;
  fetcher?: SyncFetch;
  now?: () => Date;
}

export interface WriteR2PresenceResult {
  key: string;
  bytes: number;
  status: number;
}

export async function writeR2Presence(input: WriteR2PresenceInput): Promise<WriteR2PresenceResult> {
  if (!canWritePresenceToDrive(input.settings, input.drive)) {
    throw new Error("Presence write is not allowed for this drive");
  }
  const credentials = input.settings.r2CredentialsByDriveId?.[input.drive.id];
  if (!credentials) {
    throw new Error("Presence write credentials are missing for this drive");
  }

  const presence = r2PresenceSchema.parse(input.presence);
  const key = presenceObjectKey(presence.devicePublicId);
  const body = JSON.stringify(presence);
  const response = await r2SignedFetch({
    fetcher: input.fetcher ?? (await getAppFetch()),
    credentials,
    method: "PUT",
    key,
    body,
    contentType: "application/json",
    now: input.now,
  });
  if (!response.ok) {
    throw new Error(`Failed to write presence: HTTP ${response.status}`);
  }

  return {
    key,
    bytes: new TextEncoder().encode(body).byteLength,
    status: response.status,
  };
}
