import { create } from "zustand";
import {
  type DesktopBridge,
  type DesktopClickThroughRegion,
  type DesktopKind,
  type DesktopPlatform,
  type DesktopWindowPinMode,
  type DesktopWindowState,
  resolveDesktopBridge,
} from "@/lib/desktop/bridge";
import { log } from "@/lib/logger";

interface DesktopWindowStore {
  clickThroughHover: boolean;
  fullscreen: boolean;
  initialized: boolean;
  kind: DesktopKind;
  macControlsSupported: boolean;
  maximized: boolean;
  pinMode: DesktopWindowPinMode;
  pinSupported: boolean;
  platform?: DesktopPlatform;
  windowsControlsSupported: boolean;
  closeOrHideToTray: () => Promise<void>;
  init: () => void;
  minimize: () => Promise<void>;
  setClickThroughRegions: (regions: readonly DesktopClickThroughRegion[]) => void;
  setClickThroughPaused: (paused: boolean) => void;
  setPinMode: (mode: DesktopWindowPinMode) => Promise<DesktopWindowState | undefined>;
  toggleMaximize: () => Promise<DesktopWindowState | undefined>;
  togglePinned: () => Promise<DesktopWindowState | undefined>;
}

let unsubscribeWindowState: (() => void) | undefined;
let unsubscribeClickThroughHover: (() => void) | undefined;
let initStarted = false;

function isWindowsRuntime(bridge: DesktopBridge): boolean {
  if (bridge.platform) return bridge.platform === "win32";
  if (typeof navigator === "undefined") return false;
  return (
    navigator.platform.toLowerCase().startsWith("win") || navigator.userAgent.includes("Windows")
  );
}

function isMacRuntime(bridge: DesktopBridge): boolean {
  if (bridge.platform) return bridge.platform === "darwin";
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toLowerCase().startsWith("mac") || navigator.userAgent.includes("Mac");
}

function syncWindowMaximizedDataset(maximized: boolean, fullscreen: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.windowMaximized = String(maximized || fullscreen);
}

function applyWindowState(state: DesktopWindowState) {
  useDesktopWindowStore.setState({
    clickThroughHover:
      state.pinMode === "pin-click-through"
        ? useDesktopWindowStore.getState().clickThroughHover
        : false,
    fullscreen: state.fullscreen,
    maximized: state.maximized,
    pinMode: state.pinMode ?? "off",
  });
  syncWindowMaximizedDataset(state.maximized, state.fullscreen);
}

function currentControls() {
  return resolveDesktopBridge().windowControls;
}

export const useDesktopWindowStore = create<DesktopWindowStore>((set, get) => ({
  clickThroughHover: false,
  fullscreen: false,
  initialized: false,
  kind: "web",
  macControlsSupported: false,
  maximized: false,
  pinMode: "off",
  pinSupported: false,
  platform: undefined,
  windowsControlsSupported: false,

  closeOrHideToTray: async () => {
    const controls = currentControls();
    if (!controls) return;
    await (controls.hideToTray?.() ?? controls.close());
  },

  init: () => {
    if (initStarted) return;
    initStarted = true;
    const bridge = resolveDesktopBridge();
    const controls = bridge.windowControls;
    const pinSupported = Boolean(controls?.setPinMode && controls.getState);
    set({
      initialized: true,
      kind: bridge.kind,
      // macOS keeps native traffic lights (min/max/close) at top-left, so it never
      // gets the Windows controls cluster — but the always-on-top capability works
      // cross-platform, so surface a standalone pin button on the macOS shell.
      macControlsSupported: bridge.kind === "electron" && isMacRuntime(bridge) && pinSupported,
      pinSupported,
      platform: bridge.platform,
      windowsControlsSupported:
        bridge.kind === "electron" && isWindowsRuntime(bridge) && Boolean(controls),
    });
    if (!controls) return;

    void controls
      .getState()
      .then(applyWindowState)
      .catch((error) => log.warn("desktop.windowState", "Unable to read window state", error));

    unsubscribeWindowState = controls.onStateChange?.(applyWindowState);
    unsubscribeClickThroughHover = controls.onClickThroughHover?.((clickThroughHover) =>
      set({ clickThroughHover }),
    );
  },

  minimize: async () => {
    await currentControls()?.minimize();
  },

  setClickThroughPaused: (paused: boolean) => {
    void currentControls()?.setClickThroughPaused?.(paused);
  },

  setClickThroughRegions: (regions) => {
    void currentControls()?.setClickThroughRegions?.(regions);
  },

  setPinMode: async (mode: DesktopWindowPinMode) => {
    const controls = currentControls();
    if (!controls?.setPinMode) return undefined;
    try {
      const state = await controls.setPinMode(mode);
      applyWindowState(state);
      return state;
    } catch (error) {
      log.warn("desktop.windowPin", "Unable to update pin mode", error);
      return undefined;
    }
  },

  toggleMaximize: async () => {
    const controls = currentControls();
    if (!controls?.toggleMaximize) return undefined;
    const state = await controls.toggleMaximize();
    applyWindowState(state);
    return state;
  },

  togglePinned: async () => {
    const next = get().pinMode === "off" ? "pin" : "off";
    return get().setPinMode(next);
  },
}));

export function __resetDesktopWindowStoreForTest() {
  unsubscribeWindowState?.();
  unsubscribeClickThroughHover?.();
  unsubscribeWindowState = undefined;
  unsubscribeClickThroughHover = undefined;
  initStarted = false;
  useDesktopWindowStore.setState({
    clickThroughHover: false,
    fullscreen: false,
    initialized: false,
    kind: "web",
    macControlsSupported: false,
    maximized: false,
    pinMode: "off",
    pinSupported: false,
    platform: undefined,
    windowsControlsSupported: false,
  });
  if (typeof document !== "undefined") {
    delete document.documentElement.dataset.windowMaximized;
  }
}
