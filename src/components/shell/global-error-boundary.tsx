import type { TFunction } from "i18next";
import { AlertCircle, ChevronDown, ClipboardCopy, RefreshCcw, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import i18n from "@/i18n/i18n";
import { extractErrorDebugInfo, formatErrorClipboardText } from "@/lib/error-details";
import { log } from "@/lib/logger";
import { useNotification } from "@/stores/notification-store";

type CommonT = TFunction<"common", undefined>;
type DiagnosticItem = { label: string; value: string };
type ErrorStackItem = { label: string; value: string };

type GlobalErrorBoundaryProps = { children: ReactNode };
type GlobalErrorBoundaryState = { error: unknown; errorInfo?: ErrorInfo };

/**
 * Top-level boundary: catches any render/lifecycle throw below it and swaps in a
 * full-screen crash report (message + stacks + device diagnostics + one-click
 * copy) instead of an unmounted white screen. Wrap `<App/>` with it in
 * `main.tsx`; keep `<NotificationStack/>` as a *sibling* so the copy toast still
 * renders once the app subtree is gone.
 */
export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  state: GlobalErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): GlobalErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    this.setState({ error, errorInfo });
    log.error("error-boundary", "unhandled render error", error, errorInfo);
  }

  private reset = () => {
    this.setState({ error: null, errorInfo: undefined });
  };

  render() {
    if (this.state.error) {
      return (
        <GlobalErrorFallback
          componentStack={this.state.errorInfo?.componentStack}
          error={this.state.error}
          reset={this.reset}
        />
      );
    }
    return this.props.children;
  }
}

export function GlobalErrorFallback({
  componentStack,
  error,
  reset,
}: {
  componentStack?: string | null;
  error: unknown;
  reset?: () => void;
}) {
  const { t } = useTranslation("common");
  const notify = useNotification();
  const [copied, setCopied] = useState(false);
  const message = error instanceof Error ? error.message : t("errorPage.unknownMessage");
  // Captured once when the crash screen mounts — its "Time" field.
  const [createdAt] = useState(() => Date.now());
  const debug = useMemo(
    () =>
      extractErrorDebugInfo(error, {
        componentStack: componentStack ?? undefined,
        source: "GlobalErrorBoundary",
      }),
    [componentStack, error],
  );
  const appItems = useMemo(() => getAppDiagnosticItems(t), [t]);
  const deviceItems = useMemo(() => getDeviceDiagnosticItems(t), [t]);
  const stackItems = useMemo(() => getErrorStackItems(debug, t), [debug, t]);
  const errorDetails = useMemo(
    () =>
      formatErrorClipboardText({
        message,
        createdAt,
        debug,
        url: typeof window === "undefined" ? undefined : window.location.href,
        userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
        context: [...appItems, ...deviceItems],
      }),
    [appItems, createdAt, debug, deviceItems, message],
  );

  const handleCopy = useCallback(async () => {
    const ok = await copyText(errorDetails);
    if (!ok) {
      notify.warning(t("notification.copyFail"));
      return;
    }
    setCopied(true);
    notify.success(t("notification.copySuccess"));
    window.setTimeout(() => setCopied(false), 2000);
  }, [errorDetails, notify, t]);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10 text-foreground">
      <section className="w-full max-w-3xl overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="grid gap-0 md:grid-cols-[10rem_1fr]">
          <div className="flex min-h-40 flex-col justify-between border-b bg-destructive p-5 text-white md:border-r md:border-b-0">
            <AlertCircle className="size-12" aria-hidden="true" />
            <p className="font-semibold text-xs uppercase tracking-wide">{t("errorPage.kicker")}</p>
          </div>

          <div className="space-y-6 p-5 sm:p-7">
            <div className="flex flex-col gap-4 min-[520px]:flex-row min-[520px]:items-start min-[520px]:justify-between">
              <div className="min-w-0 space-y-2">
                <h1 className="font-extrabold text-2xl leading-tight sm:text-3xl">
                  {t("errorPage.title")}
                </h1>
                <p className="max-w-2xl text-muted-foreground text-sm leading-6">
                  {t("errorPage.description")}
                </p>
              </div>
              <Button
                className="w-full min-[520px]:w-auto min-[520px]:flex-none"
                onClick={handleCopy}
                size="sm"
              >
                <ClipboardCopy />
                {copied ? t("errorPage.copied") : t("errorPage.copyDetails")}
              </Button>
            </div>

            <ErrorDetailsPanel
              message={message || t("errorPage.unknownMessage")}
              stackItems={stackItems}
              t={t}
            />

            <div className="grid gap-3">
              <DiagnosticPanel title={t("errorPage.appLabel")} items={appItems} />
              <details className="group rounded-lg border bg-muted/30">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent/60">
                  <span className="font-semibold text-muted-foreground text-xs uppercase">
                    {t("errorPage.deviceLabel")}
                  </span>
                  <ChevronDown
                    className="size-4 flex-none text-muted-foreground transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="px-4 pb-4">
                  <DiagnosticList items={deviceItems} />
                </div>
              </details>
            </div>

            <div className="flex flex-wrap gap-2">
              {reset && (
                <Button onClick={reset} size="sm" variant="outline">
                  <RotateCcw />
                  {t("errorPage.retry")}
                </Button>
              )}
              <Button onClick={handleReload} size="sm">
                <RefreshCcw />
                {t("errorPage.reload")}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function ErrorDetailsPanel({
  message,
  stackItems,
  t,
}: {
  message: string;
  stackItems: ErrorStackItem[];
  t: CommonT;
}) {
  return (
    <section className="space-y-4 rounded-lg border bg-muted/50 p-4">
      <div className="space-y-2">
        <p className="font-semibold text-muted-foreground text-xs uppercase">
          {t("errorPage.errorLabel")}
        </p>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-destructive text-xs leading-5">
          {message}
        </pre>
      </div>

      {stackItems.length > 0 ? (
        <details className="group rounded-md border bg-background/80">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-accent/60">
            <span className="font-semibold text-muted-foreground text-xs uppercase">
              {t("errorPage.stackLabel")}
            </span>
            <ChevronDown
              className="size-4 flex-none text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-4 px-4 pb-4">
            {stackItems.map((item) => (
              <div className="space-y-2 border-t pt-4 first:border-t-0 first:pt-0" key={item.label}>
                <p className="font-semibold text-[0.7rem] text-muted-foreground uppercase">
                  {item.label}
                </p>
                <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words font-mono text-foreground text-xs leading-5">
                  {item.value}
                </pre>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function DiagnosticPanel({ items, title }: { items: DiagnosticItem[]; title: string }) {
  return (
    <section className="min-w-0 rounded-lg border bg-muted/30 p-4">
      <p className="font-semibold text-muted-foreground text-xs uppercase">{title}</p>
      <DiagnosticList className="mt-3" items={items} />
    </section>
  );
}

function DiagnosticList({ className, items }: { className?: string; items: DiagnosticItem[] }) {
  return (
    <dl className={`space-y-2 ${className ?? ""}`}>
      {items.map((item) => (
        <div className="min-w-0 border-t pt-2 first:border-t-0 first:pt-0" key={item.label}>
          <dt className="font-semibold text-[0.7rem] text-muted-foreground uppercase">
            {item.label}
          </dt>
          <dd className="mt-1 break-words font-mono text-foreground text-xs leading-5">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function getErrorStackItems(
  debug: ReturnType<typeof extractErrorDebugInfo>,
  t: CommonT,
): ErrorStackItem[] {
  return [
    debug?.componentStack
      ? { label: t("errorPage.componentStackLabel"), value: debug.componentStack }
      : null,
    debug?.stack ? { label: t("errorPage.stackTraceLabel"), value: debug.stack } : null,
    debug?.cause ? { label: t("errorPage.causeLabel"), value: debug.cause } : null,
  ].filter((item): item is ErrorStackItem => item !== null);
}

function getAppDiagnosticItems(t: CommonT): DiagnosticItem[] {
  const items: DiagnosticItem[] = [];
  if (typeof window !== "undefined") {
    const isTauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
    items.push({ label: t("errorPage.runtimeField"), value: isTauri ? "Tauri" : "Browser" });
    items.push({ label: t("errorPage.urlField"), value: window.location.href });
  }
  items.push({
    label: t("errorPage.localeField"),
    value: i18n.language || t("errorPage.unavailableValue"),
  });
  items.push({ label: t("errorPage.timeField"), value: new Date().toISOString() });
  return items;
}

function getDeviceDiagnosticItems(t: CommonT): DiagnosticItem[] {
  const items: DiagnosticItem[] = [];

  if (typeof window !== "undefined") {
    items.push({
      label: t("errorPage.viewportField"),
      value: `${window.innerWidth} x ${window.innerHeight}`,
    });
    if (window.screen) {
      items.push({
        label: t("errorPage.screenField"),
        value: `${window.screen.width} x ${window.screen.height} @ ${formatNumber(window.devicePixelRatio || 1)}x`,
      });
    }
  }

  if (typeof navigator !== "undefined") {
    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
    items.push(
      {
        label: t("errorPage.platformField"),
        value: navigator.platform || t("errorPage.unavailableValue"),
      },
      {
        label: t("errorPage.languageField"),
        value: [
          navigator.language,
          ...navigator.languages.filter((language) => language !== navigator.language),
        ].join(", "),
      },
      {
        label: t("errorPage.touchField"),
        value: navigator.maxTouchPoints > 0 ? t("errorPage.yesValue") : t("errorPage.noValue"),
      },
      {
        label: t("errorPage.coresField"),
        value: navigator.hardwareConcurrency
          ? String(navigator.hardwareConcurrency)
          : t("errorPage.unavailableValue"),
      },
      {
        label: t("errorPage.memoryField"),
        value: navigatorWithMemory.deviceMemory
          ? `${formatNumber(navigatorWithMemory.deviceMemory)} GB`
          : t("errorPage.unavailableValue"),
      },
      {
        label: t("errorPage.onlineField"),
        value: navigator.onLine ? t("errorPage.yesValue") : t("errorPage.noValue"),
      },
      {
        label: t("errorPage.userAgentField"),
        value: navigator.userAgent || t("errorPage.unavailableValue"),
      },
    );
  }

  return items.length > 0
    ? items
    : [{ label: t("errorPage.deviceLabel"), value: t("errorPage.unavailableValue") }];
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Copy with the modern API, falling back to a hidden textarea + execCommand. */
async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path for browsers that reject the async API.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
