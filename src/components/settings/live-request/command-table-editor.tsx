import { useTranslation } from "react-i18next";
import { ChipInput } from "@/components/ui/chip-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IntakeCommand } from "@/db/types";
import type { AudienceRequestRouteMode } from "@/live-requests/audience-request-schema";

const ROUTE_MODES: AudienceRequestRouteMode[] = ["library-search", "ai-dj", "hybrid"];

/**
 * Editor for the keyword→intent command table. Each row configures one command's
 * trigger keywords (点歌 / AI点歌 / 评论 / 评分); `request` commands also pick the route
 * (library-search fast path vs ai-dj). Presentational — the parent owns persistence
 * and keeps the legacy `commandPrefixes` mirror in sync with the song-search row.
 */
export function CommandTableEditor({
  commands,
  onChange,
}: {
  commands: IntakeCommand[];
  onChange: (commands: IntakeCommand[]) => void;
}) {
  const { t } = useTranslation();
  const tk = (key: string, fallback: string) => t(key, { defaultValue: fallback });

  const patch = (id: string, next: Partial<IntakeCommand>) =>
    onChange(commands.map((command) => (command.id === id ? { ...command, ...next } : command)));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-sm">
          {tk("settings.liveRequestsCommands", "Command keywords")}
        </span>
        <span className="text-muted-foreground text-xs">
          {tk(
            "settings.liveRequestsCommandsHint",
            "点歌 = quick library search · AI点歌 = AI DJ · 评论 = leave a memory · 评分 5 = rate the current song",
          )}
        </span>
      </div>
      {commands.map((command) => (
        <div key={command.id} className="grid gap-2 sm:grid-cols-[1fr_10rem] sm:items-start">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">
              {tk(`settings.liveRequestsCommand.${command.id}`, command.id)}
            </span>
            <ChipInput
              value={command.prefixes}
              onChange={(prefixes) => patch(command.id, { prefixes })}
              placeholder={tk("settings.liveRequestsCommandPrefixesPlaceholder", "点歌, !sr …")}
              removeLabel={(prefix) =>
                t("settings.liveRequestsRemovePrefix", {
                  defaultValue: "Remove {{prefix}}",
                  prefix,
                })
              }
            />
          </div>
          {command.intent === "request" && (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                {tk("settings.liveRequestsRoute", "Route")}
              </span>
              <Select
                value={command.routeMode ?? "library-search"}
                onValueChange={(value) =>
                  patch(command.id, { routeMode: value as AudienceRequestRouteMode })
                }
              >
                <SelectTrigger>
                  <SelectValue>
                    {(value) => tk(`settings.liveRequestsRouteMode.${value}`, String(value))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ROUTE_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {tk(`settings.liveRequestsRouteMode.${mode}`, mode)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
