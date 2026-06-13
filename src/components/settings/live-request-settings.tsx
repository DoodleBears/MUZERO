import { Copy, FileJson, KeyRound, RotateCcw, Server, Square, Webhook } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveSettings } from "@/db/repositories";
import {
  type AudienceRequestIntakeSettings,
  DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
} from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { type LiveRequestIntakePayload, resolveDesktopBridge } from "@/lib/desktop/bridge";
import {
  authorizationHeader,
  examplePayloadJson,
  GENERIC_WEBHOOK_EXAMPLE,
  SOCIAL_STREAM_NINJA_WEBHOOK_PRESET,
} from "@/live-requests/audience-request-presets";
import type {
  AudienceRequestPlaybackAction,
  AudienceRequestRouteMode,
} from "@/live-requests/audience-request-schema";

type IntakeStatus = "unsupported" | "stopped" | "listening" | "error";

const ROUTE_MODES: AudienceRequestRouteMode[] = ["library-search", "ai-dj", "hybrid"];
const PLAYBACK_ACTIONS: AudienceRequestPlaybackAction[] = [
  "manual-review",
  "play-next",
  "append-queue",
  "play-now",
];

export function LiveRequestSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const bridge = resolveDesktopBridge();
  const controls = bridge.liveRequestIntake;
  const persistedIntake =
    settings.audienceRequestIntake ?? DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS;
  const [draft, setDraft] = useState<AudienceRequestIntakeSettings>(persistedIntake);
  const draftRef = useRef(draft);
  const intake = draft;
  const [status, setStatus] = useState<IntakeStatus>(controls ? "stopped" : "unsupported");
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<LiveRequestIntakePayload[]>([]);
  const endpoint = useMemo(
    () => `http://${intake.bindHost}:${intake.port}/v1/audience/request`,
    [intake.bindHost, intake.port],
  );
  const socialStreamUrl = intake.authToken ? `${endpoint}?token=${intake.authToken}` : endpoint;
  const visibleSocialStreamUrl = intake.authToken
    ? `${endpoint}?token=${maskToken(intake.authToken)}`
    : `${endpoint}?token=<token>`;
  const authHeader = authorizationHeader(intake.authToken);
  const visibleAuthHeader = authorizationHeader(
    intake.authToken ? maskToken(intake.authToken) : undefined,
  );
  const socialStreamExample = useMemo(
    () => examplePayloadJson(SOCIAL_STREAM_NINJA_WEBHOOK_PRESET.examplePayload),
    [],
  );
  const genericExample = useMemo(
    () => examplePayloadJson(GENERIC_WEBHOOK_EXAMPLE.examplePayload),
    [],
  );

  useEffect(() => {
    draftRef.current = persistedIntake;
    setDraft(persistedIntake);
  }, [persistedIntake]);

  useEffect(() => {
    if (!controls) return;
    return controls.onMessage((payload) => {
      setMessages((current) => [payload, ...current].slice(0, 50));
    });
  }, [controls]);

  useEffect(() => {
    if (!controls) {
      setStatus("unsupported");
      return;
    }
    void controls.status().then((next) => {
      setStatus(next.listening ? "listening" : "stopped");
      setError(next.error ?? "");
    });
  }, [controls]);

  async function updateIntake(patch: Partial<AudienceRequestIntakeSettings>) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    await saveSettings({ audienceRequestIntake: next });
    return next;
  }

  async function setEnabled(enabled: boolean) {
    const next = await updateIntake({
      enabled,
      authToken: intake.authToken || createLiveRequestToken(),
    });
    if (!controls) return;
    try {
      const result = enabled
        ? await controls.start({
            port: next.port,
            token: next.authToken ?? "",
          })
        : await controls.stop();
      setStatus(result.listening ? "listening" : "stopped");
      setError(result.error ?? "");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function regenerateToken() {
    await updateIntake({ authToken: createLiveRequestToken() });
  }

  async function copy(text: string) {
    await navigator.clipboard?.writeText(text);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.liveRequestsTitle")}</CardTitle>
        <p className="text-muted-foreground text-sm">{t("settings.liveRequestsSubtitle")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex items-start gap-3 rounded-md border border-border p-3">
          <input
            type="checkbox"
            checked={intake.enabled}
            disabled={!controls}
            onChange={(event) => void setEnabled(event.currentTarget.checked)}
            className="mt-1 size-4 accent-primary"
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium text-sm">{t("settings.liveRequestsEnable")}</span>
            <span className="text-muted-foreground text-xs">
              {controls
                ? t("settings.liveRequestsEnableHint")
                : t("settings.liveRequestsUnsupported")}
            </span>
          </span>
        </label>

        <div className="grid gap-3 md:grid-cols-[1fr_9rem]">
          <Field label={t("settings.liveRequestsEndpoint")}>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                {endpoint}
              </code>
              <Button
                variant="outline"
                size="icon"
                aria-label={t("settings.liveRequestsCopyEndpoint")}
                onClick={() => void copy(endpoint)}
              >
                <Copy />
              </Button>
            </div>
          </Field>
          <Field label={t("settings.liveRequestsPort")}>
            <Input
              type="number"
              min={1}
              max={65535}
              value={intake.port}
              onChange={(event) =>
                void updateIntake({ port: clampPort(Number(event.currentTarget.value)) })
              }
            />
          </Field>
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" />
              <span className="font-medium text-sm">{t("settings.liveRequestsAuth")}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void regenerateToken()}>
              <RotateCcw />
              {t("settings.liveRequestsRegenerateToken")}
            </Button>
          </div>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted/40 px-3 py-2 text-xs">
              {intake.authToken ? maskToken(intake.authToken) : t("settings.liveRequestsNoToken")}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("settings.liveRequestsCopySocialUrl")}
              disabled={!intake.authToken}
              onClick={() => void copy(socialStreamUrl)}
            >
              <Copy />
            </Button>
          </div>
          <p className="mt-2 text-muted-foreground text-xs">
            {t("settings.liveRequestsSocialStreamHint")}
          </p>
        </div>

        <section
          className="rounded-md border border-border p-3"
          aria-labelledby="live-request-setup"
        >
          <div className="mb-3 flex items-center gap-2">
            <Webhook className="size-4 text-primary" />
            <h3 id="live-request-setup" className="font-medium text-sm">
              {t("settings.liveRequestsSetupTitle")}
            </h3>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <SetupExample
              title={t("settings.liveRequestsSocialStreamSetup")}
              icon={<Webhook className="size-4 text-primary" />}
            >
              <SetupLine label={t("settings.liveRequestsSetupMethod")} value="POST" />
              <SetupCopyLine
                label={t("settings.liveRequestsSetupUrl")}
                value={visibleSocialStreamUrl}
                copyLabel={t("settings.liveRequestsCopySocialUrl")}
                onCopy={() => void copy(socialStreamUrl)}
              />
              <SetupLine
                label={t("settings.liveRequestsSetupBody")}
                value={t("settings.liveRequestsSocialStreamBody")}
              />
              <SetupJson value={socialStreamExample} />
            </SetupExample>
            <SetupExample
              title={t("settings.liveRequestsGenericWebhookSetup")}
              icon={<FileJson className="size-4 text-primary" />}
            >
              <SetupLine label={t("settings.liveRequestsSetupMethod")} value="POST" />
              <SetupCopyLine
                label={t("settings.liveRequestsSetupUrl")}
                value={endpoint}
                copyLabel={t("settings.liveRequestsCopyEndpoint")}
                onCopy={() => void copy(endpoint)}
              />
              <SetupCopyLine
                label={t("settings.liveRequestsSetupHeader")}
                value={visibleAuthHeader}
                copyLabel={t("settings.liveRequestsCopyAuthHeader")}
                onCopy={() => void copy(authHeader)}
              />
              <SetupLine
                label={t("settings.liveRequestsSetupBody")}
                value={t("settings.liveRequestsGenericWebhookBody")}
              />
              <SetupJson value={genericExample} />
            </SetupExample>
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("settings.liveRequestsRoute")}>
            <select
              aria-label={t("settings.liveRequestsRoute")}
              value={intake.routeMode}
              onChange={(event) =>
                void updateIntake({
                  routeMode: event.currentTarget.value as AudienceRequestRouteMode,
                })
              }
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {ROUTE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {t(`settings.liveRequestsRouteMode.${mode}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.liveRequestsPlaybackAction")}>
            <select
              aria-label={t("settings.liveRequestsPlaybackAction")}
              value={intake.playbackAction}
              onChange={(event) =>
                void updateIntake({
                  playbackAction: event.currentTarget.value as AudienceRequestPlaybackAction,
                })
              }
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {PLAYBACK_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {t(`settings.liveRequestsPlayback.${action}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.liveRequestsSearchScope")}>
            <select
              aria-label={t("settings.liveRequestsSearchScope")}
              value={intake.searchScope}
              onChange={(event) =>
                void updateIntake({
                  searchScope: event.currentTarget
                    .value as AudienceRequestIntakeSettings["searchScope"],
                })
              }
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="all-library">{t("settings.liveRequestsScope.all-library")}</option>
              <option value="active-set">{t("settings.liveRequestsScope.active-set")}</option>
            </select>
          </Field>
          <Field label={t("settings.liveRequestsCommandPrefixes")}>
            <Input
              value={intake.commandPrefixes.join(", ")}
              onChange={(event) =>
                void updateIntake({
                  commandPrefixes: event.currentTarget.value
                    .split(",")
                    .map((prefix) => prefix.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("settings.liveRequestsConfidence")}>
            <Input
              type="number"
              step="0.1"
              value={intake.confidenceThreshold}
              onChange={(event) =>
                void updateIntake({ confidenceThreshold: Number(event.currentTarget.value) })
              }
            />
          </Field>
          <Field label={t("settings.liveRequestsScoreMargin")}>
            <Input
              type="number"
              step="0.05"
              value={intake.scoreMarginThreshold}
              onChange={(event) =>
                void updateIntake({ scoreMarginThreshold: Number(event.currentTarget.value) })
              }
            />
          </Field>
          <Field label={t("settings.liveRequestsRateLimit")}>
            <Input
              type="number"
              min={1}
              value={intake.maxRequestsPerMinute}
              onChange={(event) =>
                void updateIntake({ maxRequestsPerMinute: Number(event.currentTarget.value) })
              }
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            checked={intake.onlineFallbackOnLowConfidence ?? true}
            label={t("settings.liveRequestsOnlineFallback")}
            hint={t("settings.liveRequestsOnlineFallbackHint")}
            onChange={(onlineFallbackOnLowConfidence) =>
              void updateIntake({ onlineFallbackOnLowConfidence })
            }
          />
          <Toggle
            checked={intake.requireApprovalForPlayNow}
            label={t("settings.liveRequestsRequireApproval")}
            hint={t("settings.liveRequestsRequireApprovalHint")}
            onChange={(requireApprovalForPlayNow) =>
              void updateIntake({ requireApprovalForPlayNow })
            }
          />
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Server className="size-4 text-primary" />
              <span className="font-medium text-sm">{t("settings.liveRequestsInboxTitle")}</span>
            </div>
            <StatusPill status={status} label={t(`settings.liveRequestsStatus.${status}`)} />
          </div>
          {error && <p className="mb-2 text-destructive text-xs">{error}</p>}
          {messages.length === 0 ? (
            <p className="text-muted-foreground text-xs">{t("settings.liveRequestsInboxEmpty")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.map((message) => (
                <div
                  key={`${message.receivedAt}:${message.body.slice(0, 12)}`}
                  className="rounded-md border border-border bg-muted/20 px-3 py-2"
                >
                  <p className="line-clamp-2 text-sm">{message.body}</p>
                  <p className="text-muted-foreground text-xs">
                    {new Date(message.receivedAt).toLocaleTimeString()}
                  </p>
                </div>
              ))}
            </div>
          )}
          {status === "listening" && (
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              onClick={() => void setEnabled(false)}
            >
              <Square />
              {t("settings.liveRequestsStop")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SetupExample({
  children,
  icon,
  title,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/10 p-3">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h4 className="font-medium text-sm">{title}</h4>
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

function SetupLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 gap-1 text-xs sm:grid-cols-[6rem_1fr]">
      <span className="text-muted-foreground">{label}</span>
      <code className="min-w-0 overflow-hidden text-ellipsis rounded bg-muted/40 px-2 py-1">
        {value}
      </code>
    </div>
  );
}

function SetupCopyLine({
  copyLabel,
  label,
  onCopy,
  value,
}: {
  copyLabel: string;
  label: string;
  onCopy: () => void;
  value: string;
}) {
  return (
    <div className="grid min-w-0 gap-1 text-xs sm:grid-cols-[6rem_1fr]">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex min-w-0 gap-2">
        <code className="min-w-0 flex-1 overflow-hidden text-ellipsis rounded bg-muted/40 px-2 py-1">
          {value}
        </code>
        <Button variant="outline" size="icon" aria-label={copyLabel} onClick={onCopy}>
          <Copy />
        </Button>
      </div>
    </div>
  );
}

function SetupJson({ value }: { value: string }) {
  return (
    <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-xs">
      <code>{value}</code>
    </pre>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // The control is passed in via `children` and nested inside the label, which
    // Biome's static analysis can't see through.
    // biome-ignore lint/a11y/noLabelWithoutControl: control supplied via children
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  hint,
  label,
  onChange,
}: {
  checked: boolean;
  hint: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border border-border p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="mt-1 size-4 accent-primary"
      />
      <span className="flex flex-col gap-1">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </span>
    </label>
  );
}

function StatusPill({ label, status }: { label: string; status: IntakeStatus }) {
  const color =
    status === "listening"
      ? "border-primary/40 bg-primary/10 text-primary"
      : status === "error"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-muted/30 text-muted-foreground";
  return <span className={`rounded-full border px-2 py-0.5 text-xs ${color}`}>{label}</span>;
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
