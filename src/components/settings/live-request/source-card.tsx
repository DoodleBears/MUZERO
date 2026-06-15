import { Check, Copy, Pencil, Play, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AudienceRequestSource, AudienceRequestSourceStatus } from "@/db/types";
import { cn } from "@/lib/utils";
import type {
  AudienceRequestPlaybackAction,
  AudienceRequestRouteMode,
} from "@/live-requests/audience-request-schema";

const ROUTE_MODES: AudienceRequestRouteMode[] = ["library-search", "ai-dj", "hybrid"];
const PLAYBACK_ACTIONS: AudienceRequestPlaybackAction[] = ["play-next", "append-queue", "play-now"];

const STATUS_STYLE: Record<AudienceRequestSourceStatus, string> = {
  testing: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  disabled: "border-border bg-muted/30 text-muted-foreground",
};

/**
 * One configured intake source: status, endpoint URL (webhook), per-source route
 * + playback overrides, a "configure mapping" entry, and lifecycle controls
 * (testing → Go live / Disable; active → Pause / Test; disabled → Enable).
 * Built on shadcn/COSS primitives, aligned with the other settings panels.
 */
export function SourceCard({
  source,
  endpointUrl,
  globalRouteMode,
  globalPlaybackAction,
  onPatch,
  onConfigure,
  onDelete,
}: {
  source: AudienceRequestSource;
  endpointUrl: string | null;
  globalRouteMode: AudienceRequestRouteMode;
  globalPlaybackAction: AudienceRequestPlaybackAction;
  onPatch: (patch: Partial<AudienceRequestSource>) => void;
  onConfigure: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const tk = (key: string, fallback: string) => t(key, { defaultValue: fallback });
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    if (!endpointUrl) return;
    void navigator.clipboard?.writeText(endpointUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Input
          value={source.name}
          onChange={(event) => onPatch({ name: event.currentTarget.value })}
          className="h-8 flex-1 text-sm"
          aria-label={tk("settings.liveRequestsSourceName", "Source name")}
        />
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
            STATUS_STYLE[source.status],
          )}
        >
          {tk(`settings.liveRequestsStatus.${source.status}`, source.status)}
        </span>
      </div>

      {endpointUrl && (
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px]">
            {endpointUrl}
          </code>
          <Button variant="outline" size="icon" className="size-7" onClick={copyUrl}>
            {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <LabeledSelect
          label={tk("settings.liveRequestsRoute", "Route to")}
          value={source.routeMode ?? globalRouteMode}
          options={ROUTE_MODES}
          optionLabel={(value) => tk(`settings.liveRequestsRouteMode.${value}`, value)}
          onChange={(value) => onPatch({ routeMode: value as AudienceRequestRouteMode })}
        />
        <LabeledSelect
          label={tk("settings.liveRequestsPlaybackAction", "Playback")}
          value={source.playbackAction ?? globalPlaybackAction}
          options={PLAYBACK_ACTIONS}
          optionLabel={(value) => tk(`settings.liveRequestsPlayback.${value}`, value)}
          onChange={(value) => onPatch({ playbackAction: value as AudienceRequestPlaybackAction })}
        />
      </div>

      <Button variant="outline" size="sm" className="w-full" onClick={onConfigure}>
        <Pencil className="size-3.5" />
        {tk("settings.liveRequestsConfigureMapping", "Configure mapping")} ·{" "}
        {tk(`settings.liveRequestsMappingPreset.${source.mappingPreset}`, source.mappingPreset)}
      </Button>

      <div className="flex items-center justify-between gap-2 border-border border-t pt-2">
        <div className="flex gap-2">
          {source.status === "testing" && (
            <>
              <Button size="sm" onClick={() => onPatch({ status: "active" })}>
                <Play className="size-3.5" />
                {tk("settings.liveRequestsGoLive", "Go live")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => onPatch({ status: "disabled" })}>
                {tk("settings.liveRequestsDisable", "Disable")}
              </Button>
            </>
          )}
          {source.status === "active" && (
            <>
              <Button variant="outline" size="sm" onClick={() => onPatch({ status: "disabled" })}>
                <Square className="size-3.5" />
                {tk("settings.liveRequestsPause", "Pause")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => onPatch({ status: "testing" })}>
                {tk("settings.liveRequestsTestMode", "Test")}
              </Button>
            </>
          )}
          {source.status === "disabled" && (
            <Button size="sm" onClick={() => onPatch({ status: "active" })}>
              <Play className="size-3.5" />
              {tk("settings.liveRequestsEnable", "Enable")}
            </Button>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          aria-label={tk("settings.liveRequestsDeleteSource", "Delete source")}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  optionLabel,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  optionLabel: (value: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control is the base-ui Select below
    <label className="flex flex-col gap-1">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      <Select value={value} onValueChange={(next) => onChange(String(next ?? ""))}>
        <SelectTrigger className="h-8">
          <SelectValue>{(current) => optionLabel(String(current))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {optionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
