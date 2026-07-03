/**
 * A tiny stepwise volume ramp — the shared primitive behind the DJ-voice music
 * duck and playback crossfade (淡入淡出). Steps the element volume every ~30ms
 * (no rAF, no per-frame work → negligible cost, no frame drops). Fully injectable
 * (apply / timer / stepMs) so the ramp math is deterministically unit-testable.
 */

export interface AudioFaderDeps {
  /** Apply a volume in [0,1] to the audio element. */
  apply: (volume: number) => void;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
  /** Ramp granularity; default 30ms. */
  stepMs?: number;
}

export interface AudioFader {
  /** Ramp from → to over `ms`; cancels any in-flight fade. `onDone` fires at the end. */
  fadeTo(from: number, to: number, ms: number, onDone?: () => void): void;
  cancel(): void;
  isFading(): boolean;
}

export function createAudioFader(deps: AudioFaderDeps): AudioFader {
  const stepMs = deps.stepMs ?? 30;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id));
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  return {
    fadeTo(from, to, ms, onDone) {
      cancel();
      const steps = Math.max(1, Math.round(ms / stepMs));
      if (ms <= 0 || steps <= 1) {
        deps.apply(to);
        onDone?.();
        return;
      }
      let i = 0;
      const tick = () => {
        i += 1;
        deps.apply(from + (to - from) * (i / steps));
        if (i < steps) {
          timer = setTimer(tick, stepMs);
        } else {
          timer = null;
          onDone?.();
        }
      };
      timer = setTimer(tick, stepMs);
    },
    cancel,
    isFading: () => timer !== null,
  };
}
