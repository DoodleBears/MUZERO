/**
 * A tiny module-scope pub/sub for the DJ's spoken-style replies (`dj_say`).
 *
 * The `dj_say` tool is the DJ's ONE channel for talking back to the listener.
 * Keeping it a bus (not a direct notify/TTS call) keeps the tool pure + testable
 * and lets a single app-wide consumer (`use-voice-dj`) decide what to do with a
 * reply — post it to the notification stack and, when auto-speak is on, speak it.
 * A module singleton, not Zustand state (CLAUDE.md rule 6).
 */

export interface DjReplyEvent {
  /** The short, listener-facing line to show (and optionally speak). */
  text: string;
  /** Optional mood hint for future voice/tone selection; unused for now. */
  tone?: "neutral" | "hype" | "chill" | "apologetic";
  /** The chat session that produced the reply, when known. */
  sessionId?: string;
}

type Listener = (event: DjReplyEvent) => void;

const listeners = new Set<Listener>();

/** Broadcast a DJ reply to all subscribers. */
export function emitDjReply(event: DjReplyEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // A bad subscriber must not break the tool call or other subscribers.
    }
  }
}

/** Subscribe to DJ replies; returns an unsubscribe fn. */
export function onDjReply(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
