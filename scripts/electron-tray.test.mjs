import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createTrayController } = require("../electron/tray.cjs");

function createFakeWindow() {
  const win = new EventEmitter();
  win.hide = vi.fn();
  win.show = vi.fn();
  win.focus = vi.fn();
  win.restore = vi.fn();
  win.isDestroyed = vi.fn(() => false);
  win.isMinimized = vi.fn(() => false);
  win.setSkipTaskbar = vi.fn();
  win.webContents = { send: vi.fn() };
  return win;
}

// Fake electron `nativeImage`: createFromPath → raw image; raw.resize → a distinct
// resized image; both record calls so tests can assert the menu-bar transform.
function createFakeNativeImage() {
  const setTemplateImage = vi.fn();
  const resized = { __kind: "resized", isEmpty: () => false, setTemplateImage };
  const raw = {
    __kind: "raw",
    isEmpty: () => false,
    resize: vi.fn(() => resized),
    setTemplateImage: vi.fn(),
  };
  const createFromPath = vi.fn(() => raw);
  return { createFromPath, nativeImage: { createFromPath }, raw, resized, setTemplateImage };
}

function createHarness(platform = "win32", { nativeImage } = {}) {
  const trayInstances = [];
  const app = { quit: vi.fn() };
  const Menu = { buildFromTemplate: vi.fn((template) => ({ template })) };
  class Tray extends EventEmitter {
    constructor(icon) {
      super();
      this.icon = icon;
      this.setToolTip = vi.fn();
      this.setContextMenu = vi.fn();
      trayInstances.push(this);
    }
  }
  const controller = createTrayController({
    app,
    iconPath: "icon.ico",
    Menu,
    nativeImage,
    platform,
    Tray,
  });
  return { app, controller, Menu, trayInstances };
}

describe("createTrayController", () => {
  it("creates a recoverable tray and hides close requests instead of quitting", () => {
    const { controller, trayInstances } = createHarness("win32");
    const win = createFakeWindow();
    controller.attachWindow(win);
    controller.ensureTray();

    const event = { preventDefault: vi.fn() };
    win.emit("close", event);

    expect(trayInstances).toHaveLength(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(win.setSkipTaskbar).toHaveBeenCalledWith(true);
    expect(win.hide).toHaveBeenCalledTimes(1);
  });

  it("restores and focuses the existing window from the tray", () => {
    const { controller, trayInstances } = createHarness("win32");
    const win = createFakeWindow();
    win.isMinimized.mockReturnValue(true);
    controller.attachWindow(win);
    controller.ensureTray();

    trayInstances[0].emit("click");

    expect(win.setSkipTaskbar).toHaveBeenCalledWith(false);
    expect(win.restore).toHaveBeenCalledTimes(1);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  it("lets explicit quit close the app instead of hiding it again", () => {
    const { app, controller } = createHarness("win32");
    const win = createFakeWindow();
    controller.attachWindow(win);
    controller.ensureTray();

    controller.quitApp();
    const event = { preventDefault: vi.fn() };
    win.emit("close", event);

    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it("lets native app quit close the window after before-quit", () => {
    const { app, controller } = createHarness("darwin");
    const win = createFakeWindow();
    controller.attachWindow(win);
    controller.ensureTray();

    controller.markQuitting();
    const event = { preventDefault: vi.fn() };
    win.emit("close", event);

    expect(app.quit).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it("keeps native close recoverable if tray creation fails", () => {
    const app = { quit: vi.fn() };
    const Menu = { buildFromTemplate: vi.fn((template) => ({ template })) };
    class BrokenTray {
      constructor() {
        throw new Error("tray unavailable");
      }
    }
    const controller = createTrayController({
      app,
      iconPath: "missing.ico",
      Menu,
      platform: "win32",
      Tray: BrokenTray,
    });
    const win = createFakeWindow();

    controller.attachWindow(win);
    expect(controller.ensureTray()).toBeNull();

    const event = { preventDefault: vi.fn() };
    win.emit("close", event);

    expect(controller.hasTray()).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

  it("downscales the macOS tray icon to menu-bar size while keeping the colored logo", () => {
    const fake = createFakeNativeImage();
    const { controller, trayInstances } = createHarness("darwin", { nativeImage: fake.nativeImage });
    controller.ensureTray();

    // Source the full-resolution app logo, then downscale to menu-bar size so it
    // doesn't render huge — macOS does NOT auto-fit a 1120px Tray image.
    expect(fake.createFromPath).toHaveBeenCalledWith("icon.ico");
    expect(fake.raw.resize).toHaveBeenCalledWith({ height: 16, width: 16 });
    // NOT a template image: that would strip the logo to a flat monochrome
    // silhouette. Keep the actual colored brand mark in the menu bar.
    expect(fake.setTemplateImage).not.toHaveBeenCalled();
    // Tray receives the resized nativeImage, never the raw path string.
    expect(trayInstances[0].icon).toBe(fake.resized);
    expect(typeof trayInstances[0].icon).not.toBe("string");
  });

  it("resizes the tray icon on Windows and keeps the colored logo (no template)", () => {
    const fake = createFakeNativeImage();
    const { controller, trayInstances } = createHarness("win32", { nativeImage: fake.nativeImage });
    controller.ensureTray();

    expect(fake.raw.resize).toHaveBeenCalledWith({ height: 16, width: 16 });
    expect(fake.setTemplateImage).not.toHaveBeenCalled();
    expect(trayInstances[0].icon).toBe(fake.resized);
  });

  it("falls back to the raw icon path when no nativeImage is injected", () => {
    const { controller, trayInstances } = createHarness("darwin");
    controller.ensureTray();
    expect(trayInstances[0].icon).toBe("icon.ico");
  });

  it("falls back to the raw icon path when the asset decodes empty", () => {
    const fake = createFakeNativeImage();
    fake.raw.isEmpty = () => true;
    const { controller, trayInstances } = createHarness("darwin", { nativeImage: fake.nativeImage });
    controller.ensureTray();
    expect(fake.raw.resize).not.toHaveBeenCalled();
    expect(trayInstances[0].icon).toBe("icon.ico");
  });

  it("sends action ids from native menu clicks without owning labels", () => {
    const onAction = vi.fn();
    const { controller, Menu, trayInstances } = createHarness("linux");
    controller.onAction(onAction);
    controller.ensureTray();

    controller.updateMenu({
      items: [
        { action: "window.show", enabled: true, id: "open", label: "Open MUZERO", type: "normal" },
        { id: "sep", type: "separator" },
        {
          id: "repeat",
          items: [
            {
              action: "playback.repeat.all",
              checked: true,
              enabled: true,
              id: "repeat-all",
              label: "Repeat all",
              type: "checkbox",
            },
          ],
          label: "Repeat",
          type: "submenu",
        },
      ],
      tooltip: "MUZERO - Levitating",
    });

    const template = Menu.buildFromTemplate.mock.calls.at(-1)[0];
    expect(trayInstances[0].setToolTip).toHaveBeenLastCalledWith("MUZERO - Levitating");
    expect(template[0].label).toBe("Open MUZERO");
    expect(template[0].click).toEqual(expect.any(Function));
    expect(template[1].type).toBe("separator");
    expect(template[2].submenu[0]).toMatchObject({
      checked: true,
      label: "Repeat all",
      type: "checkbox",
    });

    template[0].click();
    template[2].submenu[0].click();

    expect(onAction).toHaveBeenCalledWith("window.show");
    expect(onAction).toHaveBeenCalledWith("playback.repeat.all");
  });
});
