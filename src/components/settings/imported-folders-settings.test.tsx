import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportedFoldersSettings } from "./imported-folders-settings";

const mocks = vi.hoisted(() => ({
  hasFolderAccess: vi.fn(),
  importFolder: vi.fn(),
  syncImportFolders: vi.fn(),
  isUploading: false,
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
  useSettings: () => ({ importFolders: [] }),
}));

vi.mock("@/lib/desktop/bridge", () => ({
  hasFolderAccess: () => mocks.hasFolderAccess(),
}));

vi.mock("@/db/repositories", () => ({
  removeImportFolder: vi.fn(),
  updateImportFolder: vi.fn(),
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
    mocks.syncImportFolders.mockResolvedValue(undefined);
    mocks.isUploading = false;
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
});
