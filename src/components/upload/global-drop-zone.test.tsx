import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCoverTargetStore } from "@/stores/cover-target-store";
import { useUploadTargetStore } from "@/stores/upload-target-store";
import { GlobalDropZone } from "./global-drop-zone";

// Shared, hoisted mock handles (vi.mock factories run before module-scope consts).
const h = vi.hoisted(() => ({
  tracksGet: vi.fn(),
  setTrackCover: vi.fn(async (..._args: unknown[]) => {}),
  player: { isUploading: false, queue: [] as Array<{ id: string }>, currentIndex: -1 },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => [] }));
vi.mock("@/hooks/use-media", () => ({ useObjectUrl: () => null }));
vi.mock("@/db/muzero-db", () => ({ db: { tracks: { get: (id: string) => h.tracksGet(id) } } }));
vi.mock("@/db/repositories", () => ({
  addGalleryImage: vi.fn(async () => {}),
  addTrackBackground: vi.fn(async () => {}),
  createSession: vi.fn(async () => ({ id: "ses_new" })),
  listSessions: vi.fn(async () => []),
  saveSettings: vi.fn(async () => {}),
  setTrackCover: (...args: unknown[]) => h.setTrackCover(...args),
}));
// Identifiable crop dialog so the straight-to-crop path is observable.
vi.mock("@/components/track/cover-crop-dialog", () => ({
  CoverCropDialog: () => <div data-testid="crop-dialog" />,
}));
vi.mock("@/stores/player-store", () => ({
  usePlayerStore: Object.assign(
    (selector?: (s: typeof h.player) => unknown) => (selector ? selector(h.player) : h.player),
    { getState: () => h.player },
  ),
}));

/** Dispatch a window-level paste carrying one image file. */
function pasteImage() {
  const file = new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" });
  const event = new Event("paste", { bubbles: true });
  Object.defineProperty(event, "clipboardData", {
    value: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }], files: [file] },
  });
  window.dispatchEvent(event);
}

beforeEach(() => {
  h.player = { isUploading: false, queue: [], currentIndex: -1 };
  h.tracksGet.mockReset();
  h.setTrackCover.mockReset();
  useCoverTargetStore.getState().setCoverTarget(null);
  useUploadTargetStore.getState().setTarget({ kind: "active" });
});
afterEach(() => useCoverTargetStore.getState().setCoverTarget(null));

describe("GlobalDropZone image routing", () => {
  it("sends a pasted image straight to crop for the published cover target", async () => {
    h.tracksGet.mockResolvedValue({ id: "trk_sel", title: "Selected" });
    useCoverTargetStore.getState().setCoverTarget("trk_sel");
    render(<GlobalDropZone />);

    pasteImage();

    expect(await screen.findByTestId("crop-dialog")).toBeInTheDocument();
    expect(screen.queryByText("drop.galleryModalTitle")).not.toBeInTheDocument();
    expect(h.tracksGet).toHaveBeenCalledWith("trk_sel");
  });

  it("falls back to the gallery modal with no cover target and nothing playing", async () => {
    render(<GlobalDropZone />);

    pasteImage();

    expect(await screen.findByText("drop.galleryModalTitle")).toBeInTheDocument();
    expect(screen.queryByTestId("crop-dialog")).not.toBeInTheDocument();
    expect(h.tracksGet).not.toHaveBeenCalled();
  });
});
