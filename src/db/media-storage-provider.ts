import { desktopKind, resolveDesktopBridge } from "@/lib/desktop/bridge";
import type { MediaBlob } from "./types";

export type MediaStorageBackend = "indexeddb" | "opfs" | "electron-file";

export interface MediaStorageKeyInput {
  id: string;
  role: MediaBlob["role"];
  mime: string;
  suggestedName?: string;
}

export interface MediaStorageProviderPutInput extends MediaStorageKeyInput {
  blob: Blob;
}

export interface MediaStorageProvider {
  id: MediaStorageBackend;
  userVisible: boolean;
  put(input: MediaStorageProviderPutInput): Promise<{ storageKey?: string }>;
  get(input: { storageKey?: string; blob?: Blob; mime?: string }): Promise<Blob | null>;
  delete(input: { storageKey?: string }): Promise<void>;
  list?(): Promise<Array<{ storageKey: string; bytes?: number }>>;
  estimate?(): Promise<{ bytesUsed?: number; quotaBytes?: number }>;
}

export const indexedDbMediaStorageProvider: MediaStorageProvider = {
  id: "indexeddb",
  userVisible: false,
  async put() {
    return {};
  },
  async get(input) {
    return input.blob ?? null;
  },
  async delete() {},
};

export function mediaStorageKey(input: MediaStorageKeyInput): string {
  const name = readableStem(input.suggestedName) || input.role;
  return `${roleDirectory(input.role)}/${name}__${input.id}${extensionForMime(input.mime)}`;
}

export function createOpfsMediaStorageProvider(): MediaStorageProvider {
  return {
    id: "opfs",
    userVisible: false,
    async put(input) {
      const storageKey = mediaStorageKey(input);
      const tempKey = `.tmp/${input.id}-${Date.now()}${extensionForMime(input.mime)}.tmp`;
      await writeOpfsFile(tempKey, input.blob);
      const temp = await readOpfsFile(tempKey);
      if (!temp || temp.size !== input.blob.size) {
        await deleteOpfsFile(tempKey);
        throw new Error("OPFS staged write verification failed");
      }
      await writeOpfsFile(storageKey, temp);
      const final = await readOpfsFile(storageKey);
      await deleteOpfsFile(tempKey);
      if (!final || final.size !== input.blob.size) {
        await deleteOpfsFile(storageKey);
        throw new Error("OPFS final write verification failed");
      }
      return { storageKey };
    },
    async get(input) {
      return input.storageKey ? readOpfsFile(input.storageKey) : null;
    },
    async delete(input) {
      if (input.storageKey) await deleteOpfsFile(input.storageKey);
    },
    async estimate() {
      const estimate = await navigator.storage?.estimate?.();
      return {
        bytesUsed: estimate?.usage,
        quotaBytes: estimate?.quota,
      };
    },
  };
}

export function createElectronFileMediaStorageProvider(): MediaStorageProvider {
  return {
    id: "electron-file",
    userVisible: true,
    async put(input) {
      const storageKey = mediaStorageKey(input);
      const bytes = new Uint8Array(await input.blob.arrayBuffer());
      await requireElectronMediaStorage().writeMediaStorageFile?.({
        storageKey,
        bytes,
        expectedBytes: input.blob.size,
      });
      return { storageKey };
    },
    async get(input) {
      if (!input.storageKey) return null;
      const bytes = await requireElectronMediaStorage().readMediaStorageFile?.({
        storageKey: input.storageKey,
      });
      return bytes ? new Blob([bytes], { type: input.mime ?? "application/octet-stream" }) : null;
    },
    async delete(input) {
      if (input.storageKey) {
        await requireElectronMediaStorage().deleteMediaStorageFile?.({
          storageKey: input.storageKey,
        });
      }
    },
    async estimate() {
      return {};
    },
  };
}

export function unavailableMediaStorageProvider(id: Exclude<MediaStorageBackend, "indexeddb">) {
  return {
    id,
    userVisible: id === "electron-file",
    async put(): Promise<{ storageKey?: string }> {
      throw new Error(`${id} media storage is unavailable`);
    },
    async get(): Promise<Blob | null> {
      return null;
    },
    async delete(): Promise<void> {},
  } satisfies MediaStorageProvider;
}

export function defaultMediaStorageProvider(backend?: MediaStorageBackend): MediaStorageProvider {
  if (backend === "indexeddb") return indexedDbMediaStorageProvider;
  if (backend === "electron-file") return createElectronFileMediaStorageProvider();
  if (backend === "opfs") return createOpfsMediaStorageProvider();
  if (desktopKind() === "electron") return createElectronFileMediaStorageProvider();
  if (isOpfsAvailable()) return createOpfsMediaStorageProvider();
  return indexedDbMediaStorageProvider;
}

function requireElectronMediaStorage() {
  const bridge = resolveDesktopBridge();
  if (
    bridge.kind !== "electron" ||
    !bridge.writeMediaStorageFile ||
    !bridge.readMediaStorageFile ||
    !bridge.deleteMediaStorageFile
  ) {
    throw new Error("Electron media storage is unavailable");
  }
  return bridge;
}

function isOpfsAvailable(): boolean {
  try {
    return (
      typeof navigator !== "undefined" && typeof opfsStorageManager().getDirectory === "function"
    );
  } catch {
    return false;
  }
}

function roleDirectory(role: MediaBlob["role"]): string {
  return role === "media" ? "media" : role;
}

function readableStem(value: string | undefined): string {
  const parts = (value ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  const joined = parts.length > 0 ? parts.join(" - ") : "";
  const withoutExt = joined.replace(/\.[A-Za-z0-9]{1,8}$/u, "");
  return withoutExt
    .normalize("NFKC")
    .replace(/[<>:"|?*]/gu, "")
    .replaceAll("\u0000", "")
    .replace(/\s+/gu, " ")
    .replace(/\s*-\s*/gu, " - ")
    .replace(/[. ]+$/gu, "")
    .slice(0, 96)
    .trim();
}

function extensionForMime(mime: string): string {
  const normalized = mime.toLowerCase().split(";")[0]?.trim();
  if (normalized === "audio/mpeg") return ".mp3";
  if (normalized === "audio/wav" || normalized === "audio/wave") return ".wav";
  if (normalized === "audio/aac") return ".aac";
  if (normalized === "audio/ogg") return ".ogg";
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "video/webm") return ".webm";
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  return ".bin";
}

async function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await opfsStorageManager().getDirectory?.();
  if (!root) throw new Error("OPFS unavailable");
  return root.getDirectoryHandle("muzero-persistent-media", { create: true });
}

function opfsStorageManager(): StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
} {
  return navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
}

async function opfsFileHandle(storageKey: string, create: boolean): Promise<FileSystemFileHandle> {
  const parts = storageKey.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error("Invalid OPFS storage key");
  let directory = await opfsRoot();
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create });
  }
  return directory.getFileHandle(fileName, { create });
}

async function writeOpfsFile(storageKey: string, blob: Blob): Promise<void> {
  const handle = await opfsFileHandle(storageKey, true);
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function readOpfsFile(storageKey: string): Promise<Blob | null> {
  try {
    const handle = await opfsFileHandle(storageKey, false);
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function deleteOpfsFile(storageKey: string): Promise<void> {
  const parts = storageKey.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;
  try {
    let directory = await opfsRoot();
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part);
    }
    await directory.removeEntry(fileName);
  } catch {
    // Missing files are harmless; metadata cleanup/repair is handled separately.
  }
}
