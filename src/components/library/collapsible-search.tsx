import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * A search affordance that starts as a single icon and expands into an input when
 * clicked (the input auto-focuses). It collapses back to the icon on blur while
 * empty; Escape clears + collapses. Value is controlled by the parent.
 *
 * Used by the detail-page toolbars (set / artist / album) to filter the visible
 * track list without taking up a full search row.
 */
export function CollapsibleSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Focus the field as soon as it expands (Input doesn't forward refs, so reach in).
  useEffect(() => {
    if (open) wrapRef.current?.querySelector("input")?.focus();
  }, [open]);

  if (!open && !value) {
    return (
      <Button variant="ghost" size="sm" aria-label={placeholder} onClick={() => setOpen(true)}>
        <Search className="size-4" />
      </Button>
    );
  }
  return (
    <div ref={wrapRef} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 w-44 pl-8 pr-7 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
            setOpen(false);
          }
        }}
        onBlur={() => {
          if (!value) setOpen(false);
        }}
      />
      {value && (
        <button
          type="button"
          // preventDefault keeps focus in the input, so clearing doesn't collapse it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange("")}
          aria-label={t("gallery.clearSearch")}
          className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
