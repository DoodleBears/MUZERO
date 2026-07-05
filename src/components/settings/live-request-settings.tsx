import { KeyRound, Plus, RotateCcw, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandTableEditor } from "@/components/settings/live-request/command-table-editor";
import { MappingDialog } from "@/components/settings/live-request/mapping-dialog";
import { SourceCard } from "@/components/settings/live-request/source-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import {
  type AudienceRequestIntakeSettings,
  type AudienceRequestSearchScope,
  type AudienceRequestSource,
  type AudienceRequestTransport,
  DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
  type IntakeCommand,
} from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { type LiveRequestIntakePayload, resolveDesktopBridge } from "@/lib/desktop/bridge";
import { newId } from "@/lib/id";
import { resolveSources } from "@/live-requests/audience-request-sources";
import { resolveCommands } from "@/live-requests/intake-command";
import { applyLiveRequestIntake } from "@/live-requests/live-request-controller";
import { DEFAULT_SSN_RELAY_URL } from "@/live-requests/social-stream-relay";

const SEARCH_SCOPES: AudienceRequestSearchScope[] = ["all-library", "active-set"];

export function LiveRequestSettings() {
  const { t } = useTranslation();
  const tk = (key: string, fallback: string) => t(key, { defaultValue: fallback });
  const settings = useSettings();
  const bridge = resolveDesktopBridge();
  const controls = bridge.liveRequestIntake;
  const isWeb = bridge.kind === "web";

  const intake = settings.audienceRequestIntake ?? DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS;
  const transport: AudienceRequestTransport =
    intake.transport ?? (isWeb ? "ssn-websocket" : "http-webhook");
  const sources = resolveSources(intake.sources);
  const hasAiDjSource = sources.some((s) => s.routeMode === "ai-dj" || s.routeMode === "hybrid");
  const hasVideoSource = Boolean(
    settings.streamSources?.bili?.enabled ||
      settings.streamSources?.bili?.cookie ||
      settings.streamSources?.youtube?.enabled ||
      settings.streamSources?.youtube?.cookie ||
      settings.streamSources?.youtube?.accessToken,
  );
  const videoRequestsDisabled = isWeb || !hasVideoSource;

  const [messages, setMessages] = useState<LiveRequestIntakePayload[]>([]);
  const [dialogSourceId, setDialogSourceId] = useState<string | null>(null);
  const dialogSource = sources.find((s) => s.id === dialogSourceId) ?? null;

  useEffect(() => {
    if (!controls) return;
    return controls.onMessage((payload) =>
      setMessages((current) => [payload, ...current].slice(0, 50)),
    );
  }, [controls]);

  async function update(patch: Partial<AudienceRequestIntakeSettings>) {
    const next: AudienceRequestIntakeSettings = { ...intake, transport, sources, ...patch };
    await saveSettings({ audienceRequestIntake: next });
    await applyLiveRequestIntake(next);
  }

  const patchSource = (id: string, patch: Partial<AudienceRequestSource>) =>
    void update({ sources: sources.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  // Persist the edited command table; keep the legacy `commandPrefixes` mirror in sync
  // with the song-search row (it still drives the no-command fallback + require-prefix gate).
  const onCommandsChange = (commands: IntakeCommand[]) => {
    const song = commands.find((command) => command.id === "song-search");
    void update({ commands, commandPrefixes: song?.prefixes ?? intake.commandPrefixes });
  };

  const addSource = () =>
    void update({
      sources: [
        ...sources,
        {
          id: newId("src"),
          name: tk("settings.liveRequestsNewSource", "New source"),
          status: "testing",
          authMode: "open",
          mappingPreset: transport === "ssn-websocket" ? "social-stream-ninja" : "generic-json",
        },
      ],
    });

  const deleteSource = (id: string) => void update({ sources: sources.filter((s) => s.id !== id) });

  const endpointUrl = (source: AudienceRequestSource): string | null => {
    if (transport !== "http-webhook") return null;
    const tokenQuery = intake.authToken ? `?token=${intake.authToken}` : "";
    return `http://${intake.bindHost}:${intake.port}/v1/intake/${source.id}${tokenQuery}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tk("settings.liveRequestsTitle", "Live chat song requests")}</CardTitle>
        <p className="text-muted-foreground text-sm">
          {tk(
            "settings.liveRequestsSubtitle",
            "Let viewers request songs from chat via Social Stream Ninja or any webhook.",
          )}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Toggle
          checked={intake.enabled}
          label={tk("settings.liveRequestsEnable", "Enable live requests")}
          hint={
            controls
              ? tk("settings.liveRequestsEnableHint", "Start receiving requests on this device.")
              : tk("settings.liveRequestsUnsupported", "Not supported on this shell.")
          }
          disabled={!controls}
          onChange={(enabled) => void update({ enabled })}
        />

        <Field label={tk("settings.liveRequestsTransport", "Transport")}>
          <Select
            value={transport}
            onValueChange={(value) => void update({ transport: value as AudienceRequestTransport })}
          >
            <SelectTrigger>
              <SelectValue>
                {(value) =>
                  value === "ssn-websocket"
                    ? tk("settings.liveRequestsTransportWs", "SSN WebSocket (relay)")
                    : tk("settings.liveRequestsTransportWebhook", "Local webhook (desktop)")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {!isWeb && (
                <SelectItem value="http-webhook">
                  {tk("settings.liveRequestsTransportWebhook", "Local webhook (desktop)")}
                </SelectItem>
              )}
              <SelectItem value="ssn-websocket">
                {tk("settings.liveRequestsTransportWs", "SSN WebSocket (relay)")}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {transport === "ssn-websocket" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={tk("settings.liveRequestsSsnSession", "SSN session ID")}>
              <Input
                value={intake.ssnSessionId ?? ""}
                placeholder="abc123"
                onChange={(event) => void update({ ssnSessionId: event.currentTarget.value })}
              />
            </Field>
            <Field label={tk("settings.liveRequestsSsnRelay", "Relay URL")}>
              <Input
                value={intake.ssnRelayUrl ?? DEFAULT_SSN_RELAY_URL}
                onChange={(event) => void update({ ssnRelayUrl: event.currentTarget.value })}
              />
            </Field>
            {isWeb && hasAiDjSource && (
              <p className="text-amber-600 text-xs sm:col-span-2 dark:text-amber-400">
                {tk(
                  "settings.liveRequestsWebCorsHint",
                  "AI DJ / online sourcing on the web depends on your BYOK endpoint allowing CORS, and may fail. Use the desktop app for reliable generation.",
                )}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <KeyRound className="size-4 text-primary" />
                <span className="font-medium text-sm">
                  {tk("settings.liveRequestsAuth", "Auth token")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => void update({ authToken: createLiveRequestToken() })}
                >
                  <RotateCcw className="size-3.5" />
                  {tk("settings.liveRequestsRegenerateToken", "Regenerate")}
                </Button>
              </div>
              <code className="block truncate rounded-md bg-muted/40 px-3 py-2 text-xs">
                {intake.authToken
                  ? maskToken(intake.authToken)
                  : tk("settings.liveRequestsNoToken", "No token — open")}
              </code>
            </div>
            <Field label={tk("settings.liveRequestsPort", "Port")}>
              <Input
                type="number"
                min={1}
                max={65535}
                value={intake.port}
                onChange={(event) =>
                  void update({ port: clampPort(Number(event.currentTarget.value)) })
                }
              />
            </Field>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tk("settings.liveRequestsSearchScope", "Search scope")}>
            <Select
              value={intake.searchScope}
              onValueChange={(value) =>
                void update({ searchScope: value as AudienceRequestSearchScope })
              }
            >
              <SelectTrigger>
                <SelectValue>
                  {(value) => tk(`settings.liveRequestsScope.${value}`, String(value))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SEARCH_SCOPES.map((scope) => (
                  <SelectItem key={scope} value={scope}>
                    {tk(`settings.liveRequestsScope.${scope}`, scope)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={tk("settings.liveRequestsRateLimit", "Max / minute")}>
            <Input
              type="number"
              min={1}
              value={intake.maxRequestsPerMinute}
              onChange={(event) =>
                void update({ maxRequestsPerMinute: Number(event.currentTarget.value) })
              }
            />
          </Field>
          <Field label={tk("settings.liveRequestsCooldown", "Per-user cooldown (s)")}>
            <Input
              type="number"
              min={0}
              value={intake.requesterCooldownSec}
              onChange={(event) =>
                void update({ requesterCooldownSec: Number(event.currentTarget.value) })
              }
            />
          </Field>
        </div>

        <CommandTableEditor commands={resolveCommands(intake)} onChange={onCommandsChange} />

        <div className="rounded-md border border-border p-3">
          <div className="mb-3 flex flex-col gap-1">
            <span className="font-medium text-sm">
              {tk("settings.liveRequestsVideoTitle", "Video requests")}
            </span>
            <span className="text-muted-foreground text-xs">
              {videoRequestsDisabled
                ? tk(
                    "settings.liveRequestsVideoNeedsSource",
                    "Video requests need an enabled Bilibili or YouTube source in the desktop app.",
                  )
                : tk(
                    "settings.liveRequestsVideoHint",
                    "Viewers can paste a Bilibili or YouTube video id/link. Downloads use Online sources → Default video quality and land in Downloads.",
                  )}
            </span>
          </div>
          <Field label={tk("settings.liveRequestsVideoMaxDuration", "Max video duration (min)")}>
            <Input
              type="number"
              min={1}
              disabled={videoRequestsDisabled}
              value={Math.max(
                1,
                Math.round(
                  (intake.maxVideoRequestDurationSec ??
                    DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS.maxVideoRequestDurationSec ??
                    480) / 60,
                ),
              )}
              onChange={(event) =>
                void update({
                  maxVideoRequestDurationSec:
                    Math.max(1, Math.round(Number(event.currentTarget.value) || 1)) * 60,
                })
              }
            />
          </Field>
        </div>

        <Toggle
          checked={intake.requireCommandPrefix ?? true}
          label={tk("settings.liveRequestsRequirePrefix", "Require a command prefix")}
          hint={tk(
            "settings.liveRequestsRequirePrefixHint",
            "Only chat messages that start with a prefix above are treated as song requests. Off: every message is a request.",
          )}
          disabled={intake.commandPrefixes.length === 0}
          onChange={(requireCommandPrefix) => void update({ requireCommandPrefix })}
        />

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">
              {tk("settings.liveRequestsSources", "Sources")}
            </span>
            <Button variant="outline" size="sm" onClick={addSource}>
              <Plus className="size-3.5" />
              {tk("settings.liveRequestsAddSource", "Add source")}
            </Button>
          </div>
          {sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              endpointUrl={endpointUrl(source)}
              globalRouteMode={intake.routeMode}
              globalPlaybackAction={intake.playbackAction}
              onPatch={(patch) => patchSource(source.id, patch)}
              onConfigure={() => setDialogSourceId(source.id)}
              onDelete={() => deleteSource(source.id)}
            />
          ))}
        </section>

        <div className="rounded-md border border-border p-3">
          <div className="mb-2 flex items-center gap-2">
            <Server className="size-4 text-primary" />
            <span className="font-medium text-sm">
              {tk("settings.liveRequestsInboxTitle", "Recent requests")}
            </span>
          </div>
          {messages.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {tk("settings.liveRequestsInboxEmpty", "No requests received yet.")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.map((message) => (
                <div
                  key={`${message.receivedAt}:${message.body.slice(0, 12)}`}
                  className="rounded-md border border-border bg-muted/20 px-3 py-2"
                >
                  <p className="line-clamp-2 text-sm">{message.body}</p>
                  <p className="text-muted-foreground text-xs">
                    {message.sourceId ?? "default"} ·{" "}
                    {new Date(message.receivedAt).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      {dialogSource && (
        <MappingDialog
          open={dialogSourceId !== null}
          onOpenChange={(open) => !open && setDialogSourceId(null)}
          source={dialogSource}
          onSave={(patch) => patchSource(dialogSource.id, patch)}
          onGoLive={() => patchSource(dialogSource.id, { status: "active" })}
        />
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control supplied via children
    <label className="flex flex-col gap-1.5">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  label,
  hint,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border border-border p-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-1 size-4 accent-[var(--color-primary)]"
      />
      <span className="flex flex-col gap-1">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </span>
    </label>
  );
}

function clampPort(port: number): number {
  if (!Number.isFinite(port)) return DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS.port;
  return Math.max(1, Math.min(65_535, Math.round(port)));
}

function maskToken(token: string): string {
  if (token.length <= 18) return "••••";
  return `${token.slice(0, 12)}…${token.slice(-6)}`;
}

function createLiveRequestToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return `muz_live_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
