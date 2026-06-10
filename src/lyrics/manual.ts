/**
 * Manual lyrics entry: turn user-pasted text into a persistable record. If the
 * text contains `[mm:ss]` timestamps it's stored as synced LRC (kept verbatim so
 * formatting survives); otherwise as plain text. Always `source: "manual"` so it
 * wins on merge and auto-fetch never overwrites it. Pure.
 */

import type { LyricsRecord } from "./provider";

const HAS_TIMESTAMP = /\[\d{1,3}:\d{2}/;

export function lyricsRecordFromManualText(text: string): LyricsRecord {
  const trimmed = text.trim();
  const synced = HAS_TIMESTAMP.test(trimmed);
  return {
    source: "manual",
    instrumental: false,
    status: "found",
    synced: synced ? text : undefined,
    plain: synced ? undefined : trimmed,
  };
}
