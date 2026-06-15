/**
 * The ready-gate for the Background Frame Controller (PRD §2.3, Phase 2).
 *
 * A frame is allowed to crossfade in ONLY when it can be painted with no flash
 * and no stale/wrong cover. This collapses the anti-flicker invariants the parent
 * switch-background-perf PRD earned across QA#7–24 into one pure predicate; the
 * controller hook maps each concrete hook state (local-cover protocol, streamed
 * cover, liveQuery stale row, image decode, Pixi texture upload, derivative) onto
 * these inputs. Until a frame is ready the layer-stack reducer HOLDS the previous
 * frame (its opacity can't advance) — so the base is never swapped to a blank.
 *
 * Pure — unit-tested.
 */

export interface BackgroundReadyInputs {
  /** The resolved resource belongs to the target track (stale liveQuery row guard, QA#12-13). */
  matchesTrack: boolean;
  /** A local-cover protocol URL is still resolving — do NOT fall back to a blob (QA#11-13). */
  pendingProtocolUrl: boolean;
  /** The URL to render (object-url / muzfetch / protocol / video) is resolved. */
  mediaUrlReady: boolean;
  /** The image is decoded / the Pixi texture uploaded / the video has a frame. */
  decoded: boolean;
  /** Whether this frame renders any media at all. A title-only frame has none and
   *  is ready immediately (nothing to wait for). Defaults to true. */
  hasMedia?: boolean;
}

export function isBackgroundFrameReady(inputs: BackgroundReadyInputs): boolean {
  // A stale resource (wrong track) is never ready — it would show the wrong cover.
  if (!inputs.matchesTrack) return false;
  // No media to paint → ready at once (e.g. a title-only fallback frame).
  if (inputs.hasMedia === false) return true;
  // Mid-switch protocol resolution: hold rather than flash a blob fallback.
  if (inputs.pendingProtocolUrl) return false;
  // Never crossfade in before the URL resolves and the pixels are ready.
  return inputs.mediaUrlReady && inputs.decoded;
}
