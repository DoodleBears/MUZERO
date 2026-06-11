import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudDrive } from "@/db/types";
import { CloudDriveSets } from "./cloud-drive-sets";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const subscribeManifest = vi.fn();
const loadRemoteSetIndex = vi.fn();
const loadRemoteEntityCovers = vi.fn();
const importRemoteEntityCovers = vi.fn();
const pullRemoteSet = vi.fn();

vi.mock("@/sync/r2-subscription", () => ({
  subscribeManifest: (...args: unknown[]) => subscribeManifest(...args),
  loadRemoteSetIndex: (...args: unknown[]) => loadRemoteSetIndex(...args),
  loadRemoteEntityCovers: (...args: unknown[]) => loadRemoteEntityCovers(...args),
}));
vi.mock("@/sync/r2-import-stream", () => ({
  importRemoteEntityCovers: (...args: unknown[]) => importRemoteEntityCovers(...args),
}));
// The import goes through the orchestrated pull (audit F2): dry-run diff gates +
// pull syncRuns + the per-drive progress pipeline — never the raw importer.
vi.mock("@/stores/sync-store", () => ({
  useSyncStore: {
    getState: () => ({ pullRemoteSet: (...args: unknown[]) => pullRemoteSet(...args) }),
  },
}));

const drive: CloudDrive = {
  id: "drv_lib_abc",
  label: "Friend Drive",
  kind: "shared",
  provider: "r2",
  publicBaseUrl: "https://pub.example.com/muzero/",
  manifestUrl: "https://pub.example.com/muzero/manifest.json",
  capabilities: {
    read: true,
    write: false,
    manageInvites: false,
    writeStats: false,
    writePresence: false,
  },
  createdAt: 0,
  updatedAt: 0,
};

const preview = {
  manifestUrl: drive.manifestUrl,
  baseUrl: drive.publicBaseUrl,
  libraryId: "lib_abc",
  title: "Friend Drive",
  setCount: 1,
  trackCount: 2,
  totalBytes: 2048,
  updatedAt: "2026-06-10T00:00:00.000Z",
  manifest: {},
  sets: [
    {
      id: "ses_tokyo",
      title: "Tokyo Night Drive",
      indexUrl: "https://pub.example.com/muzero/sets/ses_tokyo/index.json",
      updatedAt: "2026-06-10T00:00:00.000Z",
      trackCount: 2,
      bytes: 2048,
    },
  ],
};

const multiPreview = {
  ...preview,
  setCount: 2,
  sets: [
    ...preview.sets,
    {
      id: "ses_osaka",
      title: "Osaka Sunrise",
      indexUrl: "https://pub.example.com/muzero/sets/ses_osaka/index.json",
      updatedAt: "2026-06-10T00:00:00.000Z",
      trackCount: 3,
      bytes: 4096,
    },
  ],
};

describe("CloudDriveSets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and lists the drive's remote sets on browse", async () => {
    subscribeManifest.mockResolvedValueOnce(preview);
    loadRemoteEntityCovers.mockResolvedValueOnce(undefined);
    render(<CloudDriveSets drive={drive} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText("Tokyo Night Drive")).toBeTruthy());
    expect(subscribeManifest).toHaveBeenCalledWith(drive.manifestUrl);
    expect(importRemoteEntityCovers).not.toHaveBeenCalled();
  });

  it("imports the drive's entity covers on browse when the manifest has them", async () => {
    subscribeManifest.mockResolvedValueOnce(preview);
    const covers = {
      baseUrl: preview.baseUrl,
      index: { schema: "muzero-r2-entity-covers-v1", updatedAt: 1, entries: [] },
    };
    loadRemoteEntityCovers.mockResolvedValueOnce(covers);
    importRemoteEntityCovers.mockResolvedValueOnce({ imported: 1, skipped: 0 });

    render(<CloudDriveSets drive={drive} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(importRemoteEntityCovers).toHaveBeenCalledWith(covers));
    expect(loadRemoteEntityCovers).toHaveBeenCalledWith(preview);
  });

  it("imports a set via loadRemoteSetIndex + the orchestrated pullRemoteSet keyed by the drive id", async () => {
    subscribeManifest.mockResolvedValueOnce(preview);
    const remoteSet = { indexUrl: preview.sets[0]!.indexUrl, index: {}, tracks: [] };
    loadRemoteSetIndex.mockResolvedValueOnce(remoteSet);
    pullRemoteSet.mockResolvedValueOnce(undefined);

    render(<CloudDriveSets drive={drive} />);
    fireEvent.click(screen.getByRole("button"));
    await screen.findByText("Tokyo Night Drive");

    const importBtn = screen.getByRole("button", { name: /cloudImport/ });
    fireEvent.click(importBtn);

    await waitFor(() => expect(pullRemoteSet).toHaveBeenCalled());
    expect(loadRemoteSetIndex).toHaveBeenCalledWith(preview, preview.sets[0]);
    expect(pullRemoteSet).toHaveBeenCalledWith({ driveId: "drv_lib_abc", remoteSet });
  });

  it("automatically imports every remote set for automatic-sync drives", async () => {
    subscribeManifest.mockResolvedValueOnce(multiPreview);
    loadRemoteEntityCovers.mockResolvedValueOnce(undefined);
    const remoteSetA = { indexUrl: multiPreview.sets[0]!.indexUrl, index: {}, tracks: [] };
    const remoteSetB = { indexUrl: multiPreview.sets[1]!.indexUrl, index: {}, tracks: [] };
    loadRemoteSetIndex.mockResolvedValueOnce(remoteSetA).mockResolvedValueOnce(remoteSetB);
    pullRemoteSet.mockResolvedValue(undefined);

    render(<CloudDriveSets drive={{ ...drive, autoSyncFrequency: "change-debounce" }} />);

    await waitFor(() => expect(pullRemoteSet).toHaveBeenCalledTimes(2));
    expect(subscribeManifest).toHaveBeenCalledWith(drive.manifestUrl);
    expect(loadRemoteSetIndex).toHaveBeenNthCalledWith(1, multiPreview, multiPreview.sets[0]);
    expect(loadRemoteSetIndex).toHaveBeenNthCalledWith(2, multiPreview, multiPreview.sets[1]);
    expect(pullRemoteSet).toHaveBeenNthCalledWith(1, { driveId: drive.id, remoteSet: remoteSetA });
    expect(pullRemoteSet).toHaveBeenNthCalledWith(2, { driveId: drive.id, remoteSet: remoteSetB });
  });

  it("treats a missing manifest as an empty unpublished drive", async () => {
    subscribeManifest.mockRejectedValueOnce(new Error("Failed to fetch manifest: HTTP 404"));

    render(<CloudDriveSets drive={drive} />);
    fireEvent.click(screen.getByRole("button"));

    await screen.findByText("settings.cloudPreviewEmpty");
    expect(loadRemoteEntityCovers).not.toHaveBeenCalled();
  });
});
