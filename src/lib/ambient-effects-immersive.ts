export interface AmbientEffectsImmersiveState {
  chromeHidden: boolean;
  isNowTab: boolean;
  lyricsOnlyIdle: boolean;
  visualizerIdleOnly: boolean;
}

/**
 * Background effect policy follows the actual Now Playing immersive/idle state.
 * Dock hot-zone hiding is deliberately excluded: on desktop the Dock can remain
 * hidden until the pointer reaches the bottom edge, even after ordinary pointer
 * movement has already restored the foreground and exited idle.
 */
export function resolveAmbientEffectsImmersive(state: AmbientEffectsImmersiveState): boolean {
  return state.isNowTab && (state.chromeHidden || state.visualizerIdleOnly || state.lyricsOnlyIdle);
}
