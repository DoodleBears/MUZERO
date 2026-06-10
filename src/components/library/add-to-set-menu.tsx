import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookmarkPlusIcon } from "@/components/ui/bookmark-plus";
import { Button } from "@/components/ui/button";
import { Command, type CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { createSession, listSessions, prependTrackIds } from "@/db/repositories";
import { notify } from "@/stores/notification-store";
import { addToSetCandidates } from "./add-to-set";

const CREATE_SET_ITEM_ID = "__muzero_create_set__";

/**
 * Batch "add to another set" — a Popover + searchable set list (with create-new),
 * adding ALL `trackIds` to the chosen/created set. Reuses the single-row picker's
 * UX but operates on a multi-selection; rendered as a batch action in the select bar.
 */
export function AddToSetMenu({
  trackIds,
  excludeSetId,
  onAdded,
}: {
  trackIds: string[];
  /** The set you're already in — hidden from the candidate list. */
  excludeSetId?: string;
  /** Called after a successful add (e.g. to leave select mode). */
  onAdded?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sessions = useLiveQuery(() => listSessions(), []) ?? [];
  const trimmed = query.trim();
  const { sets, offerCreate } = addToSetCandidates(sessions, excludeSetId, query);

  const items = useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = sets.map((session) => ({
      id: session.id,
      keywords: [session.name, session.description ?? ""],
      label: session.name,
    }));
    if (offerCreate) {
      base.push({
        id: CREATE_SET_ITEM_ID,
        keywords: [trimmed],
        label: t("track.createSet", { name: trimmed }),
      });
    }
    return base;
  }, [sets, offerCreate, trimmed, t]);

  async function addTo(name: string, sessionId?: string) {
    if (trackIds.length === 0) return;
    const targetId = sessionId ?? (await createSession({ name, seedPrompt: "" })).id;
    await prependTrackIds(targetId, trackIds);
    const targetName = sessions.find((session) => session.id === targetId)?.name ?? name;
    notify.success(t("select.addedToSet", { count: trackIds.length, name: targetName }));
    onAdded?.();
  }

  function handleSelect(id: string) {
    setOpen(false);
    setQuery("");
    if (id === CREATE_SET_ITEM_ID) void addTo(trimmed);
    else void addTo(sessions.find((session) => session.id === id)?.name ?? "", id);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm" disabled={trackIds.length === 0}>
            <BookmarkPlusIcon size={16} />
            {t("track.addToSet")}
          </Button>
        }
      />
      <PopoverContent className="w-60 p-2" side="top" sideOffset={10}>
        <PopoverTitle className="px-2 py-1.5">{t("track.addToSet")}</PopoverTitle>
        <Command
          className="border-0"
          empty={t("track.typeToCreateSet")}
          inputValue={query}
          items={items}
          onInputChange={setQuery}
          onSelect={handleSelect}
          placeholder={t("track.searchOrCreateSet")}
        />
      </PopoverContent>
    </Popover>
  );
}
