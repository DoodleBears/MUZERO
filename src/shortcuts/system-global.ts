import type { ShortcutGesture, ShortcutStroke } from "./registry";

export const SYSTEM_GLOBAL_SHORTCUT_ACTIONS = [
  "playback.toggle",
  "playback.prev",
  "playback.next",
  "playback.volumeUp",
  "playback.volumeDown",
  "playback.toggleShuffle",
  "playback.like",
  "playback.cycleRepeat",
] as const;

export type SystemGlobalShortcutActionId = (typeof SYSTEM_GLOBAL_SHORTCUT_ACTIONS)[number];

export interface SystemShortcutBinding {
  enabled: boolean;
  gesture?: ShortcutGesture;
}

export type SystemShortcutBindings = Partial<Record<string, SystemShortcutBinding | undefined>>;

export interface SystemShortcutRegistration {
  actionId: SystemGlobalShortcutActionId;
  accelerator: string;
}

export type SystemShortcutGestureRejectionReason =
  | "pointer-gesture"
  | "unsupported-key"
  | "unsafe-bare-key";

export type SystemShortcutGestureValidation =
  | { ok: true; accelerator: string }
  | { ok: false; reason: SystemShortcutGestureRejectionReason };

const SYSTEM_GLOBAL_SHORTCUT_ACTION_SET = new Set<string>(SYSTEM_GLOBAL_SHORTCUT_ACTIONS);

const MEDIA_KEY_BY_CODE: Readonly<Record<string, string>> = {
  AudioVolumeDown: "VolumeDown",
  AudioVolumeMute: "VolumeMute",
  AudioVolumeUp: "VolumeUp",
  MediaNextTrack: "MediaNextTrack",
  MediaPlayPause: "MediaPlayPause",
  MediaPreviousTrack: "MediaPreviousTrack",
  MediaStop: "MediaStop",
  MediaTrackNext: "MediaNextTrack",
  MediaTrackPrevious: "MediaPreviousTrack",
  VolumeDown: "VolumeDown",
  VolumeMute: "VolumeMute",
  VolumeUp: "VolumeUp",
};

const KEY_BY_CODE: Readonly<Record<string, string>> = {
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  Backquote: "`",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Enter: "Enter",
  Equal: "=",
  Escape: "Esc",
  Minus: "-",
  Period: ".",
  Quote: "'",
  Semicolon: ";",
  Slash: "/",
  Space: "Space",
  Tab: "Tab",
  ...MEDIA_KEY_BY_CODE,
};

export function isSystemGlobalShortcutAction(
  actionId: string,
): actionId is SystemGlobalShortcutActionId {
  return SYSTEM_GLOBAL_SHORTCUT_ACTION_SET.has(actionId);
}

export function validateSystemShortcutGesture(
  gesture: ShortcutGesture,
): SystemShortcutGestureValidation {
  if (gesture.kind !== "key") return { ok: false, reason: "pointer-gesture" };
  const key = electronKeyFromStroke(gesture.stroke);
  if (!key) return { ok: false, reason: "unsupported-key" };
  if (!hasSystemModifier(gesture.stroke) && !isDedicatedMediaKey(key)) {
    return { ok: false, reason: "unsafe-bare-key" };
  }
  return { ok: true, accelerator: electronAcceleratorFromStroke(gesture.stroke, key) };
}

export function systemGestureToElectronAccelerator(gesture: ShortcutGesture): string | null {
  const validation = validateSystemShortcutGesture(gesture);
  return validation.ok ? validation.accelerator : null;
}

export function buildSystemShortcutRegistrations(
  bindings: SystemShortcutBindings | undefined,
): SystemShortcutRegistration[] {
  const out: SystemShortcutRegistration[] = [];
  if (!bindings) return out;
  for (const actionId of SYSTEM_GLOBAL_SHORTCUT_ACTIONS) {
    const binding = bindings[actionId];
    if (!binding?.enabled || !binding.gesture) continue;
    const validation = validateSystemShortcutGesture(binding.gesture);
    if (!validation.ok) continue;
    out.push({ actionId, accelerator: validation.accelerator });
  }
  return out;
}

function electronAcceleratorFromStroke(stroke: ShortcutStroke, key: string): string {
  const parts: string[] = [];
  if (stroke.primaryKey) parts.push("CommandOrControl");
  if (stroke.ctrlKey) parts.push("Ctrl");
  if (stroke.altKey) parts.push("Alt");
  if (stroke.shiftKey) parts.push("Shift");
  if (stroke.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

function electronKeyFromStroke(stroke: ShortcutStroke): string | null {
  if (/^Key[A-Z]$/.test(stroke.code)) return stroke.code.slice(3);
  if (/^Digit[0-9]$/.test(stroke.code)) return stroke.code.slice(5);
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(stroke.code)) return stroke.code;
  return KEY_BY_CODE[stroke.code] ?? null;
}

function hasSystemModifier(stroke: ShortcutStroke): boolean {
  return Boolean(stroke.primaryKey || stroke.ctrlKey || stroke.metaKey || stroke.altKey);
}

function isDedicatedMediaKey(key: string): boolean {
  return Object.values(MEDIA_KEY_BY_CODE).includes(key);
}
