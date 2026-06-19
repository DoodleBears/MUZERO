import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVisualizerCoverColorCss } from "./visualizer-dynamic-color";

const mocks = vi.hoisted(() => ({
  liveQueryResults: [] as unknown[],
  playerState: {
    currentIndex: 0,
    queue: [] as unknown[],
  },
  putCoverPaletteDerivative: vi.fn(),
  resolveCoverPaletteDerivative: vi.fn(),
  resolveMediaBlob: vi.fn(),
  transitionVisualizerCoverColor: vi.fn(),
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (query: () => unknown, _deps: unknown[], defaultValue: unknown) => {
    const result = query();
    if (result instanceof Promise) return mocks.liveQueryResults.shift() ?? defaultValue;
    return result ?? defaultValue;
  },
}));

vi.mock("@/db/cover-derivatives", () => ({
  putCoverPaletteDerivative: mocks.putCoverPaletteDerivative,
  resolveCoverPaletteDerivative: mocks.resolveCoverPaletteDerivative,
}));

vi.mock("@/db/media-blob-storage", () => ({
  resolveMediaBlob: mocks.resolveMediaBlob,
}));

vi.mock("@/db/muzero-db", () => ({
  db: {},
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({
    primaryDark: "#ffffff",
    primaryLight: "#000000",
    theme: "dark",
    visualizerUseCoverColor: true,
  }),
}));

vi.mock("@/lib/cover-asset", () => ({
  getOrFetchRemoteCoverAsset: vi.fn(),
  remoteCoverAssetKey: (url: string) => `remote:${url}`,
}));

vi.mock("@/lib/desktop/bridge", () => ({
  resolveDesktopBridge: () => ({ kind: "electron" }),
}));

vi.mock("@/lib/diagnostics", () => ({
  sanitizeUrlForTrace: () => ({}),
}));

vi.mock("@/lib/logger", () => ({
  createDiagnosticLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("@/lib/track-source", () => ({
  describeTrackCoverSource: () => ({ kind: "local-cover" }),
}));

vi.mock("@/lib/visualizer-color", () => ({
  readPrimaryRgb: () => ({ b: 3, g: 2, r: 1 }),
}));

vi.mock("@/stores/player-store", () => ({
  usePlayerStore: (selector: (state: typeof mocks.playerState) => unknown) =>
    selector(mocks.playerState),
}));

vi.mock("@/stores/visualizer-color-store", () => ({
  transitionVisualizerCoverColor: mocks.transitionVisualizerCoverColor,
  useVisualizerCoverColorStore: (selector: (state: { css: string }) => unknown) =>
    selector({ css: "--cover-rgb: 1 2 3" }),
}));

function HookProbe() {
  useVisualizerCoverColorCss(true);
  return null;
}

describe("useVisualizerCoverColorCss", () => {
  beforeEach(() => {
    mocks.liveQueryResults = [];
    mocks.playerState.queue = [];
    mocks.putCoverPaletteDerivative.mockReset();
    mocks.resolveCoverPaletteDerivative.mockReset();
    mocks.resolveCoverPaletteDerivative.mockResolvedValue(null);
    mocks.resolveMediaBlob.mockReset();
    mocks.transitionVisualizerCoverColor.mockReset();
  });

  it("uses a track palette snapshot without resolving derivative metadata or cover bytes", () => {
    mocks.playerState.queue = [
      {
        coverBlobId: "blb_cover",
        coverPalette: [{ b: 30, g: 20, r: 10 }],
        coverPaletteSource: "blb_cover",
        id: "trk_palette",
      },
    ];

    render(<HookProbe />);

    expect(mocks.resolveCoverPaletteDerivative).not.toHaveBeenCalled();
    expect(mocks.resolveMediaBlob).not.toHaveBeenCalled();
    expect(mocks.transitionVisualizerCoverColor).toHaveBeenCalledWith(
      "blb_cover",
      {
        b: 30,
        g: 20,
        r: 10,
      },
      [{ b: 30, g: 20, r: 10 }],
    );
  });

  it("uses a palette derivative without resolving the original cover blob", () => {
    mocks.playerState.queue = [
      {
        coverBlobId: "blb_derivative",
        id: "trk_derivative",
      },
    ];
    mocks.liveQueryResults = [
      {
        palette: [{ b: 70, g: 60, r: 50 }],
      },
    ];

    render(<HookProbe />);

    expect(mocks.resolveCoverPaletteDerivative).toHaveBeenCalledTimes(1);
    expect(mocks.resolveMediaBlob).not.toHaveBeenCalled();
    expect(mocks.transitionVisualizerCoverColor).toHaveBeenCalledWith(
      "blb_derivative",
      {
        b: 70,
        g: 60,
        r: 50,
      },
      [{ b: 70, g: 60, r: 50 }],
    );
  });
});
