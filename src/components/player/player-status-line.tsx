import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { resolveStatusLine } from "@/player/transport";
import { usePlayerStore } from "@/stores/player-store";

/**
 * The thin status line under the scrubber (mirrors Poweramp's "Uploading 2
 * tracks…"). Its own leaf so upload/generation/error changes don't re-render the
 * per-tick scrubber. Priority error > uploading > generating is decided by the
 * pure `resolveStatusLine`; copy is localized here.
 */
export function PlayerStatusLine() {
  const { t } = useTranslation();
  const isUploading = usePlayerStore((s) => s.isUploading);
  const isGenerating = usePlayerStore((s) => s.isGenerating);
  const djError = usePlayerStore((s) => s.djError);

  const status = resolveStatusLine({ isUploading, isGenerating, djError });
  if (!status) return null;

  const text =
    status.kind === "error"
      ? status.message
      : status.kind === "uploading"
        ? t("sessions.importing")
        : t("dj.generating");

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "truncate text-center text-[11px]",
        status.kind === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {text}
    </div>
  );
}
