import { useLiveQuery } from "dexie-react-hooks";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookmarkPlusIcon } from "@/components/ui/bookmark-plus";
import { Command, type CommandItem } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { createSession, listSessions, prependTrackIds } from "@/db/repositories";
import type { DjSession } from "@/db/types";
import { cn } from "@/lib/utils";
import { notify } from "@/stores/notification-store";

const CREATE_SET_ITEM_ID = "__muzero_create_set__";

export function TrackAddToSetCommand({
  className,
  onAddToNewSession,
  onAddToSession,
  onComplete,
  sessions,
  trackId,
}: {
  className?: string;
  onAddToNewSession: (name: string) => void;
  onAddToSession: (sessionId: string) => void;
  onComplete?: () => void;
  sessions: DjSession[];
  trackId: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const addTargets = useMemo(
    () => sessions.filter((session) => !session.trackIds.includes(trackId)),
    [sessions, trackId],
  );
  const items = useMemo<CommandItem[]>(() => {
    const existing: CommandItem[] = addTargets.map((session) => ({
      id: session.id,
      keywords: [session.name, session.description ?? ""],
      label: session.name,
    }));
    const namesExisting = addTargets.some(
      (s) => s.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (trimmed && !namesExisting) {
      existing.push({
        id: CREATE_SET_ITEM_ID,
        keywords: [trimmed],
        label: t("track.createSet", { name: trimmed }),
      });
    }
    return existing;
  }, [addTargets, trimmed, t]);

  function handleSelect(id: string) {
    if (id === CREATE_SET_ITEM_ID) onAddToNewSession(trimmed);
    else onAddToSession(id);
    setQuery("");
    onComplete?.();
  }

  return (
    <Command
      className={cn("border-0", className)}
      empty={t("track.typeToCreateSet")}
      inputValue={query}
      items={items}
      onInputChange={setQuery}
      onSelect={handleSelect}
      placeholder={t("track.searchOrCreateSet")}
    />
  );
}

export function TrackAddToSetPopover({
  buttonClassName,
  iconClassName,
  onOpenChange,
  onAddToNewSession,
  onAddToSession,
  sessions,
  side = "left",
  sideOffset = 10,
  trackId,
}: {
  buttonClassName?: string;
  iconClassName?: string;
  onOpenChange?: (open: boolean) => void;
  onAddToNewSession: (name: string) => void;
  onAddToSession: (sessionId: string) => void;
  sessions: DjSession[];
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  trackId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  function setOpenAndNotify(nextOpen: boolean) {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return (
    <Popover open={open} onOpenChange={setOpenAndNotify}>
      <PopoverTrigger
        type="button"
        className={cn(
          "grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
          buttonClassName,
        )}
        aria-label={t("track.addToSet")}
        title={t("track.addToSet")}
      >
        <BookmarkPlusIcon size={16} className={iconClassName} />
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" side={side} sideOffset={sideOffset}>
        <PopoverTitle className="px-2 py-1.5">{t("track.addToSet")}</PopoverTitle>
        <TrackAddToSetCommand
          onAddToNewSession={onAddToNewSession}
          onAddToSession={onAddToSession}
          onComplete={() => setOpenAndNotify(false)}
          sessions={sessions}
          trackId={trackId}
        />
      </PopoverContent>
    </Popover>
  );
}

export function CurrentTrackAddToSetButton({
  buttonClassName,
  iconClassName,
  side = "top",
  sideOffset = 10,
  trackId,
}: {
  buttonClassName?: string;
  iconClassName?: string;
  side?: "top" | "bottom" | "left" | "right";
  sideOffset?: number;
  trackId: string;
}) {
  const { sessions, addToNewSession, addToSession } = useAddTrackToSetActions(trackId);
  return (
    <TrackAddToSetPopover
      buttonClassName={buttonClassName}
      iconClassName={iconClassName}
      onAddToNewSession={addToNewSession}
      onAddToSession={addToSession}
      sessions={sessions}
      side={side}
      sideOffset={sideOffset}
      trackId={trackId}
    />
  );
}

export function TrackAddToSetDialog({
  onOpenChange,
  open,
  title,
  trackId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title?: ReactNode;
  trackId: string;
}) {
  const { t } = useTranslation();
  const { sessions, addToNewSession, addToSession } = useAddTrackToSetActions(trackId);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-3 p-4">
        <DialogTitle>{title ?? t("track.addToSet")}</DialogTitle>
        <TrackAddToSetCommand
          onAddToNewSession={addToNewSession}
          onAddToSession={addToSession}
          onComplete={() => onOpenChange(false)}
          sessions={sessions}
          trackId={trackId}
        />
      </DialogContent>
    </Dialog>
  );
}

function useAddTrackToSetActions(trackId: string) {
  const { t } = useTranslation();
  const sessions = useLiveQuery(() => listSessions(), []) ?? [];

  async function addToSession(sessionId: string) {
    await prependTrackIds(sessionId, [trackId]);
    const targetName = sessions.find((session) => session.id === sessionId)?.name ?? "";
    notify.success(t("select.addedToSet", { count: 1, name: targetName }));
  }

  async function addToNewSession(name: string) {
    const session = await createSession({ name, seedPrompt: "", config: { autoExtend: false } });
    await prependTrackIds(session.id, [trackId]);
    notify.success(t("select.addedToSet", { count: 1, name: session.name }));
  }

  return {
    addToNewSession: (name: string) => void addToNewSession(name),
    addToSession: (sessionId: string) => void addToSession(sessionId),
    sessions,
  };
}
