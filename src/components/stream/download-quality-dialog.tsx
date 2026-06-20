import { Check, Download, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type DownloadProgressStage,
  downloadStreamedHit,
  listDownloadQualities,
} from "@/streamsrc/download-action";
import type { StreamSearchHit, VideoQualityOption } from "@/streamsrc/provider";

type Phase =
  | { kind: "loading" }
  | { kind: "pick"; qualities: VideoQualityOption[] }
  | { kind: "downloading"; stage: DownloadProgressStage }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** Rough download size from bitrate × duration (video-only bandwidth + a little audio). */
function estimateSize(q: VideoQualityOption, durationSec?: number): string | null {
  if (!q.bandwidth || !durationSec) return null;
  const mb = (q.bandwidth * durationSec) / 8 / 1_000_000;
  if (mb < 1) return null;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Quality picker for downloading an online video into the library (Bilibili / YouTube). */
export function DownloadQualityDialog({
  hit,
  onClose,
}: {
  hit: StreamSearchHit | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    if (!hit) return;
    let cancelled = false;
    setPhase({ kind: "loading" });
    listDownloadQualities(hit)
      .then((qualities) => {
        if (!cancelled) setPhase({ kind: "pick", qualities });
      })
      .catch((err) => {
        if (!cancelled) setPhase({ kind: "error", message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [hit]);

  if (!hit) return null;

  async function start(quality: VideoQualityOption) {
    if (!hit) return;
    setPhase({ kind: "downloading", stage: "fetch" });
    const result = await downloadStreamedHit(hit, {
      quality: quality.key,
      onProgress: (stage) =>
        setPhase((p) => (p.kind === "downloading" ? { kind: "downloading", stage } : p)),
    });
    if (result.kind === "downloaded") setPhase({ kind: "done" });
    else if (result.kind === "requires-login")
      setPhase({ kind: "error", message: t("download.loginRequired") });
    else if (result.kind === "no-permission") setPhase({ kind: "error", message: result.reason });
    else setPhase({ kind: "error", message: result.message });
  }

  const stageLabel = (stage: DownloadProgressStage) =>
    stage === "fetch"
      ? t("download.stageFetch")
      : stage === "mux"
        ? t("download.stageMux")
        : t("download.stageStore");

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
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-white/12 bg-popover/95 text-popover-foreground shadow-2xl ring-1 ring-black/10">
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
            <div className="truncate text-muted-foreground text-xs">{t("download.subtitle")}</div>
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

        <div className="p-2">
          {phase.kind === "loading" && (
            <div className="flex items-center justify-center gap-2 px-3 py-8 text-muted-foreground text-sm">
              <Loader2 className="size-4 animate-spin" /> {t("download.loadingQualities")}
            </div>
          )}

          {phase.kind === "pick" &&
            (phase.qualities.length === 0 ? (
              <p className="px-3 py-8 text-center text-muted-foreground text-sm">
                {t("download.noQualities")}
              </p>
            ) : (
              phase.qualities.map((q) => {
                const size = estimateSize(q, hit.durationSec);
                return (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => void start(q)}
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
              <Loader2 className="size-4 animate-spin" /> {stageLabel(phase.stage)}
            </div>
          )}

          {phase.kind === "done" && (
            <div className="flex flex-col items-center gap-3 px-3 py-8">
              <div className="grid size-10 place-items-center rounded-full bg-primary/15 text-primary">
                <Check className="size-5" />
              </div>
              <p className="text-sm">{t("download.done")}</p>
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
