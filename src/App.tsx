import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { NowPlayingBackground } from "@/components/player/now-playing-background";
import { PlayerDock } from "@/components/shell/player-dock";
import { GlobalDropZone } from "@/components/upload/global-drop-zone";
import { getSettings, saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useIdle } from "@/hooks/use-idle";
import { usePlayerShortcuts } from "@/hooks/use-player-shortcuts";
import { cn } from "@/lib/utils";
import { NowPlayingPage } from "@/pages/now-playing-page";
import { QueuePage } from "@/pages/queue-page";
import { SearchPage } from "@/pages/search-page";
import { SessionsPage } from "@/pages/sessions-page";
import { SettingsPage } from "@/pages/settings-page";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";

// Resume the last session at most once per page load. React StrictMode mounts
// the app twice in dev, so two resume passes interleave and race (the second
// setActiveSession clears the queue mid-flight, dropping the cue and leaving the
// dock empty). A module flag survives the StrictMode remount (a ref wouldn't).
let bootResumed = false;

export default function App() {
  // Active tab is persisted (nav-store) so the app reopens on the last page.
  const tab = useNavStore((s) => s.tab);
  const setTab = useNavStore((s) => s.setTab);
  const init = usePlayerStore((s) => s.init);
  const setActiveSession = usePlayerStore((s) => s.setActiveSession);
  const settings = useSettings();
  // Global transport shortcuts: Space/⌘P · ←→/AD · Shift±5s · ↑↓ volume · ⌘R · R.
  usePlayerShortcuts();

  // Boot: wire the media engine, resume the last set, and cue one track without
  // autoplay. WebKit needs the media src prepared before the later click gesture;
  // the heavy Now Playing image/waveform work is kept out of boot elsewhere.
  useEffect(() => {
    init();
    if (bootResumed) return;
    bootResumed = true;
    void (async () => {
      const s = await getSettings();
      if (!s.lastSessionId) return;
      await setActiveSession(s.lastSessionId);
      const store = usePlayerStore.getState();
      if (store.queue.length === 0) return;
      const idx =
        typeof s.lastTrackIndex === "number" && s.lastTrackIndex >= 0 ? s.lastTrackIndex : 0;
      if (idx < store.queue.length) await store.cueIndex(idx);
    })();
  }, [init, setActiveSession]);

  // Remember the last-played track so the next launch resumes it.
  useEffect(
    () =>
      usePlayerStore.subscribe((state, prev) => {
        if (state.currentIndex !== prev.currentIndex && state.currentIndex >= 0) {
          void saveSettings({ lastTrackIndex: state.currentIndex });
        }
      }),
    [],
  );

  // Now Playing is the immersive surface: the slideshow fills the whole viewport
  // (behind header + dock), and after a few idle seconds the chrome fades away.
  const immersive = tab === "now";
  // One idle signal. Chrome-hiding is gated by the immersiveIdle setting.
  const idle = useIdle(immersive);
  const chromeHidden = idle && (settings.immersiveIdle ?? true);

  // `reducedMotion="user"` makes every motion animation honor the OS
  // "reduce motion" setting app-wide, matching the view-transition helper.
  return (
    <MotionConfig reducedMotion="user">
      {/* The header + dock are fixed overlays (z-30) that truly float over the
          full-bleed content (and the Now Playing slideshow). `main` fills the
          whole viewport and reserves no band; each page's own scroll region pads
          itself by the chrome heights (--spacing-chrome-*), so content fills the
          screen and scrolls *under* the bars instead of being boxed between them. */}
      <div className="relative h-screen overflow-hidden bg-background text-foreground">
        <NowPlayingBackground
          className={cn(
            "fixed inset-0 z-0 transition-opacity duration-500",
            immersive ? "opacity-100" : "opacity-0",
          )}
        />

        <header
          // Draggable on desktop (Tauri overlay titlebar); transparent while
          // immersive, translucent elsewhere. The wordmark is centered, so it clears
          // the macOS traffic lights without needing a left inset.
          data-tauri-drag-region
          className={cn(
            "fixed inset-x-0 top-0 z-30 flex items-center justify-center px-4 py-3 transition-opacity duration-500",
            immersive ? "" : "bg-background/80",
            chromeHidden && "pointer-events-none opacity-0",
          )}
        >
          <span className="font-semibold tracking-tight">MUZERO</span>
        </header>

        <main className="absolute inset-0 z-10 overflow-hidden">
          {tab === "now" && <NowPlayingPage />}
          {tab === "queue" && <QueuePage />}
          {tab === "search" && <SearchPage />}
          {tab === "sessions" && <SessionsPage onStarted={() => setTab("now")} />}
          {tab === "settings" && <SettingsPage />}
        </main>

        <PlayerDock
          tab={tab}
          onTabChange={setTab}
          onOpenNowPlaying={() => setTab("now")}
          hidden={chromeHidden}
        />

        {/* App-wide drag-and-drop + paste: media → import; image → cover/background/gallery. */}
        <GlobalDropZone onMediaUploaded={(createdSet) => createdSet && setTab("queue")} />
      </div>
    </MotionConfig>
  );
}
