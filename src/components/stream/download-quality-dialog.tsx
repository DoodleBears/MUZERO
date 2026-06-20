import { Download, Layers, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listDownloadQualities,
  listVideoParts,
  startBackgroundBatchDownload,
  startBackgroundDownload,
} from "@/streamsrc/download-action";
import type { StreamPart, StreamSearchHit, VideoQualityOption } from "@/streamsrc/provider";

/** Which part the chosen quality applies to (the whole video, or one 分P). */
type Target = { externalId: string; title: string; durationSec?: number };

type Phase = { kind: "loading" } | { kind: "parts" } | { kind: "pick"; target: Target };

/** Rough download size from bitrate × duration. */
function estimateSize(q: VideoQualityOption, durationSec?: number): string | null {
  if (!q.bandwidth || !durationSec) return null;
  const mb = (q.bandwidth * durationSec) / 8 / 1_000_000;
  if (mb < 1) return null;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * Quick chooser for downloading a video into the library: pick a quality (and, for a
 * multi-part 分P video, a part or "download all"). It does NOT block on the download —
 * the choice fires a background download with a progress notification and closes.
 */
export function DownloadQualityDialog({
  hit,
  onClose,
  onStarted,
}: {
  hit: StreamSearchHit | null;
  /** Dismiss the chooser (✕ / backdrop) — stays in search. */
  onClose: () => void;
  /** A download was kicked off — the caller closes the search overlay so the
   *  progress notification (below the overlay's z-index) is visible. */
  onStarted: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [qualities, setQualities] = useState<VideoQualityOption[]>([]);
  const [parts, setParts] = useState<StreamPart[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed off the hit
  useEffect(() => {
    if (!hit) return;
    let cancelled = false;
    setPhase({ kind: "loading" });
    Promise.all([listDownloadQualities(hit), listVideoParts(hit)])
      .then(([q, p]) => {
        if (cancelled) return;
        setQualities(q);
        setParts(p);
        setPhase(
          p.length > 1
            ? { kind: "parts" }
            : { kind: "pick", target: { externalId: hit.externalId, title: hit.title } },
        );
      })
      .catch(() => {
        if (!cancelled)
          setPhase({
            kind: "pick",
            target: { externalId: hit?.externalId ?? "", title: hit?.title ?? "" },
          });
      });
    return () => {
      cancelled = true;
    };
  }, [hit]);

  if (!hit) return null;

  function pickQuality(quality: VideoQualityOption) {
    if (!hit || phase.kind !== "pick") return;
    const { target } = phase;
    startBackgroundDownload(
      {
        ...hit,
        externalId: target.externalId,
        title: target.title,
        durationSec: target.durationSec ?? hit.durationSec,
      },
      { quality: quality.key },
    );
    onStarted();
  }

  function downloadAllParts() {
    if (!hit) return;
    startBackgroundBatchDownload(hit, parts);
    onStarted();
  }

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-background/55 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t("download.title")}
    >
      <button
        type="button"
        aria-label={t("download.close")}
        className="absolute inset-0 size-full cursor-default"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/12 bg-popover/95 text-popover-foreground shadow-2xl ring-1 ring-black/10">
        <div className="flex items-start gap-3 border-white/10 border-b px-4 py-3">
          <div className="grid size-11 shrink-0 place-items-center overflow-hidden bg-secondary album-cover-radius">
            {hit.coverUrl ? (
              <img
                src={hit.coverUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-full object-cover"
              />
            ) : (
              <Download className="size-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-sm">{hit.title}</div>
            <div className="truncate text-muted-foreground text-xs">
              {phase.kind === "parts" ? t("download.parts") : t("download.subtitle")}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("download.close")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {phase.kind === "loading" && (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> {t("download.loadingQualities")}
            </div>
          )}

          {phase.kind === "parts" && (
            <>
              <button
                type="button"
                onClick={downloadAllParts}
                className="mb-1 flex w-full items-center gap-3 rounded-xl border border-primary/40 px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
              >
                <Layers className="size-4 shrink-0 text-primary" />
                <span className="font-medium text-sm">
                  {t("download.allParts", { count: parts.length })}
                </span>
              </button>
              {parts.map((part) => (
                <button
                  key={part.externalId}
                  type="button"
                  onClick={() =>
                    setPhase({
                      kind: "pick",
                      target: {
                        externalId: part.externalId,
                        title: part.title,
                        durationSec: part.durationSec,
                      },
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent/60"
                >
                  <span className="w-8 shrink-0 text-center text-muted-foreground text-xs tabular-nums">
                    P{part.index}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{part.title}</span>
                </button>
              ))}
            </>
          )}

          {phase.kind === "pick" &&
            (qualities.length === 0 ? (
              <p className="px-3 py-8 text-center text-muted-foreground text-sm">
                {t("download.noQualities")}
              </p>
            ) : (
              qualities.map((q) => {
                const size = estimateSize(q, phase.target.durationSec ?? hit.durationSec);
                return (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => pickQuality(q)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent/60"
                  >
                    <Download className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">
                        {q.label}
                        {q.hdr ? " · HDR" : ""}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        <span className="uppercase">{q.codec}</span>
                        {size ? ` · ${t("download.estSize", { size })}` : ""}
                      </div>
                    </div>
                    {q.requiresLogin ? (
                      <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        VIP
                      </span>
                    ) : null}
                  </button>
                );
              })
            ))}
        </div>
      </div>
    </div>
  );
}
