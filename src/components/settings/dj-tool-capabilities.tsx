import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DJ_CHAT_TOOL_METADATA,
  type DjChatToolId,
  type DjChatToolMetadata,
} from "@/chat/dj-chat-tool-metadata";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CATEGORY_KEY = {
  generation: "chat.toolCategories.generation",
  library: "chat.toolCategories.library",
  memories: "chat.toolCategories.memories",
  online: "chat.toolCategories.online",
  player: "chat.toolCategories.player",
  queue: "chat.toolCategories.queue",
  sets: "chat.toolCategories.sets",
} as const satisfies Record<DjChatToolMetadata["category"], string>;

const AVAILABILITY_KEY = {
  always: "chat.toolAvailability.always",
  generation: "chat.toolAvailability.generation",
  online: "chat.toolAvailability.online",
} as const satisfies Record<DjChatToolMetadata["availability"], string>;

export function DjToolCapabilities() {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<DjChatToolId>(DJ_CHAT_TOOL_METADATA[0].id);
  const selected =
    DJ_CHAT_TOOL_METADATA.find((tool) => tool.id === selectedId) ?? DJ_CHAT_TOOL_METADATA[0];

  return (
    <section className="space-y-3" aria-labelledby="dj-tool-capabilities-title">
      <div className="space-y-1">
        <h3 id="dj-tool-capabilities-title" className="font-medium text-sm">
          {t("settings.djCapabilitiesTitle")}
        </h3>
        <p className="text-muted-foreground text-xs">{t("settings.djCapabilitiesHint")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {DJ_CHAT_TOOL_METADATA.map((tool) => {
          const active = tool.id === selected.id;
          return (
            <Button
              aria-pressed={active}
              className={cn("h-8 rounded-full px-3 text-xs", active && "border-primary")}
              key={tool.id}
              onClick={() => setSelectedId(tool.id)}
              size="sm"
              type="button"
              variant={active ? "secondary" : "outline"}
            >
              {t(tool.labelKey)}
            </Button>
          );
        })}
      </div>
      {selected ? (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-sm">{t(selected.labelKey)}</p>
            <span className="rounded-md bg-background px-2 py-0.5 text-muted-foreground text-xs">
              {t(CATEGORY_KEY[selected.category])}
            </span>
            <span className="rounded-md bg-background px-2 py-0.5 text-muted-foreground text-xs">
              {t(AVAILABILITY_KEY[selected.availability])}
            </span>
          </div>
          <p className="mt-2 text-muted-foreground text-sm">{t(selected.descriptionKey)}</p>
        </div>
      ) : null}
    </section>
  );
}
