import { sanitizeDiagnosticData } from "@/lib/diagnostics";
import type { TraceEntry } from "@/lib/trace";

const DEFAULT_DB_NAME = "muzero-trace-archive";
const STORE_NAME = "entries";
const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ENABLED_STORAGE_KEY = "muzero-trace-archive-enabled";
const ENABLED_EVENT = "muzero:trace-archive-enabled";

export interface TraceArchive {
  dbName: string;
  maxEntries: number;
  maxAgeMs: number;
  now: () => number;
}

export interface TraceArchiveExportMetadata {
  appVersion: string;
  gitSha: string;
  platform: string;
  exportedAt?: string;
}

export type ArchivedTraceEntry = TraceEntry & {
  archiveId: string;
};

export function createTraceArchive(config: Partial<TraceArchive> = {}): TraceArchive {
  return {
    dbName: config.dbName ?? DEFAULT_DB_NAME,
    maxEntries: config.maxEntries ?? DEFAULT_MAX_ENTRIES,
    maxAgeMs: config.maxAgeMs ?? DEFAULT_MAX_AGE_MS,
    now: config.now ?? Date.now,
  };
}

export function isTraceArchiveEnabled(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ENABLED_STORAGE_KEY) !== "false";
}

export function setTraceArchiveEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ENABLED_STORAGE_KEY, enabled ? "true" : "false");
  window.dispatchEvent(new CustomEvent(ENABLED_EVENT, { detail: enabled }));
}

export function subscribeTraceArchiveEnabled(callback: (enabled: boolean) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = () => callback(isTraceArchiveEnabled());
  window.addEventListener(ENABLED_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(ENABLED_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export async function appendTraceArchiveEntries(
  entries: TraceEntry[],
  archive = createTraceArchive(),
): Promise<void> {
  if (entries.length === 0) return;
  const db = await openArchiveDb(archive.dbName);
  try {
    await withStore(db, "readwrite", (store) => {
      for (const entry of entries) {
        store.put(toArchivedEntry(entry));
      }
    });
    await pruneTraceArchive(archive, db);
  } finally {
    db.close();
  }
}

export async function readTraceArchiveEntries(
  archive = createTraceArchive(),
  limit = archive.maxEntries,
): Promise<ArchivedTraceEntry[]> {
  const db = await openArchiveDb(archive.dbName);
  try {
    const entries = await getAllEntries(db);
    return entries.sort((a, b) => a.at - b.at || a.id - b.id).slice(-limit);
  } finally {
    db.close();
  }
}

export async function clearTraceArchive(archive = createTraceArchive()): Promise<void> {
  const db = await openArchiveDb(archive.dbName);
  try {
    await withStore(db, "readwrite", (store) => {
      store.clear();
    });
  } finally {
    db.close();
  }
}

export async function exportTraceArchiveJsonl(
  archive = createTraceArchive(),
  metadata: TraceArchiveExportMetadata,
): Promise<string> {
  const entries = await readTraceArchiveEntries(archive);
  const header = {
    kind: "metadata",
    exportedAt: metadata.exportedAt ?? new Date(archive.now()).toISOString(),
    appVersion: metadata.appVersion,
    gitSha: metadata.gitSha,
    platform: metadata.platform,
    entryCount: entries.length,
  };
  const lines = [
    header,
    ...entries.map((entry) => ({
      kind: "trace",
      entry: toExportEntry(entry),
    })),
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

async function pruneTraceArchive(archive: TraceArchive, db: IDBDatabase): Promise<void> {
  const minAt = archive.now() - archive.maxAgeMs;
  const entries = await getAllEntries(db);
  const sorted = entries.sort((a, b) => a.at - b.at || a.id - b.id);
  const overCount = Math.max(0, sorted.length - archive.maxEntries);
  const idsToDelete = new Set<string>();

  for (const row of sorted) {
    if (row.at < minAt) idsToDelete.add(row.archiveId);
  }
  for (const row of sorted.slice(0, overCount)) {
    idsToDelete.add(row.archiveId);
  }
  if (idsToDelete.size === 0) return;

  await withStore(db, "readwrite", (store) => {
    for (const id of idsToDelete) {
      store.delete(id);
    }
  });
}

function toArchivedEntry(entry: TraceEntry): ArchivedTraceEntry {
  return {
    ...entry,
    archiveId: `${entry.at}:${entry.id}`,
    context: entry.context
      ? (sanitizeDiagnosticData(entry.context) as TraceEntry["context"])
      : undefined,
    data: entry.data ? entry.data.map((value) => sanitizeDiagnosticData(value)) : undefined,
  };
}

function toExportEntry(entry: ArchivedTraceEntry): ArchivedTraceEntry {
  return {
    ...entry,
    context: entry.context
      ? (sanitizeDiagnosticData(entry.context) as TraceEntry["context"])
      : undefined,
    data: entry.data ? entry.data.map((value) => sanitizeDiagnosticData(value)) : undefined,
  };
}

function openArchiveDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "archiveId" });
        store.createIndex("at", "at");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const result = run(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function getAllEntries(db: IDBDatabase): Promise<ArchivedTraceEntry[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as ArchivedTraceEntry[]);
    request.onerror = () => reject(request.error);
  });
}
