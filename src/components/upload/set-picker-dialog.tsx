import { useLiveQuery } from "dexie-react-hooks";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Disc3Icon } from "@/components/ui/disc-3";
import { db } from "@/db/muzero-db";
import { createSession, listSessions } from "@/db/repositories";
import { usePlayerStore } from "@/stores/player-store";
import { warmMediaProbeWorker } from "@/workers/media-probe-client";

/**
 * Choose which 歌单 imported media goes into. Used by app-wide drag/paste and
 * by the "add files" picker when the current view does not already imply a set.
 */
export function SetPickerDialog({
  files,
  defaultNewSetName,
  activateNewSet = false,
  onClose,
  onUploaded,
}: {
  files: File[];
  defaultNewSetName?: string;
  activateNewSet?: boolean;
  onClose: () => void;
  onUploaded: (count: number, createdSet: boolean) => void;
}) {
  const { t } = useTranslation();
  const sessions = useLiveQuery(() => listSessions(db), [], []);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (files.length === 0) return;
    void warmMediaProbeWorker();
  }, [files]);

  // Put the active set on top - the common case is "add to what I'm playing".
  const ordered = useMemo(() => {
    if (!activeSessionId) return sessions;
    const active = sessions.filter((s) => s.id === activeSessionId);
    return [...active, ...sessions.filter((s) => s.id !== activeSessionId)];
  }, [sessions, activeSessionId]);

  async function uploadTo(setId: string) {
    if (busy) return;
    setBusy(true);
    await usePlayerStore.getState().addUploadsToSet(setId, files);
    onUploaded(files.length, false);
    onClose();
  }

  async function uploadToNew() {
    if (busy) return;
    setBusy(true);
    const session = await createSession({
      name: defaultNewSetName ?? t("gallery.newSetName"),
      seedPrompt: "",
      config: { autoExtend: false },
    });
    if (activateNewSet) await usePlayerStore.getState().setActiveSession(session.id);
    await usePlayerStore.getState().addUploadsToSet(session.id, files);
    onUploaded(files.length, true);
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 duration-150 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={t("drop.pickSetTitle", { count: files.length })}
    >
      <button
        type="button"
        aria-label={t("drop.cancel")}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
      />
      <div className="relative flex max-h-[80vh] w-full max-w-sm flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <h2 className="text-base font-semibold">
          {t("drop.pickSetTitle", { count: files.length })}
        </h2>
        <button
          type="button"
          onClick={() => void uploadToNew()}
          disabled={busy}
          className="flex items-center gap-3 rounded-xl border border-dashed border-input p-2 text-left transition-colors hover:bg-accent/40"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary">
            <Plus className="size-5 text-primary" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{t("gallery.newSet")}</span>
            {defaultNewSetName ? (
              <span className="block truncate text-xs text-muted-foreground">
                {defaultNewSetName}
              </span>
            ) : null}
          </span>
        </button>
        <div className="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1">
          {ordered.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => void uploadTo(session.id)}
              disabled={busy}
              className="flex items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-accent/40"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary">
                <Disc3Icon className="text-muted-foreground" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{session.name}</span>
                  {session.id === activeSessionId && (
                    <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {t("drop.currentSet")}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("gallery.count", { count: session.trackIds.length })}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t("drop.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
