import { Disc3, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { createSession } from "@/db/repositories";
import { useSessions } from "@/hooks/use-app-data";
import { cn, formatDuration } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

const SEED_IDEAS = [
  "late-night lo-fi for deep focus coding",
  "sunrise synthwave road trip",
  "rainy-day jazzy neo-soul",
  "high-energy drum & bass workout",
];

/** Pick or start a DJ set. Each set is a continuous, self-extending playlist. */
export function SessionsPage({ onStarted }: { onStarted: () => void }) {
  const sessions = useSessions();
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);
  const setActiveSession = usePlayerStore((s) => s.setActiveSession);
  const [seed, setSeed] = useState("");

  async function start(seedPrompt: string) {
    const trimmed = seedPrompt.trim();
    if (!trimmed) return;
    const session = await createSession({ seedPrompt: trimmed });
    await setActiveSession(session.id);
    setSeed("");
    onStarted();
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">Start a new set</h2>
        <Textarea
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="Describe the vibe… e.g. ‘late-night lo-fi for deep focus’"
          className="mb-3"
        />
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SEED_IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setSeed(idea)}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              {idea}
            </button>
          ))}
        </div>
        <Button className="w-full" disabled={!seed.trim()} onClick={() => void start(seed)}>
          <Plus /> Start DJ set
        </Button>
      </Card>

      {sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your sets
          </h3>
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => void setActiveSession(session.id).then(onStarted)}
              className={cn(
                "flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent",
                session.id === activeSessionId && "border-primary/50 bg-accent",
              )}
            >
              <Disc3
                className={cn("size-5 shrink-0", session.id === activeSessionId && "text-primary")}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{session.name}</div>
                <div className="truncate text-xs text-muted-foreground">{session.seedPrompt}</div>
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {session.trackIds.length} · ~
                {formatDuration(session.trackIds.length * session.config.targetDurationSec)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
