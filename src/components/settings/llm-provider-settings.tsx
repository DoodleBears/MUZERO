import { ExternalLink, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createCustomLlmProviderId,
  deleteCustomLlmProvider,
  isCustomLlmProviderId,
  putCustomLlmProvider,
  useCustomLlmProviders,
} from "@/ai/custom-llm-providers";
import {
  allLlmProviderPresets,
  apiKeyForPreset,
  type LlmProviderPreset,
  type LlmProviderPresetId,
  llmModelForPreset,
  llmProviderAllowsMissingApiKey,
  llmSelectionFromSettings,
  resolveLlmProviderPreset,
} from "@/ai/llm-providers";
import { ModelCatalogCombobox } from "@/components/settings/model-catalog-combobox";
import { ProviderCombobox } from "@/components/settings/provider-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveSettings } from "@/db/repositories";
import type { CustomLlmProvider } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { openExternalUrl } from "@/lib/platform";

const DEFAULT_CHAT_MAX_OUTPUT = 32_000;
const DEFAULT_CHAT_MAX_CONTEXT = 128_000;

/** Parse a numeric settings input, falling back when it's blank/invalid. */
function commitNumber(raw: string, fallback: number): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Multi-provider LLM settings (chat PRD §6.1, ClipCombo parity): a provider
 * grid showing per-preset key status (click selects for editing), a per-provider
 * masked API-key field with a "get key" deep link, a dynamic custom-provider
 * editor (label / baseURL / model list / delete), and the global default model
 * combobox over the enabled presets. Keys write to
 * `settings.apiKeysByPresetId` — device-local, never bundled (hard rule #2).
 */
export function LlmProviderSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const customProviders = useCustomLlmProviders();
  const presets = allLlmProviderPresets(customProviders);
  const selection = llmSelectionFromSettings(settings, customProviders);
  const [editingId, setEditingId] = useState<LlmProviderPresetId | null>(null);
  const maxOutputId = useId();
  const maxContextId = useId();
  const activeId = editingId ?? selection.presetId;
  const activePreset = resolveLlmProviderPreset(activeId, customProviders);
  const activeCustom = isCustomLlmProviderId(activeId)
    ? customProviders.find((p) => p.id === activeId)
    : undefined;

  async function addCustomProvider() {
    const now = Date.now();
    const provider: CustomLlmProvider = {
      id: createCustomLlmProviderId(),
      label: `${t("settings.llmCustomProvider")} ${customProviders.length + 1}`,
      baseUrl: "http://localhost:11434/v1",
      models: [{ id: "my-model" }],
      createdAt: now,
      updatedAt: now,
    };
    await putCustomLlmProvider(provider);
    setEditingId(provider.id);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Provider selection — brand-iconed combobox (ClipCombo parity). */}
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t("settings.provider")}</span>
        <ProviderCombobox
          labels={{
            empty: t("settings.llmNoEnabled"),
            keyMissing: t("settings.llmKeyMissing"),
            keyOptional: t("settings.llmKeyOptional"),
            keyReady: t("settings.llmKeyReady"),
            searchPlaceholder: t("settings.llmProviderSearch"),
            trigger: t("settings.provider"),
          }}
          onSelect={setEditingId}
          presets={presets}
          selectedId={activeId}
          settings={settings}
        />
      </div>
      <Button onClick={() => void addCustomProvider()} size="sm" type="button" variant="outline">
        <Plus /> {t("settings.llmAddCustom")}
      </Button>

      {/* Per-provider API key (masked, with the vendor's key page). */}
      <ApiKeyField
        onCommit={(value) =>
          void saveSettings({
            apiKeysByPresetId: { ...settings.apiKeysByPresetId, [activeId]: value },
          })
        }
        optional={llmProviderAllowsMissingApiKey(activeId)}
        preset={activePreset}
        value={apiKeyForPreset(settings, activeId) ?? ""}
      />

      {/* Dynamic custom provider editor. */}
      {activeCustom && (
        <CustomProviderEditor
          onDelete={() => {
            void deleteCustomLlmProvider(activeCustom.id);
            setEditingId(null);
          }}
          provider={activeCustom}
        />
      )}

      {/* Default model for the active provider — backed by the provider's LIVE
          /models catalog (OpenRouter/OpenAI/Groq/local…) merged with hardcoded
          models, plus free-text custom ids. Picking sets this provider+model as
          the global DJ default. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">
          {t("settings.llmModelFor", { provider: activePreset.label })}
        </span>
        <ModelCatalogCombobox
          apiKey={apiKeyForPreset(settings, activeId)}
          key={activeId}
          labels={{
            empty: t("settings.llmModelEmpty"),
            loading: t("settings.llmModelLoading"),
            refresh: t("settings.llmModelRefresh"),
            searchPlaceholder: t("settings.llmModelSearch"),
            trigger: t("settings.llmModelPick"),
            customLabel: (q) => t("settings.llmModelUseCustom", { model: q }),
            capabilities: {
              vision: t("settings.capVision"),
              audio: t("settings.capAudio"),
              tools: t("settings.capTools"),
              context: t("settings.capContext"),
              price: (inLabel, outLabel) => t("settings.capPrice", { in: inLabel, out: outLabel }),
            },
          }}
          onSelect={(model) =>
            void saveSettings({
              defaultLlmProviderPresetId: activeId,
              defaultLlmModel: model,
              modelsByPresetId: { ...settings.modelsByPresetId, [activeId]: model },
            })
          }
          preset={activePreset}
          selectedModel={llmModelForPreset(settings, activePreset)}
        />
        <span className="text-muted-foreground text-[11px]">
          {activeId === selection.presetId &&
          llmModelForPreset(settings, activePreset) === selection.model
            ? t("settings.llmModelIsDefault")
            : t("settings.llmModelSetsDefault")}
        </span>
      </div>

      {/* DJ chat token limits — bigger = longer replies / fewer mid-run cutoffs and
          later context blocking. Tune for your model. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">{t("settings.chatLimits")}</span>
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label className="text-muted-foreground text-[11px]" htmlFor={maxOutputId}>
              {t("settings.chatMaxOutput")}
            </label>
            <Input
              defaultValue={settings.chatMaxOutputTokens ?? DEFAULT_CHAT_MAX_OUTPUT}
              id={maxOutputId}
              inputMode="numeric"
              key={`out-${settings.chatMaxOutputTokens ?? DEFAULT_CHAT_MAX_OUTPUT}`}
              min={256}
              onBlur={(e) =>
                void saveSettings({
                  chatMaxOutputTokens: commitNumber(e.target.value, DEFAULT_CHAT_MAX_OUTPUT),
                })
              }
              type="number"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label className="text-muted-foreground text-[11px]" htmlFor={maxContextId}>
              {t("settings.chatMaxContext")}
            </label>
            <Input
              defaultValue={settings.chatMaxContextTokens ?? DEFAULT_CHAT_MAX_CONTEXT}
              id={maxContextId}
              inputMode="numeric"
              key={`ctx-${settings.chatMaxContextTokens ?? DEFAULT_CHAT_MAX_CONTEXT}`}
              min={4000}
              onBlur={(e) =>
                void saveSettings({
                  chatMaxContextTokens: commitNumber(e.target.value, DEFAULT_CHAT_MAX_CONTEXT),
                })
              }
              type="number"
            />
          </div>
        </div>
        <span className="text-muted-foreground text-[11px]">{t("settings.chatLimitsHint")}</span>
      </div>
    </div>
  );
}

function ApiKeyField({
  onCommit,
  optional,
  preset,
  value,
}: {
  onCommit: (value: string) => void;
  optional: boolean;
  preset: LlmProviderPreset;
  value: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const shown = draft ?? value;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-xs">
        {t("settings.llmKeyFor", { provider: preset.label })}
        {optional ? ` (${t("settings.llmKeyOptionalShort")})` : ""}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          autoComplete="off"
          className="min-w-0 flex-1"
          onBlur={() => {
            if (draft != null && draft !== value) onCommit(draft.trim());
            setDraft(null);
          }}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={optional ? t("settings.llmKeyOptionalShort") : "sk-…"}
          type={reveal ? "text" : "password"}
          value={shown}
        />
        <Button
          aria-label={reveal ? t("settings.llmKeyHide") : t("settings.llmKeyReveal")}
          onClick={() => setReveal((v) => !v)}
          size="icon"
          type="button"
          variant="ghost"
        >
          {reveal ? <EyeOff /> : <Eye />}
        </Button>
        {preset.apiKeyUrl && (
          <Button
            aria-label={t("settings.llmGetKey")}
            onClick={() => void openExternalUrl(preset.apiKeyUrl as string)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ExternalLink />
          </Button>
        )}
      </div>
    </div>
  );
}

function CustomProviderEditor({
  onDelete,
  provider,
}: {
  onDelete: () => void;
  provider: CustomLlmProvider;
}) {
  const { t } = useTranslation();
  const [modelDraft, setModelDraft] = useState("");
  const nameId = useId();
  const urlId = useId();

  function update(patch: Partial<CustomLlmProvider>) {
    void putCustomLlmProvider({ ...provider, ...patch, updatedAt: Date.now() });
  }

  function addModel() {
    const id = modelDraft.trim();
    if (!id || provider.models.some((m) => m.id === id)) return;
    setModelDraft("");
    update({ models: [...provider.models, { id }] });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm">{t("settings.llmCustomProvider")}</span>
        <Button onClick={onDelete} size="sm" type="button" variant="outline">
          <Trash2 /> {t("settings.llmCustomDelete")}
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs" htmlFor={nameId}>
          {t("settings.llmCustomName")}
        </label>
        <Input
          defaultValue={provider.label}
          id={nameId}
          key={`${provider.id}-label`}
          onBlur={(e) => {
            const label = e.target.value.trim();
            if (label && label !== provider.label) update({ label });
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-muted-foreground text-xs" htmlFor={urlId}>
          {t("settings.llmCustomBaseUrl")}
        </label>
        <Input
          defaultValue={provider.baseUrl}
          id={urlId}
          key={`${provider.id}-url`}
          onBlur={(e) => {
            const baseUrl = e.target.value.trim();
            if (baseUrl && baseUrl !== provider.baseUrl) update({ baseUrl });
          }}
          placeholder="http://localhost:11434/v1"
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">
          {t("settings.llmCustomModels")} ({provider.models.length})
        </span>
        <div className="flex min-w-0 items-center gap-1.5">
          <Input
            className="min-w-0 flex-1"
            onChange={(e) => setModelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              addModel();
            }}
            placeholder={t("settings.llmCustomModelPlaceholder")}
            value={modelDraft}
          />
          <Button
            disabled={!modelDraft.trim()}
            onClick={addModel}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus /> {t("settings.llmCustomModelAdd")}
          </Button>
        </div>
        <ul className="flex flex-col gap-0.5">
          {provider.models.map((model) => (
            <li className="flex min-w-0 items-center gap-1.5" key={model.id}>
              <span className="min-w-0 flex-1 truncate text-sm">{model.id}</span>
              <Button
                aria-label={t("settings.llmCustomModelRemove", { model: model.id })}
                disabled={provider.models.length <= 1}
                onClick={() => update({ models: provider.models.filter((m) => m.id !== model.id) })}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
