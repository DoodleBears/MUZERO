import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProdPerfHud } from "@/components/dev/dev-perf-panel";
import { GlobalErrorBoundary } from "@/components/shell/global-error-boundary";
import { NotificationStack } from "@/components/shell/notification-stack";
import { TraceRecorder } from "@/components/shell/trace-recorder";
import App from "./App";
// Side-effect import: initializes i18next (en/zh/ja/ko) before the app renders.
import "./i18n/i18n";
import "./styles.css";
import { initFont } from "./theme/font";
import { initPrimary } from "./theme/primary";
import { initTheme } from "./theme/theme";

// Re-apply the saved theme and start tracking the OS preference (for "system").
// index.html already painted the initial class to avoid a flash.
initTheme();
// Inject the saved per-mode primary color overrides before first render.
initPrimary();
// Apply the saved UI font (index.html already set --app-font to avoid a flash).
initFont();

// TanStack Query is wired up for any async server-like state (provider health
// checks, future hosted music providers). On-device reactive reads use Dexie's
// useLiveQuery; Query handles request/response style calls.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* NotificationStack is a *sibling* of the boundary so its copy toast
          still renders if the whole App subtree crashes. */}
      <GlobalErrorBoundary>
        <TraceRecorder />
        <App />
      </GlobalErrorBoundary>
      {/* App has its own MotionConfig; the stack lives outside it, so honor the
          OS "reduce motion" setting here too. */}
      <MotionConfig reducedMotion="user">
        <NotificationStack />
      </MotionConfig>
      {/* Prod-only perf HUD behind the visible Settings switch; dev builds
          mount the HUD from App.tsx (memory-perf-audit PRD Phase 1). */}
      <ProdPerfHud />
    </QueryClientProvider>
  </StrictMode>,
);
