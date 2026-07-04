/**
 * Unified in-app notification store.
 *
 * One Zustand store backing every transient + persistent notification
 * (success / error / warning / info / loading). Adapted from anysoul's
 * NotificationStack: transient types auto-dismiss, errors + loading persist
 * until dismissed, and errors carry rich {@link ErrorDebugInfo} for the
 * copy-to-clipboard payload (see `@/lib/error-details`).
 *
 * Usage:
 *   const notify = useNotification();             // in a component
 *   notify.error(t("player.playbackError"), { error });
 *   import { notify } from "@/stores/notification-store"; // in stores / lib
 */
import { create } from "zustand";
import {
  captureReportStack,
  type ErrorDebugInfo,
  extractErrorDebugInfo,
} from "@/lib/error-details";

export type NotificationType = "success" | "error" | "warning" | "info" | "loading";

export interface NotificationAction {
  label: string;
  onClick: () => void;
  variant?: "default" | "ghost";
  /** Keep the notification open after this action fires (default: dismiss it). */
  keepOpen?: boolean;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  message: string;
  /** Optional secondary text, shown after the message. */
  detail?: string;
  /** Auto-dismiss after N ms; `0` = persistent until manually dismissed. */
  duration: number;
  /** Creation time, used for stable ordering. */
  createdAt: number;
  /** Whether the user can dismiss it with the ✕. */
  dismissible: boolean;
  /** Optional inline action buttons. */
  actions?: NotificationAction[];
  /** Rich debugging context surfaced by the error "copy" button. */
  debug?: ErrorDebugInfo;
  /** Determinate progress 0..1 (e.g. a download) — renders a thin bar. */
  progress?: number;
}

// Errors and loading spinners stay put; everything else fades on its own.
const DEFAULT_DURATIONS: Record<NotificationType, number> = {
  success: 3000,
  error: 0,
  warning: 5000,
  info: 3000,
  loading: 0,
};

/** Auto-dismiss delay for errors when the user hasn't opted to keep them. */
export const ERROR_AUTO_DISMISS_MS = 12_000;

// Whether errors linger until manually dismissed. Off by default: errors fade
// after ERROR_AUTO_DISMISS_MS. Mirrors `AppSettings.errorNotificationPersist`;
// kept module-side (like the timers) so reading it in `notify.error` never
// couples to a render. Synced from settings by <NotificationStack>.
let errorPersist = false;

/** Sync the error-persist preference from settings (called by the stack). */
export function setErrorNotificationPersist(persist: boolean) {
  errorPersist = persist;
}

/** Default auto-dismiss duration for a type, honoring the error-persist pref. */
function defaultDurationFor(type: NotificationType): number {
  if (type === "error") return errorPersist ? 0 : ERROR_AUTO_DISMISS_MS;
  return DEFAULT_DURATIONS[type];
}

/**
 * "Sticky" notifications are always shown (never capped by `maxVisible`) and
 * carry the ✕ dismiss button: errors, loading spinners, and anything explicitly
 * persistent (`duration === 0`). Errors stay sticky even when they auto-dismiss
 * after {@link ERROR_AUTO_DISMISS_MS}, so they never lose the ✕ or get pushed
 * out by transient toasts. Everything else is a transient toast.
 */
export function isStickyNotification(item: Pick<NotificationItem, "type" | "duration">): boolean {
  return item.type === "error" || item.type === "loading" || item.duration === 0;
}

interface NotificationState {
  queue: NotificationItem[];
  maxVisible: number;

  push: (
    item: Omit<NotificationItem, "id" | "createdAt" | "duration"> & { duration?: number },
  ) => string;
  update: (
    id: string,
    patch: Partial<Pick<NotificationItem, "type" | "message" | "detail" | "duration" | "progress">>,
  ) => void;
  dismiss: (id: string) => void;
  clear: () => void;
  setMaxVisible: (n: number) => void;
}

let idCounter = 0;
// Auto-dismiss timers live module-side (not in store state) so ticking them
// never re-renders subscribers — mirrors the non-reactive-singleton rule.
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleAutoDismiss(id: string, duration: number, dismissFn: (id: string) => void) {
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        try {
          dismissFn(id);
        } catch {
          // Non-fatal: the notification may already be gone.
        }
      }, duration),
    );
  }
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  queue: [],
  maxVisible: 3,

  push: (item) => {
    const id = `notif-${++idCounter}`;
    const duration = item.duration ?? defaultDurationFor(item.type);
    const newItem: NotificationItem = { ...item, id, duration, createdAt: Date.now() };

    set((state) => {
      const next = [...state.queue, newItem];
      // Cap both buckets so a runaway loop can't grow the queue unbounded.
      const sticky = next.filter(isStickyNotification).slice(-20);
      const transient = next.filter((i) => !isStickyNotification(i)).slice(-5);
      return { queue: [...sticky, ...transient].sort((a, b) => a.createdAt - b.createdAt) };
    });

    scheduleAutoDismiss(id, duration, get().dismiss);
    return id;
  },

  update: (id, patch) => {
    set((state) => ({
      queue: state.queue.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }));
    // Re-arm the timer if the type/duration changed (e.g. loading → success).
    const updated = get().queue.find((n) => n.id === id);
    if (updated) {
      const duration =
        patch.duration ?? (patch.type ? defaultDurationFor(patch.type) : updated.duration);
      scheduleAutoDismiss(id, duration, get().dismiss);
    }
  },

  dismiss: (id) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
    set((state) => ({ queue: state.queue.filter((n) => n.id !== id) }));
  },

  clear: () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ queue: [] });
  },

  setMaxVisible: (n) => set({ maxVisible: n }),
}));

type NotifyOpts = Partial<
  Pick<NotificationItem, "detail" | "duration" | "dismissible" | "actions" | "debug" | "progress">
> & {
  /** Raw thrown value — normalized into `debug` for the copy payload. */
  error?: unknown;
  componentStack?: string;
  source?: string;
};

/**
 * Module-level singleton: a stable reference safe in effect deps and callable
 * from non-component code (stores, lib) where hooks can't run.
 */
export const notify = {
  success: (message: string, opts?: NotifyOpts) =>
    useNotificationStore.getState().push({ type: "success", message, dismissible: true, ...opts }),

  error: (message: string, opts?: NotifyOpts) => {
    const { error, componentStack, source, ...rest } = opts ?? {};
    let debug =
      rest.debug ?? extractErrorDebugInfo(error, { detail: rest.detail, componentStack, source });
    // Guarantee the copy payload always carries a stack. String throws,
    // MediaError/DOMException, and bare `notify.error(msg)` calls leave `stack`
    // empty — synthesize one from the report site so "copy" is never stack-less.
    if (!debug?.stack) {
      const reportStack = captureReportStack();
      if (reportStack) debug = { ...debug, stack: reportStack };
    }
    return useNotificationStore
      .getState()
      .push({ type: "error", message, dismissible: true, ...rest, debug });
  },

  warning: (message: string, opts?: NotifyOpts) =>
    useNotificationStore.getState().push({ type: "warning", message, dismissible: true, ...opts }),

  info: (message: string, opts?: NotifyOpts) =>
    useNotificationStore.getState().push({ type: "info", message, dismissible: true, ...opts }),

  loading: (message: string, opts?: NotifyOpts) =>
    useNotificationStore
      .getState()
      .push({ type: "loading", message, dismissible: true, duration: 0, ...opts }),

  update: (...args: Parameters<NotificationState["update"]>) =>
    useNotificationStore.getState().update(...args),
  dismiss: (...args: Parameters<NotificationState["dismiss"]>) =>
    useNotificationStore.getState().dismiss(...args),
  clear: () => useNotificationStore.getState().clear(),
};

/** Stable singleton accessor — safe to call in render and effect deps. */
export function useNotification() {
  return notify;
}
