import { Check, Download, Layers, Loader2, Music, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type DownloadProgressStage,
  downloadStreamedHit,
  listDownloadQualities,
  listVideoParts,
} from "@/streamsrc/download-action";
import type { DownloadStreamedVideoResult } from "@/streamsrc/download-to-library";
import type { StreamPart, StreamSearchHit, VideoQualityOption } from "@/streamsrc/provider";

export type DownloadMode = "video" | "audio";
export interface DownloadRequest {
  hit: StreamSearchHit;
  mode: DownloadMode;
}

/** Which part(s) the chosen quality applies to. */
type Target = { kind: "single"; externalId: string; title: string } | { kind: "all" };

type Phase =
  | { kind: "loading" }
  | { kind: "parts" }
  | { kind: "pick"; target: Target }
  | { kind: "downloading"; label: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

/** Rough download size from bitrate × duration (video-only bandwidth + a little audio). */
function estimateSize(q: VideoQualityOption, durationSec?: number): string | null {
  if (!q.bandwidth || !durationSec) return null;
  const mb = (q.bandwidth * durationSec) / 8 / 1_000_000;
  if (mb < 1) return null;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Download a video (quality picker + 分P chooser) or audio-only (immediate) into the library. */
export function DownloadQualityDialog({
  request,
  onClose,
}: {
  request: DownloadRequest | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [qualities, setQualities] = useState<VideoQualityOption[]>([]);
  const [parts, setParts] = useState<StreamPart[]>([]);

  const hit = request?.hit ?? null;
  const mode = request?.mode ?? "video";

  function stageLabel(stage: DownloadProgressStage): string {
    return stage === "fetch"
      ? t("download.stageFetch")
      : stage === "mux"
        ? t("download.stageMux")
        : t("download.stageStore");
  }
  function applyResult(result: DownloadStreamedVideoResult, doneMessage: string) {
    if (result.kind === "downloaded") setPhase({ kind: "done", message: doneMessage });
    else if (result.kind === "requires-login")
      setPhase({ kind: "error", message: t("download.loginRequired") });
    else if (result.kind === "no-permission") setPhase({ kind: "error", message: result.reason });
    else setPhase({ kind: "error", message: result.message });
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: t/stageLabel are render-stable enough; we key off the request
  useEffect(() => {
    if (!request) return;
    const { hit: h, mode: m } = request;
    let cancelled = false;

    if (m === "audio") {
      setPhase({ kind: "downloading", label: stageLabel("fetch") });
      downloadStreamedHit(h, {
        audioOnly: true,
        onProgress: (stage) => {
          if (!cancelled) setPhase({ kind: "downloading", label: stageLabel(stage) });
        },
      })
        .then((result) => {
          if (!cancelled) applyResult(result, t("download.done"));
        })
        .catch((err) => {
          if (!cancelled) setPhase({ kind: "error", message: String(err) });
        });
      return () => {
        cancelled = true;
      };
    }

    setPhase({ kind: "loading" });
    Promise.all([listDownloadQualities(h), listVideoParts(h)])
      .then(([q, p]) => {
        if (cancelled) return;
        setQualities(q);
        setParts(p);
        setPhase(
          p.length > 1
            ? { kind: "parts" }
            : {
                kind: "pick",
                target: { kind: "single", externalId: h.externalId, title: h.title },
              },
        );
      })
      .catch((err) => {
        if (!cancelled) setPhase({ kind: "error", message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!hit) return null;

  async function startVideo(quality: VideoQualityOption) {
    if (!hit || phase.kind !== "pick" || phase.target.kind !== "single") return;
    const target = phase.target;
    setPhase({ kind: "downloading", label: stageLabel("fetch") });
    const result = await downloadStreamedHit(
      { ...hit, externalId: target.externalId, title: target.title },
      {
        quality: quality.key,
        onProgress: (stage) => setPhase({ kind: "downloading", label: stageLabel(stage) }),
      },
    );
    applyResult(result, t("download.done"));
  }

  // "Download all parts" uses the configured default quality (no per-part picker); the
  // source's selector degrades to the closest available tier.
  async function startAll() {
    if (!hit) return;
    let ok = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      setPhase({
        kind: "downloading",
        label: t("download.downloadingPart", { done: i + 1, total: parts.length }),
      });
      const result = await downloadStreamedHit({
        ...hit,
        externalId: part.externalId,
        title: part.title,
        durationSec: part.durationSec ?? hit.durationSec,
      });
      if (result.kind === "downloaded") ok += 1;
      else if (result.kind === "requires-login") {
        setPhase({ kind: "error", message: t("download.loginRequired") });
        return;
      }
    }
    setPhase({ kind: "done", message: t("download.doneCount", { count: ok }) });
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
            ) : mode === "audio" ? (
              <Music className="size-4 text-muted-foreground" />
            ) : (
              <Download className="size-4 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-sm">{hit.title}</div>
            <div className="truncate text-muted-foreground text-xs">
              {mode === "audio"
                ? t("download.audio")
                : phase.kind === "parts"
                  ? t("download.parts")
                  : t("download.subtitle")}
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

        <div className="overflow-y-auto p-2">
          {phase.kind === "loading" && (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> {t("download.loadingQualities")}
            </div>
          )}

          {phase.kind === "parts" && (
            <>
              <button
                type="button"
                onClick={() => void startAll()}
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
                      target: { kind: "single", externalId: part.externalId, title: part.title },
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent/60"
                >
                  <span className="w-6 shrink-0 text-center text-muted-foreground text-xs tabular-nums">
                    {part.index}
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
                const size = estimateSize(
                  q,
                  phase.target.kind === "all" ? undefined : hit.durationSec,
                );
                return (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => void startVideo(q)}
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

          {phase.kind === "downloading" && (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> {phase.label}
            </div>
          )}

          {phase.kind === "done" && (
            <div className="flex flex-col items-center gap-3 px-3 py-8">
              <div className="grid size-10 place-items-center rounded-full bg-primary/15 text-primary">
                <Check className="size-5" />
              </div>
              <p className="text-sm">{phase.message}</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent/60"
              >
                {t("download.close")}
              </button>
            </div>
          )}

          {phase.kind === "error" && (
            <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
              <p className="text-destructive text-sm">{t("download.failed")}</p>
              <p className="break-all text-muted-foreground text-xs">{phase.message}</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent/60"
              >
                {t("download.close")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
