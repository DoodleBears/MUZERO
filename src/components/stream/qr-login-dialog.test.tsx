import { act, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamLoginConfig } from "@/streamsrc/login";
import { QrLoginDialog } from "./qr-login-dialog";

const config: StreamLoginConfig = {
  source: "netease",
  loginUrl: "https://music.163.com/#/login",
  cookieUrls: ["https://music.163.com"],
  authCookie: "MUSIC_U",
};

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  poll: vi.fn(),
  qrPollLoop: vi.fn(),
  readSourceCookies: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { source?: string }) => (opts?.source ? `${key}:${opts.source}` : key),
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/lib/desktop/bridge", () => ({
  resolveDesktopBridge: () => ({
    readSourceCookies: mocks.readSourceCookies,
  }),
}));

vi.mock("@/streamsrc/qr-login-provider", () => ({
  createNeteaseQrApi: () => ({
    generate: mocks.generate,
    poll: mocks.poll,
  }),
  qrPollLoop: mocks.qrPollLoop,
}));

vi.mock("@/streamsrc/stream-http", () => ({
  createStreamHttp: () => ({}),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue({ qrKey: "qr-key", qrContent: "https://qr" });
  mocks.qrPollLoop.mockImplementation(async (_api, _qrKey, deps) => {
    deps.onStatus?.("success");
    return { outcome: "success", cookie: "MUSIC_U=token" };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("QrLoginDialog", () => {
  it("auto-closes after success even if saving settings re-renders the parent", async () => {
    const close = vi.fn();

    function Harness() {
      const [version, setVersion] = useState(0);
      return (
        <QrLoginDialog
          source="netease"
          label={`网易云 ${version}`}
          config={config}
          onClose={() => close()}
          onSuccess={async () => {
            window.setTimeout(() => setVersion((n) => n + 1), 100);
          }}
        />
      );
    }

    render(<Harness />);

    await flushMicrotasks();
    expect(screen.getByText("streamSources.qrSuccess")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.getByText("streamSources.qrTitle:网易云 1")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(close).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
});

async function flushMicrotasks() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
