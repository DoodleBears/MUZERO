/**
 * Local-folder import: scan a user-picked folder for plaintext audio/video and
 * feed it through the existing upload pipeline. The scan/classify/dedup core is
 * pure and takes an injected {@link FolderFs}, so it unit-tests without Tauri;
 * the Tauri-backed wrappers at the bottom (dialog + fs + runtime scope grant)
 * are the only parts that touch the desktop shell.
 *
 * Scope: plaintext media + NetEase `.ncm` (decrypted locally on import — local
 * format conversion of the user's own library; see {@link decodeNcm}). The other
 * encrypted store formats (QQ `.qmc*` / `.mflac` / `.mgg`, 酷狗 `.kgm` family, …)
 * and Spotify/Apple DRM caches are still NOT decrypted — they're detected and
 * counted so the UI can say "skipped N".
 */

import type { TrackKind } from "@/db/types";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { classifyFile } from "@/lib/file-drop";
import { isNcmFile } from "@/lib/ncm-decode";

/** Minimal shape of a Tauri `DirEntry` we depend on (decoupled for tests). */
export interface DirEntryLike {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

/** The filesystem surface the scanner needs — real impl wraps the Tauri plugins. */
export interface FolderFs {
  readDir: (path: string) => Promise<DirEntryLike[]>;
  join: (base: string, name: string) => Promise<string> | string;
  // `<ArrayBuffer>` (not the default `ArrayBufferLike`) so the bytes satisfy
  // `BlobPart` when wrapped in a File — SharedArrayBuffer-backed views don't.
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
}

/** A media file discovered under a folder, classified for import. */
export interface ScannedFile {
  /** Absolute path on disk (also the dedup key once imported as `Track.sourcePath`). */
  path: string;
  /** Basename, used as the fallback title + for MIME guessing. */
  name: string;
  kind: TrackKind;
  /** Set for containers that must be decrypted to plaintext before ingest (`.ncm`). */
  decode?: "ncm";
}

export interface FolderScanResult {
  /** Importable plaintext audio/video. */
  media: ScannedFile[];
  /** Encrypted store-format files we deliberately do not decrypt. */
  encryptedCount: number;
  /** Other non-media files (junk, docs) — counted, not imported. Images are ignored. */
  unsupportedCount: number;
}

// --- encrypted store-format detector -----------------------------------------

// QQ音乐 .qmc0/.qmc3/.qmcflac/.qmcogg/.mflac/.mgg…; 酷狗 .kgm/.kgma; 酷我 .kwm;
// 太合/千千 .tkm; 百度 .bkcmp3/.bkcflac. NetEase `.ncm` is NOT here — it's decrypted
// on import (see `isNcmFile`). Deliberately excludes ambiguous extensions like
// `.xm`/`.vpr` (`.xm` is a legitimate tracker-module format).
const ENCRYPTED_EXT =
  /\.(qmc0|qmc3|qmcflac|qmcogg|mflac|mflac0|mgg|mgg1|mggl|kgm|kgma|kwm|tkm|bkcmp3|bkcflac)$/i;

/** Encrypted/DRM store formats we report but never decrypt. */
export function isEncryptedStoreFormat(name: string): boolean {
  return ENCRYPTED_EXT.test(name);
}

// --- MIME from extension ------------------------------------------------------

const EXT_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/opus",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

/** Best-effort MIME from a filename extension — on-disk files carry no `File.type`. */
export function mimeFromExtension(name: string, kind: TrackKind): string {
  const ext = name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  return (ext && EXT_MIME[ext]) || (kind === "video" ? "video/mp4" : "audio/mpeg");
}

// --- recursion (pure given an injected fs) ------------------------------------

/** Guard against pathological symlink/junction loops the symlink-skip can't catch. */
const MAX_DEPTH = 24;

/**
 * Recursively scan a folder for plaintext media. Symlinks are skipped entirely
 * (avoids loops + escaping the granted scope); an unreadable subdirectory is
 * swallowed so one permission error never aborts the whole scan.
 */
export async function scanFolderForMedia(
  rootPath: string,
  fs: Pick<FolderFs, "readDir" | "join">,
): Promise<FolderScanResult> {
  const media: ScannedFile[] = [];
  let encryptedCount = 0;
  let unsupportedCount = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return;
    let entries: DirEntryLike[];
    try {
      entries = await fs.readDir(dir);
    } catch {
      return; // unreadable subdir — skip, keep scanning the rest
    }
    for (const entry of entries) {
      if (entry.isSymlink) continue;
      const full = await fs.join(dir, entry.name);
      if (entry.isDirectory) {
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile) continue;
      // NetEase `.ncm` is decrypted to plaintext audio during ingest.
      if (isNcmFile(entry.name)) {
        media.push({ path: full, name: entry.name, kind: "audio", decode: "ncm" });
        continue;
      }
      if (isEncryptedStoreFormat(entry.name)) {
        encryptedCount += 1;
        continue;
      }
      // On-disk files have no MIME — force the extension path.
      const cls = classifyFile({ type: "", name: entry.name });
      if (cls === "audio" || cls === "video") {
        media.push({ path: full, name: entry.name, kind: cls });
      } else if (cls === null) {
        unsupportedCount += 1; // images (cls === "image") are silently ignored
      }
    }
  }

  await walk(rootPath, 0);
  return { media, encryptedCount, unsupportedCount };
}

/** Keep only files not already in the library (incremental dedup by absolute path). */
export function selectNewFiles(
  scanned: ScannedFile[],
  knownPaths: ReadonlySet<string>,
): ScannedFile[] {
  return scanned.filter((f) => !knownPaths.has(f.path));
}

/** Basename of an absolute path (handles both POSIX and Windows separators). */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

// --- shell-backed wrappers (desktop only; routed through src/lib/desktop) ------

/**
 * Build a {@link FolderFs} from the active desktop bridge (Tauri plugins or the
 * Electron IPC). Callers gate on {@link hasFolderAccess} first; this throws in a
 * runtime without filesystem access (plain web).
 */
export function createFolderFs(): FolderFs {
  const bridge = resolveDesktopBridge();
  const { readDir, readFile, join } = bridge;
  if (!readDir || !readFile || !join) {
    throw new Error("Folder access is not available in this runtime");
  }
  return { readDir, readFile, join };
}

/** Open the native folder picker; absolute path, or null if cancelled / web. */
export async function pickFolder(): Promise<string | null> {
  return (await resolveDesktopBridge().pickFolder?.()) ?? null;
}

/**
 * Grant the app runtime read access to a folder (recursive). On Tauri this extends
 * the fs scope; on Electron it adds to the main-process allowlist. Both ship with
 * NO static access and re-grant each launch from the remembered-folder list, never
 * broadening beyond the user's picks.
 */
export async function grantFolderAccess(path: string): Promise<void> {
  await resolveDesktopBridge().grantFolderAccess?.(path);
}

/** Read a scanned file's bytes into a `File` so it flows through the upload pipeline. */
export async function readScannedFile(
  file: ScannedFile,
  fs: Pick<FolderFs, "readFile">,
): Promise<File> {
  const bytes = await fs.readFile(file.path);
  return new File([bytes], file.name, { type: mimeFromExtension(file.name, file.kind) });
}
