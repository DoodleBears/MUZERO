import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import "@/i18n/i18n"; // initialize i18next so chrome strings resolve
import { latestVersion } from "@/content/changelog";
import { getLastSeenVersion } from "@/lib/changelog-seen";
import { ChangelogModal, openChangelog } from "./changelog-modal";

const SEEN_KEY = "muzero:changelog:lastSeenVersion";

beforeEach(() => localStorage.clear());

describe("ChangelogModal", () => {
  it("auto-opens with only the unseen releases when returning after a gap", async () => {
    localStorage.setItem(SEEN_KEY, "0.5.0");
    render(<ChangelogModal />);

    expect(
      await screen.findByText("Faster imports and a cleaner desktop shell"),
    ).toBeInTheDocument();
    expect(screen.getByText("Immersive, fluid, and self-updating")).toBeInTheDocument();
    expect(screen.getByText("Online sources & word-by-word lyrics")).toBeInTheDocument();
    // 0.5.0 and older are already seen → not shown.
    expect(screen.queryByText("A real music library")).not.toBeInTheDocument();
  });

  it("does not auto-open when already up to date", async () => {
    localStorage.setItem(SEEN_KEY, latestVersion);
    render(<ChangelogModal />);
    await waitFor(() =>
      expect(
        screen.queryByText("Faster imports and a cleaner desktop shell"),
      ).not.toBeInTheDocument(),
    );
  });

  it("first-ever visit: opens with the full bundled history and does not seed lastSeen", async () => {
    render(<ChangelogModal />);
    expect(await screen.findByText("An AI DJ and a player in one")).toBeInTheDocument();
    expect(screen.getByText("Faster imports and a cleaner desktop shell")).toBeInTheDocument();
    expect(getLastSeenVersion()).toBeNull();
  });

  it("opens the FULL history on the open event", async () => {
    localStorage.setItem(SEEN_KEY, latestVersion);
    render(<ChangelogModal />);
    act(() => openChangelog());
    expect(await screen.findByText("An AI DJ and a player in one")).toBeInTheDocument();
    expect(screen.getByText("Faster imports and a cleaner desktop shell")).toBeInTheDocument();
    expect(screen.getByText("Immersive, fluid, and self-updating")).toBeInTheDocument();
  });

  it("acknowledges up to the latest version only when closed until next update", async () => {
    localStorage.setItem(SEEN_KEY, "0.5.0");
    render(<ChangelogModal />);
    const closeUntilNextUpdate = await screen.findByRole("button", {
      name: "Close until next update",
    });
    fireEvent.click(closeUntilNextUpdate);
    await waitFor(() => expect(getLastSeenVersion()).toBe(latestVersion));
  });

  it("keeps the last-seen version unchanged when closed temporarily", async () => {
    localStorage.setItem(SEEN_KEY, "0.5.0");
    render(<ChangelogModal />);
    const close = await screen.findByRole("button", { name: "Close" });
    fireEvent.click(close);
    await waitFor(() => expect(getLastSeenVersion()).toBe("0.5.0"));
  });
});
