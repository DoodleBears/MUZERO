import { ArrowUp, CircleStop, ListEnd } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Grow the composer from one line up to this many, then scroll internally. */
const MAX_ROWS = 3;

/** A `/`-triggered action surfaced in the composer (e.g. start a new session). */
export interface SlashCommand {
  /** Trigger token shown after the slash, e.g. "new" → "/new". */
  id: string;
  /** Human label / hint shown beside the trigger in the menu. */
  label: string;
  run: () => void | Promise<void>;
}

interface ChatComposerProps {
  disabled?: boolean;
  isRunning?: boolean;
  placeholder?: string;
  /** Optional controlled draft (so an empty-state chip can inject text). */
  value?: string;
  onValueChange?: (value: string) => void;
  onSend: (text: string) => void | Promise<void>;
  onQueue?: (text: string) => void | Promise<void>;
  onInterrupt?: (text: string) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  /** `/`-commands offered when the draft starts with a slash. */
  slashCommands?: SlashCommand[];
}

export function ChatComposer({
  disabled = false,
  isRunning = false,
  placeholder,
  value,
  onValueChange,
  onSend,
  onQueue,
  onInterrupt,
  onStop,
  slashCommands = [],
}: ChatComposerProps) {
  const [internalDraft, setInternalDraft] = useState("");
  const draft = value ?? internalDraft;
  const setDraft = (next: string) => (onValueChange ? onValueChange(next) : setInternalDraft(next));
  const canSend = draft.trim().length > 0 && !disabled;

  // Slash menu: open while the draft is a single `/token` (no space yet) and at
  // least one command matches. Escape dismisses until the next keystroke.
  const [highlight, setHighlight] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const slashQuery =
    slashCommands.length > 0 && draft.startsWith("/") && !draft.includes(" ")
      ? draft.slice(1).toLowerCase()
      : null;
  const slashMatches =
    slashQuery === null
      ? []
      : slashCommands.filter(
          (c) =>
            c.id.toLowerCase().includes(slashQuery) || c.label.toLowerCase().includes(slashQuery),
        );
  const slashOpen = slashMatches.length > 0 && !menuDismissed;
  const activeIndex = Math.min(highlight, slashMatches.length - 1);

  function updateDraft(next: string) {
    setDraft(next);
    setMenuDismissed(false);
    setHighlight(0);
  }

  async function runSlash(command: SlashCommand) {
    setDraft("");
    setMenuDismissed(false);
    setHighlight(0);
    await command.run();
  }

  // Autosize: one line by default, grow with wrapped/newline content up to
  // MAX_ROWS, then scroll inside. Reset to `auto` first so it can also shrink.
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `draft` is the resize trigger (content changed), even though the effect reads height from the DOM, not from draft.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const styles = getComputedStyle(el);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const paddingY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    const maxHeight = lineHeight * MAX_ROWS + paddingY;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft]);

  async function submitDraft(action: "send" | "queue" | "interrupt") {
    if (!canSend) return;
    const text = draft;
    setDraft("");
    if (action === "interrupt" && onInterrupt) {
      await onInterrupt(text);
      return;
    }
    if (action === "queue" && onQueue) {
      await onQueue(text);
      return;
    }
    await onSend(text);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await submitDraft(isRunning ? "queue" : "send");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Slash menu navigation takes over the arrow/Enter/Escape keys while open.
    if (slashOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((h) => (h + 1) % slashMatches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight((h) => (h - 1 + slashMatches.length) % slashMatches.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void runSlash(slashMatches[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuDismissed(true);
        return;
      }
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if ((event.metaKey || event.ctrlKey) && isRunning) {
      void submitDraft("interrupt");
      return;
    }
    void submitDraft(isRunning ? "queue" : "send");
  }

  return (
    <form
      className="relative flex shrink-0 items-end gap-2 border-t bg-background p-3"
      onSubmit={handleSubmit}
    >
      {slashOpen && (
        <div
          className="absolute inset-x-3 bottom-full z-20 mb-1 max-h-48 overflow-y-auto rounded-lg border bg-popover py-1 shadow-md"
          role="listbox"
        >
          {slashMatches.map((command, index) => (
            <button
              aria-selected={index === activeIndex}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
              key={command.id}
              onClick={() => void runSlash(command)}
              onMouseEnter={() => setHighlight(index)}
              role="option"
              type="button"
            >
              <span className="font-medium">/{command.id}</span>
              <span className="text-muted-foreground text-xs">{command.label}</span>
            </button>
          ))}
        </div>
      )}
      <Textarea
        className="min-h-0 resize-none overflow-y-hidden"
        disabled={disabled}
        onChange={(event) => updateDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={textareaRef}
        rows={1}
        value={draft}
      />
      {isRunning && !draft.trim() ? (
        <Button aria-label="Stop" onClick={() => void onStop?.()} size="icon" variant="outline">
          <CircleStop />
        </Button>
      ) : isRunning ? (
        <Button aria-label="Queue" disabled={!canSend} size="icon" type="submit">
          <ListEnd />
        </Button>
      ) : (
        <Button aria-label="Send" disabled={!canSend} size="icon" type="submit">
          <ArrowUp />
        </Button>
      )}
    </form>
  );
}
