import type { KeyboardEvent } from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** A `/`-triggered action surfaced in a composer (e.g. start a new session). */
export interface SlashCommand {
  /** Trigger token shown after the slash, e.g. "new" → "/new". */
  id: string;
  /** Human label / hint shown beside the trigger in the menu. */
  label: string;
  run: () => void | Promise<void>;
}

/**
 * Shared `/`-command state for any text input (the expanded composer textarea AND
 * the collapsed dock chip). The menu is open while the draft is a single `/token`
 * (no space yet) with at least one match; Escape dismisses it until the next
 * keystroke. `onKeyDown` returns true when it consumed the event so the caller
 * can stop (don't also send / submit the form).
 */
export function useSlashCommands(
  draft: string,
  commands: SlashCommand[] = [],
  onConsume?: () => void,
) {
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const query =
    commands.length > 0 && draft.startsWith("/") && !draft.includes(" ")
      ? draft.slice(1).toLowerCase()
      : null;
  const matches =
    query === null
      ? []
      : commands.filter(
          (c) => c.id.toLowerCase().includes(query) || c.label.toLowerCase().includes(query),
        );
  const open = matches.length > 0 && !dismissed;
  const activeIndex = Math.min(highlight, Math.max(0, matches.length - 1));

  async function run(command: SlashCommand) {
    onConsume?.();
    setDismissed(false);
    setHighlight(0);
    await command.run();
  }

  /** Call on every draft change so an Escape-dismissed menu reopens on input. */
  function notifyChange() {
    setDismissed(false);
    setHighlight(0);
  }

  function onKeyDown(event: KeyboardEvent): boolean {
    if (!open) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void run(matches[activeIndex]);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(true);
      return true;
    }
    return false;
  }

  return { open, matches, activeIndex, setHighlight, run, onKeyDown, notifyChange };
}

/** The floating `/`-command list. Positioned by the caller via `className`. */
export function SlashMenu({
  matches,
  activeIndex,
  onHighlight,
  onRun,
  className,
}: {
  matches: SlashCommand[];
  activeIndex: number;
  onHighlight: (index: number) => void;
  onRun: (command: SlashCommand) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "absolute bottom-full z-30 mb-1 max-h-48 overflow-y-auto rounded-lg border bg-popover py-1 shadow-md",
        className,
      )}
      role="listbox"
    >
      {matches.map((command, index) => (
        <button
          aria-selected={index === activeIndex}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
            index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          )}
          key={command.id}
          onClick={() => onRun(command)}
          onMouseEnter={() => onHighlight(index)}
          role="option"
          type="button"
        >
          <span className="font-medium">/{command.id}</span>
          <span className="text-muted-foreground text-xs">{command.label}</span>
        </button>
      ))}
    </div>
  );
}
