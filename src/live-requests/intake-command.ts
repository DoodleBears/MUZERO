import { DEFAULT_INTAKE_COMMANDS, type IntakeCommand } from "@/db/types";
import type { AudienceRequestRouteMode } from "./audience-request-schema";

/**
 * Pure keyword→intent router for the live-request (弹幕) intake. A message's
 * leading keyword decides its intent + route: `点歌`→library-search fast path,
 * `AI点歌`→ai-dj, `评论`→comment (Memory), `评分`→rating (crowd vote). Case-
 * insensitive, longest-prefix-first so `评分` wins over a shorter `评`. Mirrors the
 * discipline of `matchAudienceRequestPrefix`; deterministic + exhaustively tested.
 */

export interface IntakeCommandMatch {
  command: IntakeCommand;
  /** Prefix-stripped free text (rating also strips the score, comment the leading mm:ss). */
  body: string;
  /** rating only: parsed score clamped to 1..5; undefined when no number/stars present. */
  score?: number;
  /** comment only: explicit leading `mm:ss` (`评论 3:14 …`) → seconds; undefined = floating. */
  atSec?: number;
  matchedPrefix: string;
}

const RATING_MIN = 1;
const RATING_MAX = 5;

function clampScore(n: number): number {
  return Math.min(RATING_MAX, Math.max(RATING_MIN, n));
}

/** Parse a leading rating score: filled stars, an integer/decimal, or `n/m` (→ clamp). */
function extractScore(rest: string): { score?: number; body: string } {
  const trimmed = rest.trim();
  const stars = trimmed.match(/^★+/);
  if (stars) {
    return { score: clampScore(stars[0].length), body: trimmed.slice(stars[0].length).trim() };
  }
  const num = trimmed.match(/^(\d+(?:\.\d+)?)(?:\s*\/\s*\d+)?/);
  if (num) {
    return {
      score: clampScore(Math.round(Number(num[1]))),
      body: trimmed.slice(num[0].length).trim(),
    };
  }
  return { body: trimmed };
}

/** Parse a leading `mm:ss` / `m:ss` (or `h:mm:ss`) into seconds; else leave the text untouched. */
function extractLeadingTimestamp(rest: string): { atSec?: number; body: string } {
  const trimmed = rest.trim();
  const m = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return { body: trimmed };
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = m[3] != null ? Number(m[3]) : undefined;
  // Two parts = m:s; three parts = h:m:s.
  const atSec = c === undefined ? a * 60 + b : a * 3600 + b * 60 + c;
  return { atSec, body: trimmed.slice(m[0].length).trim() };
}

export function matchIntakeCommand(
  message: string,
  commands: readonly IntakeCommand[],
): IntakeCommandMatch | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  const candidates: Array<{ command: IntakeCommand; prefix: string }> = [];
  for (const command of commands) {
    if (command.enabled === false) continue;
    for (const raw of command.prefixes) {
      const prefix = raw.trim();
      if (prefix) candidates.push({ command, prefix });
    }
  }
  // Longest prefix first so a specific `评分` beats a generic `评`; ties keep config order.
  candidates.sort((a, b) => b.prefix.length - a.prefix.length);

  for (const { command, prefix } of candidates) {
    if (!lower.startsWith(prefix.toLowerCase())) continue;
    const rest = trimmed.slice(prefix.length).trim();
    if (command.intent === "rating") {
      const { score, body } = extractScore(rest);
      return { command, body, score, matchedPrefix: prefix };
    }
    if (command.intent === "comment") {
      const { atSec, body } = extractLeadingTimestamp(rest);
      return { command, body, atSec, matchedPrefix: prefix };
    }
    return { command, body: rest, matchedPrefix: prefix };
  }
  return null;
}

/**
 * Effective command table for an intake config. Explicit `commands` win; otherwise
 * synthesize a `song-search` request command from the legacy `commandPrefixes` +
 * `routeMode` (so existing installs keep working) and append the default ai-dj /
 * comment / rating commands.
 */
export function resolveCommands(intake: {
  commands?: IntakeCommand[];
  commandPrefixes?: string[];
  routeMode?: AudienceRequestRouteMode;
}): IntakeCommand[] {
  if (intake.commands && intake.commands.length > 0) return intake.commands;
  const defaultSongPrefixes = DEFAULT_INTAKE_COMMANDS.find((c) => c.id === "song-search")
    ?.prefixes ?? ["点歌"];
  const songSearch: IntakeCommand = {
    id: "song-search",
    intent: "request",
    prefixes:
      intake.commandPrefixes && intake.commandPrefixes.length > 0
        ? intake.commandPrefixes
        : defaultSongPrefixes,
    routeMode: intake.routeMode ?? "library-search",
  };
  return [songSearch, ...DEFAULT_INTAKE_COMMANDS.filter((c) => c.id !== "song-search")];
}
