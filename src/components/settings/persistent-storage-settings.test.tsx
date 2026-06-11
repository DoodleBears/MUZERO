import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PersistentStorageSettings } from "./persistent-storage-settings";

const mocks = vi.hoisted(() => ({
  cleanupOrphans: vi.fn(),
  migrateWithProgress: vi.fn(),
  notifySuccess: vi.fn(),
  summary: {
    count: 2,
    bytes: 12,
    legacyMediaCount: 2,
    missingCount: 0,
    orphanedCount: 0,
    byBackend: {
      indexeddb: { count: 2, bytes: 12 },
      opfs: { count: 0, bytes: 0 },
      "electron-file": { count: 0, bytes: 0 },
    },
    byRole: {
      media: { count: 2, bytes: 12 },
    },
  },
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => mocks.summary,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@/db/media-blob-storage", () => ({
  cleanupOrphanedMediaStorageFiles: mocks.cleanupOrphans,
  migrateLegacyMediaBlobsWithProgress: mocks.migrateWithProgress,
  summarizePersistentMediaStorage: vi.fn(),
}));

vi.mock("@/stores/notification-store", () => ({
  notify: {
    success: mocks.notifySuccess,
  },
}));

describe("PersistentStorageSettings", () => {
  it("shows migration progress while legacy media is migrating", async () => {
    mocks.migrateWithProgress.mockImplementationOnce(async (_db, options) => {
      await options.onProgress({
        cancelled: false,
        failed: 0,
        migrated: 0,
        processed: 0,
        skipped: 0,
        total: 2,
      });
      await options.onProgress({
        cancelled: false,
        current: { bytes: 6, id: "blb_a", role: "media" },
        failed: 0,
        migrated: 1,
        processed: 1,
        skipped: 0,
        total: 2,
      });
      return {
        cancelled: false,
        failed: 0,
        migrated: 2,
        processed: 2,
        skipped: 0,
        total: 2,
      };
    });

    render(<PersistentStorageSettings />);

    fireEvent.click(screen.getByRole("button", { name: /streamCache.permanentMigrate/ }));

    await waitFor(() => {
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    });
    expect(screen.getByText(/^streamCache\.permanentProgress /)).toHaveTextContent('"processed":2');
    expect(screen.getByText(/^streamCache\.permanentProgressDetail /)).toHaveTextContent(
      '"migrated":2',
    );
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      expect.stringContaining("streamCache.permanentMigrateDone"),
    );
  });
});
