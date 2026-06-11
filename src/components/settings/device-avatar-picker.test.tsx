import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DeviceAvatarPicker } from "./device-avatar-picker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/track/cover-crop-dialog", () => ({
  CoverCropDialog: ({
    onConfirm,
    onCancel,
  }: {
    onConfirm: (rect: { x: number; y: number; width: number; height: number }) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="crop-dialog">
      <button type="button" onClick={() => onConfirm({ x: 1, y: 2, width: 40, height: 40 })}>
        confirm crop
      </button>
      <button type="button" onClick={onCancel}>
        cancel crop
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    loading,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => (
    <button type="button" disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
}));

describe("DeviceAvatarPicker", () => {
  it("opens the square crop flow before saving an uploaded avatar", async () => {
    const onSaveAvatar = vi.fn().mockResolvedValue(undefined);
    const file = new File(["avatar"], "avatar.png", { type: "image/png" });

    render(
      <DeviceAvatarPicker
        avatarUrl={null}
        fallbackStyle={{ background: "red" }}
        onSaveAvatar={onSaveAvatar}
      />,
    );

    fireEvent.change(screen.getByLabelText("settings.deviceAvatarUpload"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByText("confirm crop"));

    await waitFor(() =>
      expect(onSaveAvatar).toHaveBeenCalledWith(file, { x: 1, y: 2, width: 40, height: 40 }),
    );
    expect(screen.queryByTestId("crop-dialog")).not.toBeInTheDocument();
  });
});
