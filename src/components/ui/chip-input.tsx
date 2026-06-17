import { X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { cn } from "@/lib/utils";

export interface ChipInputProps {
  /** Current chips. De-duplicated + trimmed by the component before `onChange`. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** aria-label for each chip's remove button; receives the chip text. */
  removeLabel?: (chip: string) => string;
  className?: string;
  disabled?: boolean;
}

/**
 * Tokenized text input: type a value, press Enter to commit it as a removable
 * chip. Backspace on an empty field removes the last chip. Values are trimmed
 * and de-duplicated (case-sensitive). A reusable replacement for comma-joined
 * string fields (e.g. live-request command prefixes) — see CLAUDE.md.
 */
export function ChipInput({
  value,
  onChange,
  placeholder,
  removeLabel,
  className,
  disabled,
}: ChipInputProps) {
  const [draft, setDraft] = useState("");

  function commit(raw = draft) {
    const next = raw.trim();
    setDraft("");
    if (!next || value.includes(next)) return;
    onChange([...value, next]);
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !draft && value.length) {
      event.preventDefault();
      removeAt(value.length - 1);
    }
  }

  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 text-sm focus-within:ring-2 focus-within:ring-ring",
        disabled && "opacity-50",
        className,
      )}
    >
      {value.map((chip, index) => (
        <span
          key={chip}
          className="flex h-7 items-center gap-1 rounded-full border border-border bg-card/55 px-2.5 text-xs"
        >
          {chip}
          <button
            type="button"
            disabled={disabled}
            onClick={() => removeAt(index)}
            aria-label={removeLabel?.(chip)}
          >
            <X className="size-3 text-muted-foreground hover:text-foreground" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit()}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="h-7 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
