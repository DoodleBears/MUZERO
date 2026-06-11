"use client";

import { ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import {
  apiKeyForPreset,
  type LlmProviderPreset,
  type LlmProviderPresetId,
  llmProviderAllowsMissingApiKey,
} from "@/ai/llm-providers";
import { Button } from "@/components/ui/button";
import { Command, type CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AppSettings } from "@/db/types";
import { cn } from "@/lib/utils";
import { getProviderBrandIcon } from "./provider-brand-icons";

export interface ProviderComboboxLabels {
  trigger: string;
  searchPlaceholder: string;
  empty: string;
  keyReady: string;
  keyOptional: string;
  keyMissing: string;
}

/**
 * Provider selection as a brand-iconed combobox (ClipCombo parity): a
 * shadcn-style Popover + Command where each item shows the provider's brand
 * glyph, its label, and its key status; the trigger shows the active provider's
 * icon + label. Replaces the flat provider grid.
 */
export function ProviderCombobox({
  className,
  labels,
  onSelect,
  presets,
  selectedId,
  settings,
}: {
  className?: string;
  labels: ProviderComboboxLabels;
  onSelect: (id: LlmProviderPresetId) => void;
  presets: LlmProviderPreset[];
  selectedId: LlmProviderPresetId;
  settings: AppSettings;
}) {
  const [open, setOpen] = useState(false);

  function keyStatus(id: LlmProviderPresetId): string {
    if (apiKeyForPreset(settings, id)?.trim()) return labels.keyReady;
    return llmProviderAllowsMissingApiKey(id) ? labels.keyOptional : labels.keyMissing;
  }

  // The provider list is tiny; building items each render avoids the
  // memo/exhaustive-deps churn over `labels` and the key-status closure.
  const items: CommandItem[] = presets.map((preset) => {
    const Icon = getProviderBrandIcon(preset.id);
    return {
      id: preset.id,
      label: preset.label,
      keywords: [preset.id, preset.label],
      icon: <Icon className="size-4" />,
      description: keyStatus(preset.id),
    };
  });

  const active = presets.find((p) => p.id === selectedId) ?? presets[0];
  const ActiveIcon = getProviderBrandIcon(active?.id ?? "");

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={labels.trigger}
            className={cn("w-full justify-between", className)}
            variant="outline"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ActiveIcon className="size-4 shrink-0" />
              <span className="truncate">{active?.label ?? labels.trigger}</span>
            </span>
            <ChevronsUpDown aria-hidden="true" className="opacity-60" />
          </Button>
        }
      />
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <Command
          empty={labels.empty}
          items={items}
          onSelect={(id) => {
            onSelect(id as LlmProviderPresetId);
            setOpen(false);
          }}
          placeholder={labels.searchPlaceholder}
          selectedId={selectedId}
        />
      </PopoverContent>
    </Popover>
  );
}
