import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { DeviceRecord } from "@/db/types";

export interface LocalDeviceOptions {
  now?: number;
  publicIdFactory?: () => string;
  signingSecretFactory?: () => string;
  platform?: DeviceRecord["platform"];
  userAgent?: string;
  os?: string;
  appVersion?: string;
}

export interface UpdateLocalDeviceProfileInput {
  name?: string;
  avatarSeed?: string;
  avatarBlobId?: string;
  publishProfile?: boolean;
  now?: number;
}

const LOCAL_DEVICE_ID = "dev_local";

export function getLocalDevice(db: MuzeroDB = defaultDb): Promise<DeviceRecord | undefined> {
  return db.devices.get(LOCAL_DEVICE_ID);
}

export async function getOrCreateLocalDevice(
  options: LocalDeviceOptions = {},
  db: MuzeroDB = defaultDb,
): Promise<DeviceRecord> {
  const now = options.now ?? Date.now();
  const existing = await db.devices.get(LOCAL_DEVICE_ID);
  if (existing) {
    const next = {
      ...existing,
      platform: options.platform ?? existing.platform,
      userAgent: options.userAgent ?? existing.userAgent,
      os: options.os ?? existing.os,
      appVersion: options.appVersion ?? existing.appVersion,
      lastSeenAt: now,
    };
    await db.devices.put(next);
    return next;
  }

  const device: DeviceRecord = {
    id: LOCAL_DEVICE_ID,
    publicId: options.publicIdFactory?.() ?? randomPublicId(),
    name: defaultDeviceName(options.platform),
    platform: options.platform ?? "browser",
    userAgent: options.userAgent,
    os: options.os,
    appVersion: options.appVersion ?? "0.1.0",
    localSigningSecret: options.signingSecretFactory?.() ?? randomToken("sec"),
    publishProfile: false,
    profileRevision: 1,
    createdAt: now,
    lastSeenAt: now,
  };
  await db.devices.put(device);
  return device;
}

export async function updateLocalDeviceProfile(
  input: UpdateLocalDeviceProfileInput,
  db: MuzeroDB = defaultDb,
): Promise<DeviceRecord> {
  const current = await getOrCreateLocalDevice({ now: input.now }, db);
  const next: DeviceRecord = {
    ...current,
    name: input.name?.trim() || current.name,
    avatarSeed: input.avatarSeed?.trim() || current.avatarSeed,
    avatarBlobId: input.avatarBlobId ?? current.avatarBlobId,
    publishProfile: input.publishProfile ?? current.publishProfile,
    profileRevision: current.profileRevision + 1,
    lastSeenAt: input.now ?? Date.now(),
  };
  await db.devices.put(next);
  return next;
}

function defaultDeviceName(platform?: DeviceRecord["platform"]): string {
  if (platform === "tauri") return "Desktop";
  if (platform === "electron") return "Electron";
  return "Browser";
}

function randomPublicId(): string {
  return randomToken("dvc");
}

function randomToken(prefix: string): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const value = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${prefix}_${value}`;
}
