import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * One mapping target field: a template `{{ … }}` input plus a live preview of
 * what that template resolves to against the currently-selected sample payload
 * (or the resolution error). The preview uses the same engine that runs at
 * intake time, so what the user sees here is what will run.
 */
export function TargetFieldInput({
  label,
  required,
  value,
  placeholder,
  previewValue,
  previewError,
  isFocused,
  onChange,
  onFocus,
  onBlur,
}: {
  label: string;
  required?: boolean;
  value: string;
  placeholder?: string;
  previewValue?: unknown;
  previewError?: string;
  isFocused?: boolean;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const hasPreview = previewValue !== undefined && previewValue !== null && previewValue !== "";
  const previewText =
    typeof previewValue === "object" ? JSON.stringify(previewValue) : String(previewValue ?? "");

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-muted-foreground text-xs">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        className={cn("font-mono text-xs", isFocused && "ring-2 ring-ring")}
      />
      {previewError ? (
        <span className="truncate text-[10px] text-destructive">{previewError}</span>
      ) : (
        <span
          className={cn(
            "truncate text-[10px]",
            hasPreview ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/60",
          )}
        >
          {hasPreview ? `→ ${previewText}` : "—"}
        </span>
      )}
    </div>
  );
}
