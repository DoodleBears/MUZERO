import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CloudDrive } from "@/db/types";
import { CloudDriveSyncControls } from "./cloud-drive-sync-controls";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    disabled,
    onValueChange,
    value,
    "aria-label": ariaLabel,
  }: {
    "aria-label"?: string;
    children: ReactNode;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    value?: string | number;
  }) => (
    <select
      aria-label={ariaLabel}
      disabled={disabled}
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ children, value }: { children: ReactNode; value: string | number }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => children,
  SelectValue: () => null,
}));

const drive: CloudDrive = {
  id: "drv_sync",
  label: "Sync Drive",
  kind: "owned",
  provider: "r2",
  capabilities: {
    read: true,
    write: true,
    manageInvites: false,
    writeStats: true,
    writePresence: true,
  },
  autoSyncFrequency: "manual",
  uploadConcurrency: 2,
  createdAt: 0,
  updatedAt: 0,
};

describe("CloudDriveSyncControls", () => {
  it("renders frequency and upload-concurrency controls for writable drives", () => {
    const onAutoSyncFrequencyChange = vi.fn();
    const onUploadConcurrencyChange = vi.fn();

    render(
      <CloudDriveSyncControls
        drive={drive}
        onAutoSyncFrequencyChange={onAutoSyncFrequencyChange}
        onUploadConcurrencyChange={onUploadConcurrencyChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("settings.cloudAutoSyncFrequency"), {
      target: { value: "30min" },
    });
    fireEvent.change(screen.getByLabelText("settings.cloudUploadConcurrency"), {
      target: { value: "3" },
    });

    expect(onAutoSyncFrequencyChange).toHaveBeenCalledWith("30min");
    expect(onUploadConcurrencyChange).toHaveBeenCalledWith(3);
  });

  it("disables write controls for read-only drives", () => {
    render(
      <CloudDriveSyncControls
        drive={{
          ...drive,
          capabilities: { ...drive.capabilities, write: false },
        }}
        onAutoSyncFrequencyChange={vi.fn()}
        onUploadConcurrencyChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("settings.cloudAutoSyncFrequency")).toBeDisabled();
    expect(screen.getByLabelText("settings.cloudUploadConcurrency")).toBeDisabled();
  });
});
