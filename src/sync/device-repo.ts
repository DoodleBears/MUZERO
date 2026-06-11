import {
  deleteMediaBlob,
  type MediaBlobStorageOptions,
  putSizeAwareImageBlob,
} from "@/db/media-blob-storage";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { DeviceRecord } from "@/db/types";
import { newId } from "@/lib/id";

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

export interface SetLocalDeviceAvatarInput {
  blob: Blob;
  mime?: string;
  name?: string;
  avatarSeed?: string;
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

  const existingNames = await db.devices.toArray();
  const name = nextAvailableDeviceName(
    defaultDeviceName(options.platform),
    existingNames.map((device) => device.name),
  );
  const device: DeviceRecord = {
    id: LOCAL_DEVICE_ID,
    publicId: options.publicIdFactory?.() ?? randomPublicId(),
    name,
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

export async function setLocalDeviceAvatar(
  input: SetLocalDeviceAvatarInput,
  db: MuzeroDB = defaultDb,
  storage: MediaBlobStorageOptions = {},
): Promise<DeviceRecord> {
  const now = input.now ?? Date.now();
  const current = await getOrCreateLocalDevice({ now }, db);
  const avatar = await putSizeAwareImageBlob(
    {
      id: newId("blb"),
      trackId: current.id,
      role: "avatar",
      mime: input.mime || input.blob.type || "image/jpeg",
      bytes: input.blob.size,
      blob: input.blob,
      suggestedName: "Avatar",
    },
    db,
    storage,
  );
  const next: DeviceRecord = {
    ...current,
    name: input.name?.trim() || current.name,
    avatarSeed: input.avatarSeed?.trim() || current.avatarSeed,
    avatarBlobId: avatar.id,
    publishProfile: input.publishProfile ?? current.publishProfile,
    profileRevision: current.profileRevision + 1,
    lastSeenAt: now,
  };
  try {
    await db.transaction("rw", db.devices, async () => {
      await db.devices.put(next);
    });
  } catch (error) {
    await deleteMediaBlob(avatar.id, db, storage);
    throw error;
  }
  if (current.avatarBlobId) {
    await deleteMediaBlob(current.avatarBlobId, db, storage);
  }
  return next;
}

function defaultDeviceName(platform?: DeviceRecord["platform"]): string {
  if (platform === "tauri") return "Desktop";
  if (platform === "electron") return "Electron";
  return "Browser";
}

function nextAvailableDeviceName(baseName: string, names: string[]): string {
  const taken = new Set(names.map(normalizeDeviceName).filter(Boolean));
  if (!taken.has(normalizeDeviceName(baseName))) return baseName;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!taken.has(normalizeDeviceName(candidate))) return candidate;
  }
  return `${baseName} ${Date.now()}`;
}

function normalizeDeviceName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
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
