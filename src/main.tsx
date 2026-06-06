import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Side-effect import: initializes i18next (en/zh/ja/ko) before the app renders.
import "./i18n/i18n";
import "./styles.css";
import { initTheme } from "./theme/theme";

// Re-apply the saved theme and start tracking the OS preference (for "system").
// index.html already painted the initial class to avoid a flash.
initTheme();

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
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
