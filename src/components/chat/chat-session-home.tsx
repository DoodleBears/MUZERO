import { Check, MessageSquare, Pencil, Search, X } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { parseChatMessages, parseQueuedPrompts } from "@/chat/dj-chat-sessions";
import type { ChatSession } from "@/chat/types";
import { Button } from "@/components/ui/button";
import { DeleteIcon } from "@/components/ui/delete";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ChatSessionHomeLabels {
  cancel: string;
  delete: string;
  empty: ReactNode;
  itemMeta: (input: { messageCount: number; queuedPromptCount: number }) => ReactNode;
  open: string;
  rename: string;
  saveRename: string;
  searchPlaceholder: string;
  title: ReactNode;
  titleInput: string;
  updatedAt: (updatedAt: number) => ReactNode;
}

interface ChatSessionHomeProps {
  activeSessionId?: string | null;
  className?: string;
  labels: ChatSessionHomeLabels;
  onDeleteSession?: (sessionId: string) => void;
  onOpenSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  sessions: ChatSession[];
}

export function ChatSessionHome({
  activeSessionId,
  className,
  labels,
  onDeleteSession,
  onOpenSession,
  onRenameSession,
  sessions,
}: ChatSessionHomeProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [titleDraft, setTitleDraft] = useState("");

  const visibleSessions = useMemo(
    () => sessions.filter((session) => sessionMatchesQuery(session, query)),
    [query, sessions],
  );

  function startRename(session: ChatSession) {
    setEditingSessionId(session.id);
    setTitleDraft(session.title);
  }

  function submitRename(event: FormEvent, sessionId: string) {
    event.preventDefault();
    onRenameSession?.(sessionId, titleDraft);
    setEditingSessionId(null);
    setTitleDraft("");
  }

  return (
    <section
      aria-labelledby="chat-session-home-title"
      className={cn("flex min-h-0 flex-1 flex-col gap-3 bg-background p-3", className)}
    >
      <div className="space-y-3">
        <h2 className="font-medium text-sm" id="chat-session-home-title">
          {labels.title}
        </h2>
        <div className="relative">
          <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label={labels.searchPlaceholder}
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.searchPlaceholder}
            type="search"
            value={query}
          />
        </div>
      </div>

      {visibleSessions.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-muted-foreground text-sm">
          {labels.empty}
        </p>
      ) : (
        <ol className="min-h-0 space-y-2 overflow-y-auto">
          {visibleSessions.map((session) => {
            const messages = parseChatMessages(session.messagesJson);
            const queuedPrompts = parseQueuedPrompts(session.queuedPromptsJson);
            const isEditing = editingSessionId === session.id;

            return (
              <li
                className={cn(
                  "rounded-lg border bg-muted/20 p-2",
                  activeSessionId === session.id && "border-primary bg-primary/5",
                )}
                data-testid={`chat-session-${session.id}`}
                key={session.id}
              >
                {isEditing ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(event) => submitRename(event, session.id)}
                  >
                    <Input
                      aria-label={labels.titleInput}
                      autoFocus
                      onChange={(event) => setTitleDraft(event.target.value)}
                      value={titleDraft}
                    />
                    <Button aria-label={labels.saveRename} size="icon-sm" type="submit">
                      <Check />
                    </Button>
                    <Button
                      aria-label={labels.cancel}
                      onClick={() => setEditingSessionId(null)}
                      size="icon-sm"
                      variant="outline"
                    >
                      <X />
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-start gap-2">
                    <Button
                      aria-current={activeSessionId === session.id ? "page" : undefined}
                      aria-label={labels.open}
                      className="h-auto min-w-0 flex-1 justify-start px-2 py-1.5"
                      onClick={() => onOpenSession?.(session.id)}
                      variant="ghost"
                    >
                      <MessageSquare />
                      <span className="min-w-0 truncate text-left">{session.title}</span>
                    </Button>
                    <Button
                      aria-label={labels.rename}
                      onClick={() => startRename(session)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      aria-label={labels.delete}
                      onClick={() => onDeleteSession?.(session.id)}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <DeleteIcon size={16} />
                    </Button>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-muted-foreground text-xs">
                  <span>{labels.updatedAt(session.updatedAt)}</span>
                  <span>
                    {labels.itemMeta({
                      messageCount: messages.length,
                      queuedPromptCount: queuedPrompts.length,
                    })}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function sessionMatchesQuery(session: ChatSession, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (session.title.toLowerCase().includes(needle)) return true;
  return parseChatMessages(session.messagesJson).some(
    (message) =>
      message.role === "user" &&
      message.parts.some(
        (part) => part.type === "text" && part.text.toLowerCase().includes(needle),
      ),
  );
}
