import { useCallback, useMemo } from "react";
import { useSettings } from "@/hooks/use-app-data";
import {
  currentPlatform,
  eventMatchesAction,
  mergeBindings,
  sanitizeOverrides,
} from "@/shortcuts/engine";

/**
 * Returns `(event, actionId) => boolean` for scoped surfaces (library nav, back
 * gesture, memory) — "does this live key match the user's bindings for this
 * action?". Reads the merged bindings from settings so overrides take effect live,
 * and re-memoizes only when the override map changes.
 */
export function useShortcutMatcher(): (event: KeyboardEvent, actionId: string) => boolean {
  const overrides = useSettings().shortcutOverrides;
  const platform = useMemo(() => currentPlatform(), []);
  const bindings = useMemo(
    () => mergeBindings(sanitizeOverrides(overrides, platform)),
    [overrides, platform],
  );
  return useCallback(
    (event: KeyboardEvent, actionId: string) =>
      eventMatchesAction(event, actionId, bindings, platform),
    [bindings, platform],
  );
}
