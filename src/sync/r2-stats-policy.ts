import type { AppSettings, CloudDrive, DeviceRecord } from "@/db/types";

export function canWriteStatsToDrive(settings: AppSettings, drive: CloudDrive): boolean {
  if (!drive.capabilities.writeStats) return false;
  if (drive.kind !== "owned" && drive.kind !== "trusted") return false;
  return Boolean(settings.r2CredentialsByDriveId?.[drive.id]);
}

export function canPublishDeviceProfileToDrive(
  device: DeviceRecord,
  settings: AppSettings,
  drive: CloudDrive,
): boolean {
  if (!device.publishProfile) return false;
  return canWriteStatsToDrive(settings, drive);
}
