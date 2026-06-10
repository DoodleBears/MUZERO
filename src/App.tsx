import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ImmersiveMemoryOverlay } from "@/components/player/immersive-memory-overlay";
import { NowPlayingBackground } from "@/components/player/now-playing-background";
import { VisualizerTuningPanel } from "@/components/player/visualizer-tuning-panel";
import { GlobalTrackSearch } from "@/components/search/global-track-search";
import { PlayerDock } from "@/components/shell/player-dock";
import { GlobalDropZone } from "@/components/upload/global-drop-zone";
import { useSettings } from "@/hooks/use-app-data";
import { useIdle } from "@/hooks/use-idle";
import { useShortcutDispatch } from "@/hooks/use-shortcut-dispatch";
import { cn } from "@/lib/utils";
import { NowPlayingPage } from "@/pages/now-playing-page";
import { QueuePage } from "@/pages/queue-page";
import { SearchPage } from "@/pages/search-page";
import { SessionsPage } from "@/pages/sessions-page";
import { SettingsPage } from "@/pages/settings-page";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { startSyncIndicator } from "@/stores/sync-indicator";
import { useUiStore } from "@/stores/ui-store";
import { useVisualizerPanelStore } from "@/stores/visualizer-panel-store";
import { resolveVisualizerStyle } from "@/visualizer/registry";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function isGlobalSearchShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && key === "f") return true;
  return key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target);
}

function hasModalDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}

export default function App() {
  // Active tab is persisted (nav-store) so the app reopens on the last page.
  const tab = useNavStore((s) => s.tab);
  const setTab = useNavStore((s) => s.setTab);
  const init = usePlayerStore((s) => s.init);
  const hasAmbientTrack = usePlayerStore(
    (s) => s.currentIndex >= 0 && Boolean(s.queue[s.currentIndex]),
  );
  const [trackSearchOpen, setTrackSearchOpen] = useState(false);
  const fullscreenRestoreRef = useRef<{ element: HTMLElement; until: number } | null>(null);
  const settings = useSettings();
  // Global keyboard shortcuts (transport + tab nav), resolved through the
  // configurable registry so user overrides take effect live.
  useShortcutDispatch();

  // Boot only wires the media engine. Auto-cueing the previous track during
  // WKWebView startup can make the full-screen media/background path flicker.
  useEffect(() => {
    init();
  }, [init]);

  // Surface background sync (folder import + R2) as a persistent, cancelable toast.
  useEffect(() => {
    startSyncIndicator();
  }, []);

  // Desktop: re-scan remembered local-import folders for new files shortly after
  // boot. Deferred so it never blocks first paint / WKWebView startup; the action
  // self-guards (no-op in the browser or when no folders are remembered).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void usePlayerStore.getState().syncImportFolders();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isGlobalSearchShortcut(e)) return;
      e.preventDefault();
      setTrackSearchOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !hasModalDialogOpen()) return;
      const fullscreenElement = document.fullscreenElement;
      if (fullscreenElement instanceof HTMLElement) {
        fullscreenRestoreRef.current = {
          element: fullscreenElement,
          until: performance.now() + 1200,
        };
      }
      e.preventDefault();
      if (trackSearchOpen) {
        e.stopImmediatePropagation();
        setTrackSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDownCapture, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDownCapture, { capture: true });
  }, [trackSearchOpen]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const pending = fullscreenRestoreRef.current;
      if (document.fullscreenElement || !pending) return;
      fullscreenRestoreRef.current = null;
      if (performance.now() > pending.until) return;
      void pending.element.requestFullscreen().catch(() => undefined);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // The current-track ambience is the app's stage, not a page-local decoration:
  // non-Now tabs float their content above the same background instead of
  // tearing it down on every navigation change.
  const isNowTab = tab === "now";
  const ambientActive = isNowTab || hasAmbientTrack;
  // One idle signal. Chrome-hiding is gated by the immersiveIdle setting.
  const idle = useIdle(isNowTab);
  const visualizerBackgroundActive =
    ambientActive &&
    (settings.visualizerAsBackground ?? false) &&
    resolveVisualizerStyle(settings.visualizerStyle) !== "off";
  const visualizerIdleOnly =
    idle && visualizerBackgroundActive && (settings.visualizerIdleOnly ?? false);
  const chromeHidden = idle && ((settings.immersiveIdle ?? true) || visualizerIdleOnly);
  const visualizerPreviewOnly = useVisualizerPanelStore((s) => s.previewOnly);
  const visualizerHidden = useVisualizerPanelStore((s) => s.visualizerHidden);
  const foregroundHidden = visualizerPreviewOnly || visualizerIdleOnly;
  // In full-immersive (only background + spectrum, foreground rail hidden) surface
  // memories as a top popover instead — see the immersive-memory-moments PRD.
  const immersiveMemoryActive = visualizerIdleOnly && (settings.immersiveMemoryOverlay ?? true);

  // Mirror the chrome-hidden signal so deep surfaces (e.g. the lyrics search
  // affordance) can fade in sync with the Dock during immersive idle.
  useEffect(() => {
    useUiStore.getState().setChromeHidden(chromeHidden || foregroundHidden);
  }, [chromeHidden, foregroundHidden]);

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
          active={ambientActive}
          hideVisualizer={visualizerHidden}
          className={cn(
            "fixed inset-0 z-0 transition-opacity duration-500",
            ambientActive ? "opacity-100" : "opacity-0",
          )}
        />

        <header
          // Draggable on desktop (Tauri overlay titlebar); transparent over the
          // ambient playback stage, translucent only on the plain app background.
          // The wordmark is centered, so it clears the macOS traffic lights
          // without needing a left inset.
          data-tauri-drag-region
          className={cn(
            // `-webkit-app-region:drag` makes the header drag the Electron frameless
            // window; `data-tauri-drag-region` does the same under Tauri (both inert
            // on the other shell + the web build).
            "fixed inset-x-0 top-0 z-30 flex items-center justify-center px-4 py-3 transition-opacity duration-500 [-webkit-app-region:drag]",
            ambientActive ? "" : "bg-background/80",
            (chromeHidden || foregroundHidden) && "pointer-events-none opacity-0",
          )}
        >
          <span className="font-semibold tracking-tight">MUZERO</span>
        </header>

        <main className="chrome-fade absolute inset-0 z-10 overflow-hidden [--chrome-fade-bottom:calc(var(--spacing-chrome-bottom)/2)] [--chrome-fade-top:3rem]">
          {tab === "now" && <NowPlayingPage foregroundHidden={foregroundHidden} />}
          {tab === "queue" && (
            <AmbientPageOverlay active={ambientActive}>
              <QueuePage />
            </AmbientPageOverlay>
          )}
          {tab === "search" && (
            <AmbientPageOverlay active={ambientActive}>
              <SearchPage />
            </AmbientPageOverlay>
          )}
          {tab === "sessions" && (
            <AmbientPageOverlay active={ambientActive}>
              <SessionsPage onStarted={() => setTab("now")} />
            </AmbientPageOverlay>
          )}
          {tab === "settings" && (
            <AmbientPageOverlay active={ambientActive}>
              <SettingsPage />
            </AmbientPageOverlay>
          )}
        </main>

        <PlayerDock
          tab={tab}
          onTabChange={setTab}
          onOpenNowPlaying={() => setTab("now")}
          hidden={chromeHidden || foregroundHidden}
        />

        {immersiveMemoryActive && <ImmersiveMemoryOverlay />}

        <VisualizerTuningPanel />

        <GlobalTrackSearch open={trackSearchOpen} onOpenChange={setTrackSearchOpen} />

        {/* App-wide drag-and-drop + paste: media → import; image → cover/background/gallery. */}
        <GlobalDropZone onMediaUploaded={(createdSet) => createdSet && setTab("queue")} />
      </div>
    </MotionConfig>
  );
}

function AmbientPageOverlay({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      className={cn(
        "h-full transition-colors duration-500",
        active && "bg-background/45 backdrop-blur-[2px]",
      )}
    >
      {children}
    </div>
  );
}
