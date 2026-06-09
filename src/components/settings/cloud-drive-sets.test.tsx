import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CloudDrive } from "@/db/types";
import { CloudDriveSets } from "./cloud-drive-sets";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const subscribeManifest = vi.fn();
const loadRemoteSetIndex = vi.fn();
const importRemoteSetStream = vi.fn();

vi.mock("@/sync/r2-subscription", () => ({
  subscribeManifest: (...args: unknown[]) => subscribeManifest(...args),
  loadRemoteSetIndex: (...args: unknown[]) => loadRemoteSetIndex(...args),
}));
vi.mock("@/sync/r2-import-stream", () => ({
  importRemoteSetStream: (...args: unknown[]) => importRemoteSetStream(...args),
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

describe("CloudDriveSets", () => {
  it("loads and lists the drive's remote sets on browse", async () => {
    subscribeManifest.mockResolvedValueOnce(preview);
    render(<CloudDriveSets drive={drive} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(screen.getByText("Tokyo Night Drive")).toBeTruthy());
    expect(subscribeManifest).toHaveBeenCalledWith(drive.manifestUrl);
  });

  it("imports a set via loadRemoteSetIndex + importRemoteSetStream keyed by the drive id", async () => {
    subscribeManifest.mockResolvedValueOnce(preview);
    const remoteSet = { indexUrl: preview.sets[0]!.indexUrl, index: {}, tracks: [] };
    loadRemoteSetIndex.mockResolvedValueOnce(remoteSet);
    importRemoteSetStream.mockResolvedValueOnce({ sessionId: "s", trackIds: [] });

    render(<CloudDriveSets drive={drive} />);
    fireEvent.click(screen.getByRole("button"));
    await screen.findByText("Tokyo Night Drive");

    const importBtn = screen.getByRole("button", { name: /cloudImport/ });
    fireEvent.click(importBtn);

    await waitFor(() => expect(importRemoteSetStream).toHaveBeenCalled());
    expect(loadRemoteSetIndex).toHaveBeenCalledWith(preview, preview.sets[0]);
    expect(importRemoteSetStream).toHaveBeenCalledWith({ driveId: "drv_lib_abc", remoteSet });
  });
});
