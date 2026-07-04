import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDjChatRuntimeSnapshot } from "@/chat/dj-chat-runtime-registry";
import { DJ_CHAT_TOOL_METADATA } from "@/chat/dj-chat-tool-metadata";
import { collectToolActivityNotices } from "@/chat/dj-tool-activity";
import { useSettings } from "@/hooks/use-app-data";
import { useChatStore } from "@/stores/chat-store";
import { notify } from "@/stores/notification-store";

const LABEL_KEY_BY_TOOL = new Map(DJ_CHAT_TOOL_METADATA.map((m) => [m.id as string, m.labelKey]));

/**
 * Null-rendering leaf that mirrors each DJ tool-call step into the top-left
 * notification stack (tool label + key input) — the same title + executed content
 * the dock activity card shows above the composer. Gated by
 * `settings.djToolActivityNotify` (default on).
 *
 * It owns its OWN snapshot subscription (not the dock's mode-gated one) so it
 * fires regardless of whether the chat is minimized, chip, or expanded; and it
 * renders `null` so snapshot churn re-renders only this leaf, never the dock
 * entry (CLAUDE.md rule 6). De-dup by tool-call id lives in a ref, reset per
 * session and seeded from history so opening a session never replays a backlog.
 */
export function DjToolActivityNotifier() {
  const { t } = useTranslation();
  const enabled = useSettings().djToolActivityNotify ?? true;
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const snapshot = useDjChatRuntimeSnapshot(activeSessionId);
  const seenRef = useRef<{ sessionId: string | null; keys: Set<string> }>({
    sessionId: null,
    keys: new Set(),
  });

  useEffect(() => {
    if (!snapshot) return;
    const state = seenRef.current;

    // New session (or first mount): seed `seen` from the full history so we don't
    // replay past calls as a burst, and don't notify on this pass.
    if (state.sessionId !== snapshot.meta.sessionId) {
      state.sessionId = snapshot.meta.sessionId;
      state.keys = new Set();
      collectToolActivityNotices(snapshot.messages, state.keys);
      return;
    }

    // Only the newest assistant message accrues new tool parts mid-turn — walk a
    // small tail, not the whole history, on every streamed snapshot.
    const window = snapshot.messages.slice(-2);

    if (!enabled) {
      // Keep `seen` current so flipping the toggle on later starts fresh, not with
      // a backlog of everything that ran while it was off.
      collectToolActivityNotices(window, state.keys);
      return;
    }

    for (const notice of collectToolActivityNotices(window, state.keys)) {
      const labelKey = LABEL_KEY_BY_TOOL.get(notice.toolName);
      const title = labelKey ? t(labelKey) : notice.toolName;
      notify.info(title, notice.detail ? { detail: notice.detail } : undefined);
    }
  }, [snapshot, enabled, t]);

  return null;
}
