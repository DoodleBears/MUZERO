import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { Track, TrackMediaMetadata } from "@/db/types";
import {
  basename,
  type FolderFs,
  mimeFromExtension,
  type ScannedFile,
  scanFolderForMedia,
} from "@/lib/folder-import";

export type LocalFileRepairResult = { kind: "repaired"; sourcePath: string } | { kind: "no-match" };

export interface RepairTrackSourcePathFromFolderInput {
  track: Track;
  folderPath: string;
  fs: Pick<FolderFs, "readDir" | "join">;
  db?: MuzeroDB;
  now?: () => number;
}

export function findLocalFileRepairCandidate(
  track: Pick<Track, "kind" | "mediaMetadata" | "sourcePath" | "title">,
  files: readonly ScannedFile[],
): ScannedFile | undefined {
  const expected = expectedFileName(track)?.toLowerCase();
  if (!expected) return undefined;
  return files.find((file) => file.kind === track.kind && file.name.toLowerCase() === expected);
}

export async function repairTrackSourcePathFromFolder(
  input: RepairTrackSourcePathFromFolderInput,
): Promise<LocalFileRepairResult> {
  const database = input.db ?? defaultDb;
  const scanned = await scanFolderForMedia(input.folderPath, input.fs);
  const match = findLocalFileRepairCandidate(input.track, scanned.media);
  if (!match) return { kind: "no-match" };

  const updatedAt = input.now?.() ?? Date.now();
  await database.tracks.update(input.track.id, {
    error: undefined,
    mediaMetadata: repairedMetadata(input.track, match, updatedAt),
    sourcePath: match.path,
    status: "ready",
    updatedAt,
  });
  return { kind: "repaired", sourcePath: match.path };
}

function expectedFileName(
  track: Pick<Track, "mediaMetadata" | "sourcePath" | "title">,
): string | undefined {
  return (
    track.mediaMetadata?.originalFileName ??
    (track.sourcePath ? basename(track.sourcePath) : undefined)
  );
}

function repairedMetadata(track: Track, file: ScannedFile, parsedAt: number): TrackMediaMetadata {
  const mime = mimeFromExtension(file.name, file.kind);
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  return {
    ...(track.mediaMetadata ?? {
      parser: "manual" as const,
      title: track.title,
    }),
    originalExtension: extension,
    originalFileName: file.name,
    originalMime: mime,
    parsedAt,
  };
}
