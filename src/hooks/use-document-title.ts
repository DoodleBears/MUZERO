import { useEffect } from "react";
import { DEFAULT_DOCUMENT_TITLE, formatDocumentTitle } from "@/lib/document-title";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Keep the browser tab title in sync with the current track —
 * `Title · Artist · Album | MUZERO`, falling back to the brand title when the
 * queue is empty. Subscribes to the same minimal selectors the now-playing UI
 * uses (queue + currentIndex), so the returned Track reference is stable across
 * progress ticks and the title only rewrites when the song actually changes.
 */
export function useDocumentTitle(): void {
  const current = usePlayerStore((s) =>
    s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined,
  );
  const title = formatDocumentTitle(current);
  useEffect(() => {
    document.title = title;
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE;
    };
  }, [title]);
}
