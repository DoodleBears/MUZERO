import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { upsertCloudDrive, upsertCloudShare } from "./cloud-drive-repo";
import { checkR2PublicRead, type R2HealthcheckOptions } from "./r2-healthcheck";
import type { RemoteLibraryPreview } from "./r2-subscription";

export interface ReadOnlyManifestConnection {
  preview: RemoteLibraryPreview;
  driveId: string;
  shareId: string;
}

export async function connectReadOnlyManifest(
  manifestOrBaseUrl: string,
  options: R2HealthcheckOptions = {},
  db: MuzeroDB = defaultDb,
): Promise<ReadOnlyManifestConnection> {
  const result = await checkR2PublicRead(manifestOrBaseUrl, options);
  if (!result.ok || !result.preview) {
    throw new Error(result.hint ?? result.checks.at(-1)?.message ?? "Manifest validation failed");
  }

  const preview = result.preview;
  const driveId = stableLocalId("drv", preview.libraryId);
  const shareId = stableLocalId("shr", preview.libraryId);
  await upsertCloudDrive(
    {
      id: driveId,
      label: preview.title,
      kind: "shared",
      provider: "r2",
      publicBaseUrl: preview.baseUrl,
      manifestUrl: preview.manifestUrl,
      capabilities: {
        read: true,
        write: false,
        manageInvites: false,
        writeStats: false,
        writePresence: false,
      },
    },
    db,
  );
  await upsertCloudShare(
    {
      id: shareId,
      driveId,
      remoteShareId: preview.libraryId,
      label: preview.title,
      manifestUrl: preview.manifestUrl,
      access: "read-only",
      lastSyncedAt: Date.now(),
    },
    db,
  );

  return { preview, driveId, shareId };
}

function stableLocalId(prefix: "drv" | "shr", remoteId: string): string {
  return `${prefix}_${remoteId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}
