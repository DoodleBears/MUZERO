import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CoverCropDialog } from "./cover-crop-dialog";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-media", () => ({ useObjectUrl: () => "blob:preview" }));
// Fire onCropComplete synchronously so the dialog has a crop rect to confirm.
vi.mock("react-easy-crop", () => ({
  default: ({ onCropComplete }: { onCropComplete?: (a: unknown, p: unknown) => void }) => {
    onCropComplete?.({}, { x: 1, y: 2, width: 3, height: 4 });
    return <div data-testid="cropper" />;
  },
}));

const FILE = new File([new Uint8Array([1])], "c.png", { type: "image/png" });
const RECT = { x: 1, y: 2, width: 3, height: 4 };

describe("CoverCropDialog", () => {
  it("confirms the primary action with the cropped rect", () => {
    const onConfirm = vi.fn();
    render(<CoverCropDialog file={FILE} onConfirm={onConfirm} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText("crop.apply"));
    expect(onConfirm).toHaveBeenCalledWith(RECT);
  });

  it("renders a second button that confirms with its own handler", () => {
    const onConfirm = vi.fn();
    const onSecondary = vi.fn();
    render(
      <CoverCropDialog
        file={FILE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        confirmLabel="primary.label"
        secondary={{ label: "secondary.label", onConfirm: onSecondary }}
      />,
    );

    fireEvent.click(screen.getByText("secondary.label"));
    expect(onSecondary).toHaveBeenCalledWith(RECT);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("primary.label"));
    expect(onConfirm).toHaveBeenCalledWith(RECT);
  });

  it("Enter confirms the PRIMARY action (the default target)", () => {
    const onConfirm = vi.fn();
    render(
      <CoverCropDialog
        file={FILE}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        confirmLabel="primary.label"
        secondary={{ label: "secondary.label", onConfirm: vi.fn() }}
      />,
    );

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith(RECT);
  });
});
