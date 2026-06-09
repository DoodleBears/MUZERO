import { describe, expect, it } from "vitest";
import type { CloudDrive } from "@/db/types";
import { resolvePresenceDrive } from "./use-remote-presence";

function drive(id: string, publicBaseUrl?: string): CloudDrive {
  return {
    id,
    label: id,
    kind: "shared",
    provider: "r2",
    publicBaseUrl,
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
}

describe("resolvePresenceDrive", () => {
  const drives = [
    drive("drv_lib_abc", "https://abc.example.com/muzero/"),
    drive("drv_lib_xyz", "https://xyz.example.com/muzero/"),
  ];

  it("resolves the source drive of a remote-imported set by id prefix", () => {
    const resolved = resolvePresenceDrive("ses_remote_drv_lib_abc_ses_tokyo", drives);
    expect(resolved?.id).toBe("drv_lib_abc");
  });

  it("returns null for a local (non-remote) session", () => {
    expect(resolvePresenceDrive("ses_local_123", drives)).toBeNull();
    expect(resolvePresenceDrive(null, drives)).toBeNull();
  });

  it("returns null when the matched drive has no public base URL", () => {
    const noUrl = [drive("drv_lib_abc")];
    expect(resolvePresenceDrive("ses_remote_drv_lib_abc_ses_tokyo", noUrl)).toBeNull();
  });

  it("does not match a different drive's sets", () => {
    const resolved = resolvePresenceDrive("ses_remote_drv_lib_xyz_ses_a", drives);
    expect(resolved?.id).toBe("drv_lib_xyz");
  });
});
