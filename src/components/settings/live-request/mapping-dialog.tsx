import { RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsIndicator, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AudienceRequestSource } from "@/db/types";
import {
  type CapturedPayload,
  getCapturedLiveRequests,
} from "@/live-requests/live-request-controller";
import {
  detectPresetId,
  fieldValuesToMapping,
  getPresetMapping,
  type MappingPresetId,
  mappingToFieldValues,
  REQUEST_TARGET_FIELDS,
  type RequestMapping,
  type RequestMappingFieldValues,
} from "@/live-requests/request-mapping-presets";
import { applyTemplateString } from "@/live-requests/request-template";
import { JsonPayloadTree } from "./json-payload-tree";
import { TargetFieldInput } from "./target-field-input";

const PRESET_IDS: MappingPresetId[] = ["auto", "social-stream-ninja", "generic-json", "custom"];

function safeParseMapping(raw: string): RequestMapping | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.query !== "string") return null;
    return parsed as RequestMapping;
  } catch {
    return null;
  }
}

export function MappingDialog({
  open,
  onOpenChange,
  source,
  onSave,
  onGoLive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: AudienceRequestSource;
  onSave: (update: { mappingPreset: MappingPresetId; mapping?: RequestMapping }) => void;
  onGoLive: () => void;
}) {
  const { t } = useTranslation();
  const tk = (key: string, fallback: string) => t(key, { defaultValue: fallback });

  const [preset, setPreset] = useState<MappingPresetId>(source.mappingPreset);
  const [fieldValues, setFieldValues] = useState<RequestMappingFieldValues>(() =>
    mappingToFieldValues(source.mapping ?? getPresetMapping(source.mappingPreset)),
  );
  const [editorMode, setEditorMode] = useState<"visual" | "raw">("visual");
  const [rawText, setRawText] = useState(() =>
    JSON.stringify(source.mapping ?? getPresetMapping(source.mappingPreset) ?? {}, null, 2),
  );
  const [focusedField, setFocusedField] = useState<keyof RequestMapping | null>(null);
  const [samples, setSamples] = useState<CapturedPayload[]>([]);
  const [sampleIndex, setSampleIndex] = useState(0);

  // Poll the in-memory capture ring while open so a request sent during testing
  // shows up here without a manual refresh.
  useEffect(() => {
    if (!open) return;
    const refresh = () => setSamples(getCapturedLiveRequests(source.id));
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, [open, source.id]);

  const activeSample = samples[sampleIndex]?.body ?? samples[0]?.body;

  const handlePreset = useCallback((next: MappingPresetId) => {
    setPreset(next);
    const presetMapping = getPresetMapping(next);
    if (presetMapping) {
      setFieldValues(mappingToFieldValues(presetMapping));
      setRawText(JSON.stringify(presetMapping, null, 2));
    } else if (next === "auto") {
      setFieldValues(mappingToFieldValues(null));
    }
  }, []);

  const setField = useCallback((key: keyof RequestMapping, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
    setPreset("custom");
  }, []);

  const fieldPreview = (key: keyof RequestMapping): { value?: unknown; error?: string } => {
    const template = fieldValues[key];
    if (!template.trim() || !activeSample) return {};
    try {
      return { value: applyTemplateString(template, { payload: activeSample }) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  const buildMapping = useCallback((): RequestMapping | null => {
    if (preset === "auto") return null;
    return editorMode === "raw" ? safeParseMapping(rawText) : fieldValuesToMapping(fieldValues);
  }, [preset, editorMode, rawText, fieldValues]);

  const persist = useCallback(() => {
    if (preset === "auto") {
      onSave({ mappingPreset: "auto", mapping: undefined });
      return true;
    }
    const mapping = buildMapping();
    if (!mapping?.query.trim()) return false;
    onSave({ mappingPreset: detectPresetId(mapping), mapping });
    return true;
  }, [preset, buildMapping, onSave]);

  const presetLabel = (id: string) =>
    tk(`settings.liveRequestsMappingPreset.${id}`, id === "auto" ? "Auto (heuristic)" : id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[min(calc(100vw-2rem),60rem)] max-w-none flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="truncate">
              {source.name} — {tk("settings.liveRequestsMappingTitle", "Configure mapping")}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {tk("settings.liveRequestsMappingDesc", "Map the incoming request body to a query")}
            </DialogDescription>
          </div>
          <Select value={preset} onValueChange={(value) => handlePreset(value as MappingPresetId)}>
            <SelectTrigger className="w-44">
              <SelectValue>{(value) => presetLabel(String(value))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PRESET_IDS.map((id) => (
                <SelectItem key={id} value={id}>
                  {presetLabel(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {preset === "auto" ? (
          <div className="flex flex-1 items-center justify-center rounded-md border border-border bg-muted/20 p-6 text-center text-muted-foreground text-sm">
            {tk(
              "settings.liveRequestsMappingAutoNote",
              "Auto uses the built-in field heuristic — no mapping needed. Pick a preset or Custom to map fields explicitly.",
            )}
          </div>
        ) : (
          <Tabs
            value={editorMode}
            onValueChange={(value) => setEditorMode(value as "visual" | "raw")}
            className="min-h-0 flex-1"
          >
            <TabsList>
              <TabsTab value="visual">{tk("settings.liveRequestsMappingVisual", "Visual")}</TabsTab>
              <TabsTab value="raw">{tk("settings.liveRequestsMappingRaw", "Raw JSON")}</TabsTab>
              <TabsIndicator />
            </TabsList>

            <TabsPanel value="visual" className="min-h-0 flex-1">
              <div className="grid h-full grid-cols-2 gap-3">
                <div className="flex min-h-0 flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-muted-foreground text-xs">
                      {tk("settings.liveRequestsMappingSample", "Sample payload")}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        onClick={() => setSamples(getCapturedLiveRequests(source.id))}
                      >
                        <RefreshCw className="size-3" />
                      </Button>
                      {samples.length > 0 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6"
                          onClick={() => {
                            setSamples([]);
                            setSampleIndex(0);
                          }}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {samples.length > 1 && (
                    <Select
                      value={String(sampleIndex)}
                      onValueChange={(value) => setSampleIndex(Number(value))}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue>{(value) => `#${Number(value) + 1}`}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {samples.map((sample, index) => (
                          <SelectItem key={sample.receivedAt} value={String(index)}>
                            #{index + 1} · {new Date(sample.receivedAt).toLocaleTimeString()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/20">
                    {activeSample ? (
                      <JsonPayloadTree
                        data={activeSample}
                        onSelect={(expression) => setField(focusedField ?? "query", expression)}
                      />
                    ) : (
                      <p className="p-3 text-muted-foreground text-xs">
                        {tk(
                          "settings.liveRequestsMappingNoSample",
                          "No sample yet. While this source is in testing, send a request to its endpoint to see the body here, then click a field to map it.",
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
                  {REQUEST_TARGET_FIELDS.map(({ key, required }) => {
                    const preview = fieldPreview(key);
                    return (
                      <TargetFieldInput
                        key={key}
                        label={tk(`settings.liveRequestsMappingField.${key}`, key)}
                        required={required}
                        value={fieldValues[key]}
                        placeholder="{{ payload.… }}"
                        previewValue={preview.value}
                        previewError={preview.error}
                        isFocused={focusedField === key}
                        onChange={(value) => setField(key, value)}
                        onFocus={() => setFocusedField(key)}
                        onBlur={() => setTimeout(() => setFocusedField(null), 150)}
                      />
                    );
                  })}
                </div>
              </div>
            </TabsPanel>

            <TabsPanel value="raw" className="min-h-0 flex-1">
              <Textarea
                value={rawText}
                onChange={(event) => {
                  setRawText(event.currentTarget.value);
                  setPreset("custom");
                }}
                className="h-full min-h-0 resize-none font-mono text-xs"
                spellCheck={false}
              />
            </TabsPanel>
          </Tabs>
        )}

        <div className="flex items-center justify-between gap-3 border-border border-t pt-3">
          <span className="text-muted-foreground text-xs">
            {source.status === "testing"
              ? tk(
                  "settings.liveRequestsMappingTestingNote",
                  "Testing — requests are previewed, not played",
                )
              : ""}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (persist()) onOpenChange(false);
              }}
            >
              {tk("settings.liveRequestsMappingSave", "Save mapping")}
            </Button>
            {source.status === "testing" && (
              <Button
                onClick={() => {
                  if (persist()) {
                    onGoLive();
                    onOpenChange(false);
                  }
                }}
              >
                {tk("settings.liveRequestsGoLive", "Go live")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
