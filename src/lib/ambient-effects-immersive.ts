export interface AmbientEffectsImmersiveState {
  isNowTab: boolean;
  visualizerIdleOnly: boolean;
}

/**
 * Background effect policy follows the explicit Now Playing visualizer
 * "Immersive" mode only. Ordinary idle chrome hiding (or the "Visualizer"
 * placement staying active while idle) should keep using normal video settings.
 */
export function resolveAmbientEffectsImmersive(state: AmbientEffectsImmersiveState): boolean {
  return state.isNowTab && state.visualizerIdleOnly;
}
