import { UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AddTracksMenu } from "@/components/upload/add-tracks-menu";
import { cn } from "@/lib/utils";

export function LibraryImportEmptyState({
  className,
  compact = false,
  showAddTracks = true,
}: {
  className?: string;
  compact?: boolean;
  showAddTracks?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="library-import-empty-state"
      className={cn(
        "mx-auto flex w-full max-w-xl flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-background/45 px-5 text-center shadow-sm backdrop-blur-sm",
        compact ? "min-h-72 gap-3 py-6" : "min-h-[22rem] gap-4 py-8",
        className,
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-primary/12 text-primary">
        <UploadCloud className="size-6" aria-hidden="true" />
      </div>
      <div className="max-w-sm space-y-1.5">
        <h2 className="font-semibold text-base text-foreground">{t("sessions.uploadTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("sessions.uploadDesc")}</p>
      </div>
      {showAddTracks && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <AddTracksMenu />
        </div>
      )}
      <p className="max-w-sm text-muted-foreground text-xs">{t("drop.addSubtitle")}</p>
    </section>
  );
}
