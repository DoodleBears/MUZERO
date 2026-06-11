import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTrace, traceDiagnosticEvent } from "@/lib/trace";
import { TraceDiagnostics } from "./trace-diagnostics";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

describe("TraceDiagnostics", () => {
  afterEach(() => {
    clearTrace();
    vi.restoreAllMocks();
  });

  it("filters by level/category/error kind and shows repro steps", () => {
    traceDiagnosticEvent("info", "ui.action", "play.click", "track play clicked", {
      category: "user-action",
      phase: "start",
      trackId: "trk_1",
      controlId: "track.play",
    });
    traceDiagnosticEvent("error", "stream.resolve", "resolve.failed", "stream resolve failed", {
      category: "stream",
      phase: "fail",
      errorKind: "http_status",
      traceId: "ply_1",
      trackId: "trk_1",
    });
    traceDiagnosticEvent("info", "stream.cache", "cache.success", "stream cache succeeded", {
      category: "cache",
      phase: "success",
      traceId: "ply_1",
    });

    render(<TraceDiagnostics />);

    expect(screen.getByText(/settings.traceCount/)).toHaveTextContent('"count":3');
    fireEvent.change(screen.getByLabelText("settings.traceLevel"), { target: { value: "error" } });
    expect(screen.getByText(/settings.traceCount/)).toHaveTextContent('"count":1');
    expect(screen.getByText(/resolve.failed/)).toBeInTheDocument();
    expect(screen.queryByText(/cache.success/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("settings.traceLevel"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("settings.traceCategory"), {
      target: { value: "user-action" },
    });
    expect(screen.getAllByText(/play.click/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/resolve.failed/)).not.toBeInTheDocument();
    expect(screen.getByText(/settings.traceRepro/)).toBeInTheDocument();
  });

  it("copies visible entries rather than always copying the full buffer", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    traceDiagnosticEvent("info", "ui.action", "play.click", "track play clicked", {
      category: "user-action",
      trackId: "trk_1",
    });
    traceDiagnosticEvent("error", "stream.resolve", "resolve.failed", "stream resolve failed", {
      category: "stream",
      errorKind: "http_status",
      traceId: "ply_1",
    });

    render(<TraceDiagnostics />);

    fireEvent.change(screen.getByLabelText("settings.traceLevel"), { target: { value: "error" } });
    fireEvent.click(screen.getByRole("button", { name: /settings.traceCopyVisible/ }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("resolve.failed");
    expect(writeText.mock.calls[0][0]).not.toContain("play.click");

    fireEvent.click(screen.getByRole("button", { name: /settings.traceCopyAll/ }));
    expect(writeText.mock.calls[1][0]).toContain("resolve.failed");
    expect(writeText.mock.calls[1][0]).toContain("play.click");
  });

  it("copies the latest traceId group as the current playback attempt", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    traceDiagnosticEvent("error", "stream.resolve", "resolve.failed", "old failed", {
      category: "stream",
      errorKind: "http_status",
      traceId: "ply_old",
    });
    traceDiagnosticEvent("info", "stream.resolve", "resolve.start", "new started", {
      category: "stream",
      traceId: "ply_new",
    });
    traceDiagnosticEvent("error", "player.media", "error", "new media failed", {
      category: "media",
      errorKind: "media_decode",
      traceId: "ply_new",
    });

    render(<TraceDiagnostics />);

    fireEvent.click(screen.getByRole("button", { name: /settings.traceCopyCurrent/ }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("ply_new");
    expect(writeText.mock.calls[0][0]).toContain("new media failed");
    expect(writeText.mock.calls[0][0]).not.toContain("ply_old");
  });

  it("clears active trace entries", () => {
    traceDiagnosticEvent("error", "stream.resolve", "resolve.failed", "stream resolve failed", {
      category: "stream",
      errorKind: "http_status",
    });

    render(<TraceDiagnostics />);

    fireEvent.click(screen.getByRole("button", { name: /settings.traceClear/ }));
    const logPanel = screen.getByText("settings.traceEmpty");
    expect(within(logPanel.parentElement as HTMLElement).getByText("settings.traceEmpty")).toBe(
      logPanel,
    );
  });
});
