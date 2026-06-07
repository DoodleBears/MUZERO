import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatErrorClipboardText } from "@/lib/error-details";
import { log } from "@/lib/logger";
import { cn } from "@/lib/utils";
import {
  type NotificationItem,
  type NotificationType,
  notify,
  useNotificationStore,
} from "@/stores/notification-store";

const NOTIFICATION_ICONS: Record<NotificationType, ReactNode> = {
  success: <CheckCircle2 className="size-5 flex-none text-emerald-500" />,
  error: <AlertCircle className="size-5 flex-none text-white" />,
  warning: <AlertTriangle className="size-5 flex-none text-amber-500" />,
  info: <Info className="size-5 flex-none text-sky-500" />,
  loading: <Loader2 className="size-5 flex-none animate-spin text-primary" />,
};

// Position-reflow spring: snappy, no overshoot into the newly arrived item.
const layoutSpring = { type: "spring", stiffness: 360, damping: 38 } as const;
const enterSpring = { type: "spring", stiffness: 300, damping: 30 } as const;

/**
 * App-wide notification overlay. Anchored top-left, just under the floating
 * header — the bottom of the viewport is owned by the PlayerDock, so errors and
 * toasts live up top, out of its way. Persistent items (errors, loading) always
 * stay; transient ones cap at `maxVisible`. Mounted in `main.tsx` as a sibling
 * of the error boundary so its copy toast still appears on the crash screen.
 */
export function NotificationStack() {
  const queue = useNotificationStore((s) => s.queue);
  const maxVisible = useNotificationStore((s) => s.maxVisible);
  const dismiss = useNotificationStore((s) => s.dismiss);

  // Persistent items (duration 0) always show; maxVisible only caps transients.
  const persistentIds = new Set(queue.filter((i) => i.duration === 0).map((i) => i.id));
  const visibleTransientIds = new Set(
    queue
      .filter((i) => i.duration > 0)
      .slice(-maxVisible)
      .map((i) => i.id),
  );
  const orderedItems = queue
    .filter((i) => persistentIds.has(i.id) || visibleTransientIds.has(i.id))
    .sort((a, b) => a.createdAt - b.createdAt);

  if (orderedItems.length === 0) return null;

  return (
    <motion.div
      layout
      transition={{ layout: layoutSpring }}
      className="pointer-events-none fixed left-4 top-[calc(env(safe-area-inset-top)+4.5rem)] z-50 flex max-w-[min(90vw,28rem)] flex-col items-start gap-2"
    >
      <AnimatePresence mode="popLayout">
        {orderedItems.map((item) => (
          <NotificationItemView key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

function NotificationItemView({
  item,
  onDismiss,
}: {
  item: NotificationItem;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const isError = item.type === "error";
  const isPersistent = item.duration === 0;

  const handleCopy = async () => {
    const payload = formatErrorClipboardText({
      message: item.message,
      detail: item.detail,
      createdAt: item.createdAt,
      debug: item.debug,
      url: typeof window === "undefined" ? undefined : window.location.href,
      userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
    });
    try {
      await navigator.clipboard.writeText(payload);
      notify.success(t("notification.copySuccess"));
    } catch (err) {
      log.warn("notification", "clipboard write failed", err);
      notify.warning(t("notification.copyFail"));
    }
  };

  return (
    <motion.div
      // Animate position only (not size) so sibling insert/remove slides this
      // item to its new slot instead of jumping. Slide in/out from the left so
      // the entrance is independent of the vertical stack axis.
      layout="position"
      initial={{ opacity: 0, x: -24, scale: 0.98 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -24, scale: 0.98 }}
      transition={{ ...enterSpring, opacity: { duration: 0.2 }, layout: layoutSpring }}
      className="pointer-events-auto max-w-full"
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-card/95 px-3 py-2 text-sm shadow-lg backdrop-blur",
          isError && "border-destructive bg-destructive text-white",
        )}
      >
        {NOTIFICATION_ICONS[item.type]}

        <div className="min-w-0 flex-1 truncate sm:overflow-visible sm:whitespace-normal">
          <span className={cn(!isError && "text-foreground")}>{item.message}</span>
          {item.detail && (
            <span className={cn("ml-1", isError ? "text-white/80" : "text-muted-foreground")}>
              {item.detail}
            </span>
          )}
        </div>

        {item.actions?.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              action.onClick();
              if (!action.keepOpen) onDismiss();
            }}
            className={cn(
              "whitespace-nowrap rounded-md px-2 py-0.5 font-medium text-xs transition-colors",
              action.variant === "ghost"
                ? "hover:bg-foreground/10"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {action.label}
          </button>
        ))}

        {isError && (
          <button
            type="button"
            onClick={handleCopy}
            className="whitespace-nowrap rounded-md bg-white/15 px-2 py-0.5 font-medium text-white text-xs transition-colors hover:bg-white/25"
          >
            {t("notification.copy")}
          </button>
        )}

        {isPersistent && item.dismissible !== false && (
          <button
            type="button"
            aria-label={t("notification.dismiss")}
            onClick={onDismiss}
            className={cn(
              "flex-none rounded-md p-0.5 transition-colors",
              isError
                ? "text-white hover:bg-white/20"
                : "text-muted-foreground hover:bg-foreground/10",
            )}
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

export default NotificationStack;
