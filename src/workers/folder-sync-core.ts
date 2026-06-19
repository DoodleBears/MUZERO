import type { CreateReferencedUploadedTrackInput } from "@/db/repositories";
import type { ScannedFile } from "@/lib/folder-import";

export interface FolderSyncSourceRef {
  id: string;
  sessionId: string;
  sourcePath: string;
}

export interface FolderSyncPlanInput {
  media: ScannedFile[];
  existingRefs: FolderSyncSourceRef[];
  setId: string;
  sessionTrackIds: string[];
  removedTrackIds: string[];
}

export type FolderSyncPlanDbInput = Omit<FolderSyncPlanInput, "existingRefs">;

export interface FolderSyncPlanResult {
  freshIndexes: number[];
  recoveredTrackIds: string[];
  knownCount: number;
}

export interface CreateReferencedTracksInput {
  setId: string;
  files: ScannedFile[];
}

export interface CreateReferencedTracksResult {
  trackIds: string[];
}

export interface PublishTrackIdsInput {
  setId: string;
  ids: string[];
  afterTrackId?: string;
}

export interface PublishTrackIdsResult {
  afterTrackId?: string;
}

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

/**
 * Pure folder-sync planning. This is intentionally free of Dexie / DOM / shell
 * access so large Set/Map/filter work can run inside the shared heavy worker.
 */
export function planFolderSyncFiles(input: FolderSyncPlanInput): FolderSyncPlanResult {
  const known = new Set(input.existingRefs.map((ref) => ref.sourcePath));
  const linkedTrackIds = new Set(input.sessionTrackIds);
  const removedTrackIds = new Set(input.removedTrackIds);
  const recoverByPath = new Map<string, string>();
  for (const ref of input.existingRefs) {
    if (ref.sessionId !== input.setId) continue;
    if (linkedTrackIds.has(ref.id) || removedTrackIds.has(ref.id)) continue;
    if (!recoverByPath.has(ref.sourcePath)) recoverByPath.set(ref.sourcePath, ref.id);
  }

  const recoveredTrackIds: string[] = [];
  const freshIndexes: number[] = [];
  for (let index = 0; index < input.media.length; index += 1) {
    const file = input.media[index];
    if (!file) continue;
    const recoveredId = recoverByPath.get(file.path);
    if (recoveredId) {
      recoveredTrackIds.push(recoveredId);
      continue;
    }
    if (!known.has(file.path)) freshIndexes.push(index);
  }

  return { freshIndexes, recoveredTrackIds, knownCount: known.size };
}

export function freshFilesFromPlan(
  media: readonly ScannedFile[],
  plan: Pick<FolderSyncPlanResult, "freshIndexes">,
): ScannedFile[] {
  return plan.freshIndexes
    .map((index) => media[index])
    .filter((file): file is ScannedFile => Boolean(file));
}

export function buildReferencedUploadedTrackInputs(
  input: CreateReferencedTracksInput,
  now: number = Date.now(),
): CreateReferencedUploadedTrackInput[] {
  return input.files.map((file) => {
    const title = titleFromFileName(file.name);
    const mime = file.decode === "ncm" ? "audio/mpeg" : mimeFromExtension(file.name, file.kind);
    return {
      sessionId: input.setId,
      title,
      kind: file.decode === "ncm" ? "audio" : file.kind,
      mime,
      durationSec: 0,
      sourcePath: file.path,
      mediaMetadata: {
        originalMime: mime,
        originalExtension: file.decode === "ncm" ? "ncm" : extensionFromFileName(file.name),
        parser: "manual",
        parsedAt: now,
      },
    };
  });
}

function mimeFromExtension(name: string, kind: ScannedFile["kind"]): string {
  const ext = extensionFromFileName(name);
  return (ext && EXT_MIME[ext]) || (kind === "video" ? "video/mp4" : "audio/mpeg");
}

function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

function extensionFromFileName(name: string): string | undefined {
  return name.toLowerCase().match(/\.([^.]+)$/)?.[1];
}
