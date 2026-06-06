import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DockNav, type Tab } from "@/components/nav/dock-nav";
import { PlayerBar } from "@/components/player/player-bar";
import { getSettings } from "@/db/repositories";
import { NowPlayingPage } from "@/pages/now-playing-page";
import { QueuePage } from "@/pages/queue-page";
import { SearchPage } from "@/pages/search-page";
import { SessionsPage } from "@/pages/sessions-page";
import { SettingsPage } from "@/pages/settings-page";
import { usePlayerStore } from "@/stores/player-store";

export default function App() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("sessions");
  const init = usePlayerStore((s) => s.init);
  const setActiveSession = usePlayerStore((s) => s.setActiveSession);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);

  // Boot: wire the media engine and resume the last set if there was one.
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

  // `reducedMotion="user"` makes every motion animation honor the OS
  // "reduce motion" setting app-wide, matching the view-transition helper.
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <img src="/muzero.svg" alt="" className="size-6" />
          <span className="font-semibold tracking-tight">MUZERO</span>
          <span className="ml-auto text-xs text-muted-foreground">{t("app.tagline")}</span>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
          {tab === "now" && <NowPlayingPage />}
          {tab === "queue" && <QueuePage />}
          {tab === "search" && <SearchPage />}
          {tab === "sessions" && <SessionsPage onStarted={() => setTab("now")} />}
          {tab === "settings" && <SettingsPage />}
        </main>

        {activeSessionId && <PlayerBar />}

        <DockNav value={tab} onChange={setTab} />
      </div>
    </MotionConfig>
  );
}
