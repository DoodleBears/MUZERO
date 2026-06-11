import { useCallback, useEffect, useState } from "react";
import type { LlmModelPreset, LlmProviderPreset } from "@/ai/llm-providers";
import { clearModelCatalogCache, fetchModelCatalog, modelsEndpointFor } from "@/ai/model-catalog";
import { getAppFetch } from "@/lib/platform";

interface ModelCatalogState {
  catalog: LlmModelPreset[];
  loading: boolean;
  error: boolean;
  /** Whether this provider exposes a model endpoint at all (else hardcoded-only). */
  supported: boolean;
  refresh: () => void;
}

/**
 * Fetch a provider's live model catalog (chat PRD §6.1). Runs only when
 * `enabled` (e.g. the model combobox is open) and the provider has a `/models`
 * endpoint. Uses the CORS-safe app fetch so it works from the desktop shell.
 * The module cache dedupes; `refresh` busts it and refetches.
 */
export function useModelCatalog(
  preset: LlmProviderPreset,
  apiKey: string | undefined,
  enabled: boolean,
): ModelCatalogState {
  const supported = modelsEndpointFor(preset) !== null;
  const [state, setState] = useState<{
    catalog: LlmModelPreset[];
    loading: boolean;
    error: boolean;
  }>({ catalog: [], loading: false, error: false });
  const [nonce, setNonce] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on the preset identity (id/baseURL) not the churning object; nonce is the manual-refresh trigger
  useEffect(() => {
    if (!enabled || !supported) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: false }));
    (async () => {
      try {
        const fetchImpl = await getAppFetch();
        const models = await fetchModelCatalog(preset, apiKey, { fetchImpl });
        if (!cancelled) setState({ catalog: models ?? [], loading: false, error: false });
      } catch {
        if (!cancelled) setState({ catalog: [], loading: false, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, supported, preset.id, preset.baseURL, apiKey, nonce]);

  const refresh = useCallback(() => {
    clearModelCatalogCache();
    setNonce((n) => n + 1);
  }, []);

  return { ...state, supported, refresh };
}
