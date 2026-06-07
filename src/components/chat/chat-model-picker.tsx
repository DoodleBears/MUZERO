"use client";

import { ChevronsUpDown } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import type { LlmProviderPreset, LlmProviderPresetId } from "@/ai/llm-providers";
import { Button } from "@/components/ui/button";
import { Command, type CommandItem } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const ITEM_SEPARATOR = "\u0000";

export interface ChatModelPickerLabels {
  empty: ReactNode;
  inherited: ReactNode;
  searchPlaceholder: string;
  trigger: string;
}

interface ChatModelSelection {
  model: string;
  presetId: LlmProviderPresetId;
}

interface ChatModelPickerProps {
  className?: string;
  labels: ChatModelPickerLabels;
  onSelect: (selection: ChatModelSelection) => void;
  presets: LlmProviderPreset[];
  selectedModel?: string;
  selectedPresetId?: string;
}

export function ChatModelPicker({
  className,
  labels,
  onSelect,
  presets,
  selectedModel,
  selectedPresetId,
}: ChatModelPickerProps) {
  const [open, setOpen] = useState(false);
  const { items, selectionById, selectedLabel, selectedId } = useMemo(
    () => modelItemsFor(presets, selectedPresetId, selectedModel),
    [presets, selectedModel, selectedPresetId],
  );

  function selectModel(id: string) {
    const selection = selectionById.get(id);
    if (!selection) return;
    onSelect(selection);
    setOpen(false);
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={labels.trigger}
            className={cn("min-w-48 justify-between", className)}
            variant="outline"
          >
            <span className="truncate">{selectedLabel ?? labels.inherited}</span>
            <ChevronsUpDown aria-hidden="true" className="opacity-60" />
          </Button>
        }
      />
      <PopoverContent className="w-72 p-0">
        <Command
          empty={labels.empty}
          items={items}
          onSelect={selectModel}
          placeholder={labels.searchPlaceholder}
          selectedId={selectedId}
        />
      </PopoverContent>
    </Popover>
  );
}

function modelItemsFor(
  presets: readonly LlmProviderPreset[],
  selectedPresetId: string | undefined,
  selectedModel: string | undefined,
) {
  const selectionById = new Map<string, ChatModelSelection>();
  const items: CommandItem[] = [];
  let selectedId: string | undefined;
  let selectedLabel: string | undefined;

  for (const preset of presets) {
    for (const model of preset.models) {
      const id = itemIdFor(preset.id, model.id);
      const label = `${preset.label} / ${model.label}`;
      selectionById.set(id, { model: model.id, presetId: preset.id });
      items.push({
        id,
        keywords: [preset.id, preset.label, model.id, model.label],
        label,
      });
      if (preset.id === selectedPresetId && model.id === selectedModel) {
        selectedId = id;
        selectedLabel = label;
      }
    }
  }

  return { items, selectedId, selectedLabel, selectionById };
}

function itemIdFor(presetId: LlmProviderPresetId, model: string) {
  return `${presetId}${ITEM_SEPARATOR}${model}`;
}
