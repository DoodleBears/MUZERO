import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportedFoldersSettings } from "./imported-folders-settings";

const mocks = vi.hoisted(() => ({
  hasFolderAccess: vi.fn(),
  importFolder: vi.fn(),
  resetImportedFolders: vi.fn(),
  settings: { importFolders: [] as Array<{ id: string; path: string; setId: string }> },
  syncImportFolders: vi.fn(),
  isUploading: false,
  notifySuccess: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSessions: () => [],
  useSettings: () => mocks.settings,
}));

vi.mock("@/lib/desktop/bridge", () => ({
  hasFolderAccess: () => mocks.hasFolderAccess(),
}));

vi.mock("@/db/repositories", () => ({
  removeImportFolder: vi.fn(),
  resetImportedFolders: mocks.resetImportedFolders,
  updateImportFolder: vi.fn(),
}));

vi.mock("@/stores/notification-store", () => ({
  notify: {
    error: vi.fn(),
    success: mocks.notifySuccess,
  },
}));

vi.mock("@/stores/player-store", () => ({
  usePlayerStore: (selector: (state: unknown) => unknown) =>
    selector({
      importFolder: mocks.importFolder,
      isUploading: mocks.isUploading,
      syncImportFolders: mocks.syncImportFolders,
    }),
}));

describe("ImportedFoldersSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasFolderAccess.mockReturnValue(true);
    mocks.importFolder.mockResolvedValue(true);
    mocks.resetImportedFolders.mockResolvedValue({ foldersRemoved: 1, tracksDeleted: 2 });
    mocks.settings = { importFolders: [] };
    mocks.syncImportFolders.mockResolvedValue(undefined);
    mocks.isUploading = false;
    mocks.notifySuccess.mockReset();
  });

  it("shows a primary add-local-folder action in the local files card header", () => {
    render(<ImportedFoldersSettings />);

    fireEvent.click(screen.getByRole("button", { name: "settings.importFolderAdd" }));

    expect(mocks.importFolder).toHaveBeenCalledTimes(1);
  });

  it("does not show the add action when folder access is unavailable", () => {
    mocks.hasFolderAccess.mockReturnValue(false);

    render(<ImportedFoldersSettings />);

    expect(
      screen.queryByRole("button", { name: "settings.importFolderAdd" }),
    ).not.toBeInTheDocument();
  });

  it("resets remembered folder imports after confirmation", async () => {
    mocks.settings = {
      importFolders: [{ id: "imf_1", path: "/music", setId: "ses_1" }],
    };

    render(<ImportedFoldersSettings />);

    fireEvent.click(screen.getByRole("button", { name: "settings.importFoldersReset" }));
    fireEvent.click(screen.getByRole("button", { name: "settings.importFoldersResetConfirm" }));

    await waitFor(() => expect(mocks.resetImportedFolders).toHaveBeenCalledTimes(1));
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      'settings.importFoldersResetDone {"folders":1,"tracks":2}',
    );
  });
});
