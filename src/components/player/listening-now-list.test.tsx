import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { R2Presence } from "@/sync/r2-presence";
import { ListeningNowList } from "./listening-now-list";

describe("ListeningNowList", () => {
  it("shows which trusted anonymous device is listening to which track", () => {
    render(
      <ListeningNowList
        ariaLabel="Listening now"
        presenceRows={[
          presence({ deviceName: "Studio phone", devicePublicId: "dvc_phone", trackId: "trk_1" }),
          presence({ deviceName: undefined, devicePublicId: "dvc_guest", trackId: "remote_2" }),
        ]}
        trackTitleById={new Map([["trk_1", "Blue Avenue"]])}
      />,
    );

    expect(screen.getByText("Studio phone")).toBeInTheDocument();
    expect(screen.getByText("Blue Avenue")).toBeInTheDocument();
    expect(screen.getByText("dvc_guest")).toBeInTheDocument();
    expect(screen.getByText("remote_2")).toBeInTheDocument();
  });

  it("renders nothing when there are no visible presence rows", () => {
    const { container } = render(<ListeningNowList ariaLabel="Listening now" presenceRows={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

function presence(overrides: Partial<R2Presence> = {}): R2Presence {
  return {
    schema: "muzero-r2-presence-v1",
    devicePublicId: "dvc_1",
    deviceName: "Studio",
    trackId: "trk_1",
    setId: "ses_1",
    state: "playing",
    positionSec: 12,
    updatedAt: 1_000,
    expiresAt: 121_000,
    ...overrides,
  };
}
