import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveSettings } from "@/db/repositories";
import type { AppSettings, LlmProviderId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { type MusicGenProviderId, resolveMusicGenProvider } from "@/musicgen/registry";
import { usePlayerStore } from "@/stores/player-store";

/** On-device, BYOK settings. Nothing here is ever sent anywhere but the model/API you point it at. */
export function SettingsPage() {
  const settings = useSettings();
  const rebuildEngine = usePlayerStore((s) => s.rebuildEngine);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<"unknown" | "ok" | "down" | "checking">("unknown");

  // Keep the local draft in sync once the persisted settings load.
  useEffect(() => setDraft(settings), [settings]);

  function patch(p: Partial<AppSettings>) {
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
  }

  async function save() {
    await saveSettings(draft);
    await rebuildEngine();
    setSaved(true);
  }

  async function checkAceStep() {
    setHealth("checking");
    const provider = resolveMusicGenProvider({ ...draft, musicGenProvider: "acestep-local" });
    const ok = (await provider.health?.()) ?? false;
    setHealth(ok ? "ok" : "down");
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>AI DJ (LLM)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field label="Provider">
            <select
              value={draft.llmProvider}
              onChange={(e) => patch({ llmProvider: e.target.value as LlmProviderId })}
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
          <Field label="Model">
            <Input
              value={draft.llmModel}
              onChange={(e) => patch({ llmModel: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </Field>
          {draft.llmProvider === "openai" ? (
            <Field label="OpenAI API key">
              <Input
                type="password"
                value={draft.openaiApiKey ?? ""}
                onChange={(e) => patch({ openaiApiKey: e.target.value })}
                placeholder="sk-…"
              />
            </Field>
          ) : (
            <Field label="Anthropic API key">
              <Input
                type="password"
                value={draft.anthropicApiKey ?? ""}
                onChange={(e) => patch({ anthropicApiKey: e.target.value })}
                placeholder="sk-ant-…"
              />
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Music generation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field label="Provider">
            <select
              value={draft.musicGenProvider}
              onChange={(e) => patch({ musicGenProvider: e.target.value as MusicGenProviderId })}
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="mock">Mock synth (offline, no model)</option>
              <option value="acestep-local">ACE-Step (local server)</option>
            </select>
          </Field>
          {draft.musicGenProvider === "acestep-local" && (
            <>
              <Field label="ACE-Step server URL">
                <Input
                  value={draft.aceStepUrl}
                  onChange={(e) => patch({ aceStepUrl: e.target.value })}
                  placeholder="http://localhost:8085"
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void checkAceStep()}>
                  Test connection
                </Button>
                {health === "ok" && <CheckCircle2 className="size-4 text-primary" />}
                {health === "down" && <XCircle className="size-4 text-destructive" />}
                {health === "checking" && (
                  <span className="text-xs text-muted-foreground">checking…</span>
                )}
                {health === "down" && (
                  <span className="text-xs text-muted-foreground">
                    Run `make serve` in acestep-local.
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()}>Save settings</Button>
        {saved && <span className="text-sm text-muted-foreground">Saved ✓</span>}
      </div>
      <p className="pb-4 text-xs text-muted-foreground">
        MUZERO is local-first: tracks, audio, and these settings live in your browser's IndexedDB on
        this device. API keys are stored locally and sent only to the provider you choose — never to
        us.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // The control is passed in via `children` and nested inside the label, which
    // Biome's static analysis can't see through.
    // biome-ignore lint/a11y/noLabelWithoutControl: control supplied via children
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
