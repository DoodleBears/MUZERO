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
const loadRemoteDeviceProfiles = vi.fn();
const importRemoteEntityCovers = vi.fn();
const pullRemoteSet = vi.fn();
const getLocalDevice = vi.fn();

vi.mock("@/sync/r2-subscription", () => ({
  subscribeManifest: (...args: unknown[]) => subscribeManifest(...args),
  loadRemoteSetIndex: (...args: unknown[]) => loadRemoteSetIndex(...args),
  loadRemoteEntityCovers: (...args: unknown[]) => loadRemoteEntityCovers(...args),
  loadRemoteDeviceProfiles: (...args: unknown[]) => loadRemoteDeviceProfiles(...args),
}));
vi.mock("@/sync/r2-import-stream", () => ({
  importRemoteEntityCovers: (...args: unknown[]) => importRemoteEntityCovers(...args),
}));
vi.mock("@/sync/device-repo", () => ({
  getLocalDevice: (...args: unknown[]) => getLocalDevice(...args),
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
    getLocalDevice.mockResolvedValue(undefined);
    loadRemoteDeviceProfiles.mockResolvedValue(new Map());
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

  it("hides legacy empty duplicate set previews when a repaired non-empty set exists", async () => {
    subscribeManifest.mockResolvedValueOnce({
      ...preview,
      sets: [
        {
          ...preview.sets[0]!,
          id: "ses_old_empty",
          trackCount: 0,
          bytes: 434,
          publishedBy: "dvc_friend",
        },
        {
          ...preview.sets[0]!,
          id: "ses_repaired",
          trackCount: 79,
          bytes: 129_000,
          publishedBy: "dvc_friend",
        },
        {
          ...preview.sets[0]!,
          id: "ses_empty_unique",
          title: "Empty Draft",
          trackCount: 0,
          bytes: 439,
          publishedBy: "dvc_friend",
        },
        {
          ...preview.sets[0]!,
          id: "ses_empty_unique_duplicate",
          title: "Empty   Draft",
          trackCount: 0,
          bytes: 441,
          publishedBy: "dvc_friend",
        },
      ],
    });

    render(<CloudDriveSets drive={drive} />);
    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getAllByText("Tokyo Night Drive")).toHaveLength(1));
    expect(screen.getAllByText("Empty Draft")).toHaveLength(1);
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

  it("loads remote device profiles and passes source attribution into the pull", async () => {
    const attributedPreview = {
      ...preview,
      sets: [{ ...preview.sets[0]!, publishedBy: "dvc_friend" }],
    };
    const profiles = new Map([
      [
        "dvc_friend",
        {
          devicePublicId: "dvc_friend",
          displayName: "Friend phone",
          avatarSeed: "green",
          avatarUrl: "https://pub.example.com/muzero/objects/avatars/friend.jpg",
        },
      ],
    ]);
    subscribeManifest.mockResolvedValueOnce(attributedPreview);
    loadRemoteDeviceProfiles.mockResolvedValueOnce(profiles);
    const remoteSet = { indexUrl: attributedPreview.sets[0]!.indexUrl, index: {}, tracks: [] };
    loadRemoteSetIndex.mockResolvedValueOnce(remoteSet);
    pullRemoteSet.mockResolvedValueOnce(undefined);

    render(<CloudDriveSets drive={drive} />);
    fireEvent.click(screen.getByRole("button"));
    await screen.findByText("Friend phone");
    fireEvent.click(screen.getByRole("button", { name: /cloudImport/ }));

    await waitFor(() => expect(pullRemoteSet).toHaveBeenCalled());
    expect(loadRemoteDeviceProfiles).toHaveBeenCalledWith(attributedPreview);
    expect(pullRemoteSet).toHaveBeenCalledWith({
      driveId: drive.id,
      remoteSet,
      source: {
        driveId: drive.id,
        driveLabel: drive.label,
        devicePublicId: "dvc_friend",
        displayName: "Friend phone",
        avatarSeed: "green",
        avatarUrl: "https://pub.example.com/muzero/objects/avatars/friend.jpg",
      },
    });
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
    expect(pullRemoteSet).toHaveBeenCalledWith({
      driveId: "drv_lib_abc",
      remoteSet,
      source: expect.objectContaining({ driveId: drive.id, driveLabel: drive.label }),
    });
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
    expect(pullRemoteSet).toHaveBeenNthCalledWith(1, {
      driveId: drive.id,
      remoteSet: remoteSetA,
      source: expect.objectContaining({ driveId: drive.id, driveLabel: drive.label }),
    });
    expect(pullRemoteSet).toHaveBeenNthCalledWith(2, {
      driveId: drive.id,
      remoteSet: remoteSetB,
      source: expect.objectContaining({ driveId: drive.id, driveLabel: drive.label }),
    });
  });

  it("uses freshly loaded device profiles when automatic sync imports sets", async () => {
    const attributedPreview = {
      ...preview,
      sets: [{ ...preview.sets[0]!, publishedBy: "dvc_friend" }],
    };
    const profiles = new Map([
      [
        "dvc_friend",
        {
          devicePublicId: "dvc_friend",
          displayName: "Friend phone",
          avatarSeed: "green",
          avatarUrl: "https://pub.example.com/muzero/objects/avatars/friend.jpg",
        },
      ],
    ]);
    subscribeManifest.mockResolvedValueOnce(attributedPreview);
    loadRemoteDeviceProfiles.mockResolvedValueOnce(profiles);
    loadRemoteEntityCovers.mockResolvedValueOnce(undefined);
    const remoteSet = { indexUrl: attributedPreview.sets[0]!.indexUrl, index: {}, tracks: [] };
    loadRemoteSetIndex.mockResolvedValueOnce(remoteSet);
    pullRemoteSet.mockResolvedValue(undefined);

    render(<CloudDriveSets drive={{ ...drive, autoSyncFrequency: "change-debounce" }} />);

    await waitFor(() => expect(pullRemoteSet).toHaveBeenCalledTimes(1));
    expect(pullRemoteSet).toHaveBeenCalledWith({
      driveId: drive.id,
      remoteSet,
      source: {
        driveId: drive.id,
        driveLabel: drive.label,
        devicePublicId: "dvc_friend",
        displayName: "Friend phone",
        avatarSeed: "green",
        avatarUrl: "https://pub.example.com/muzero/objects/avatars/friend.jpg",
      },
    });
  });

  it("skips legacy empty duplicate set previews during automatic import-all", async () => {
    const repairedPreview = {
      ...multiPreview,
      sets: [
        {
          ...multiPreview.sets[0]!,
          id: "ses_old_empty",
          trackCount: 0,
          bytes: 434,
          publishedBy: "dvc_a",
        },
        {
          ...multiPreview.sets[0]!,
          id: "ses_repaired",
          trackCount: 79,
          bytes: 129_000,
          publishedBy: "dvc_a",
        },
      ],
    };
    subscribeManifest.mockResolvedValueOnce(repairedPreview);
    loadRemoteEntityCovers.mockResolvedValueOnce(undefined);
    const remoteSet = { indexUrl: repairedPreview.sets[1]!.indexUrl, index: {}, tracks: [] };
    loadRemoteSetIndex.mockResolvedValueOnce(remoteSet);
    pullRemoteSet.mockResolvedValue(undefined);

    render(<CloudDriveSets drive={{ ...drive, autoSyncFrequency: "change-debounce" }} />);

    await waitFor(() => expect(pullRemoteSet).toHaveBeenCalledTimes(1));
    expect(loadRemoteSetIndex).toHaveBeenCalledWith(repairedPreview, repairedPreview.sets[1]);
    expect(loadRemoteSetIndex).not.toHaveBeenCalledWith(repairedPreview, repairedPreview.sets[0]);
  });

  it("skips self-published sets during automatic import-all to avoid duplicating local sets", async () => {
    getLocalDevice.mockResolvedValue({ publicId: "dvc_b" });
    const selfAwarePreview = {
      ...multiPreview,
      sets: [
        { ...multiPreview.sets[0]!, publishedBy: "dvc_a" },
        { ...multiPreview.sets[1]!, publishedBy: "dvc_b" },
      ],
    };
    subscribeManifest.mockResolvedValueOnce(selfAwarePreview);
    loadRemoteEntityCovers.mockResolvedValueOnce(undefined);
    const remoteSetA = { indexUrl: selfAwarePreview.sets[0]!.indexUrl, index: {}, tracks: [] };
    loadRemoteSetIndex.mockResolvedValueOnce(remoteSetA);
    pullRemoteSet.mockResolvedValue(undefined);

    render(<CloudDriveSets drive={{ ...drive, autoSyncFrequency: "change-debounce" }} />);

    await waitFor(() => expect(pullRemoteSet).toHaveBeenCalledTimes(1));
    expect(loadRemoteSetIndex).toHaveBeenCalledWith(selfAwarePreview, selfAwarePreview.sets[0]);
    expect(loadRemoteSetIndex).not.toHaveBeenCalledWith(selfAwarePreview, selfAwarePreview.sets[1]);
    expect(pullRemoteSet).toHaveBeenCalledWith({
      driveId: drive.id,
      remoteSet: remoteSetA,
      source: expect.objectContaining({
        driveId: drive.id,
        driveLabel: drive.label,
        devicePublicId: "dvc_a",
      }),
    });
  });

  it("treats a missing manifest as an empty unpublished drive", async () => {
    subscribeManifest.mockRejectedValueOnce(new Error("Failed to fetch manifest: HTTP 404"));

    render(<CloudDriveSets drive={drive} />);
    fireEvent.click(screen.getByRole("button"));

    await screen.findByText("settings.cloudPreviewEmpty");
    expect(loadRemoteEntityCovers).not.toHaveBeenCalled();
  });
});
