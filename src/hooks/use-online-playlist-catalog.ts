import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveSettings } from "@/db/repositories";
import type { StreamSourceId } from "@/db/types";
import {
  allOnlinePlaylistCatalogEntries,
  onlinePlaylistCatalogSourcesToSync,
  syncOnlinePlaylistCatalogSource,
} from "@/streamsrc/playlist-catalog";
import { createStreamSource } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { useSettings } from "./use-app-data";

export function useOnlinePlaylistCatalog(active: boolean) {
  const settings = useSettings();
  const [syncingSources, setSyncingSources] = useState<Set<StreamSourceId>>(() => new Set());
  const latestSettingsRef = useRef(settings);
  const syncingSourcesRef = useRef<Set<StreamSourceId>>(new Set());
  latestSettingsRef.current = settings;

  const playlists = useMemo(
    () => allOnlinePlaylistCatalogEntries(settings.onlinePlaylistCatalog),
    [settings.onlinePlaylistCatalog],
  );

  const syncSources = useCallback(async (sources: StreamSourceId[]) => {
    const fresh = sources.filter((source) => !syncingSourcesRef.current.has(source));
    if (fresh.length === 0) return;
    for (const source of fresh) syncingSourcesRef.current.add(source);
    setSyncingSources((current) => new Set([...current, ...fresh]));
    try {
      let workingSettings = latestSettingsRef.current;
      for (const source of fresh) {
        await syncOnlinePlaylistCatalogSource(source, {
          settings: workingSettings,
          save: async (patch) => {
            const next = await saveSettings(patch);
            workingSettings = next;
            latestSettingsRef.current = next;
            return next;
          },
          createSource: (id) =>
            createStreamSource(id, {
              http: createStreamHttp(),
              now: () => Date.now(),
              getCookie: (sid) => workingSettings.streamSources?.[sid]?.cookie,
            }),
        });
      }
    } finally {
      setSyncingSources((current) => {
        const next = new Set(current);
        for (const source of fresh) {
          syncingSourcesRef.current.delete(source);
          next.delete(source);
        }
        return next;
      });
    }
  }, []);

  const refreshAll = useCallback(
    () =>
      syncSources(
        onlinePlaylistCatalogSourcesToSync(latestSettingsRef.current, Date.now(), {
          force: true,
        }),
      ),
    [syncSources],
  );

  const refreshSource = useCallback(
    (source: StreamSourceId) => syncSources([source]),
    [syncSources],
  );

  useEffect(() => {
    if (!active) return;
    const sources = onlinePlaylistCatalogSourcesToSync(settings, Date.now());
    if (sources.length > 0) void syncSources(sources);
  }, [active, settings, syncSources]);

  return {
    catalog: settings.onlinePlaylistCatalog,
    playlists,
    refreshAll,
    refreshSource,
    syncingSources,
    syncing: syncingSources.size > 0,
  };
}
