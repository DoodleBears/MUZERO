import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveTextFile } from "@/lib/save-text-file";
import { clearTrace, traceDiagnosticEvent } from "@/lib/trace";
import {
  appendTraceArchiveEntries,
  clearTraceArchive,
  createTraceArchive,
} from "@/lib/trace-archive";
import { TRACE_DIAGNOSTICS_RESUME_DELAY_MS, TraceDiagnostics } from "./trace-diagnostics";

vi.mock("@/lib/save-text-file", () => ({
  saveTextFile: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
  }),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
    "aria-label": ariaLabel,
  }: {
    "aria-label"?: string;
    children: ReactNode;
    onValueChange?: (value: string) => void;
    value?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onValueChange?.(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ children, value }: { children: ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => children,
  SelectValue: () => null,
}));

describe("TraceDiagnostics", () => {
  afterEach(async () => {
    vi.useRealTimers();
    clearTrace();
    await clearTraceArchive();
    window.localStorage.clear();
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

    renderReadyTraceDiagnostics();

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

  it("pauses trace subscription while inactive and refreshes when active again", () => {
    traceDiagnosticEvent("info", "ui.action", "initial.click", "initial action", {
      category: "user-action",
    });

    const { rerender } = renderReadyTraceDiagnostics({ active: false });

    expect(screen.getByText(/settings.traceCount/)).toHaveTextContent('"total":0');
    expect(screen.queryByText(/initial.click/)).not.toBeInTheDocument();

    act(() => {
      traceDiagnosticEvent("error", "stream.resolve", "resolve.failed", "stream resolve failed", {
        category: "stream",
        errorKind: "http_status",
      });
    });

    expect(screen.getByText(/settings.traceCount/)).toHaveTextContent('"total":0');
    expect(screen.queryByText(/resolve.failed/)).not.toBeInTheDocument();

    rerender(<TraceDiagnostics active traceResumeDelayMs={0} />);

    expect(screen.getByText(/settings.traceCount/)).toHaveTextContent('"total":2');
    expect(screen.getAllByText(/initial.click/).length).toBeGreaterThan(0);
    expect(screen.getByText(/resolve.failed/)).toBeInTheDocument();
  });

  it("copies visible entries rather than always copying the full buffer", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
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

    renderReadyTraceDiagnostics();

    fireEvent.change(screen.getByLabelText("settings.traceLevel"), { target: { value: "error" } });
    fireEvent.click(screen.getByRole("button", { name: /settings.traceCopyVisible/ }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("resolve.failed");
    expect(writeText.mock.calls[0]?.[0]).not.toContain("play.click");

    fireEvent.click(screen.getByRole("button", { name: /settings.traceCopyAll/ }));
    expect(writeText.mock.calls[1]?.[0]).toContain("resolve.failed");
    expect(writeText.mock.calls[1]?.[0]).toContain("play.click");
  });

  it("copies the latest traceId group as the current playback attempt", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
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

    renderReadyTraceDiagnostics();

    fireEvent.click(screen.getByRole("button", { name: /settings.traceCopyCurrent/ }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain("ply_new");
    expect(writeText.mock.calls[0]?.[0]).toContain("new media failed");
    expect(writeText.mock.calls[0]?.[0]).not.toContain("ply_old");
  });

  it("clears active trace entries", () => {
    traceDiagnosticEvent("error", "stream.resolve", "resolve.failed", "stream resolve failed", {
      category: "stream",
      errorKind: "http_status",
    });

    renderReadyTraceDiagnostics();

    fireEvent.click(screen.getByRole("button", { name: /settings.traceClear/ }));
    const logPanel = screen.getByText("settings.traceEmpty");
    expect(within(logPanel.parentElement as HTMLElement).getByText("settings.traceEmpty")).toBe(
      logPanel,
    );
  });

  it("toggles the performance HUD setting (visible prod-build switch, rule 3)", async () => {
    renderReadyTraceDiagnostics();

    const toggle = screen.getByRole("checkbox", { name: /settings.perfHud/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);

    const { getSettings } = await import("@/db/repositories");
    await waitFor(async () => {
      expect((await getSettings()).perfHudEnabled).toBe(true);
    });
  });

  it("exports archived trace entries as a local file", async () => {
    await appendTraceArchiveEntries(
      [
        {
          id: 1,
          at: 1_000,
          level: "error",
          scope: "stream.proxy",
          event: "request.failed",
          message: "media proxy response",
          context: { category: "network", errorKind: "http_status", httpStatus: 403 },
        },
      ],
      createTraceArchive({ now: () => 1_000 }),
    );

    renderReadyTraceDiagnostics();

    const exportButton = await screen.findByRole("button", {
      name: /settings.traceArchiveExport/,
    });
    await waitFor(() => expect(exportButton).not.toBeDisabled());
    fireEvent.click(exportButton);

    await waitFor(() => expect(saveTextFile).toHaveBeenCalledTimes(1));
    const [, mime, text] = vi.mocked(saveTextFile).mock.calls[0] ?? [];
    expect(mime).toBe("application/x-ndjson");
    expect(text).toContain("media proxy response");
    expect(text).toContain('"httpStatus":403');
  });

  it("defers active trace subscription on first mount", () => {
    vi.useFakeTimers();
    traceDiagnosticEvent("info", "ui.action", "initial.click", "initial action", {
      category: "user-action",
    });

    render(<TraceDiagnostics />);

    expect(screen.getByText(/settings.traceCount/)).toHaveTextContent('"total":0');
    expect(screen.queryByText(/initial.click/)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TRACE_DIAGNOSTICS_RESUME_DELAY_MS);
    });

    expect(screen.getByText(/settings.traceCount/)).toHaveTextContent('"total":1');
    expect(screen.getAllByText(/initial.click/).length).toBeGreaterThan(0);
  });
});

function renderReadyTraceDiagnostics({ active = true }: { active?: boolean } = {}) {
  return render(<TraceDiagnostics active={active} traceResumeDelayMs={0} />);
}
