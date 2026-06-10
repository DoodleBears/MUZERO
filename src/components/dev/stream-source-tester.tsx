/**
 * Dev-only panel to validate an external streaming source end-to-end against the
 * real APIs (search → resolve → play) before the full UI/player integration lands.
 * Mounted only on Electron (needs the muzfetch CORS proxy); plain English copy
 * since it's a throwaway test affordance, not shipped product (exempt from i18n).
 *
 * NetEase: full path works — CDN URLs play directly in <audio> (cross-origin, no
 * Referer). Bilibili: search + resolve work and the URL is shown, but playback 403s
 * until the media proxy injects Referer (PRD Phase 1 infra). This panel is the
 * "notify me to run Electron" handoff; it will be replaced by Settings + search UI.
 */

import { useRef, useState } from "react";
import type { StreamSourceId } from "@/db/types";
import { createBiliSource } from "@/streamsrc/bili/bili-source";
import { createNeteaseSource } from "@/streamsrc/netease/netease-source";
import type { StreamSearchHit, StreamSourceProvider } from "@/streamsrc/provider";
import { createStreamHttp } from "@/streamsrc/stream-http";

function makeSource(id: StreamSourceId): StreamSourceProvider | null {
  const http = createStreamHttp();
  if (id === "bili") return createBiliSource({ http, now: () => Date.now() });
  if (id === "netease") return createNeteaseSource({ http });
  return null; // youtube → Phase 4
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function StreamSourceTester() {
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState<StreamSourceId>("netease");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<StreamSearchHit[]>([]);
  const [status, setStatus] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  async function runSearch() {
    setBusy(true);
    setStatus(`searching “${query}” on ${sourceId}…`);
    setHits([]);
    setResolvedUrl("");
    try {
      const src = makeSource(sourceId);
      if (!src) {
        setStatus(`${sourceId} not implemented`);
        return;
      }
      const results = await src.search(query, { limit: 15 });
      setHits(results);
      setStatus(`${results.length} result(s)`);
    } catch (e) {
      setStatus(`search error: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function playHit(hit: StreamSearchHit) {
    setStatus(`resolving “${hit.title}”…`);
    setResolvedUrl("");
    try {
      const src = makeSource(sourceId);
      if (!src) return;
      const res = await src.resolve(hit.externalId);
      if (res.kind !== "ok") {
        const detail =
          res.kind === "no-permission"
            ? ` (${res.reason})`
            : res.kind === "error"
              ? ` (${res.message})`
              : "";
        setStatus(`resolve → ${res.kind}${detail}`);
        return;
      }
      setResolvedUrl(res.stream.mediaUrl);
      const audio = audioRef.current;
      if (audio) {
        audio.src = res.stream.mediaUrl;
        await audio.play();
        setStatus(
          `playing (${res.stream.mime}${res.stream.quality ? `, ${res.stream.quality}` : ""})`,
        );
      }
    } catch (e) {
      setStatus(`play error (expected for bili until proxy injects Referer): ${errMsg(e)}`);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 left-3 z-50 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur hover:text-foreground"
      >
        ▶ Stream sources (dev)
      </button>
    );
  }

  return (
    <div className="fixed bottom-24 left-3 z-50 flex max-h-[60vh] w-80 flex-col gap-2 overflow-hidden rounded-xl border border-border bg-background/95 p-3 text-sm shadow-xl backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Stream sources (dev)</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      <div className="flex gap-1">
        {(["netease", "bili", "youtube"] as StreamSourceId[]).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSourceId(id)}
            disabled={id === "youtube"}
            className={`rounded-md border px-2 py-1 text-xs ${
              sourceId === id ? "border-primary bg-accent" : "border-border text-muted-foreground"
            } disabled:opacity-40`}
          >
            {id}
          </button>
        ))}
      </div>

      <div className="flex gap-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim() && !busy) void runSearch();
          }}
          placeholder="search a song…"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={busy || !query.trim()}
          className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40"
        >
          Search
        </button>
      </div>

      <p className="truncate text-xs text-muted-foreground" title={status}>
        {status}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {hits.map((hit) => (
          <button
            key={`${hit.source}:${hit.externalId}`}
            type="button"
            onClick={() => void playHit(hit)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-accent/50"
          >
            <span className="text-primary">▶</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{hit.title}</span>
              <span className="block truncate text-muted-foreground">
                {hit.artist ?? "—"}
                {hit.durationSec
                  ? ` · ${Math.floor(hit.durationSec / 60)}:${String(hit.durationSec % 60).padStart(2, "0")}`
                  : ""}
              </span>
            </span>
          </button>
        ))}
      </div>

      {resolvedUrl && (
        <p className="break-all text-[10px] text-muted-foreground" title={resolvedUrl}>
          {resolvedUrl.slice(0, 120)}…
        </p>
      )}
      {/* biome-ignore lint/a11y/useMediaCaption: dev test affordance, not shipped UI */}
      <audio ref={audioRef} controls className="w-full" />
    </div>
  );
}
