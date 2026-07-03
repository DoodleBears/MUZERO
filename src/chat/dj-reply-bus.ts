/**
 * A tiny module-scope pub/sub for the DJ's spoken-style replies (`dj_say`).
 *
 * The `dj_say` tool is the DJ's ONE channel for talking back to the listener.
 * Keeping it a bus (not a direct notify/TTS call) keeps the tool pure + testable
 * and lets a single app-wide consumer (`use-voice-dj`) decide what to do with a
 * reply — post it to the notification stack and, when auto-speak is on, speak it.
 * A module singleton, not Zustand state (CLAUDE.md rule 6).
 */

import type { ReplyPart } from "@/tts/emotion-markup";

export interface DjReplyEvent {
  /** The short, listener-facing line to show (and optionally speak) — plain, no
   *  emotion markers. Derived from {@link parts} when present. */
  text: string;
  /** The reply split into parts, each with an optional emotion. The speak path
   *  turns these into Fish emotion markers; the notification uses {@link text}. */
  parts?: ReplyPart[];
  /** Optional mood hint for future voice/tone selection; unused for now. */
  tone?: "neutral" | "hype" | "chill" | "apologetic";
  /** The chat session that produced the reply, when known. */
  sessionId?: string;
}

type Listener = (event: DjReplyEvent) => void;

const listeners = new Set<Listener>();
// The text of the immediately-previous reply, to drop back-to-back duplicates —
// models sometimes call dj_say repeatedly with the SAME line in one turn, which
// would spam the notification stack + read the same thing aloud several times.
// Only consecutive identicals are dropped: "a","b","a" still delivers all three.
let lastReplyText = "";

/** Broadcast a DJ reply to all subscribers (dropping a back-to-back duplicate). */
export function emitDjReply(event: DjReplyEvent): void {
  const text = event.text.trim();
  if (text && text === lastReplyText) return;
  lastReplyText = text;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A bad subscriber must not break the tool call or other subscribers.
    }
  }
}

/** Test seam: reset the dedup guard between cases. */
export function resetDjReplyDedup(): void {
  lastReplyText = "";
}

/** Subscribe to DJ replies; returns an unsubscribe fn. */
export function onDjReply(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
