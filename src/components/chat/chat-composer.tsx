import { ArrowUp, CircleStop } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatComposerProps {
  disabled?: boolean;
  isRunning?: boolean;
  placeholder?: string;
  onSend: (text: string) => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}

export function ChatComposer({
  disabled = false,
  isRunning = false,
  placeholder,
  onSend,
  onStop,
}: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0 && !disabled;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    const text = draft;
    setDraft("");
    await onSend(text);
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
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void handleSubmit(event);
          }
        }}
        placeholder={placeholder}
        value={draft}
      />
      {isRunning && !draft.trim() ? (
        <Button aria-label="Stop" onClick={() => void onStop?.()} size="icon" variant="outline">
          <CircleStop />
        </Button>
      ) : (
        <Button aria-label="Send" disabled={!canSend} size="icon" type="submit">
          <ArrowUp />
        </Button>
      )}
    </form>
  );
}
