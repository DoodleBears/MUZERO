"use client";

import { Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

export interface CommandItem {
  disabled?: boolean;
  id: string;
  keywords?: string[];
  label: string;
}

interface CommandProps {
  className?: string;
  empty: ReactNode;
  inputValue?: string;
  items: CommandItem[];
  maxResults?: number;
  onInputChange?: (value: string) => void;
  onSelect: (id: string) => void;
  placeholder: string;
  selectedId?: string | null;
}

export function Command({
  className,
  empty,
  inputValue,
  items,
  maxResults = 100,
  onInputChange,
  onSelect,
  placeholder,
  selectedId,
}: CommandProps) {
  const [uncontrolledInput, setUncontrolledInput] = useState("");
  const query = inputValue ?? uncontrolledInput;
  const filteredItems = useMemo(
    () => filterCommandItems(items, query).slice(0, maxResults),
    [items, maxResults, query],
  );

  function setQuery(value: string) {
    onInputChange?.(value);
    if (inputValue === undefined) setUncontrolledInput(value);
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-popover", className)}>
      <div className="flex items-center gap-2 border-border border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          aria-label={placeholder}
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          type="search"
          value={query}
        />
      </div>
      <div className="max-h-72 overflow-y-auto p-1" role="listbox">
        {filteredItems.length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground text-sm">{empty}</div>
        ) : (
          filteredItems.map((item) => (
            <button
              aria-disabled={item.disabled || undefined}
              aria-selected={selectedId === item.id}
              className={cn(
                "flex w-full cursor-pointer items-center rounded-md px-3 py-2 text-left text-sm outline-none",
                "hover:bg-accent focus-visible:bg-accent data-[selected=true]:bg-accent/60 data-[selected=true]:font-medium",
                item.disabled && "cursor-not-allowed opacity-50",
              )}
              data-selected={selectedId === item.id}
              disabled={item.disabled}
              key={item.id}
              onClick={() => onSelect(item.id)}
              role="option"
              type="button"
            >
              {item.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function filterCommandItems(items: readonly CommandItem[], query: string): CommandItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((item) =>
    [item.label, ...(item.keywords ?? [])].some((value) => value.toLowerCase().includes(needle)),
  );
}
