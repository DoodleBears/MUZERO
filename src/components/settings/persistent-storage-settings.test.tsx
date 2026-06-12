import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersistentStorageSettings } from "./persistent-storage-settings";

const mocks = vi.hoisted(() => ({
  cleanupOrphans: vi.fn(),
  countCoverMetadataBackfillCandidates: vi.fn(),
  coverRepairCount: 3,
  migrateWithProgress: vi.fn(),
  notifySuccess: vi.fn(),
  repairCoverMetadata: vi.fn(),
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
  useLiveQuery: (_query: unknown, _deps: unknown, defaultValue: unknown) =>
    typeof defaultValue === "number" ? mocks.coverRepairCount : mocks.summary,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@/components/settings/stream-cache-controls", () => ({
  StreamCacheControls: () => <div>stream-cache-controls</div>,
}));

vi.mock("@/db/media-blob-storage", () => ({
  cleanupOrphanedMediaStorageFiles: mocks.cleanupOrphans,
  migrateLegacyMediaBlobsWithProgress: mocks.migrateWithProgress,
  summarizePersistentMediaStorage: vi.fn(),
}));

vi.mock("@/db/repositories", () => ({
  backfillCoverMetadata: mocks.repairCoverMetadata,
  countCoverMetadataBackfillCandidates: mocks.countCoverMetadataBackfillCandidates,
}));

vi.mock("@/stores/notification-store", () => ({
  notify: {
    success: mocks.notifySuccess,
  },
}));

describe("PersistentStorageSettings", () => {
  beforeEach(() => {
    mocks.cleanupOrphans.mockReset();
    mocks.countCoverMetadataBackfillCandidates.mockReset();
    mocks.coverRepairCount = 3;
    mocks.migrateWithProgress.mockReset();
    mocks.notifySuccess.mockReset();
    mocks.repairCoverMetadata.mockReset();
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: vi.fn(async () => ({ quota: 1024, usage: 512 })),
      },
    });
  });

  it("shows a storage quota progress bar when browser usage is available", async () => {
    render(<PersistentStorageSettings />);

    const progress = await screen.findByRole("progressbar", {
      name: "settings.storageUsageTitle",
    });

    expect(progress).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText(/^settings\.storageUsageRatio /)).toHaveTextContent('"percent":50');
    expect(screen.getByText("stream-cache-controls")).toBeInTheDocument();
  });

  it("falls back without a progress bar when quota is unavailable", async () => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        estimate: vi.fn(async () => ({ usage: 512 })),
      },
    });

    render(<PersistentStorageSettings />);

    await screen.findByText(/^settings\.storageUsageUnavailable /);
    expect(
      screen.queryByRole("progressbar", { name: "settings.storageUsageTitle" }),
    ).not.toBeInTheDocument();
  });

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
      expect(
        screen.getByRole("progressbar", { name: /^streamCache\.permanentProgress / }),
      ).toHaveAttribute("aria-valuenow", "100");
    });
    expect(screen.getByText(/^streamCache\.permanentProgress /)).toHaveTextContent('"processed":2');
    expect(screen.getByText(/^streamCache\.permanentProgressDetail /)).toHaveTextContent(
      '"migrated":2',
    );
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      expect.stringContaining("streamCache.permanentMigrateDone"),
    );
  });

  it("repairs cover color metadata on demand", async () => {
    mocks.repairCoverMetadata.mockResolvedValueOnce({ attempted: ["blb_a"], updated: 1 });

    render(<PersistentStorageSettings />);

    fireEvent.click(screen.getByRole("button", { name: /streamCache.permanentRepairCovers/ }));

    await waitFor(() => {
      expect(mocks.repairCoverMetadata).toHaveBeenCalledWith(undefined, { limit: 500 });
    });
    expect(mocks.notifySuccess).toHaveBeenCalledWith(
      expect.stringContaining("streamCache.permanentRepairCoversDone"),
    );
  });
});
