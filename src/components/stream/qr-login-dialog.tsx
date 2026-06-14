import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { StreamSourceId } from "@/db/types";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { qrSvgDataUrl } from "@/lib/qr-svg";
import { cn } from "@/lib/utils";
import type { StreamLoginConfig } from "@/streamsrc/login";
import type { QrStatus } from "@/streamsrc/qr-login";
import {
  createNeteaseQrApi,
  type QrOutcome,
  type QrSourceApi,
  qrPollLoop,
} from "@/streamsrc/qr-login-provider";
import { createStreamHttp } from "@/streamsrc/stream-http";

type LoginPhase = "loading" | QrStatus | QrOutcome | "error";

export function QrLoginDialog({
  source,
  label,
  config,
  onClose,
  onExternalLogin,
  onSuccess,
}: {
  source: StreamSourceId;
  label: string;
  config: StreamLoginConfig;
  onClose: () => void;
  onExternalLogin?: () => void;
  onSuccess: (cookie: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<LoginPhase>("loading");
  const [qrContent, setQrContent] = useState("");
  const [attempt, setAttempt] = useState(0);
  const onCloseRef = useRef(onClose);
  const onSuccessRef = useRef(onSuccess);
  const qrSrc = useMemo(() => (qrContent ? qrSvgDataUrl(qrContent) : ""), [qrContent]);
  const retryable = phase === "expired" || phase === "timeout" || phase === "error";

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    void attempt;
    const bridge = resolveDesktopBridge();
    const api = createQrApi(source);
    const signal = { aborted: false };
    let closeTimer: number | undefined;

    async function run() {
      if (!api || !bridge.readSourceCookies) {
        setPhase("error");
        return;
      }
      setPhase("loading");
      setQrContent("");
      try {
        const generated = await api.generate();
        if (signal.aborted) return;
        setQrContent(generated.qrContent);
        setPhase("waiting");
        const outcome = await qrPollLoop(api, generated.qrKey, {
          now: () => Date.now(),
          sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
          readCookie: () =>
            bridge.readSourceCookies?.({
              loginUrl: config.loginUrl,
              cookieUrls: config.cookieUrls,
              authCookie: config.authCookie,
            }) ?? Promise.resolve(null),
          onStatus: setPhase,
          signal,
        });
        if (signal.aborted) return;
        if (outcome.outcome === "success" && outcome.cookie) {
          setPhase("success");
          await onSuccessRef.current(outcome.cookie);
          if (signal.aborted) return;
          closeTimer = window.setTimeout(() => {
            if (!signal.aborted) onCloseRef.current();
          }, 700);
          return;
        }
        setPhase(outcome.outcome === "success" ? "error" : outcome.outcome);
      } catch {
        if (!signal.aborted) setPhase("error");
      }
    }

    void run();
    return () => {
      signal.aborted = true;
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [source, config, attempt]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="gap-4">
        <DialogTitle>{t("streamSources.qrTitle", { source: label })}</DialogTitle>
        <DialogDescription>{t("streamSources.qrSubtitle")}</DialogDescription>

        <div className="flex flex-col items-center gap-3">
          <div className="grid size-48 place-items-center rounded-xl bg-white p-3 shadow-inner">
            {qrSrc ? (
              <img src={qrSrc} alt={t("streamSources.qrAlt", { source: label })} />
            ) : (
              <Loader2 className="size-6 animate-spin text-zinc-400" />
            )}
          </div>
          <p
            className={cn(
              "min-h-5 text-center text-sm",
              phase === "success" ? "text-green-500" : "text-muted-foreground",
            )}
          >
            {phaseText(phase, t as (key: string) => string)}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("playlistImport.cancel")}
          </Button>
          <div className="flex items-center gap-2">
            {onExternalLogin && (
              <Button type="button" variant="outline" onClick={onExternalLogin}>
                {t("streamSources.externalLogin")}
              </Button>
            )}
            {retryable && (
              <Button type="button" onClick={() => setAttempt((n) => n + 1)}>
                <RefreshCw className="size-4" />
                {t("discover.retry")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function createQrApi(source: StreamSourceId): QrSourceApi | null {
  const http = createStreamHttp();
  if (source === "netease") return createNeteaseQrApi(http);
  return null;
}

function phaseText(phase: LoginPhase, t: (key: string) => string): string {
  switch (phase) {
    case "loading":
      return t("streamSources.qrLoading");
    case "waiting":
      return t("streamSources.qrWaiting");
    case "scanned":
      return t("streamSources.qrScanned");
    case "success":
      return t("streamSources.qrSuccess");
    case "expired":
      return t("streamSources.qrExpired");
    case "timeout":
      return t("streamSources.qrTimeout");
    case "cancelled":
      return t("streamSources.qrCancelled");
    default:
      return t("streamSources.qrError");
  }
}
