import { ClipboardCopy, Download } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteIcon } from "@/components/ui/delete";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APP_VERSION, GIT_SHA } from "@/lib/app-version";
import {
  type DiagnosticCategory,
  type DiagnosticErrorKind,
  type DiagnosticLevel,
  matchesDiagnosticFilter,
} from "@/lib/diagnostics";
import { saveTextFile } from "@/lib/save-text-file";
import { clearTrace, formatTraceEntries, type TraceEntry, useTraceEntries } from "@/lib/trace";
import {
  clearTraceArchive,
  createTraceArchive,
  exportTraceArchiveJsonl,
  isTraceArchiveEnabled,
  readTraceArchiveEntries,
  setTraceArchiveEnabled,
  subscribeTraceArchiveEnabled,
} from "@/lib/trace-archive";

const LEVEL_OPTIONS = ["all", "debug", "info", "warn", "error"] as const;
const CATEGORY_OPTIONS = [
  "all",
  "user-action",
  "network",
  "stream",
  "media",
  "cache",
  "sync",
] as const;
const ERROR_KIND_OPTIONS = [
  "all",
  "http_status",
  "network_error",
  "media_decode",
  "auth_required",
  "permission_denied",
  "po_token",
] as const;

type LevelOption = (typeof LEVEL_OPTIONS)[number];
type CategoryOption = (typeof CATEGORY_OPTIONS)[number];
type ErrorKindOption = (typeof ERROR_KIND_OPTIONS)[number];

const LEVEL_OPTION_LABELS = {
  all: "settings.traceOptionAll",
  debug: "settings.traceLevelDebug",
  info: "settings.traceLevelInfo",
  warn: "settings.traceLevelWarn",
  error: "settings.traceLevelError",
} as const satisfies Record<LevelOption, string>;

const CATEGORY_OPTION_LABELS = {
  all: "settings.traceOptionAll",
  "user-action": "settings.traceCategoryUserAction",
  network: "settings.traceCategoryNetwork",
  stream: "settings.traceCategoryStream",
  media: "settings.traceCategoryMedia",
  cache: "settings.traceCategoryCache",
  sync: "settings.traceCategorySync",
} as const satisfies Record<CategoryOption, string>;

const ERROR_KIND_OPTION_LABELS = {
  all: "settings.traceOptionAll",
  http_status: "settings.traceErrorHttpStatus",
  network_error: "settings.traceErrorNetworkError",
  media_decode: "settings.traceErrorMediaDecode",
  auth_required: "settings.traceErrorAuthRequired",
  permission_denied: "settings.traceErrorPermissionDenied",
  po_token: "settings.traceErrorPoToken",
} as const satisfies Record<ErrorKindOption, string>;

export function TraceDiagnostics() {
  const { t } = useTranslation();
  const entries = useTraceEntries();
  const [copied, setCopied] = useState<"visible" | "current" | "all" | "archive" | null>(null);
  const [level, setLevel] = useState<LevelOption>("all");
  const [category, setCategory] = useState<CategoryOption>("all");
  const [errorKind, setErrorKind] = useState<ErrorKindOption>("all");
  const [query, setQuery] = useState("");
  const [archiveEnabled, setArchiveEnabledState] = useState(isTraceArchiveEnabled);
  const [archiveCount, setArchiveCount] = useState(0);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const visible = useMemo(
    () =>
      entries
        .filter((entry) =>
          matchesDiagnosticFilter(
            { ...entry, event: entry.event ?? "" },
            {
              levels: level === "all" ? undefined : [level as DiagnosticLevel],
              categories: category === "all" ? undefined : [category as DiagnosticCategory],
              errorKinds: errorKind === "all" ? undefined : [errorKind as DiagnosticErrorKind],
              text: query.trim() || undefined,
            },
          ),
        )
        .slice(-120),
    [entries, level, category, errorKind, query],
  );
  const reproSteps = useMemo(() => visible.filter(isUserActionEntry), [visible]);
  const currentTraceId = useMemo(() => latestTraceId(entries), [entries]);
  const currentTraceEntries = useMemo(
    () =>
      currentTraceId ? entries.filter((entry) => entry.context?.traceId === currentTraceId) : [],
    [entries, currentTraceId],
  );
  const visibleText = formatTraceEntries(visible);
  const currentText = formatTraceEntries(currentTraceEntries);
  const allText = formatTraceEntries(entries);

  useEffect(() => subscribeTraceArchiveEnabled(setArchiveEnabledState), []);

  useEffect(() => {
    let alive = true;
    void refreshArchiveCount().then((count) => {
      if (alive) setArchiveCount(count);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function copyTrace(kind: "visible" | "current" | "all") {
    if (!navigator.clipboard) return;
    const text = kind === "visible" ? visibleText : kind === "current" ? currentText : allText;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  }

  async function exportArchive() {
    setArchiveBusy(true);
    try {
      const archive = createTraceArchive();
      const text = await exportTraceArchiveJsonl(archive, {
        appVersion: APP_VERSION,
        gitSha: GIT_SHA,
        platform: navigator.userAgent,
      });
      await saveTextFile(traceExportFileName(), "application/x-ndjson", text);
      setArchiveCount((await readTraceArchiveEntries(archive)).length);
      setCopied("archive");
      window.setTimeout(() => setCopied(null), 1600);
    } finally {
      setArchiveBusy(false);
    }
  }

  async function clearActiveAndArchive() {
    clearTrace();
    await clearTraceArchive();
    setArchiveCount(0);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{t("settings.traceTitle")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("settings.traceHint")}</p>
          <p className="text-muted-foreground text-xs">
            {t("settings.traceCount", {
              count: visible.length,
              total: entries.length,
              range: traceRangeLabel(visible, t("settings.traceNoRange")),
            })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={visible.length === 0}
            onClick={() => void copyTrace("visible")}
          >
            <ClipboardCopy />
            {copied === "visible" ? t("settings.traceCopied") : t("settings.traceCopyVisible")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!currentTraceId}
            onClick={() => void copyTrace("current")}
          >
            <ClipboardCopy />
            {copied === "current" ? t("settings.traceCopied") : t("settings.traceCopyCurrent")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length === 0}
            onClick={() => void copyTrace("all")}
          >
            <ClipboardCopy />
            {copied === "all" ? t("settings.traceCopied") : t("settings.traceCopyAll")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={entries.length === 0 && archiveCount === 0}
            onClick={() => void clearActiveAndArchive()}
          >
            <DeleteIcon size={16} />
            {t("settings.traceClear")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 rounded-md border border-border p-3 md:flex-row md:items-center md:justify-between">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={archiveEnabled}
              onChange={(event) => setTraceArchiveEnabled(event.currentTarget.checked)}
              className="mt-1"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium text-foreground">{t("settings.traceArchive")}</span>
              <span className="text-muted-foreground text-xs">
                {t("settings.traceArchiveHint", { count: archiveCount })}
              </span>
            </span>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={archiveBusy || archiveCount === 0}
            onClick={() => void exportArchive()}
          >
            <Download />
            {copied === "archive"
              ? t("settings.traceArchiveExported")
              : t("settings.traceArchiveExport")}
          </Button>
        </div>
        <div className="grid gap-2 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(180px,1.4fr)]">
          <TraceSelect
            label={t("settings.traceLevel")}
            value={level}
            options={LEVEL_OPTIONS}
            getOptionLabel={(option) => t(LEVEL_OPTION_LABELS[option])}
            onChange={setLevel}
          />
          <TraceSelect
            label={t("settings.traceCategory")}
            value={category}
            options={CATEGORY_OPTIONS}
            getOptionLabel={(option) => t(CATEGORY_OPTION_LABELS[option])}
            onChange={setCategory}
          />
          <TraceSelect
            label={t("settings.traceErrorKind")}
            value={errorKind}
            options={ERROR_KIND_OPTIONS}
            getOptionLabel={(option) => t(ERROR_KIND_OPTION_LABELS[option])}
            onChange={setErrorKind}
          />
          <label
            htmlFor="trace-search"
            className="flex flex-col gap-1 text-xs text-muted-foreground"
          >
            {t("settings.traceSearch")}
            <Input
              id="trace-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.traceSearchPlaceholder")}
              className="h-9 text-xs"
            />
          </label>
        </div>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
          <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-5 text-muted-foreground">
            {visibleText || t("settings.traceEmpty")}
          </pre>
          <div className="flex min-h-0 flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">{t("settings.traceRepro")}</p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-5 text-muted-foreground">
              {formatTraceEntries(reproSteps) || t("settings.traceReproEmpty")}
            </pre>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

async function refreshArchiveCount(): Promise<number> {
  return (await readTraceArchiveEntries()).length;
}

function traceExportFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `muzero-trace-${stamp}.jsonl`;
}

function TraceSelect<TOption extends string>({
  label,
  value,
  options,
  getOptionLabel,
  onChange,
}: {
  label: string;
  value: TOption;
  options: readonly TOption[];
  getOptionLabel: (value: TOption) => string;
  onChange: (value: TOption) => void;
}) {
  const labelId = useId();

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <span id={labelId}>{label}</span>
      <Select
        aria-label={label}
        value={value}
        onValueChange={(nextValue) => onChange(nextValue as TOption)}
      >
        <SelectTrigger aria-labelledby={labelId} className="h-9 text-xs">
          <SelectValue>{(selectedValue) => getOptionLabel(selectedValue as TOption)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {getOptionLabel(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function isUserActionEntry(entry: TraceEntry): boolean {
  return entry.context?.category === "user-action";
}

function latestTraceId(entries: TraceEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const traceId = entries[index].context?.traceId;
    if (traceId) return traceId;
  }
  return null;
}

function traceRangeLabel(entries: TraceEntry[], empty: string): string {
  if (entries.length === 0) return empty;
  const first = new Date(entries[0].at).toLocaleTimeString();
  const last = new Date(entries[entries.length - 1].at).toLocaleTimeString();
  return first === last ? first : `${first} - ${last}`;
}
