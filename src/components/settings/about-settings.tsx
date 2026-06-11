import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openChangelog } from "@/components/player/changelog-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettings } from "@/hooks/use-app-data";
import { resolveAppIconOption } from "@/lib/app-icon";
import { APP_VERSION, RELEASE_ID } from "@/lib/app-version";
import { type UpdateChannel, useDesktopUpdate } from "@/lib/desktop/desktop-update";

const CHANNEL_KEY = "muzero:update:channel";

function readChannel(): UpdateChannel {
  try {
    return localStorage.getItem(CHANNEL_KEY) === "beta" ? "beta" : "stable";
  } catch {
    return "stable";
  }
}

function useUpdateStatusLabel(): string {
  const { t } = useTranslation();
  const { status } = useDesktopUpdate();
  switch (status.kind) {
    case "checking":
      return t("update.checking");
    case "available":
      return t("update.available", { version: status.version ?? "" });
    case "downloading":
      return t("update.downloading", { percent: status.percent ?? 0 });
    case "downloaded":
      return t("update.downloaded", { version: status.version ?? "" });
    case "manual-required":
      return t("update.manualRequired");
    case "error":
      return t("update.error");
    default:
      return t("update.upToDate");
  }
}

export function AboutSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const { supported, status, check, install, setChannel } = useDesktopUpdate();
  const [channel, setLocalChannel] = useState<UpdateChannel>(readChannel);
  const statusLabel = useUpdateStatusLabel();
  const appIcon = resolveAppIconOption(settings.appIcon);

  // biome-ignore lint/correctness/useExhaustiveDependencies: align the main process with the persisted channel once when the bridge becomes available
  useEffect(() => {
    if (supported) setChannel(channel);
  }, [supported]);

  const onChannelChange = (next: string | null) => {
    const value: UpdateChannel = next === "beta" ? "beta" : "stable";
    setLocalChannel(value);
    try {
      localStorage.setItem(CHANNEL_KEY, value);
    } catch {
      // ignore (private mode)
    }
    setChannel(value);
  };

  const canInstall = status.kind === "downloaded" || status.kind === "manual-required";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.aboutTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-1.5 pb-1">
          <img
            src={appIcon.preview}
            alt="MUZERO"
            width={128}
            height={128}
            className="size-32 rounded-[1.75rem] drop-shadow-[0_16px_36px_rgba(0,0,0,0.26)]"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-sm">{t("settings.aboutCurrentVersion")}</span>
          <span className="font-medium text-sm tabular-nums">v{APP_VERSION}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-sm">{t("settings.aboutBuild")}</span>
          <span className="select-all text-muted-foreground text-xs tabular-nums">
            {RELEASE_ID}
          </span>
        </div>

        {supported ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-sm">{t("settings.aboutChannel")}</span>
              <Select value={channel} onValueChange={onChannelChange}>
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">{t("settings.aboutChannelStable")}</SelectItem>
                  <SelectItem value="beta">{t("settings.aboutChannelBeta")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm">{statusLabel}</span>
              <div className="flex gap-2">
                {canInstall ? (
                  <Button size="sm" onClick={install}>
                    {status.kind === "manual-required"
                      ? t("update.download")
                      : t("update.restartToUpdate")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={check}
                  disabled={status.kind === "checking" || status.kind === "downloading"}
                >
                  {t("settings.aboutCheckUpdates")}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t("settings.aboutWebOnly")}</p>
        )}

        <div>
          <Button variant="outline" size="sm" onClick={openChangelog}>
            {t("settings.aboutViewChangelog")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
