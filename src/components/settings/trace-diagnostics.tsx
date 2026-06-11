import { ClipboardCopy } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteIcon } from "@/components/ui/delete";
import { Input } from "@/components/ui/input";
import {
  type DiagnosticCategory,
  type DiagnosticErrorKind,
  type DiagnosticLevel,
  matchesDiagnosticFilter,
} from "@/lib/diagnostics";
import { clearTrace, formatTraceEntries, type TraceEntry, useTraceEntries } from "@/lib/trace";

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

export function TraceDiagnostics() {
  const { t } = useTranslation();
  const entries = useTraceEntries();
  const [copied, setCopied] = useState<"visible" | "current" | "all" | null>(null);
  const [level, setLevel] = useState<LevelOption>("all");
  const [category, setCategory] = useState<CategoryOption>("all");
  const [errorKind, setErrorKind] = useState<ErrorKindOption>("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(
    () =>
      entries
        .filter((entry) =>
          matchesDiagnosticFilter(entry, {
            levels: level === "all" ? undefined : [level as DiagnosticLevel],
            categories: category === "all" ? undefined : [category as DiagnosticCategory],
            errorKinds: errorKind === "all" ? undefined : [errorKind as DiagnosticErrorKind],
            text: query.trim() || undefined,
          }),
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

  async function copyTrace(kind: "visible" | "current" | "all") {
    if (!navigator.clipboard) return;
    const text = kind === "visible" ? visibleText : kind === "current" ? currentText : allText;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
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
          <Button variant="ghost" size="sm" disabled={entries.length === 0} onClick={clearTrace}>
            <DeleteIcon size={16} />
            {t("settings.traceClear")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 md:grid-cols-[repeat(3,minmax(0,1fr))_minmax(180px,1.4fr)]">
          <TraceSelect
            label={t("settings.traceLevel")}
            value={level}
            options={LEVEL_OPTIONS}
            onChange={(value) => setLevel(value as LevelOption)}
          />
          <TraceSelect
            label={t("settings.traceCategory")}
            value={category}
            options={CATEGORY_OPTIONS}
            onChange={(value) => setCategory(value as CategoryOption)}
          />
          <TraceSelect
            label={t("settings.traceErrorKind")}
            value={errorKind}
            options={ERROR_KIND_OPTIONS}
            onChange={(value) => setErrorKind(value as ErrorKindOption)}
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

function TraceSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
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
