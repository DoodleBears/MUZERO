import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EntityCoverButton } from "./entity-cover-button";

const h = vi.hoisted(() => ({
  hasOverride: false,
  setEntityCover: vi.fn(async (..._a: unknown[]) => {}),
  clearEntityCover: vi.fn(async (..._a: unknown[]) => {}),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => h.hasOverride }));
vi.mock("@/db/muzero-db", () => ({ db: {} }));
vi.mock("@/hooks/use-media", () => ({ useEntityCoverUrl: () => null }));
vi.mock("@/db/repositories", () => ({
  setEntityCover: (...a: unknown[]) => h.setEntityCover(...a),
  clearEntityCover: (...a: unknown[]) => h.clearEntityCover(...a),
}));
vi.mock("@/components/track/cover-crop-dialog", () => ({
  CoverCropDialog: ({ onConfirm }: { onConfirm: (r: unknown) => void }) => (
    <button
      type="button"
      data-testid="crop-confirm"
      onClick={() => onConfirm({ x: 0, y: 0, width: 10, height: 10 })}
    />
  ),
}));

function dropImage(node: HTMLElement) {
  const file = new File([new Uint8Array([1, 2, 3])], "art.png", { type: "image/png" });
  fireEvent.drop(node, {
    dataTransfer: {
      types: ["Files"],
      items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      files: [file],
    },
  });
  return file;
}

beforeEach(() => {
  h.hasOverride = false;
  h.setEntityCover.mockReset();
  h.clearEntityCover.mockReset();
});

describe("EntityCoverButton", () => {
  it("sets the entity cover after dropping an image and confirming the crop", async () => {
    render(
      <EntityCoverButton entityKey="double j 姜峰" kind="artist" coverTrack={undefined} round />,
    );

    dropImage(screen.getByLabelText("gallery.coverHint"));
    fireEvent.click(await screen.findByTestId("crop-confirm"));

    expect(h.setEntityCover).toHaveBeenCalledWith(
      expect.objectContaining({ entityKey: "double j 姜峰", kind: "artist", mime: "image/png" }),
    );
  });

  it("shows a remove control only when a custom override exists and clears it", () => {
    h.hasOverride = true;
    render(<EntityCoverButton entityKey="k" kind="album" coverTrack={undefined} round={false} />);

    fireEvent.click(screen.getByLabelText("gallery.removeCover"));
    expect(h.clearEntityCover).toHaveBeenCalledWith("k");
  });

  it("hides the remove control with no override", () => {
    render(<EntityCoverButton entityKey="k" kind="album" coverTrack={undefined} round={false} />);
    expect(screen.queryByLabelText("gallery.removeCover")).not.toBeInTheDocument();
  });
});
