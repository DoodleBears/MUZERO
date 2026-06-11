import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

export function PlaybackLoadingRow({ className }: { className?: string }) {
  const { t } = useTranslation();
  const loading = usePlayerStore((s) => s.playbackLoading);
  if (!loading) return null;

  const label =
    loading.sourceKind === "remote"
      ? t("player.loadingRemote", { title: loading.title })
      : t("player.loadingTrack", { title: loading.title });

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-auto flex max-w-full items-center gap-2 rounded-full bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm ring-1 ring-border/50 backdrop-blur",
        className,
      )}
    >
      <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin text-primary" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
}
