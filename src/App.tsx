import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DevPerfPanel } from "@/components/dev/dev-perf-panel";
import { ChangelogModal } from "@/components/player/changelog-modal";
import { ImmersiveLyricsOverlay } from "@/components/player/immersive-lyrics-overlay";
import { ImmersiveMemoryOverlay } from "@/components/player/immersive-memory-overlay";
import { LyricsTuningPanel } from "@/components/player/lyrics-tuning-panel";
import { NowPlayingBackground } from "@/components/player/now-playing-background";
import { useVisualizerCoverColorCss } from "@/components/player/visualizer-dynamic-color";
import { VisualizerTuningPanel } from "@/components/player/visualizer-tuning-panel";
import { GlobalTrackSearch } from "@/components/search/global-track-search";
import { HeaderPinButton } from "@/components/shell/header-pin-button";
import { PlayerDock } from "@/components/shell/player-dock";
import { WindowsWindowControls } from "@/components/shell/windows-window-controls";
import { GlobalDropZone } from "@/components/upload/global-drop-zone";
import { useSettings } from "@/hooks/use-app-data";
import { useAppIcon } from "@/hooks/use-app-icon";
import { useDockIdle } from "@/hooks/use-dock-idle";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useIdle } from "@/hooks/use-idle";
import { usePlaybackWarmup } from "@/hooks/use-playback-warmup";
import { useShortcutDispatch } from "@/hooks/use-shortcut-dispatch";
import { useSystemShortcuts } from "@/hooks/use-system-shortcuts";
import { albumCoverAppearanceCssVars } from "@/lib/album-cover-appearance";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { electronWindowAppearanceCssVars } from "@/lib/electron-window-appearance";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { dragWindowOnEmptyPress } from "@/lib/window-drag";
import { NowPlayingPage } from "@/pages/now-playing-page";
import { QueuePage } from "@/pages/queue-page";
import { SearchPage } from "@/pages/search-page";
import { SessionsPage } from "@/pages/sessions-page";
import { SettingsPage } from "@/pages/settings-page";
import { buildSystemShortcutRegistrations } from "@/shortcuts/system-global";
import { startCloudAutoSyncScheduler } from "@/stores/cloud-auto-sync";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { startSyncIndicator } from "@/stores/sync-indicator";
import { useUiStore } from "@/stores/ui-store";
import { useVisualizerPanelStore } from "@/stores/visualizer-panel-store";
import { useTraySync } from "@/tray/use-tray-sync";
import { resolveVisualizerPlacement } from "@/visualizer/placement";

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
  const systemShortcutRegistrations = useMemo(
    () => buildSystemShortcutRegistrations(settings.systemShortcutBindings),
    [settings.systemShortcutBindings],
  );
  // Global keyboard shortcuts (transport + tab nav), resolved through the
  // configurable registry so user overrides take effect live.
  useShortcutDispatch();
  useSystemShortcuts({
    enabled: settings.systemShortcutsEnabled === true,
    registrations: systemShortcutRegistrations,
  });
  // Browser tab title tracks the current track: `Title · Artist · Album | MUZERO`.
  useDocumentTitle();
  // Apply the chosen desktop app icon (Electron only; no-op on web/tauri).
  useAppIcon();
  // Keep the native tray menu aligned with current playback state (Electron only).
  useTraySync();
  // Keep the next transport targets warm so keyboard/button skips don't paint
  // empty cover/background states while local blobs or R2 bytes resolve.
  usePlaybackWarmup();
  useDesktopChromeDataset();
  useAppearanceCssVars(settings);
  useDesktopWindowPinMode(settings);

  // Boot only wires the media engine. Auto-cueing the previous track during
  // WKWebView startup can make the full-screen media/background path flicker.
  useEffect(() => {
    init();
  }, [init]);

  // Surface background sync (folder import + R2) as a persistent, cancelable toast.
  useEffect(() => {
    startSyncIndicator();
  }, []);

  // Visible per-drive R2 auto-sync scheduler. It delegates to the same
  // orchestrated Sync now path and self-guards per drive.
  useEffect(() => startCloudAutoSyncScheduler(), []);

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
  const ambientBackgroundActive = hasAmbientTrack;
  // Global idle still drives Now Playing foreground/visualizer state. The Dock
  // gets its own idle rule below so wide screens can reveal it from a bottom hot
  // zone instead of from any tiny pointer movement.
  const idle = useIdle(isNowTab);
  const visualizerPlacement = resolveVisualizerPlacement(settings);
  const visualizerBackgroundActive = ambientBackgroundActive && visualizerPlacement !== "off";
  const lyricsOnlyIdle =
    idle && isNowTab && visualizerBackgroundActive && visualizerPlacement === "lyrics";
  const visualizerIdleOnly = idle && visualizerBackgroundActive && visualizerPlacement === "idle";
  const chromeHidden =
    idle && ((settings.immersiveIdle ?? true) || visualizerIdleOnly || lyricsOnlyIdle);
  const dockIdleEnabled =
    isNowTab &&
    ((settings.immersiveIdle ?? true) ||
      (visualizerBackgroundActive &&
        (visualizerPlacement === "idle" || visualizerPlacement === "lyrics")));
  const dockIdleHidden = useDockIdle(dockIdleEnabled);
  const visualizerPreviewOnly = useVisualizerPanelStore((s) => s.previewOnly);
  const visualizerHidden = useVisualizerPanelStore((s) => s.visualizerHidden);
  const foregroundHidden = visualizerPreviewOnly || visualizerIdleOnly || lyricsOnlyIdle;
  const dockHidden = dockIdleHidden || foregroundHidden;
  // In full-immersive (only background + spectrum, foreground rail hidden) surface
  // memories as a top popover instead — see the immersive-memory-moments PRD.
  const immersiveMemoryActive =
    visualizerIdleOnly && !lyricsOnlyIdle && (settings.immersiveMemoryOverlay ?? true);
  // Lyrics-on + foreground hidden → centered lyrics over the background. The
  // normal visible-page lyrics layout remains cover-left / lyrics-right.
  const lyricsVisible = !settings.nowPlayingRightRailCollapsed;
  const immersiveLyricsActive = lyricsOnlyIdle || (foregroundHidden && lyricsVisible);
  const ambientBackdropActive = ambientBackgroundActive && !lyricsOnlyIdle;

  // Mirror the Dock-hidden signal so deep surfaces (e.g. the lyrics search
  // affordance) can fade in sync with the Dock during immersive idle.
  useEffect(() => {
    useUiStore.getState().setChromeHidden(dockHidden);
  }, [dockHidden]);
  useLyricsOnlyOverlayDataset(lyricsOnlyIdle);

  // MUZERO keeps its playback-oriented motion alive regardless of the OS
  // reduced-motion setting; animation is part of the player feedback model.
  return (
    <MotionConfig reducedMotion="never">
      {/* The header + dock are fixed overlays (z-30) that truly float over the
          full-bleed content (and the Now Playing slideshow). `main` fills the
          whole viewport and reserves no band; each page's own scroll region pads
          itself by the chrome heights (--spacing-chrome-*), so content fills the
          screen and scrolls *under* the bars instead of being boxed between them. */}
      <div className="app-shell relative h-screen overflow-hidden bg-background text-foreground">
        <NowPlayingBackground
          active={ambientBackdropActive}
          hideVisualizer={visualizerHidden}
          className={cn(
            "fixed inset-0 z-0 transition-opacity duration-500",
            ambientBackdropActive ? "opacity-100" : "opacity-0",
          )}
        />

        <header
          // Draggable on desktop (Tauri overlay titlebar); transparent over the
          // ambient playback stage, translucent only on the plain app background.
          // The wordmark is centered, so it clears the macOS traffic lights
          // without needing a left inset.
          data-tauri-drag-region
          className={cn(
            // The transparent drag layer below owns Electron's frameless drag area.
            // Keeping the header itself no-drag prevents the Windows controls from
            // being swallowed by Chromium's app-region hit testing.
            "app-titlebar fixed inset-x-0 top-0 z-30 flex items-center justify-center px-4 py-3 transition-opacity duration-500 [-webkit-app-region:no-drag]",
            ambientActive ? "" : "bg-background/80",
            (chromeHidden || foregroundHidden) && "pointer-events-none opacity-0",
          )}
        >
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 right-36 [-webkit-app-region:drag]"
            data-tauri-drag-region
          />
          <div
            className="group/header-logo relative z-10 flex items-center justify-center [-webkit-app-region:no-drag]"
            data-no-drag
          >
            <button
              aria-label="MUZERO"
              className="cursor-default border-0 bg-transparent p-0 font-semibold tracking-tight text-inherit [-webkit-app-region:no-drag]"
              data-no-drag
              onDoubleClick={() => void toggleDesktopMaximize()}
              type="button"
            >
              MUZERO
            </button>
            <HeaderPinButton />
          </div>
          <WindowsWindowControls />
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
          hidden={dockHidden}
        />

        {immersiveMemoryActive && <ImmersiveMemoryOverlay />}
        {immersiveLyricsActive && <ImmersiveLyricsOverlay lyricsOnly={lyricsOnlyIdle} />}

        <VisualizerTuningPanel />
        <LyricsTuningPanel />

        <GlobalTrackSearch open={trackSearchOpen} onOpenChange={setTrackSearchOpen} />

        {/* App-wide drag-and-drop + paste: media → import; image → cover/background/gallery. */}
        <GlobalDropZone onMediaUploaded={(createdSet) => createdSet && setTab("queue")} />

        {/* Dev perf HUD, behind the same visible Settings switch as prod. */}
        {import.meta.env.DEV && settings.perfHudEnabled && <DevPerfPanel />}
        {/* "What's New" — auto-opens for unseen releases; also opens from Settings → About. */}
        <ChangelogModal />
      </div>
    </MotionConfig>
  );
}

function useDesktopChromeDataset() {
  useEffect(() => {
    const bridge = resolveDesktopBridge();
    const html = document.documentElement;
    html.dataset.desktopShell = bridge.kind;
    if (bridge.platform) html.dataset.desktopPlatform = bridge.platform;
    return () => {
      delete html.dataset.desktopShell;
      delete html.dataset.desktopPlatform;
      delete html.dataset.windowMaximized;
    };
  }, []);
}

function useLyricsOnlyOverlayDataset(active: boolean) {
  useEffect(() => {
    const html = document.documentElement;
    if (active) html.dataset.muzeroLyricsOverlay = "true";
    else delete html.dataset.muzeroLyricsOverlay;
    return () => {
      delete html.dataset.muzeroLyricsOverlay;
    };
  }, [active]);
}

function useAppearanceCssVars(settings: ReturnType<typeof useSettings>) {
  const coverColorCss = useVisualizerCoverColorCss(
    settings.electronWindowBorderColorMode === "cover",
    { respectVisualizerSetting: false },
  );

  useEffect(() => {
    const html = document.documentElement;
    const vars = {
      ...electronWindowAppearanceCssVars(settings, { coverColorCss }),
      ...albumCoverAppearanceCssVars(settings),
    };
    for (const [name, value] of Object.entries(vars)) {
      html.style.setProperty(name, value);
    }
    return () => {
      for (const name of Object.keys(vars)) {
        html.style.removeProperty(name);
      }
    };
  }, [settings, coverColorCss]);
}

function useDesktopWindowPinMode(settings: ReturnType<typeof useSettings>) {
  useEffect(() => {
    const controls = resolveDesktopBridge().windowControls;
    if (!controls?.setPinMode) return;
    const mode = settings.desktopWindowPinMode === "pin" ? "pin" : "off";
    void controls
      .setPinMode(mode)
      .catch((error) => log.warn("desktop.windowPin", "Unable to apply pin mode", error));
  }, [settings.desktopWindowPinMode]);
}

async function toggleDesktopMaximize() {
  const state = await resolveDesktopBridge().windowControls?.toggleMaximize();
  if (!state) return;
  document.documentElement.dataset.windowMaximized = String(state.maximized || state.fullscreen);
}

function AmbientPageOverlay({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    // Desktop window drag: the whole page is a drag surface, so any empty space —
    // side gutters AND gaps inside the content (unfilled grid cells, padding) —
    // moves the frameless window, like a native app. Both shells are wired (each
    // inert on the other + web):
    //   • Electron → `-webkit-app-region:drag` here; every interactive control +
    //     overlay opts out via the global `no-drag` rule in styles.css (Electron's
    //     drag region is geometric, so controls must explicitly carve themselves
    //     out). The dock/dialog backdrops/popovers carry `data-no-drag`.
    //   • Tauri → `onMouseDown` delegates to the native `startDragging` for any
    //     press that isn't on a control (its `data-tauri-drag-region` is exact-hit,
    //     so a single delegated handler is how we cover dynamic empty space).
    // biome-ignore lint/a11y/noStaticElementInteractions: a passive window-drag surface, not a content control — no role/keyboard action; it only moves the OS window on desktop.
    <div
      onMouseDown={dragWindowOnEmptyPress}
      className={cn(
        "relative h-full transition-colors duration-500 [-webkit-app-region:drag]",
        // Full-screen backdrop blur over the live Pixi/background stage is very
        // expensive in Windows WebView/Chromium; keep non-Now pages composited flat.
        active && "bg-background/45",
      )}
    >
      {children}
    </div>
  );
}
