import { Loader2, Sparkles, TriangleAlert, Wand2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Compact DJ status + manual "extend" control. The DJ normally extends the set
 * on its own (续上歌单) as the queue drains; this surfaces what it's doing and
 * lets the user nudge it.
 */
export function DjConsole() {
  const { t } = useTranslation();
  const isDrafting = usePlayerStore((s) => s.isDrafting);
  const isGenerating = usePlayerStore((s) => s.isGenerating);
  const djError = usePlayerStore((s) => s.djError);
  const draftNow = usePlayerStore((s) => s.draftNow);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 text-sm text-muted-foreground">
          {isDrafting ? (
            <>
              <Sparkles className="size-4 animate-pulse text-primary" />
              {t("dj.writing")}
            </>
          ) : isGenerating ? (
            <>
              <Loader2 className="size-4 animate-spin text-primary" />
              {t("dj.generating")}
            </>
          ) : (
            <>
              <Wand2 className="size-4" />
              {t("dj.standby")}
            </>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!activeSessionId || isDrafting}
          onClick={() => void draftNow()}
        >
          {t("dj.extend")}
        </Button>
      </div>
      {djError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{djError}</span>
        </div>
      )}
    </div>
  );
}
