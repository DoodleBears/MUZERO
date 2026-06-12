import { describe, expect, it } from "vitest";
import {
  APP_ICON_OPTIONS,
  APP_ICONS,
  DEFAULT_APP_ICON,
  isAppIconId,
  resolveAppIcon,
} from "./app-icon";

describe("app-icon registry", () => {
  it("recognizes valid ids and rejects everything else", () => {
    expect(isAppIconId("dark")).toBe(true);
    expect(isAppIconId("light")).toBe(true);
    expect(isAppIconId("sketch")).toBe(true);
    expect(isAppIconId("monogram")).toBe(true);
    expect(isAppIconId("split")).toBe(true);
    expect(isAppIconId("auto")).toBe(false);
    expect(isAppIconId("")).toBe(false);
    expect(isAppIconId(undefined)).toBe(false);
    expect(isAppIconId(42)).toBe(false);
  });

  it("falls back to the default for stale / unknown values", () => {
    expect(resolveAppIcon("light")).toBe("light");
    expect(resolveAppIcon("nope")).toBe(DEFAULT_APP_ICON);
    expect(resolveAppIcon(undefined)).toBe(DEFAULT_APP_ICON);
    expect(DEFAULT_APP_ICON).toBe("dark");
  });

  it("exposes one picker row per icon, in registry order", () => {
    expect(APP_ICON_OPTIONS.map((o) => o.value)).toEqual([...APP_ICONS]);
    for (const option of APP_ICON_OPTIONS) {
      expect(isAppIconId(option.value)).toBe(true);
      expect(option.preview).toMatch(/^\/muzero-logo(?:-.+)?\.png$/);
    }
  });
});
