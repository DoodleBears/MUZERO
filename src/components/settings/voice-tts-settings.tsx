import { useQuery } from "@tanstack/react-query";
import { Check, ExternalLink, Eye, EyeOff, Play, Plus, Trash2, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Slider } from "@/components/ui/slider";
import { saveSettings } from "@/db/repositories";
import type { CachedVoiceModel } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { openExternalUrl } from "@/lib/platform";
import type { FishTtsBackend } from "@/tts/fish-mapping";
import { TtsError, type VoiceModel } from "@/tts/provider";
import { resolveTtsProvider } from "@/tts/registry";
import { synthesizeReply } from "@/voice/tts-playback-runtime";

const FISH_KEY_URL = "https://fish.audio/go-api/";
const BACKENDS: FishTtsBackend[] = ["s1", "s2-pro"];

type TtsErrorKey =
  | "voice.tts.errAuth"
  | "voice.tts.errRateLimit"
  | "voice.tts.errNetwork"
  | "voice.tts.errGeneric";

function ttsErrorKey(err: unknown): TtsErrorKey {
  if (err instanceof TtsError) {
    if (err.kind === "auth") return "voice.tts.errAuth";
    if (err.kind === "rate-limit") return "voice.tts.errRateLimit";
    if (err.kind === "network") return "voice.tts.errNetwork";
  }
  return "voice.tts.errGeneric";
}

function splitIds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Settings → Text-to-Speech (Phase 2 of the voice-DJ PRD). BYOK Fish Audio key +
 * "My voices" (self_only) with search, add-by-id for public voices, per-voice
 * sample + reply preview, and speak/duck controls. Voices load via TanStack Query
 * (remote list = its job, rule 6); the key writes to `settings.fishAudioApiKey`.
 */
export function VoiceTtsSettings() {
  const { t } = useTranslation();
  const settings = useSettings();
  const key = settings.fishAudioApiKey?.trim() ?? "";
  const hasKey = Boolean(key);
  // Cheap to build; queries key on `key`/`search`, not on provider identity.
  const provider = resolveTtsProvider(settings);

  const [reveal, setReveal] = useState(false);
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [addDraft, setAddDraft] = useState("");
  const [busyMsgKey, setBusyMsgKey] = useState<TtsErrorKey | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const addedIds = settings.ttsAddedVoiceIds ?? [];

  const ownedQuery = useQuery({
    queryKey: ["fish-owned-voices", key, search],
    queryFn: async (): Promise<VoiceModel[]> =>
      provider ? provider.listVoices({ ownedOnly: true, query: search || undefined }) : [],
    enabled: hasKey,
    staleTime: 60_000,
  });

  const addedQuery = useQuery({
    queryKey: ["fish-added-voices", key, addedIds.join(",")],
    queryFn: async (): Promise<VoiceModel[]> => {
      if (!provider) return [];
      const cache = new Map((settings.ttsAddedVoiceCache ?? []).map((m) => [m.id, m]));
      const out: VoiceModel[] = [];
      for (const id of addedIds) {
        const cached = cache.get(id);
        if (cached) {
          out.push({
            id: cached.id,
            title: cached.title,
            coverImage: cached.coverImage,
            samples: cached.samples ?? [],
            tags: [],
            languages: [],
          });
          continue;
        }
        const fetched = await provider.getVoice(id).catch(() => null);
        if (fetched) out.push(fetched);
      }
      return out;
    },
    enabled: hasKey && addedIds.length > 0,
    staleTime: 30 * 60_000,
  });

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
  }

  function playSample(url: string) {
    stopAudio();
    const el = new Audio(url);
    audioRef.current = el;
    void el.play().catch(() => {});
  }

  async function previewReply(voiceId: string) {
    setBusyMsgKey(null);
    setPreviewingId(voiceId);
    try {
      const result = await synthesizeReply(t("voice.tts.previewText"), { voiceId });
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(result.blob);
      previewUrlRef.current = url;
      playSample(url);
    } catch (err) {
      setBusyMsgKey(ttsErrorKey(err));
    } finally {
      setPreviewingId(null);
    }
  }

  async function addVoices() {
    const ids = splitIds(addDraft).filter((id) => !addedIds.includes(id));
    if (!ids.length || !provider) return;
    setBusyMsgKey(null);
    const resolved: VoiceModel[] = [];
    for (const id of ids) {
      const model = await provider.getVoice(id).catch(() => null);
      if (model) resolved.push(model);
    }
    if (!resolved.length) {
      setBusyMsgKey("voice.tts.errGeneric");
      return;
    }
    const newCache: CachedVoiceModel[] = resolved.map((m) => ({
      id: m.id,
      title: m.title,
      coverImage: m.coverImage,
      samples: m.samples,
    }));
    const mergedCache = [...(settings.ttsAddedVoiceCache ?? []), ...newCache];
    const dedupedCache = Array.from(new Map(mergedCache.map((m) => [m.id, m])).values());
    await saveSettings({
      ttsAddedVoiceIds: [...addedIds, ...resolved.map((m) => m.id)],
      ttsAddedVoiceCache: dedupedCache,
    });
    setAddDraft("");
  }

  async function removeVoice(id: string) {
    await saveSettings({
      ttsAddedVoiceIds: addedIds.filter((x) => x !== id),
      ttsAddedVoiceCache: (settings.ttsAddedVoiceCache ?? []).filter((m) => m.id !== id),
      ttsVoiceId: settings.ttsVoiceId === id ? undefined : settings.ttsVoiceId,
    });
  }

  const shownKey = keyDraft ?? settings.fishAudioApiKey ?? "";
  const speed = settings.ttsSpeed ?? 1;
  const duckVolume = Math.round((settings.djVoiceDuckVolume ?? 0.25) * 100);
  const duckRamp = settings.djVoiceDuckRampMs ?? 200;

  const renderVoice = (voice: VoiceModel, removable: boolean) => {
    const selected = settings.ttsVoiceId === voice.id;
    const sampleUrl = voice.samples[0]?.audio;
    return (
      <div
        key={voice.id}
        className={`flex items-center gap-2 rounded-md border p-2.5 ${selected ? "border-primary" : "border-border"}`}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium text-sm">{voice.title}</span>
          <span className="truncate text-muted-foreground text-[11px]">{voice.id}</span>
        </div>
        {sampleUrl && (
          <Button
            aria-label={t("voice.tts.playSample")}
            onClick={() => playSample(sampleUrl)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Play />
          </Button>
        )}
        <Button
          disabled={previewingId === voice.id}
          onClick={() => void previewReply(voice.id)}
          size="sm"
          type="button"
          variant="ghost"
        >
          {previewingId === voice.id ? t("voice.tts.previewing") : t("voice.tts.previewReply")}
        </Button>
        <Button
          onClick={() => void saveSettings({ ttsVoiceId: voice.id })}
          size="sm"
          type="button"
          variant={selected ? "default" : "outline"}
        >
          {selected ? <Check /> : null}
          {selected ? t("voice.tts.selected") : t("voice.tts.select")}
        </Button>
        {removable && (
          <Button
            aria-label={t("voice.tts.remove")}
            onClick={() => void removeVoice(voice.id)}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Trash2 />
          </Button>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("voice.tts.title")}</CardTitle>
        <p className="text-muted-foreground text-xs">{t("voice.tts.subtitle")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Auto-speak DJ replies — the single switch that turns the DJ's voice on. */}
        <label className="flex items-start gap-3 rounded-md border border-border p-3">
          <input
            type="checkbox"
            checked={Boolean(settings.djReplyAutoSpeak)}
            onChange={(e) => void saveSettings({ djReplyAutoSpeak: e.currentTarget.checked })}
            className="mt-1 size-4 accent-primary"
          />
          <span className="flex flex-col gap-1">
            <span className="font-medium text-sm">{t("voice.tts.autoSpeak")}</span>
            <span className="text-muted-foreground text-xs">{t("voice.tts.autoSpeakHint")}</span>
          </span>
        </label>

        {/* Fish API key */}
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs">{t("voice.tts.apiKey")}</span>
          <div className="flex min-w-0 items-center gap-1.5">
            <Input
              autoComplete="off"
              className="min-w-0 flex-1"
              type={reveal ? "text" : "password"}
              value={shownKey}
              placeholder="Fish Audio API key"
              onChange={(e) => setKeyDraft(e.target.value)}
              onBlur={() => {
                if (keyDraft != null && keyDraft !== (settings.fishAudioApiKey ?? "")) {
                  void saveSettings({ fishAudioApiKey: keyDraft.trim() });
                }
                setKeyDraft(null);
              }}
            />
            <Button
              aria-label={reveal ? t("voice.tts.hide") : t("voice.tts.reveal")}
              onClick={() => setReveal((v) => !v)}
              size="icon"
              type="button"
              variant="ghost"
            >
              {reveal ? <EyeOff /> : <Eye />}
            </Button>
            <Button
              aria-label={t("voice.tts.getKey")}
              onClick={() => void openExternalUrl(FISH_KEY_URL)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ExternalLink />
            </Button>
          </div>
        </div>

        {busyMsgKey && <span className="text-destructive text-xs">{t(busyMsgKey)}</span>}

        {!hasKey && <span className="text-muted-foreground text-xs">{t("voice.tts.needKey")}</span>}

        {/* My voices */}
        {hasKey && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-sm">{t("voice.tts.myVoices")}</span>
            </div>
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t("voice.tts.search")}
            />
            {ownedQuery.isLoading ? (
              <span className="text-muted-foreground text-xs">{t("voice.tts.loading")}</span>
            ) : ownedQuery.data && ownedQuery.data.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {ownedQuery.data.map((v) => renderVoice(v, false))}
              </div>
            ) : (
              <span className="text-muted-foreground text-xs">{t("voice.tts.noVoices")}</span>
            )}
          </div>
        )}

        {/* Add a public voice */}
        {hasKey && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <span className="font-medium text-sm">{t("voice.tts.addTitle")}</span>
            <span className="text-muted-foreground text-xs">{t("voice.tts.addHint")}</span>
            <div className="flex min-w-0 items-center gap-1.5">
              <Input
                className="min-w-0 flex-1"
                value={addDraft}
                onChange={(e) => setAddDraft(e.target.value)}
                placeholder={t("voice.tts.addPlaceholder")}
              />
              <Button
                disabled={!splitIds(addDraft).length}
                onClick={() => void addVoices()}
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus /> {t("voice.tts.add")}
              </Button>
            </div>
            {addedQuery.data && addedQuery.data.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {addedQuery.data.map((v) => renderVoice(v, true))}
              </div>
            )}
          </div>
        )}

        {/* Voice / synthesis controls */}
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">{t("voice.tts.backend")}</span>
            <Select
              value={settings.ttsModel ?? "s1"}
              onValueChange={(value) => {
                if (value) void saveSettings({ ttsModel: value as FishTtsBackend });
              }}
            >
              <SelectTrigger>
                <SelectValue>
                  {(value) =>
                    value === "s2-pro" ? t("voice.tts.backendS2") : t("voice.tts.backendS1")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {BACKENDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id === "s2-pro" ? t("voice.tts.backendS2") : t("voice.tts.backendS1")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-muted-foreground text-xs">
              {t("voice.tts.speed", { value: speed.toFixed(1) })}
            </span>
            <Slider
              min={0.5}
              max={2}
              step={0.1}
              value={speed}
              onValueChange={(v) => void saveSettings({ ttsSpeed: v })}
              aria-label={t("voice.tts.speed", { value: speed.toFixed(1) })}
            />
          </div>
        </div>

        {/* Ducking */}
        <label className="flex items-start gap-3 rounded-md border border-border p-3">
          <input
            type="checkbox"
            checked={settings.djVoiceDuckMusic ?? true}
            onChange={(e) => void saveSettings({ djVoiceDuckMusic: e.currentTarget.checked })}
            className="mt-1 size-4 accent-primary"
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-center gap-1.5 font-medium text-sm">
              <Volume2 className="size-4" /> {t("voice.tts.duckMusic")}
            </span>
            {(settings.djVoiceDuckMusic ?? true) && (
              <>
                <span className="text-muted-foreground text-xs">
                  {t("voice.tts.duckVolume", { pct: duckVolume })}
                </span>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={duckVolume}
                  onValueChange={(v) => void saveSettings({ djVoiceDuckVolume: v / 100 })}
                  aria-label={t("voice.tts.duckVolume", { pct: duckVolume })}
                />
                <span className="text-muted-foreground text-xs">
                  {t("voice.tts.duckRamp", { ms: duckRamp })}
                </span>
                <Slider
                  min={0}
                  max={600}
                  step={50}
                  value={duckRamp}
                  onValueChange={(v) => void saveSettings({ djVoiceDuckRampMs: v })}
                  aria-label={t("voice.tts.duckRamp", { ms: duckRamp })}
                />
              </>
            )}
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
