import { ListMusic, Radio, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { PlayerBar } from "@/components/player/player-bar";
import { getSettings } from "@/db/repositories";
import { cn } from "@/lib/utils";
import { NowPlayingPage } from "@/pages/now-playing-page";
import { QueuePage } from "@/pages/queue-page";
import { SessionsPage } from "@/pages/sessions-page";
import { SettingsPage } from "@/pages/settings-page";
import { usePlayerStore } from "@/stores/player-store";

type Tab = "now" | "queue" | "sessions" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Radio }[] = [
  { id: "now", label: "Now", icon: Radio },
  { id: "queue", label: "Queue", icon: ListMusic },
  { id: "sessions", label: "Sets", icon: Sparkles },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("sessions");
  const init = usePlayerStore((s) => s.init);
  const setActiveSession = usePlayerStore((s) => s.setActiveSession);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);

  // Boot: wire the audio engine and resume the last set if there was one.
  useEffect(() => {
    init();
    void (async () => {
      const settings = await getSettings();
      if (settings.lastSessionId) {
        await setActiveSession(settings.lastSessionId);
        setTab("now");
      }
    })();
  }, [init, setActiveSession]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <img src="/muzero.svg" alt="" className="size-6" />
        <span className="font-semibold tracking-tight">MUZERO</span>
        <span className="ml-auto text-xs text-muted-foreground">AI DJ · local-first</span>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === "now" && <NowPlayingPage />}
        {tab === "queue" && <QueuePage />}
        {tab === "sessions" && <SessionsPage onStarted={() => setTab("now")} />}
        {tab === "settings" && <SettingsPage />}
      </main>

      {activeSessionId && <PlayerBar />}

      <nav className="flex border-t border-border bg-card">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] transition-colors",
              tab === id ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
