import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DevPerfPanel } from "@/components/dev/dev-perf-panel";
import { RenderTraceBoundary } from "@/components/dev/render-trace-boundary";
import { AlbumCoverAppearancePanel } from "@/components/player/album-cover-appearance-panel";
import { ChangelogModal } from "@/components/player/changelog-modal";
import { ImmersiveLyricsOverlay } from "@/components/player/immersive-lyrics-overlay";
import { ImmersiveMemoryOverlay } from "@/components/player/immersive-memory-overlay";
import { LyricsTuningPanel } from "@/components/player/lyrics-tuning-panel";
import { NowPlayingBackground } from "@/components/player/now-playing-background";
import { useVisualizerCoverColorCss } from "@/components/player/visualizer-dynamic-color";
import { VisualizerTuningPanel } from "@/components/player/visualizer-tuning-panel";
import { GlobalTrackSearch } from "@/components/search/global-track-search";
import { HeaderNavTabs } from "@/components/shell/header-nav-tabs";
import { MacWindowControls } from "@/components/shell/mac-window-controls";
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
import {
  nowPlayingCoverBacklightVars,
  resolveNowPlayingCoverBacklightAppearance,
} from "@/lib/album-cover-appearance";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import {
  electronWindowAppearanceCssVars,
  resolveBorderColorMode,
} from "@/lib/electron-window-appearance";
import { transitionProgress, useNowPlayingTransition } from "@/lib/now-playing-transition";
import { cn } from "@/lib/utils";
import { setViewTransitionSuppressed } from "@/lib/view-transition";
import { rgba } from "@/lib/visualizer-color";
import { dragWindowOnEmptyPress } from "@/lib/window-drag";
import {
  startLiveRequestIntake,
  stopLiveRequestIntake,
} from "@/live-requests/live-request-controller";
import { NowPlayingPage } from "@/pages/now-playing-page";
import { QueuePage } from "@/pages/queue-page";
import { SearchPage } from "@/pages/search-page";
import { SessionsPage } from "@/pages/sessions-page";
import { SettingsPage } from "@/pages/settings-page";
import { buildSystemShortcutRegistrations } from "@/shortcuts/system-global";
import { startCloudAutoSyncScheduler } from "@/stores/cloud-auto-sync";
import { useDesktopWindowStore } from "@/stores/desktop-window-store";
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
  const clickThroughHover = useDesktopWindowStore((s) => s.clickThroughHover);
  const initDesktopWindow = useDesktopWindowStore((s) => s.init);
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
  // Apply the chosen desktop app icon (Electron only; no-op on web/tauri).
  useAppIcon();
  // NOTE: the playback-subscribing side-effect hooks (document title / tray sync /
  // transport warmup) live in <PlaybackEffects/> below, NOT here. They subscribe to
  // currentIndex/queue, so calling them in App's body would re-render App on every
  // song switch — and the 5 TabPanels are App's inline children, so every hidden tab
  // (Settings/Search/Sessions/Queue) would reconcile per switch. Isolating them in a
  // null-rendering leaf keeps a switch from cascading into App + all tabs. (PRD
  // 20260617-dock-swipe-switch-jank #2: cut the switch reconcile.)
  useDesktopChromeDataset();
  useAppearanceCssVars(settings);
  useWindowBorderDragColor(settings);
  useDesktopWindowPinMode(settings);

  useEffect(() => {
    initDesktopWindow();
  }, [initDesktopWindow]);

  // Boot only wires the media engine. Auto-cueing the previous track during
  // WKWebView startup can make the full-screen media/background path flicker.
  useEffect(() => {
    init();
  }, [init]);

  // Wire the live chat request intake (Social Stream Ninja / webhooks): received
  // messages search the library and play. No-op on shells without an intake transport.
  useEffect(() => {
    startLiveRequestIntake();
    return () => stopLiveRequestIntake();
  }, []);

  // Surface background sync (folder import + R2) as a persistent, cancelable toast.
  useEffect(() => {
    startSyncIndicator();
  }, []);

  // Visible per-drive R2 auto-sync scheduler. It delegates to the same
  // orchestrated Sync now path and self-guards per drive.
  useEffect(() => startCloudAutoSyncScheduler(), []);

  // Dev / profiling-build automation control endpoint bridge. In a normal prod build
  // both flags fold to false → the import is dead code → tree-shaken. The dedicated
  // profiling build (`VITE_MUZERO_PROFILE=1 vite build`) keeps the bridge so the harness
  // can drive a PROD renderer (no jsxDEV / dev-React noise) over the control endpoint for
  // clean CPU profiles. The bridge still no-ops unless the Electron main process attached
  // the control server (see electron/perf-control.cjs).
  useEffect(() => {
    if (!import.meta.env.DEV && !import.meta.env.VITE_MUZERO_PROFILE) return;
    void import("@/dev/perf-control-bridge").then((m) => m.startPerfControlBridge());
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
      // F-key fullscreen goes through the DOM Fullscreen API, not the Electron window
      // (which drives data-window-maximized). Mirror the state onto the root so the
      // win32 shell can drop its rounded corners + accent border while fullscreen.
      document.documentElement.dataset.documentFullscreen = String(
        Boolean(document.fullscreenElement),
      );
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
  // Pinned lyrics-only overlay (OBS): once pinned, the window is always-on-top
  // and the lyrics capture stays clean. Pointer click-through is a separate
  // session-only Lock action from the lyrics overlay, not the default pin state.
  const lyricsPlacementActive =
    isNowTab && visualizerBackgroundActive && visualizerPlacement === "lyrics";
  const lyricsOverlayPinned = lyricsPlacementActive && settings.desktopWindowPinMode === "pin";
  const lyricsOnlyIdle = lyricsPlacementActive && (idle || lyricsOverlayPinned);
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
  // While pinned as a lyrics overlay the background/foreground stay hidden
  // (lyricsOnlyIdle is latched above), but the titlebar should still reveal on
  // hover. So the header follows raw pointer idle here instead of the latch.
  const headerHidden = lyricsOverlayPinned ? idle : chromeHidden || foregroundHidden;
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

  // The non-active tabs stay MOUNTED (display:none) to keep their subscriptions warm.
  // App re-renders on transient chrome state (idle/hover during a drag), and these
  // pages take no switch-changing props — so memoize their ELEMENTS: App's re-render
  // no longer cascades a full reconcile into every hidden tab on each song switch
  // (the dominant switch cost; PRD 20260617-dock-swipe-switch-jank #2). Each page
  // still re-renders from its OWN store/liveQuery subscriptions.
  const onSessionsStarted = useCallback(() => setTab("now"), [setTab]);
  const queuePanel = useMemo(() => <QueuePage />, []);
  const searchPanel = useMemo(() => <SearchPage />, []);
  const sessionsPanel = useMemo(
    () => <SessionsPage onStarted={onSessionsStarted} />,
    [onSessionsStarted],
  );
  const settingsPanel = useMemo(() => <SettingsPage />, []);

  // Mirror the Dock-hidden signal so deep surfaces (e.g. the lyrics search
  // affordance) can fade in sync with the Dock during immersive idle.
  useEffect(() => {
    useUiStore.getState().setChromeHidden(dockHidden);
  }, [dockHidden]);
  // Suppress whole-page View Transitions while the heavy ambient backdrop is live:
  // a `root` transition would snapshot + cross-fade that full-screen Pixi/video/
  // visualizer layer (unchanged between tabs) and dip FPS on tab switches. See PRD
  // 20260615-…-view-transition-perf Phase 2.
  useEffect(() => {
    setViewTransitionSuppressed(ambientBackdropActive);
  }, [ambientBackdropActive]);
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
        {/* Playback side-effects isolated in a leaf so a song switch re-renders only
            this, not App + every inline TabPanel (see PlaybackEffects). */}
        <PlaybackEffects />
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
            headerHidden && "pointer-events-none opacity-0",
          )}
        >
          <div
            aria-hidden="true"
            className="absolute inset-y-0 left-0 right-36 [-webkit-app-region:drag]"
            data-tauri-drag-region
          />
          <HeaderNavTabs
            foregroundVisible={!foregroundHidden}
            hidden={headerHidden}
            value={tab}
            onChange={setTab}
            onDoubleClick={() => void toggleDesktopMaximize()}
          />
          <WindowsWindowControls />
          <MacWindowControls />
        </header>

        {/* Tabs are kept MOUNTED and toggled with `hidden` (display:none) rather
            than conditionally rendered. Remounting a page on every switch tore
            down + re-subscribed its Dexie `useLiveQuery`s (listAllTracks /
            trackPlaybackStats / memoryNotesByTrack) and re-rendered every cover
            surface → IndexedDB deserialization + GC long task = the tab-switch
            FPS dip (PRD 20260615-…-view-transition-perf Phase 4 / QA#1). Keeping
            them mounted holds the subscriptions live so a switch is a pure CSS
            show/hide. rAF-driven children pause while hidden on their own:
            PlaybackSpectrum (IntersectionObserver), the visualizer host (IO +
            document.hidden), and the shared Lenis driver (self-stops when idle). */}
        <main className="chrome-fade absolute inset-0 z-10 overflow-hidden [--chrome-fade-bottom:calc(var(--spacing-chrome-bottom)/2)] [--chrome-fade-top:3rem]">
          <TabPanel active={tab === "now"}>
            <RenderTraceBoundary id="tab:now" active={tab === "now"}>
              <NowPlayingPage foregroundHidden={foregroundHidden} pageActive={tab === "now"} />
            </RenderTraceBoundary>
          </TabPanel>
          <TabPanel active={tab === "queue"}>
            <RenderTraceBoundary id="tab:queue" active={tab === "queue"}>
              <AmbientPageOverlay active={ambientActive}>{queuePanel}</AmbientPageOverlay>
            </RenderTraceBoundary>
          </TabPanel>
          <TabPanel active={tab === "search"}>
            <RenderTraceBoundary id="tab:search" active={tab === "search"}>
              <AmbientPageOverlay active={ambientActive}>{searchPanel}</AmbientPageOverlay>
            </RenderTraceBoundary>
          </TabPanel>
          <TabPanel active={tab === "sessions"}>
            <RenderTraceBoundary id="tab:sessions" active={tab === "sessions"}>
              <AmbientPageOverlay active={ambientActive}>{sessionsPanel}</AmbientPageOverlay>
            </RenderTraceBoundary>
          </TabPanel>
          <TabPanel active={tab === "settings"}>
            <RenderTraceBoundary id="tab:settings" active={tab === "settings"}>
              <AmbientPageOverlay active={ambientActive}>{settingsPanel}</AmbientPageOverlay>
            </RenderTraceBoundary>
          </TabPanel>
        </main>

        <RenderTraceBoundary id="dock">
          <PlayerDock
            tab={tab}
            onTabChange={setTab}
            onOpenNowPlaying={() => setTab("now")}
            hidden={dockHidden}
          />
        </RenderTraceBoundary>

        {immersiveMemoryActive && <ImmersiveMemoryOverlay />}
        {immersiveLyricsActive && (
          <ImmersiveLyricsOverlay
            lyricsOnly={lyricsOnlyIdle}
            pinned={lyricsOverlayPinned}
            revealed={!idle || clickThroughHover}
          />
        )}

        <VisualizerTuningPanel />
        <LyricsTuningPanel />
        <AlbumCoverAppearancePanel />

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
      // The album-cover *radius/shadow* vars are intentionally NOT applied
      // globally — they would bleed into every cover (library rows, playlist /
      // album art, search results). They're scoped to the Now Playing stage
      // subtree instead (see SwipeableMediaStage). Only the backlight vars,
      // which the Now Playing cover backlight reads through a portal into
      // `main`, stay global here.
      ...nowPlayingCoverBacklightVars(resolveNowPlayingCoverBacklightAppearance(settings)),
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

/**
 * Drive the Windows window-border accent off the cover-drag progress, so the border
 * crossfades from the current cover's color to the neighbour's AS YOU DRAG (tracking
 * the finger), mirroring the cover image. It writes `--electron-window-border-color`
 * per frame from the shared `transitionProgress`, between the from/to colors frozen at
 * drag start. Outside a drag the settled value (useAppearanceCssVars) owns the var, and
 * since both end on the same color there is no flash at handoff. Only meaningful in
 * "cover" border mode on the Windows Electron shell; a custom border never follows covers.
 */
function useWindowBorderDragColor(settings: ReturnType<typeof useSettings>) {
  const active = useNowPlayingTransition((s) => s.active);
  const fromColor = useNowPlayingTransition((s) => s.fromColor);
  const toColor = useNowPlayingTransition((s) => s.toColor);
  const borderColorMode = settings.electronWindowBorderColorMode;
  const borderColor = settings.electronWindowBorderColor;
  const borderOpacity = settings.electronWindowBorderOpacity;

  useEffect(() => {
    if (!active || !fromColor || !toColor) return;
    if (resolveBorderColorMode(borderColorMode) !== "cover") return;
    const html = document.documentElement;
    if (html.dataset.desktopShell !== "electron" || html.dataset.desktopPlatform !== "win32")
      return;

    // While dragging, the border must track the finger with no easing lag, so the
    // box-shadow's resting CSS transition is disabled (see styles.css).
    html.dataset.windowBorderDragging = "true";
    const colorSettings = {
      electronWindowBorderColor: borderColor,
      electronWindowBorderColorMode: borderColorMode,
      electronWindowBorderOpacity: borderOpacity,
    };
    const apply = (progress: number) => {
      // The stage resets transitionProgress to 0 the instant a drag settles — but
      // endTransition() (active → false) runs synchronously right before it, while this
      // listener's React cleanup hasn't fired yet. Without this guard that stray 0 would
      // repaint the FROM color for a frame (the post-commit flash-back). Bail once the
      // store says the transition is over; the committed color is already painted.
      if (!useNowPlayingTransition.getState().active) return;
      const t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
      const coverColorCss = rgba(
        {
          r: Math.round(fromColor.r + (toColor.r - fromColor.r) * t),
          g: Math.round(fromColor.g + (toColor.g - fromColor.g) * t),
          b: Math.round(fromColor.b + (toColor.b - fromColor.b) * t),
        },
        1,
      );
      const css = electronWindowAppearanceCssVars(colorSettings, { coverColorCss })[
        "--electron-window-border-color"
      ];
      if (css) html.style.setProperty("--electron-window-border-color", css);
    };
    apply(transitionProgress.get());
    const unsubscribe = transitionProgress.on("change", apply);
    return () => {
      unsubscribe();
      delete html.dataset.windowBorderDragging;
      // Leave the var at its last drag value; the settled accent reconciles it (same
      // color on commit → no flash; the box-shadow transition smooths any remainder).
    };
  }, [active, fromColor, toColor, borderColorMode, borderColor, borderOpacity]);
}

function useDesktopWindowPinMode(settings: ReturnType<typeof useSettings>) {
  const setPinMode = useDesktopWindowStore((s) => s.setPinMode);

  useEffect(() => {
    const mode = settings.desktopWindowPinMode === "pin" ? "pin" : "off";
    void setPinMode(mode);
  }, [settings.desktopWindowPinMode, setPinMode]);
}

async function toggleDesktopMaximize() {
  await useDesktopWindowStore.getState().toggleMaximize();
}

/**
 * One kept-mounted tab page. Inactive panels stay in the React tree (so their
 * liveQuery subscriptions and scroll/edit state persist) but go `display:none`
 * via `hidden`, which also drops them from layout, paint, focus order, and the
 * a11y tree. See the `<main>` comment + PRD Phase 4.
 */
function TabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return <div className={cn("h-full", !active && "hidden")}>{children}</div>;
}

/**
 * Null-rendering leaf that owns the playback-state-subscribing side-effect hooks
 * (document title / tray sync / transport warmup). These re-render on every song
 * switch (currentIndex/queue) — isolating them here means ONLY this leaf re-renders,
 * not App and its inline TabPanels, so a switch no longer reconciles the hidden tabs.
 */
function PlaybackEffects() {
  // Browser tab title tracks the current track: `Title · Artist · Album | MUZERO`.
  useDocumentTitle();
  // Keep the native tray menu aligned with current playback state (Electron only).
  useTraySync();
  // Keep the next transport targets warm so keyboard/button skips don't paint
  // empty cover/background states while local blobs or R2 bytes resolve.
  usePlaybackWarmup();
  return null;
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
