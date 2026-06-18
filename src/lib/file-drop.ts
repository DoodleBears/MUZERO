/**
 * Pure helpers for the global drag-and-drop ingest. Audio/video files are
 * imported into the active set; images become a cover candidate for the current
 * track. Kept side-effect free so the routing rules are unit-tested without DOM.
 * (Mirrors ClipCombo's landing-page drop classification.)
 */

import { isNcmFile } from "@/lib/ncm-decode";

export type DroppedKind = "audio" | "video" | "image";

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|flac|ogg|opus)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i;

/** A file-shaped value: real File during drop, or a {type,name} peek mid-drag. */
type FileLike = { type: string; name: string };

/** Classify a file by MIME first, falling back to its extension. */
export function classifyFile(file: FileLike): DroppedKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  const name = file.name.toLowerCase();
  if (VIDEO_EXT.test(name)) return "video";
  if (AUDIO_EXT.test(name)) return "audio";
  // NetEase `.ncm` carries no playable MIME — it's decrypted to audio on ingest.
  if (isNcmFile(name)) return "audio";
  if (IMAGE_EXT.test(name)) return "image";
  return null;
}

export interface ClassifiedDrop {
  /** Audio + video → imported into the set as tracks. */
  media: File[];
  /** Images → cover candidate for the current track. */
  images: File[];
  /** Unsupported files, surfaced as a "skipped" notice. */
  skipped: File[];
}

/** Split a dropped file list into media (audio/video), images, and skipped. */
export function classifyDrop(files: readonly File[]): ClassifiedDrop {
  const media: File[] = [];
  const images: File[] = [];
  const skipped: File[] = [];
  for (const file of files) {
    const kind = classifyFile(file);
    if (kind === "audio" || kind === "video") media.push(file);
    else if (kind === "image") images.push(file);
    else skipped.push(file);
  }
  return { media, images, skipped };
}

/**
 * Whether a drag carries OS files (vs an internal element drag). During a drag
 * the browser exposes `dataTransfer.types` but not the files themselves.
 */
export function dragHasFiles(types: readonly string[] | DOMStringList | undefined): boolean {
  if (!types) return false;
  return Array.from(types).includes("Files");
}

/**
 * Extract files from a drop or paste DataTransfer. Unions both `.items` and
 * `.files` and dedupes by identity, because the two channels disagree depending
 * on the event: a multi-file *paste* exposes all files via `.items[].getAsFile()`
 * but often only the first via `.files`, while `.files` keeps containers (e.g.
 * .mkv) that `.items` can fail to materialize. Reading only one channel drops
 * files (the multi-file paste bug); reading both without dedupe double-imports a
 * normal drop (both channels carry every file). Read synchronously — the
 * DataTransfer is invalidated after the event returns.
 */
export function filesFromTransfer(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const out: File[] = [];
  const seen = new Set<string>();
  const add = (file: File | null) => {
    if (!file) return;
    // The same physical file arrives through both channels as distinct File
    // instances with identical metadata — key on that tuple so the union
    // collapses by identity, not by reference.
    const key = JSON.stringify([file.name, file.size, file.lastModified, file.type]);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  // `.items` first: the reliable source for multiple pasted files.
  if (dt.items) {
    for (let i = 0; i < dt.items.length; i += 1) {
      const item = dt.items[i];
      if (item.kind !== "file") continue;
      add(item.getAsFile());
    }
  }
  // `.files` second: backfills any container `.items` couldn't materialize.
  if (dt.files) {
    for (let i = 0; i < dt.files.length; i += 1) add(dt.files[i]);
  }
  return out;
}

/** Guard against pathological deep / self-referential dropped trees. */
const MAX_DROP_DEPTH = 24;

export interface DeepTransferFiles {
  files: File[];
  /** Present only for a single top-level dropped folder. Mixed drops stay generic. */
  topLevelFolderName?: string;
}

/** Recursively read a dropped `FileSystemEntry` (file or directory) into Files. */
function readDropEntry(entry: FileSystemEntry, depth: number): Promise<File[]> {
  if (depth > MAX_DROP_DEPTH) return Promise.resolve([]);
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([]),
      );
    });
  }
  if (!entry.isDirectory) return Promise.resolve([]);
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  return new Promise((resolve) => {
    const collected: FileSystemEntry[] = [];
    // `readEntries` returns in batches and must be called until it yields none.
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            Promise.all(collected.map((e) => readDropEntry(e, depth + 1)))
              .then((nested) => resolve(nested.flat()))
              .catch(() => resolve([]));
            return;
          }
          collected.push(...batch);
          readBatch();
        },
        () => resolve([]),
      );
    };
    readBatch();
  });
}

/**
 * Like {@link filesFromTransfer}, but expands dropped FOLDERS into their files via
 * `webkitGetAsEntry()`. The DataTransfer is invalidated once the drop event
 * returns, so the synchronous part (capturing entries) must run inside the
 * handler — call this directly in `onDrop`; it reads the transfer before its first
 * `await`, then resolves the directory recursion. Falls back to the flat reader
 * where the entry API is unavailable.
 */
export async function filesFromTransferDeepInfo(
  dt: DataTransfer | null | undefined,
): Promise<DeepTransferFiles> {
  if (!dt?.items) return { files: filesFromTransfer(dt) };
  const entries: FileSystemEntry[] = [];
  const flat: File[] = [];
  let sawEntryApi = false;
  for (let i = 0; i < dt.items.length; i += 1) {
    const item = dt.items[i];
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      entries.push(entry);
      sawEntryApi = true;
    } else {
      const file = item.getAsFile();
      if (file) flat.push(file);
    }
  }
  if (!sawEntryApi) return { files: filesFromTransfer(dt) };
  const fromEntries = (await Promise.all(entries.map((e) => readDropEntry(e, 0)))).flat();
  // Dedupe the union (a file may surface through both an entry and `.getAsFile`).
  const seen = new Set<string>();
  const out: File[] = [];
  for (const file of [...fromEntries, ...flat]) {
    const key = JSON.stringify([file.name, file.size, file.lastModified, file.type]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  const singleTopLevelFolder =
    entries.length === 1 && entries[0]?.isDirectory && flat.length === 0
      ? entries[0].name
      : undefined;
  return { files: out, topLevelFolderName: singleTopLevelFolder };
}

export async function filesFromTransferDeep(dt: DataTransfer | null | undefined): Promise<File[]> {
  return (await filesFromTransferDeepInfo(dt)).files;
}

/**
 * `accept` for media file inputs. MIME wildcards alone make some OS pickers grey
 * out containers with no/odd MIME (notably .mkv → video/x-matroska), so we list
 * extensions explicitly too. Drag-and-drop and paste bypass this entirely.
 */
export const MEDIA_ACCEPT =
  "audio/*,video/*,.mp4,.m4v,.mov,.webm,.mkv,.avi,.mp3,.m4a,.aac,.flac,.ogg,.opus,.wav,.ncm";

/**
 * `accept` for image inputs. MIME wildcards alone can miss files whose OS picker
 * does not expose a MIME type, so keep the extension list aligned with
 * `IMAGE_EXT` above.
 */
export const IMAGE_ACCEPT = "image/*,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.heic,.heif";

/**
 * Summarize the dragged items for the live overlay. `dataTransfer.items[].type`
 * is readable mid-drag (names are not), so we can tell "all images" (→ cover
 * hint) from a media drop (→ add-to-set hint) before the user releases.
 */
export function summarizeDragItems(items: DataTransferItemList | DataTransferItem[] | undefined): {
  count: number;
  allImages: boolean;
} {
  if (!items) return { count: 0, allImages: false };
  let count = 0;
  let images = 0;
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind !== "file") continue;
    count += 1;
    if (item.type.startsWith("image/")) images += 1;
  }
  return { count, allImages: count > 0 && images === count };
}
