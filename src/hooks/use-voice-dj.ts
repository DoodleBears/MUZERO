/**
 * useVoiceDj — the app-wide wiring that turns push-to-talk into a DJ turn
 * (voice-DJ PRD Phase 3). Mounted once from App. It:
 *   1) points the global VoiceInputController's callbacks at the ACTIVE chat
 *      runtime (transcript → sendMessage / interrupt, continuing the same
 *      conversation — PRD Q4), and surfaces recording + error toasts;
 *   2) subscribes to `dj_say` replies → notification (+ optional speech with a
 *      gradient music duck);
 *   3) watches the active runtime for paid-generation approvals and either
 *      prompts Approve/Deny or auto-approves per the user's setting (PRD Q5).
 *
 * Orchestration singletons (controller, TTS playback) live in module scope, not
 * Zustand — the hook only holds refs (CLAUDE.md rule 6).
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AsrError } from "@/asr/provider";
import type { DjChatRuntimeActor } from "@/chat/dj-chat-runtime-actor";
import { pendingApprovalIds } from "@/chat/dj-chat-runtime-actor";
import { getActiveDjChatRuntimeActor } from "@/chat/dj-chat-runtime-registry";
import { onDjReply } from "@/chat/dj-reply-bus";
import type { AppSettings } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { notify } from "@/stores/notification-store";
import { isTtsReady } from "@/tts/registry";
import { createTtsPlayback, type TtsPlayback } from "@/voice/tts-playback";
import {
  createAudioSink,
  createGradientDucker,
  synthesizeReply,
} from "@/voice/tts-playback-runtime";
import { decideApproval, deliverDjReply, routeVoiceTranscript } from "@/voice/voice-dj-logic";
import { getVoiceInputController } from "@/voice/voice-input-runtime";

type AsrErrorKey =
  | "voice.asr.micDenied"
  | "voice.asr.errAuth"
  | "voice.asr.errRateLimit"
  | "voice.asr.errNetwork"
  | "voice.asr.errGeneric";

function asrErrorMessageKey(err: unknown): AsrErrorKey {
  if (err instanceof DOMException && err.name === "NotAllowedError") return "voice.asr.micDenied";
  if (err instanceof AsrError) {
    if (err.kind === "auth") return "voice.asr.errAuth";
    if (err.kind === "rate-limit") return "voice.asr.errRateLimit";
    if (err.kind === "network") return "voice.asr.errNetwork";
  }
  return "voice.asr.errGeneric";
}

export function useVoiceDj(): void {
  const { t } = useTranslation();
  const settings = useSettings();

  // Refs keep the latest settings/translator readable inside the stable callbacks
  // installed once on the module-scope controller.
  const settingsRef = useRef<AppSettings>(settings);
  settingsRef.current = settings;
  const tRef = useRef(t);
  tRef.current = t;

  const playbackRef = useRef<TtsPlayback | null>(null);
  if (!playbackRef.current) {
    playbackRef.current = createTtsPlayback({
      synthesize: (text, signal) => synthesizeReply(text, { signal }),
      sink: createAudioSink(),
      ducker: createGradientDucker(() => settingsRef.current.djVoiceDuckRampMs ?? 200),
      getConfig: () => ({
        duckEnabled: settingsRef.current.djVoiceDuckMusic ?? true,
        duckVolume: settingsRef.current.djVoiceDuckVolume ?? 0.25,
      }),
      onError: () => notify.warning(tRef.current("voice.tts.synthFailed")),
    });
  }

  // Watcher state (persist across renders).
  const approvalSubRef = useRef<{ actor: DjChatRuntimeActor; unsub: () => void } | null>(null);
  const handledApprovals = useRef<Set<string>>(new Set());
  const listeningToastRef = useRef<string | null>(null);
  // A voice turn is awaiting a reply; cleared once dj_say fires (or we fall back).
  const expectFallbackRef = useRef(false);

  useEffect(() => {
    const controller = getVoiceInputController();
    const playback = playbackRef.current;

    /** Show a DJ reply (notification + optional speech). Shared by dj_say + fallback. */
    function postReply(text: string): void {
      deliverDjReply(
        { text },
        {
          notifyReply: (t) =>
            notify.info(t, {
              duration: 8000,
              actions: isTtsReady(settingsRef.current)
                ? [
                    {
                      label: tRef.current("voice.reply.replay"),
                      onClick: () => playback?.speak(t),
                      keepOpen: true,
                    },
                  ]
                : undefined,
            }),
          speak: (t) => playback?.speak(t),
          autoSpeak: settingsRef.current.djReplyAutoSpeak ?? false,
          ttsReady: isTtsReady(settingsRef.current),
        },
      );
    }

    function watchActor(actor: DjChatRuntimeActor): void {
      if (approvalSubRef.current?.actor === actor) return;
      approvalSubRef.current?.unsub();
      let prevStatus = actor.getSnapshot().meta.status;
      const unsub = actor.subscribe(() => {
        const snap = actor.getSnapshot();

        // Paid-generation approval (PRD Q5).
        if (snap.meta.status === "awaiting-approval") {
          const fresh = pendingApprovalIds(snap.messages).filter(
            (id) => !handledApprovals.current.has(id),
          );
          const decision = decideApproval(
            fresh,
            settingsRef.current.voiceAutoApproveGenerate ?? false,
          );
          if (decision.kind !== "none") {
            for (const id of decision.ids) handledApprovals.current.add(id);
            if (decision.kind === "auto-approve") {
              for (const id of decision.ids) void actor.respondToToolApproval(id, true);
            } else {
              const id = decision.ids[0];
              notify.warning(tRef.current("voice.approval.prompt"), {
                duration: 0,
                actions: [
                  {
                    label: tRef.current("voice.approval.approve"),
                    onClick: () => void actor.respondToToolApproval(id, true),
                  },
                  {
                    label: tRef.current("voice.approval.deny"),
                    onClick: () => void actor.respondToToolApproval(id, false),
                    variant: "ghost",
                  },
                ],
              });
            }
          }
        }

        // Fallback reply: a voice turn just finished but the model never called
        // dj_say — speak/notify `lastAssistantPreview` so there's always a reply.
        const settled = snap.meta.status === "idle" || snap.meta.status === "error";
        const wasBusy = prevStatus === "streaming" || prevStatus === "submitted";
        if (settled && wasBusy && expectFallbackRef.current) {
          expectFallbackRef.current = false;
          const preview = snap.meta.lastAssistantPreview?.trim();
          if (preview) postReply(preview);
        }
        prevStatus = snap.meta.status;
      });
      approvalSubRef.current = { actor, unsub };
    }

    controller.setCallbacks({
      onStateChange: (state) => {
        if (state === "recording") {
          if (listeningToastRef.current) notify.dismiss(listeningToastRef.current);
          listeningToastRef.current = notify.loading(tRef.current("voice.listening"));
        } else if (state === "transcribing") {
          if (listeningToastRef.current) {
            notify.update(listeningToastRef.current, {
              message: tRef.current("voice.transcribing"),
            });
          }
        } else if (listeningToastRef.current) {
          notify.dismiss(listeningToastRef.current);
          listeningToastRef.current = null;
        }
      },
      onTranscript: (text) => {
        expectFallbackRef.current = true;
        void getActiveDjChatRuntimeActor().then((actor) => {
          watchActor(actor);
          return routeVoiceTranscript(
            {
              getStatus: () => actor.getSnapshot().meta.status,
              sendMessage: (m) => actor.sendMessage(m),
              interruptWithMessage: (m) => actor.interruptWithMessage(m),
            },
            text,
          );
        });
      },
      onError: (err) => notify.error(tRef.current(asrErrorMessageKey(err))),
    });

    const offReply = onDjReply((event) => {
      // A real dj_say reply arrived → no fallback needed for this turn.
      expectFallbackRef.current = false;
      postReply(event.text);
    });

    return () => {
      offReply();
      approvalSubRef.current?.unsub();
      approvalSubRef.current = null;
      if (listeningToastRef.current) {
        notify.dismiss(listeningToastRef.current);
        listeningToastRef.current = null;
      }
    };
  }, []);
}
