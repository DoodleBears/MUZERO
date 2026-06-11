import { useEffect } from "react";
import { subscribeElectronDiagnostics } from "@/lib/desktop/electron";
import { traceDiagnosticEvent, traceEvent } from "@/lib/trace";
import { usePlayerStore } from "@/stores/player-store";

export function TraceRecorder() {
  useEffect(() => {
    traceEvent("info", "app", "trace recorder mounted", {
      userAgent: navigator.userAgent,
      url: window.location.href,
    });

    const onError = (event: ErrorEvent) => {
      traceEvent("error", "window", "error", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error,
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      traceEvent("error", "window", "unhandledrejection", event.reason);
    };
    const onVisibility = () => {
      traceEvent("info", "document", "visibilitychange", {
        visibilityState: document.visibilityState,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribeElectronDiagnostics = subscribeElectronDiagnostics((entry) => {
      traceDiagnosticEvent(entry.level, entry.scope, entry.event ?? "main.event", entry.message, {
        ...entry.context,
        source: entry.context?.source ?? "electron-main",
      });
    });
    const unsubPlayer = usePlayerStore.subscribe((state, prev) => {
      const currentTrack = state.currentIndex >= 0 ? state.queue[state.currentIndex] : undefined;
      const prevTrack = prev.currentIndex >= 0 ? prev.queue[prev.currentIndex] : undefined;
      if (
        state.currentIndex === prev.currentIndex &&
        state.queue.length === prev.queue.length &&
        state.isPlaying === prev.isPlaying &&
        state.wantPlay === prev.wantPlay &&
        currentTrack?.id === prevTrack?.id
      ) {
        return;
      }
      traceEvent("debug", "player.state", "changed", {
        activeSessionId: state.activeSessionId,
        queueLength: state.queue.length,
        currentIndex: state.currentIndex,
        currentTrackId: currentTrack?.id ?? null,
        isPlaying: state.isPlaying,
        wantPlay: state.wantPlay,
      });
    });
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribeElectronDiagnostics();
      unsubPlayer();
    };
  }, []);

  return null;
}
