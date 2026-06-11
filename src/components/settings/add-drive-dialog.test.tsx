import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/db/types";
import { AddDriveDialog } from "./add-drive-dialog";

const mocks = vi.hoisted(() => ({
  checkR2PublicRead: vi.fn(),
  checkR2WriteAccess: vi.fn(),
  saveSettings: vi.fn(),
  upsertCloudDrive: vi.fn(),
  publishDrive: vi.fn(),
  onOpenChange: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/db/repositories", () => ({
  saveSettings: (...args: unknown[]) => mocks.saveSettings(...args),
}));

vi.mock("@/sync/cloud-drive-repo", () => ({
  upsertCloudDrive: (...args: unknown[]) => mocks.upsertCloudDrive(...args),
}));

vi.mock("@/sync/r2-healthcheck", () => ({
  checkR2PublicRead: (...args: unknown[]) => mocks.checkR2PublicRead(...args),
  checkR2WriteAccess: (...args: unknown[]) => mocks.checkR2WriteAccess(...args),
  maskSecret: (value: string) => `${value.slice(0, 2)}...`,
}));

vi.mock("@/sync/owner-r2-connection", () => ({
  buildOwnerR2Connection: () => ({
    manifestUrl: "https://pub.example.com/muzero/manifest.json",
    publicBaseUrl: "https://pub.example.com/muzero/",
    credentials: {
      accountId: "account",
      bucket: "muzero",
      accessKeyId: "key",
      secretAccessKey: "secret",
      endpointUrl: "https://account.r2.cloudflarestorage.com",
    },
  }),
}));

vi.mock("@/stores/sync-store", () => ({
  useSyncStore: {
    getState: () => ({ publishDrive: (...args: unknown[]) => mocks.publishDrive(...args) }),
  },
}));

describe("AddDriveDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkR2PublicRead.mockResolvedValue({
      ok: true,
      preview: { title: "MUZERO R2" },
      checks: [],
    });
    mocks.checkR2WriteAccess.mockResolvedValue({ ok: true, checks: [] });
    mocks.upsertCloudDrive.mockImplementation(async (drive) => drive);
    mocks.saveSettings.mockResolvedValue(undefined);
    mocks.publishDrive.mockResolvedValue(undefined);
  });

  it("offers post-add sync choices and honors them for a writable R2 drive", async () => {
    render(
      <AddDriveDialog
        open
        onOpenChange={mocks.onOpenChange}
        settings={{ r2CredentialsByDriveId: {} } as AppSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("settings.cloudOwnerEndpoint"), {
      target: { value: "https://account.r2.cloudflarestorage.com" },
    });
    fireEvent.change(screen.getByLabelText("settings.cloudOwnerBucket"), {
      target: { value: "muzero" },
    });
    fireEvent.change(screen.getByLabelText("settings.cloudOwnerAccessKey"), {
      target: { value: "key" },
    });
    fireEvent.change(screen.getByLabelText("settings.cloudOwnerSecretKey"), {
      target: { value: "secret" },
    });
    fireEvent.change(screen.getByLabelText("settings.cloudOwnerPublicUrl"), {
      target: { value: "https://pub.example.com/muzero/" },
    });

    fireEvent.click(screen.getByRole("button", { name: /settings.cloudOwnerValidate/ }));
    await screen.findByText("settings.addDriveValidated");
    fireEvent.click(screen.getByRole("button", { name: "settings.addDriveNext" }));

    expect(screen.getByText("settings.addDriveAfterAddTitle")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("settings.addDriveSyncAfterAdd"));
    fireEvent.click(screen.getByLabelText("settings.addDriveAutoSyncAfterChanges"));
    fireEvent.click(screen.getByRole("button", { name: "settings.addDriveFinish" }));

    await waitFor(() => expect(mocks.upsertCloudDrive).toHaveBeenCalled());
    const drive = mocks.upsertCloudDrive.mock.calls[0]?.[0];
    expect(drive).toMatchObject({
      kind: "owned",
      autoSyncFrequency: "change-debounce",
    });
    expect(mocks.saveSettings).toHaveBeenCalled();
    expect(mocks.publishDrive).toHaveBeenCalledWith(drive.id);
    expect(mocks.onOpenChange).toHaveBeenCalledWith(false);
  });
});
