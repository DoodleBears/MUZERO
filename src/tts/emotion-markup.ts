/**
 * Pure helpers for the DJ's multi-part spoken replies (`dj_say`). A reply is an
 * array of {@link ReplyPart}s, each an optional emotion + a line of text. The
 * emotion maps to Fish Audio's inline emotion markers so the TTS voice can shift
 * tone mid-reply (Fish emotion control):
 *   - S2 family (`s2.1-pro-free` / `s2.1-pro` / `s2-pro`) → `[emotion]` brackets
 *     (free-form natural-language descriptors allowed);
 *   - S1 (`s1`) → `(emotion)` parentheses (a fixed emotion set).
 *
 * Notifications and dedup use {@link plainReplyText} (no markers); only the TTS
 * input carries the markers via {@link buildEmotionText}. Kept vendor-pure and
 * DOM-free so the marker syntax is exhaustively unit-testable.
 */

import type { FishTtsBackend } from "./fish-mapping";

/** One segment of a DJ reply: a line of text with an optional emotion. */
export interface ReplyPart {
  text: string;
  /** Emotion descriptor (e.g. "happy", "excited", "gentle"); maps to Fish markers. */
  emotion?: string;
}

/**
 * Normalize a `dj_say` payload into clean parts. Accepts the multi-part `say`
 * array (preferred) or a legacy single `text`; trims text + emotion, drops empty
 * parts and empty emotions.
 */
export function normalizeReplyParts(input: { say?: ReplyPart[]; text?: string }): ReplyPart[] {
  const raw: ReplyPart[] = input.say?.length ? input.say : input.text ? [{ text: input.text }] : [];
  return raw
    .map((p) => {
      const emotion = p.emotion?.trim();
      return { text: (p.text ?? "").trim(), emotion: emotion ? emotion : undefined };
    })
    .filter((p) => p.text.length > 0);
}

/** The plain listener-facing text: part texts joined, emotions stripped. */
export function plainReplyText(parts: ReplyPart[]): string {
  return parts
    .map((p) => p.text.trim())
    .filter(Boolean)
    .join(" ");
}

/** Whether a Fish backend uses the S1 parenthesis emotion syntax (else brackets). */
export function usesParenEmotion(backend: FishTtsBackend): boolean {
  return backend === "s1";
}

/** Wrap one emotion label in the backend's marker syntax: `[happy]` (S2) / `(happy)` (S1). */
export function emotionMarker(emotion: string, backend: FishTtsBackend): string {
  // Strip stray brackets a model might already have added, so we never double-wrap.
  const label = emotion
    .trim()
    .replace(/[[\]()]/g, "")
    .trim();
  if (!label) return "";
  return usesParenEmotion(backend) ? `(${label})` : `[${label}]`;
}

/**
 * Build the TTS input string: each part's text prefixed with its emotion marker
 * (when set), parts joined by a space. With no emotions this equals
 * {@link plainReplyText}, so the speak path stays identical to what's shown.
 */
export function buildEmotionText(parts: ReplyPart[], backend: FishTtsBackend): string {
  return parts
    .map((p) => {
      const text = p.text.trim();
      if (!text) return "";
      const marker = p.emotion ? emotionMarker(p.emotion, backend) : "";
      return marker ? `${marker} ${text}` : text;
    })
    .filter(Boolean)
    .join(" ");
}
