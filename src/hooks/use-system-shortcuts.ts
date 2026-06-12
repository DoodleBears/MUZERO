import { useEffect, useMemo, useRef, useState } from "react";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { log } from "@/lib/logger";
import { createShortcutActionRunnerContext, runShortcutAction } from "@/shortcuts/actions";
import {
  isSystemGlobalShortcutAction,
  type SystemShortcutRegistration,
} from "@/shortcuts/system-global";
import { useNavStore } from "@/stores/nav-store";

export interface UseSystemShortcutsInput {
  enabled: boolean;
  registrations: readonly SystemShortcutRegistration[];
}

export interface SystemShortcutRuntimeStatus {
  actionId: string;
  accelerator: string;
  status: "active" | "failed";
  reason?: string;
}

export interface SystemShortcutsRuntimeState {
  supported: boolean;
  registering: boolean;
  statuses: SystemShortcutRuntimeStatus[];
  error?: string;
}

const UNSUPPORTED_STATE: SystemShortcutsRuntimeState = {
  supported: false,
  registering: false,
  statuses: [],
};

const IDLE_SUPPORTED_STATE: SystemShortcutsRuntimeState = {
  supported: true,
  registering: false,
  statuses: [],
};

export function useSystemShortcuts({
  enabled,
  registrations,
}: UseSystemShortcutsInput): SystemShortcutsRuntimeState {
  const setTab = useNavStore((s) => s.setTab);
  const bridge = useMemo(() => resolveDesktopBridge(), []);
  const systemShortcuts = bridge.systemShortcuts;
  const registrationsKey = useMemo(() => JSON.stringify(registrations), [registrations]);
  const registrationsRef = useRef(registrations);
  registrationsRef.current = registrations;
  const [state, setState] = useState<SystemShortcutsRuntimeState>(() =>
    systemShortcuts ? IDLE_SUPPORTED_STATE : UNSUPPORTED_STATE,
  );

  useEffect(() => {
    if (!systemShortcuts) return;
    const actionCtx = createShortcutActionRunnerContext(setTab);
    return systemShortcuts.onAction((actionId) => {
      if (!isSystemGlobalShortcutAction(actionId)) return;
      runShortcutAction(actionId, actionCtx);
    });
  }, [setTab, systemShortcuts]);

  useEffect(() => {
    if (!systemShortcuts) {
      setState(UNSUPPORTED_STATE);
      return;
    }

    let cancelled = false;
    const desired = enabled && registrationsKey !== "[]" ? [...registrationsRef.current] : [];
    setState((current) => ({ ...current, supported: true, registering: true, error: undefined }));

    void systemShortcuts
      .configure(desired)
      .then((result) => {
        if (cancelled) return;
        setState({
          supported: result.supported,
          registering: false,
          statuses: result.statuses,
        });
      })
      .catch((error: unknown) => {
        log.warn("shortcuts.systemGlobal", "Unable to configure system shortcuts", error);
        if (cancelled) return;
        setState({
          supported: true,
          registering: false,
          statuses: [],
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
      void systemShortcuts
        .configure([])
        .catch((error: unknown) =>
          log.warn("shortcuts.systemGlobal", "Unable to unregister system shortcuts", error),
        );
    };
  }, [enabled, registrationsKey, systemShortcuts]);

  return state;
}
