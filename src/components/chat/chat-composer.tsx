import { ArrowUp, CircleStop, ListEnd } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type SlashCommand, SlashMenu, useSlashCommands } from "./slash-commands";

export type { SlashCommand };

/** Grow the composer from one line up to this many, then scroll internally. */
const MAX_ROWS = 3;

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

  const slash = useSlashCommands(draft, slashCommands, () => setDraft(""));

  function updateDraft(next: string) {
    setDraft(next);
    slash.notifyChange();
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
    // The slash menu takes over arrow/Enter/Escape while open.
    if (slash.onKeyDown(event)) return;
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
      {slash.open && (
        <SlashMenu
          activeIndex={slash.activeIndex}
          className="inset-x-3"
          matches={slash.matches}
          onHighlight={slash.setHighlight}
          onRun={slash.run}
        />
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
