import { ExternalLink, Eye, EyeOff, Mic } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GroqWhisperModel } from "@/asr/groq-mapping";
import { AsrError } from "@/asr/provider";
import { isAsrConfigured } from "@/asr/registry";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import type { VoiceInputMode } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { openExternalUrl } from "@/lib/platform";
import {
  createVoiceInputController,
  type VoiceInputController,
  type VoiceInputState,
} from "@/voice/voice-input-controller";
import { defaultVoiceInputDeps } from "@/voice/voice-input-runtime";

const GROQ_KEY_URL = "https://console.groq.com/keys";
const MODELS: GroqWhisperModel[] = ["whisper-large-v3-turbo", "whisper-large-v3"];
const LANGUAGES = ["auto", "en", "zh", "ja", "ko", "es", "fr", "de", "ru", "pt"];
const MODES: VoiceInputMode[] = ["hold", "toggle"];

type AsrErrorKey =
  | "voice.asr.micDenied"
  | "voice.asr.errAuth"
  | "voice.asr.errRateLimit"
  | "voice.asr.errNetwork"
  | "voice.asr.errGeneric";

function asrErrorKey(err: unknown): AsrErrorKey {
  if (err instanceof DOMException && err.name === "NotAllowedError") return "voice.asr.micDenied";
  if (err instanceof AsrError) {
    if (err.kind === "auth") return "voice.asr.errAuth";
    if (err.kind === "rate-limit") return "voice.asr.errRateLimit";
    if (err.kind === "network") return "voice.asr.errNetwork";
  }
  return "voice.asr.errGeneric";
}

/**
 * Settings → Speech-to-Text (Phase 1 of the voice-DJ PRD). BYOK Groq key +
 * model / language / microphone + a hold-to-talk mic test that runs the real
 * {@link VoiceInputController}. Mirrors `llm-provider-settings.tsx`'s masked-key
 * form; keys write to `settings.groqApiKey` (device-local, never bundled).
 */
export function VoiceAsrSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const configured = isAsrConfigured(settings);
  const reusesDjKey = !settings.groqApiKey?.trim() && Boolean(settings.apiKeysByPresetId?.groq);

  const [reveal, setReveal] = useState(false);
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]);

  // Mic-test block owns its OWN controller instance (not the global singleton).
  const controllerRef = useRef<VoiceInputController | null>(null);
  const [testState, setTestState] = useState<VoiceInputState>("idle");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<AsrErrorKey | null>(null);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((list) =>
        setDevices(
          list
            .filter((d) => d.kind === "audioinput")
            .map((d) => ({ deviceId: d.deviceId, label: d.label })),
        ),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    const controller = createVoiceInputController(
      defaultVoiceInputDeps({
        getDeviceId: () => settings.asrInputDeviceId || undefined,
        callbacks: {
          onStateChange: setTestState,
          onTranscript: (text) => {
            setTranscript(text);
            setErrorKey(null);
          },
          onError: (err) => setErrorKey(asrErrorKey(err)),
        },
      }),
    );
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
    // Recreate when the chosen microphone changes so getUserMedia picks it up.
  }, [settings.asrInputDeviceId]);

  const shownKey = keyDraft ?? settings.groqApiKey ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("voice.asr.title")}</CardTitle>
        <p className="text-muted-foreground text-xs">{t("voice.asr.subtitle")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Master enable */}
        <label className="flex items-start gap-3 rounded-md border border-border p-3">
          <input
            type="checkbox"
            checked={Boolean(settings.asrEnabled)}
            onChange={(e) => void saveSettings({ asrEnabled: e.currentTarget.checked })}
            className="mt-1 size-4 accent-primary"
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium text-sm">{t("voice.asr.enable")}</span>
            <span className="text-muted-foreground text-xs">{t("voice.asr.enableHint")}</span>
          </span>
        </label>

        {/* Groq API key (masked) */}
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{t("voice.asr.apiKey")}</span>
          <div className="flex min-w-0 items-center gap-1.5">
            <Input
              autoComplete="off"
              className="min-w-0 flex-1"
              type={reveal ? "text" : "password"}
              value={shownKey}
              placeholder={reusesDjKey ? "gsk_… (reusing DJ key)" : "gsk_…"}
              onChange={(e) => setKeyDraft(e.target.value)}
              onBlur={() => {
                if (keyDraft != null && keyDraft !== (settings.groqApiKey ?? "")) {
                  void saveSettings({ groqApiKey: keyDraft.trim() });
                }
                setKeyDraft(null);
              }}
            />
            <Button
              aria-label={reveal ? t("voice.asr.hide") : t("voice.asr.reveal")}
              onClick={() => setReveal((v) => !v)}
              size="icon"
              type="button"
              variant="ghost"
            >
              {reveal ? <EyeOff /> : <Eye />}
            </Button>
            <Button
              aria-label={t("voice.asr.getKey")}
              onClick={() => void openExternalUrl(GROQ_KEY_URL)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ExternalLink />
            </Button>
          </div>
          {reusesDjKey && (
            <span className="text-muted-foreground text-[11px]">{t("voice.asr.apiKeyReused")}</span>
          )}
        </div>

        {/* Model + language */}
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">{t("voice.asr.model")}</span>
            <Select
              value={settings.asrModel ?? "whisper-large-v3-turbo"}
              onValueChange={(value) => void saveSettings({ asrModel: value as GroqWhisperModel })}
            >
              <SelectTrigger>
                <SelectValue>
                  {(value) =>
                    value === "whisper-large-v3"
                      ? t("voice.asr.modelLarge")
                      : t("voice.asr.modelTurbo")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id === "whisper-large-v3"
                      ? t("voice.asr.modelLarge")
                      : t("voice.asr.modelTurbo")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">{t("voice.asr.language")}</span>
            <Select
              value={settings.asrLanguage ?? "auto"}
              onValueChange={(value) => {
                if (value) void saveSettings({ asrLanguage: value });
              }}
            >
              <SelectTrigger>
                <SelectValue>
                  {(value) => (value === "auto" ? t("voice.asr.languageAuto") : String(value))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code === "auto" ? t("voice.asr.languageAuto") : code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Microphone device */}
        {devices.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">{t("voice.asr.microphone")}</span>
            <Select
              value={settings.asrInputDeviceId || "default"}
              onValueChange={(value) =>
                void saveSettings({ asrInputDeviceId: !value || value === "default" ? "" : value })
              }
            >
              <SelectTrigger>
                <SelectValue>
                  {(value) =>
                    value === "default"
                      ? t("voice.asr.micDefault")
                      : (devices.find((d) => d.deviceId === value)?.label ?? String(value))
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("voice.asr.micDefault")}</SelectItem>
                {devices.map((d, i) => (
                  <SelectItem key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Microphone ${i + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Push-to-talk mode */}
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{t("voice.asr.inputMode")}</span>
          <div className="flex flex-col gap-1.5">
            {MODES.map((mode) => {
              const active = (settings.voiceInputMode ?? "hold") === mode;
              return (
                <label
                  key={mode}
                  className={`flex items-start gap-3 rounded-md border p-2.5 ${active ? "border-primary" : "border-border"}`}
                >
                  <input
                    type="radio"
                    name="voice-input-mode"
                    checked={active}
                    onChange={() => void saveSettings({ voiceInputMode: mode })}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm">
                      {mode === "hold" ? t("voice.asr.modeHold") : t("voice.asr.modeToggle")}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {mode === "hold"
                        ? t("voice.asr.modeHoldHint")
                        : t("voice.asr.modeToggleHint")}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <span className="text-muted-foreground text-[11px]">{t("voice.asr.bindHint")}</span>
        </div>

        {/* Auto-approve paid generation from voice */}
        <label className="flex items-start gap-3 rounded-md border border-border p-3">
          <input
            type="checkbox"
            checked={Boolean(settings.voiceAutoApproveGenerate)}
            onChange={(e) =>
              void saveSettings({ voiceAutoApproveGenerate: e.currentTarget.checked })
            }
            className="mt-1 size-4 accent-primary"
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium text-sm">{t("voice.asr.autoApprove")}</span>
            <span className="text-muted-foreground text-xs">{t("voice.asr.autoApproveHint")}</span>
          </span>
        </label>

        {/* Mic test */}
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <span className="font-medium text-sm">{t("voice.asr.test")}</span>
          <span className="text-muted-foreground text-xs">{t("voice.asr.testHint")}</span>
          <Button
            type="button"
            variant={testState === "recording" ? "default" : "outline"}
            disabled={!configured || testState === "transcribing"}
            className="w-fit select-none"
            onPointerDown={() => void controllerRef.current?.start()}
            onPointerUp={() => void controllerRef.current?.stop()}
            onPointerLeave={() => {
              if (testState === "recording") void controllerRef.current?.stop();
            }}
          >
            <Mic />
            {testState === "recording"
              ? t("voice.asr.listening")
              : testState === "transcribing"
                ? t("voice.asr.transcribing")
                : t("voice.asr.holdToTalk")}
          </Button>
          {!configured && (
            <span className="text-muted-foreground text-[11px]">
              {t("voice.asr.notConfigured")}
            </span>
          )}
          {errorKey && <span className="text-destructive text-xs">{t(errorKey)}</span>}
          {transcript != null && !errorKey && (
            <div className="flex flex-col gap-0.5">
              <span className="text-muted-foreground text-[11px]">{t("voice.asr.transcript")}</span>
              <span className="text-sm">{transcript || t("voice.asr.noSpeech")}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
