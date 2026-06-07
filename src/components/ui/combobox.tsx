"use client";

import { ChevronsUpDown } from "lucide-react";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import {
  ComboBox as AriaComboBox,
  Button,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
} from "react-aria-components";
import { cn } from "@/lib/utils";

export interface ComboboxItem {
  /** Stable key; also the value reported back on select. */
  id: string;
  /** Visible + searchable text. */
  label: string;
  /** Optional inline style for the row (e.g. a font-family preview). */
  style?: CSSProperties;
}

export interface ComboboxProps {
  /** Accessible name for the input. */
  label: string;
  /** Full option list; filtering happens internally against `label`. */
  items: ComboboxItem[];
  /** Currently selected id (must match an item id) or null. */
  selectedKey: string | null;
  /** Controlled text in the input. */
  inputValue: string;
  onInputChange: (value: string) => void;
  /** Fired when an item is chosen (its id) — null for a cleared/custom commit. */
  onSelectionChange: (id: string | null) => void;
  onOpenChange?: (isOpen: boolean) => void;
  /** Allow committing free text not in the list (handled by the parent). */
  allowsCustomValue?: boolean;
  placeholder?: string;
  loadingText?: string;
  emptyText?: string;
  isLoading?: boolean;
  /** Cap on rendered rows (system-font lists can be hundreds long). */
  maxResults?: number;
  className?: string;
  /** Inline style for the input itself (e.g. preview the typed font). */
  inputStyle?: CSSProperties;
}

/**
 * A searchable single-select combobox built on react-aria-components (same stack
 * as the color picker — full keyboard + a11y, no extra deps). Controlled: the
 * parent owns `inputValue` / `selectedKey`. Filtering is done here (case-
 * insensitive contains) so the list updates even as `items` grows asynchronously.
 */
export function Combobox({
  label,
  items,
  selectedKey,
  inputValue,
  onInputChange,
  onSelectionChange,
  onOpenChange,
  allowsCustomValue,
  placeholder,
  loadingText,
  emptyText,
  isLoading,
  maxResults = 100,
  className,
  inputStyle,
}: ComboboxProps) {
  const filtered = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    const selectedLabel = items.find((i) => i.id === selectedKey)?.label;
    // Empty query, or input still equal to the selection, shows the whole list
    // (so opening a chosen value lets you browse, not just see that one row).
    const list =
      !query || inputValue.trim() === selectedLabel
        ? items
        : items.filter((i) => i.label.toLowerCase().includes(query));
    return list.slice(0, maxResults);
  }, [items, inputValue, selectedKey, maxResults]);

  return (
    <AriaComboBox
      aria-label={label}
      items={filtered}
      selectedKey={selectedKey}
      inputValue={inputValue}
      onInputChange={onInputChange}
      onSelectionChange={(key) => onSelectionChange(key == null ? null : String(key))}
      onOpenChange={onOpenChange}
      allowsCustomValue={allowsCustomValue}
      menuTrigger="focus"
      className={cn("flex flex-col gap-1", className)}
    >
      <div className="relative flex items-center">
        <Input
          placeholder={placeholder}
          style={inputStyle}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            "h-10 w-full rounded-md border border-input bg-transparent px-3 pe-9 text-sm outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />
        <Button
          aria-label={label}
          className={cn(
            "absolute end-1 grid size-7 place-items-center rounded text-muted-foreground outline-none",
            "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <ChevronsUpDown className="size-4" />
        </Button>
      </div>
      <Popover
        className={cn(
          "z-50 max-h-64 w-[var(--trigger-width)] overflow-auto rounded-lg border border-border",
          "bg-popover p-1 text-popover-foreground shadow-lg outline-none",
        )}
      >
        <ListBox
          className="outline-none"
          renderEmptyState={() => (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {isLoading ? loadingText : emptyText}
            </div>
          )}
        >
          {(item: ComboboxItem) => (
            <ListBoxItem
              id={item.id}
              textValue={item.label}
              style={item.style}
              className={cn(
                "flex cursor-pointer select-none items-center rounded px-3 py-1.5 text-sm outline-none",
                "data-[focused]:bg-accent data-[selected]:bg-accent/60 data-[selected]:font-medium",
              )}
            >
              {item.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}
