import { describe, expect, it } from "vitest";
import { electronWindowAppearanceCssVars } from "./electron-window-appearance";

describe("electronWindowAppearanceCssVars", () => {
  it("emits only border appearance CSS variables", () => {
    expect(Object.keys(electronWindowAppearanceCssVars({})).sort()).toEqual([
      "--electron-window-border-color",
      "--electron-window-border-width",
      "--electron-window-radius",
    ]);
  });

  it("defaults to a 6px cover-colored border at 10% opacity", () => {
    expect(
      electronWindowAppearanceCssVars({}, { coverColorCss: "rgba(10, 20, 30, 1)" }),
    ).toMatchObject({
      "--electron-window-border-width": "6px",
      "--electron-window-border-color": "color-mix(in srgb, rgba(10, 20, 30, 1) 10%, transparent)",
    });
  });

  it("resolves border CSS variables", () => {
    expect(
      electronWindowAppearanceCssVars({
        electronWindowBorderWidth: 2,
        electronWindowBorderColorMode: "custom",
        electronWindowBorderColor: "#3366ff",
        electronWindowBorderOpacity: 40,
      }),
    ).toMatchObject({
      "--electron-window-border-width": "2px",
      "--electron-window-border-color": "rgb(51 102 255 / 40%)",
    });
  });

  it("uses the visualizer cover color when requested", () => {
    expect(
      electronWindowAppearanceCssVars(
        {
          electronWindowBorderColorMode: "cover",
          electronWindowBorderColor: "#3366ff",
          electronWindowBorderOpacity: 55,
        },
        { coverColorCss: "rgba(10, 20, 30, 1)" },
      )["--electron-window-border-color"],
    ).toBe("color-mix(in srgb, rgba(10, 20, 30, 1) 55%, transparent)");
  });

  it("clamps radius and border width", () => {
    expect(
      electronWindowAppearanceCssVars({
        electronWindowRadius: 99,
        electronWindowBorderWidth: 99,
      }),
    ).toMatchObject({
      "--electron-window-radius": "32px",
      "--electron-window-border-width": "8px",
    });
  });
});
