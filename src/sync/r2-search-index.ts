import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { RemoteSearchCatalog, RemoteSearchTrack } from "@/db/types";
import { getAppFetch } from "@/lib/platform";
import { cacheMetadataVersion } from "./r2-merge-policy";
import {
  matchesRemoteSearchTrack,
  type R2SearchPageRef,
  type R2SetSearchPage,
  type R2TrackSearchPage,
  r2SearchCatalogSchema,
  r2SetSearchPageSchema,
  r2TrackSearchPageSchema,
  remoteSearchSetToRow,
  remoteSearchTrackToRow,
} from "./r2-search-catalog";
import { resolveRemoteObjectUrl } from "./r2-url";

export type SyncCatalogFetch = typeof globalThis.fetch;

export interface ImportRemoteTrackSearchPageInput {
  catalogId: string;
  driveId: string;
  shareId?: string;
  page: R2TrackSearchPage;
}

export interface ImportRemoteSetSearchPageInput {
  catalogId: string;
  driveId: string;
  shareId?: string;
  page: R2SetSearchPage;
}

export interface ImportRemoteSearchCatalogInput {
  catalogId: string;
  driveId: string;
  shareId?: string;
  scope: RemoteSearchCatalog["scope"];
  baseUrl: string;
  catalogUrl: string;
  fetcher?: SyncCatalogFetch;
}

async function resolveFetcher(fetcher?: SyncCatalogFetch): Promise<SyncCatalogFetch> {
  return fetcher ?? getAppFetch();
}

async function fetchJson(url: string, label: string, fetcher: SyncCatalogFetch): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Failed to parse ${label} JSON`, { cause: error });
  }
}

export async function importRemoteTrackSearchPage(
  input: ImportRemoteTrackSearchPageInput,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const rows = input.page.tracks.map((track) =>
    remoteSearchTrackToRow({
      catalogId: input.catalogId,
      driveId: input.driveId,
      shareId: input.shareId,
      track,
    }),
  );
  await db.remoteSearchTracks.bulkPut(rows);
}

export async function importRemoteSetSearchPage(
  input: ImportRemoteSetSearchPageInput,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const rows = input.page.sets.map((set) =>
    remoteSearchSetToRow({
      catalogId: input.catalogId,
      driveId: input.driveId,
      shareId: input.shareId,
      set,
    }),
  );
  await db.remoteSearchSets.bulkPut(rows);
}

export async function importRemoteSearchCatalog(
  input: ImportRemoteSearchCatalogInput,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const fetcher = await resolveFetcher(input.fetcher);
  const rawCatalog = await fetchJson(input.catalogUrl, "search catalog", fetcher);
  const catalog = r2SearchCatalogSchema.parse(rawCatalog);
  const existing = await db.remoteSearchCatalogs.get(input.catalogId);
  const pageVersions: Record<string, string> = {};

  await db.remoteSearchCatalogs.put({
    id: input.catalogId,
    driveId: input.driveId,
    shareId: input.shareId,
    scope: input.scope,
    sourceUrl: input.catalogUrl,
    updatedAt: Date.parse(catalog.updatedAt),
    syncedAt: Date.now(),
    setCount: catalog.counts.sets,
    trackCount: catalog.counts.tracks,
    pageVersions,
  });

  for (const pageRef of catalog.pages.tracks) {
    const pageUrl = resolveRemoteObjectUrl(input.baseUrl, pageRefPath(pageRef));
    const version = cacheMetadataVersion(pageRef);
    const versionKey = pageVersionKey("track", pageUrl);
    if (version) pageVersions[versionKey] = version;
    if (version && existing?.pageVersions?.[versionKey] === version) continue;
    const rawPage = await fetchJson(pageUrl, "track search page", fetcher);
    await importRemoteTrackSearchPage(
      {
        catalogId: input.catalogId,
        driveId: input.driveId,
        shareId: input.shareId,
        page: r2TrackSearchPageSchema.parse(rawPage),
      },
      db,
    );
  }

  for (const pageRef of catalog.pages.sets) {
    const pageUrl = resolveRemoteObjectUrl(input.baseUrl, pageRefPath(pageRef));
    const version = cacheMetadataVersion(pageRef);
    const versionKey = pageVersionKey("set", pageUrl);
    if (version) pageVersions[versionKey] = version;
    if (version && existing?.pageVersions?.[versionKey] === version) continue;
    const rawPage = await fetchJson(pageUrl, "set search page", fetcher);
    await importRemoteSetSearchPage(
      {
        catalogId: input.catalogId,
        driveId: input.driveId,
        shareId: input.shareId,
        page: r2SetSearchPageSchema.parse(rawPage),
      },
      db,
    );
  }

  await db.remoteSearchCatalogs.update(input.catalogId, {
    pageVersions,
    syncedAt: Date.now(),
  });
}

export async function searchRemoteTracks(
  query: string,
  db: MuzeroDB = defaultDb,
): Promise<RemoteSearchTrack[]> {
  const rows = await db.remoteSearchTracks.toArray();
  return rows.filter((row) => matchesRemoteSearchTrack(row, query));
}

function pageRefPath(ref: R2SearchPageRef): string {
  return typeof ref === "string" ? ref : ref.path;
}

function pageVersionKey(kind: "set" | "track", pageUrl: string): string {
  return `${kind}:${pageUrl}`;
}
