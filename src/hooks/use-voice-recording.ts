import { useEffect, useState } from "react";
import type { VoiceInputState } from "@/voice/voice-input-controller";
import { getVoiceInputController } from "@/voice/voice-input-runtime";

/**
 * Reflect the global push-to-talk controller's recording state in a component
 * (e.g. the composer mic button) via its multi-listener `subscribeState` — so
 * `use-voice-dj` keeps ownership of the single callbacks (routing + TTS).
 */
export function useVoiceRecordingState(): VoiceInputState {
  const [state, setState] = useState<VoiceInputState>(() => getVoiceInputController().getState());
  useEffect(() => {
    const controller = getVoiceInputController();
    setState(controller.getState());
    return controller.subscribeState(setState);
  }, []);
  return state;
}
