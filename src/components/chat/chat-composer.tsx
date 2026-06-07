import { ArrowUp, CircleStop, ListEnd } from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatComposerProps {
  disabled?: boolean;
  isRunning?: boolean;
  placeholder?: string;
  onSend: (text: string) => void | Promise<void>;
  onQueue?: (text: string) => void | Promise<void>;
  onInterrupt?: (text: string) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}

export function ChatComposer({
  disabled = false,
  isRunning = false,
  placeholder,
  onSend,
  onQueue,
  onInterrupt,
  onStop,
}: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0 && !disabled;

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
      className="flex shrink-0 items-end gap-2 border-t bg-background p-3"
      onSubmit={handleSubmit}
    >
      <Textarea
        className="max-h-36 min-h-11 resize-none"
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
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
