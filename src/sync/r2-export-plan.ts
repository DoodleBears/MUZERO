import type { MuzeroDB } from "@/db/muzero-db";
import { db as defaultDb } from "@/db/muzero-db";
import type { DjSession, MediaBlob, Memory, Track } from "@/db/types";
import type { R2Manifest, R2SetIndex } from "./r2-manifest-schema";

type R2RemoteObject = R2SetIndex["tracks"][number]["media"];

export type R2ExportObjectKind = "media" | "cover" | "memory-photo" | "set-index" | "manifest";

export interface R2ExportObject {
  kind: R2ExportObjectKind;
  key: string;
  contentType: string;
  bytes: number;
  body: Blob | string;
  sha256?: string;
  setId?: string;
  trackId?: string;
  memoryId?: string;
}

export interface R2ExportPlan {
  driveId: string;
  libraryId: string;
  baseUrl: string;
  objects: R2ExportObject[];
  totalBytes: number;
}

export interface R2ExportPlanInput {
  driveId: string;
  libraryId: string;
  baseUrl: string;
  setIds: string[];
  db?: MuzeroDB;
}

interface BinaryObjectResult {
  object: R2ExportObject;
  remote: R2RemoteObject;
}

export async function buildR2ExportPlan(input: R2ExportPlanInput): Promise<R2ExportPlan> {
  const db = input.db ?? defaultDb;
  const binaryObjects: R2ExportObject[] = [];
  const setIndexes: Array<{ session: DjSession; object: R2ExportObject }> = [];

  for (const setId of input.setIds) {
    const session = await db.sessions.get(setId);
    if (!session) continue;
    const tracks = await loadSessionTracks(session, db);
    const setIndexTracks: R2SetIndex["tracks"] = [];

    for (const track of tracks) {
      if (!track.blobId) continue;
      const mediaBlob = await db.mediaBlobs.get(track.blobId);
      if (!mediaBlob) continue;

      const media = await createBinaryObject("media", mediaBlob, {
        setId: session.id,
        trackId: track.id,
      });
      binaryObjects.push(media.object);

      const cover = track.coverBlobId
        ? await loadOptionalBinaryObject("cover", track.coverBlobId, db, {
            setId: session.id,
            trackId: track.id,
          })
        : undefined;
      if (cover) binaryObjects.push(cover.object);

      const memories = await db.memories.where("trackId").equals(track.id).sortBy("createdAt");
      const remoteMemories = [];
      for (const memory of memories) {
        const photo = memory.photoBlobId
          ? await loadOptionalBinaryObject("memory-photo", memory.photoBlobId, db, {
              setId: session.id,
              trackId: track.id,
              memoryId: memory.id,
            })
          : undefined;
        if (photo) binaryObjects.push(photo.object);
        remoteMemories.push(toRemoteMemory(memory, photo?.remote));
      }

      setIndexTracks.push({
        id: track.id,
        title: track.title,
        kind: track.kind,
        origin: track.origin,
        provider: track.provider,
        durationSec: track.durationSec,
        createdAt: track.createdAt,
        generatedAt: track.generatedAt,
        liked: track.liked,
        tags: track.tags,
        brief: track.brief ?? null,
        providerPreset: track.providerPreset ?? null,
        media: media.remote,
        cover: cover?.remote,
        memories: remoteMemories,
      });
    }

    const setIndex: R2SetIndex = {
      schema: "muzero-r2-set-index-v1",
      set: {
        id: session.id,
        name: session.name,
        seedPrompt: session.seedPrompt,
        displayMode: session.displayMode,
        config: session.config,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      tracks: setIndexTracks,
    };
    setIndexes.push({
      session,
      object: createJsonObject("set-index", `sets/${session.id}/index.json`, setIndex, {
        setId: session.id,
      }),
    });
  }

  const manifest = createManifest(input, setIndexes);
  const objects = [
    ...binaryObjects,
    ...setIndexes.map(({ object }) => object),
    createJsonObject("manifest", "manifest.json", manifest),
  ];

  return {
    driveId: input.driveId,
    libraryId: input.libraryId,
    baseUrl: input.baseUrl,
    objects,
    totalBytes: objects.reduce((total, object) => total + object.bytes, 0),
  };
}

async function loadSessionTracks(session: DjSession, db: MuzeroDB): Promise<Track[]> {
  const rows = await db.tracks.bulkGet(session.trackIds);
  return rows.filter((track): track is Track => Boolean(track));
}

async function loadOptionalBinaryObject(
  kind: "cover" | "memory-photo",
  blobId: string,
  db: MuzeroDB,
  refs: Pick<R2ExportObject, "setId" | "trackId" | "memoryId">,
): Promise<BinaryObjectResult | undefined> {
  const blob = await db.mediaBlobs.get(blobId);
  return blob ? createBinaryObject(kind, blob, refs) : undefined;
}

async function createBinaryObject(
  kind: "media" | "cover" | "memory-photo",
  blob: MediaBlob,
  refs: Pick<R2ExportObject, "setId" | "trackId" | "memoryId">,
): Promise<BinaryObjectResult> {
  const sha256 = await sha256Blob(blob);
  const key = `${binaryDirectory(kind)}/sha256-${sha256}${extensionForMime(blob.mime)}`;
  const object: R2ExportObject = {
    kind,
    key,
    contentType: blob.mime,
    bytes: blob.bytes,
    body: blob.blob,
    sha256,
    ...refs,
  };
  return {
    object,
    remote: {
      key,
      url: key,
      mime: blob.mime,
      bytes: blob.bytes,
      sha256,
    },
  };
}

function toRemoteMemory(
  memory: Memory,
  photo?: R2RemoteObject,
): R2SetIndex["tracks"][number]["memories"][number] {
  return {
    id: memory.id,
    note: memory.note,
    createdAt: memory.createdAt,
    photo,
  };
}

function createJsonObject(
  kind: "set-index" | "manifest",
  key: string,
  value: unknown,
  refs: Pick<R2ExportObject, "setId"> = {},
): R2ExportObject {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  return {
    kind,
    key,
    contentType: "application/json",
    bytes: new TextEncoder().encode(body).byteLength,
    body,
    ...refs,
  };
}

function createManifest(
  input: R2ExportPlanInput,
  setIndexes: Array<{ session: DjSession; object: R2ExportObject }>,
): R2Manifest {
  const now = new Date().toISOString();
  return {
    schema: "muzero-r2-manifest-v1",
    libraryId: input.libraryId,
    title: "MUZERO Library",
    createdAt: now,
    updatedAt: now,
    baseUrl: input.baseUrl,
    sets: setIndexes.map(({ session, object }) => ({
      id: session.id,
      title: session.name,
      index: object.key,
      updatedAt: new Date(session.updatedAt).toISOString(),
      trackCount: session.trackIds.length,
      bytes: object.bytes,
    })),
  };
}

async function sha256Blob(blob: MediaBlob): Promise<string> {
  const value = blob.blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  const bytes =
    typeof value.arrayBuffer === "function"
      ? await value.arrayBuffer()
      : new TextEncoder().encode(`${blob.id}:${blob.mime}:${blob.bytes}`).buffer;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function binaryDirectory(kind: "media" | "cover" | "memory-photo"): string {
  if (kind === "media") return "objects/media";
  if (kind === "cover") return "objects/covers";
  return "objects/memories";
}

function extensionForMime(mime: string): string {
  if (mime === "audio/mpeg") return ".mp3";
  if (mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav") return ".wav";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return "";
}
