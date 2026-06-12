/**
 * The keyboard-shortcut **action registry** — the single source of truth for every
 * configurable binding in MUZERO. Pure data (no React, no DOM): defaults, display
 * hints, dispatch, and the cheat-sheet all derive from this one array.
 *
 * Action ids are a **codename layer** (CLAUDE.md hard rule #4): stable across brand
 * pivots, like provider ids and `trk_`/`ses_` prefixes — so a user's stored keymap
 * (`AppSettings.shortcutOverrides`, keyed by id) survives renames.
 *
 * See the configurable-keyboard-shortcuts PRD
 * (`docs/prd/20260610-muzero-configurable-keyboard-shortcuts-prd/`).
 */

/** Best-effort platform discriminant — only "mac vs not" matters (⌘ vs Ctrl). */
export type Platform = "mac" | "other";

/**
 * Which surfaces a binding is live in. MUZERO surfaces SHADOW each other (you are
 * in exactly one library surface at a time, but `global` is always live), so
 * dispatch resolves by precedence (`inspector` > `library` > `global`) and a chord
 * may legally appear in more than one scope (e.g. `↑` = volume in `global` AND
 * focus-up in `library`). Conflicts are detected within a SINGLE scope only.
 */
export type ShortcutScope = "global" | "library" | "inspector";

/** Dispatch precedence: the most-specific *active* scope that binds a chord wins. */
export const SCOPE_PRECEDENCE: readonly ShortcutScope[] = ["inspector", "library", "global"];

/** Cheat-sheet grouping. `reference` = read-only intrinsic widget keys / gestures. */
export type ShortcutCategory =
  | "playback"
  | "navigation"
  | "library"
  | "search"
  | "memory"
  | "reference";

/**
 * One key stroke. `code` is `KeyboardEvent.code` (POSITIONAL — KeyW/KeyA/… keeps
 * WASD under the same fingers on AZERTY/Dvorak and matches the existing Backquote
 * check); `keyLabel` (from `event.key`) is for display only. `primaryKey` is the
 * platform's primary modifier (⌘ on mac, Ctrl elsewhere); it normalizes to Meta or
 * Ctrl per platform at identity time.
 */
export interface ShortcutStroke {
  code: string;
  keyLabel: string;
  primaryKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * A bindable gesture. v1 supports single-stroke key chords; `pointer` entries are
 * DISPLAY-ONLY (trackpad swipe, cover drag) — shown in the cheat-sheet, never
 * matched/dispatched here (their own DOM code owns them). 2-stroke sequences are a
 * forward-compatible Phase-5 extension.
 */
export type ShortcutGesture =
  | { kind: "key"; stroke: ShortcutStroke }
  | { kind: "pointer"; labelKey: string };

export interface ShortcutActionDef {
  /** Stable codename id (e.g. `playback.next`). Never renamed across brand pivots. */
  id: string;
  scope: ShortcutScope;
  category: ShortcutCategory;
  /** i18n key for the action label. */
  labelKey: string;
  /** Optional i18n key for a one-line description. */
  descriptionKey?: string;
  /** Built-in default bindings (may be multiple). */
  defaultBindings: ShortcutGesture[];
  /** false = display-only (gestures / reference keys): shown but never rebindable. */
  allowUserBindings?: boolean;
  /** true = cannot be rebound, and cannot be displaced by a conflict chain. */
  protected?: boolean;
  /** Extra search terms for the cheat-sheet fuzzy filter. */
  keywords?: readonly string[];
}

/** Concise key-gesture builder for the defaults table. */
function key(
  code: string,
  keyLabel: string,
  mods: Omit<ShortcutStroke, "code" | "keyLabel"> = {},
): ShortcutGesture {
  return { kind: "key", stroke: { code, keyLabel, ...mods } };
}

/** Concise display-only pointer-gesture builder. */
function pointer(labelKey: string): ShortcutGesture {
  return { kind: "pointer", labelKey };
}

/**
 * Every configurable action, plus a few display-only gesture entries. Defaults
 * mirror the bindings that ship today (see the audit in the PRD §1.1). The
 * read-only "reference" intrinsic-key entries are added in Phase 3.
 */
export const SHORTCUT_ACTIONS: readonly ShortcutActionDef[] = [
  // ── Playback / transport (global) ──────────────────────────────────────────
  {
    id: "playback.toggle",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackToggle",
    defaultBindings: [key("Space", "Space"), key("KeyP", "P", { primaryKey: true })],
    keywords: ["play", "pause", "暂停", "播放"],
  },
  {
    id: "playback.prev",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackPrev",
    defaultBindings: [key("KeyQ", "Q")],
    keywords: ["previous", "上一首"],
  },
  {
    id: "playback.next",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackNext",
    defaultBindings: [key("KeyE", "E")],
    keywords: ["next", "下一首"],
  },
  {
    id: "playback.seekBack",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackSeekBack",
    defaultBindings: [key("KeyQ", "Q", { shiftKey: true })],
    keywords: ["seek", "rewind", "快退"],
  },
  {
    id: "playback.seekForward",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackSeekForward",
    defaultBindings: [key("KeyE", "E", { shiftKey: true })],
    keywords: ["seek", "forward", "快进"],
  },
  {
    id: "playback.volumeUp",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackVolumeUp",
    defaultBindings: [key("ArrowUp", "↑"), key("ArrowUp", "↑", { primaryKey: true })],
    keywords: ["volume", "音量"],
  },
  {
    id: "playback.volumeDown",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackVolumeDown",
    defaultBindings: [key("ArrowDown", "↓"), key("ArrowDown", "↓", { primaryKey: true })],
    keywords: ["volume", "音量"],
  },
  {
    id: "playback.cycleRepeat",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackCycleRepeat",
    defaultBindings: [key("KeyR", "R")],
    keywords: ["repeat", "loop", "循环"],
  },
  {
    id: "playback.toggleShuffle",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackToggleShuffle",
    defaultBindings: [key("KeyR", "R", { altKey: true })],
    keywords: ["shuffle", "随机"],
  },
  {
    id: "playback.like",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackLike",
    defaultBindings: [key("KeyL", "L")],
    keywords: ["like", "heart", "favorite", "红心", "喜欢"],
  },
  {
    id: "playback.toggleFullscreen",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.playbackToggleFullscreen",
    defaultBindings: [key("KeyF", "F")],
    keywords: ["fullscreen", "全屏"],
  },
  // ── Navigation (global) ────────────────────────────────────────────────────
  {
    id: "nav.tabNow",
    scope: "global",
    category: "navigation",
    labelKey: "shortcuts.action.navTabNow",
    defaultBindings: [key("Digit1", "1", { primaryKey: true })],
  },
  {
    id: "nav.tabLibrary",
    scope: "global",
    category: "navigation",
    labelKey: "shortcuts.action.navTabLibrary",
    defaultBindings: [key("Digit2", "2", { primaryKey: true })],
  },
  {
    id: "nav.tabSettings",
    scope: "global",
    category: "navigation",
    labelKey: "shortcuts.action.navTabSettings",
    defaultBindings: [key("Digit3", "3", { primaryKey: true })],
  },
  {
    id: "queue.toggle",
    scope: "global",
    category: "navigation",
    labelKey: "shortcuts.action.queueToggle",
    defaultBindings: [key("KeyT", "T")],
    keywords: ["queue", "up next", "drawer", "队列", "歌单", "播放列表"],
  },
  {
    id: "lyrics.toggleStage",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.lyricsToggleStage",
    defaultBindings: [key("KeyC", "C")],
    keywords: ["lyrics", "caption", "歌词", "字幕"],
  },
  {
    id: "visualizer.cycleMode",
    scope: "global",
    category: "playback",
    labelKey: "shortcuts.action.visualizerCycleMode",
    defaultBindings: [key("KeyV", "V")],
    keywords: ["visualizer", "spectrum", "可视化", "频谱"],
  },
  {
    id: "nav.cycleGalleryMode",
    scope: "global",
    category: "navigation",
    labelKey: "shortcuts.action.navCycleGalleryMode",
    // ` next tab · Shift+` previous tab (reverse direction lives in the gallery handler).
    defaultBindings: [key("Backquote", "`"), key("Backquote", "`", { shiftKey: true })],
    keywords: ["gallery", "tab", "模式"],
  },
  // Jump straight to a library tab (bare 1/2/3/4 on the gallery wall). Handled in
  // the SearchPage gallery handler; the dispatcher has no handler so they no-op
  // elsewhere.
  {
    id: "nav.galleryTabSets",
    scope: "global",
    category: "navigation",
    labelKey: "shortcuts.action.navGalleryTabSets",
    defaultBindings: [key("Digit1", "1")],
    keywords: ["gallery", "tab", "sets", "歌单"],
  },
  {
    id: "nav.galleryTabTracks",
    scope: "global",
    category: "navigation",
    labelKey: "shortcuts.action.navGalleryTabTracks",
    defaultBindings: [key("Digit2", "2")],
    keywords: ["gallery", "tab", "songs", "全部歌曲"],
  },
  {
    id: "nav.galleryTabAlbums",
    scope: "global",
    category: "navigation",
    labelKey: "shortcuts.action.navGalleryTabAlbums",
    defaultBindings: [key("Digit3", "3")],
    keywords: ["gallery", "tab", "albums", "专辑"],
  },
  {
    id: "nav.galleryTabArtists",
    scope: "global",
    category: "navigation",
    labelKey: "shortcuts.action.navGalleryTabArtists",
    defaultBindings: [key("Digit4", "4")],
    keywords: ["gallery", "tab", "artists", "歌手"],
  },
  {
    id: "search.openGlobal",
    scope: "global",
    category: "search",
    labelKey: "shortcuts.action.searchOpenGlobal",
    defaultBindings: [key("Slash", "/"), key("KeyF", "F", { primaryKey: true })],
    protected: true,
    keywords: ["search", "find", "搜索"],
  },
  // ── Library focus navigation (library) ─────────────────────────────────────
  {
    id: "library.focusPrev",
    scope: "library",
    category: "library",
    labelKey: "shortcuts.action.libraryFocusPrev",
    defaultBindings: [key("KeyW", "W"), key("ArrowUp", "↑")],
    keywords: ["up", "navigate", "上"],
  },
  {
    id: "library.focusNext",
    scope: "library",
    category: "library",
    labelKey: "shortcuts.action.libraryFocusNext",
    defaultBindings: [key("KeyS", "S"), key("ArrowDown", "↓")],
    keywords: ["down", "navigate", "下"],
  },
  {
    id: "library.open",
    scope: "library",
    category: "library",
    labelKey: "shortcuts.action.libraryOpen",
    defaultBindings: [key("KeyD", "D"), key("ArrowRight", "→"), key("Enter", "Enter")],
    keywords: ["open", "enter", "进入"],
  },
  {
    id: "library.back",
    scope: "library",
    category: "library",
    labelKey: "shortcuts.action.libraryBack",
    defaultBindings: [key("KeyA", "A"), key("ArrowLeft", "←")],
    keywords: ["back", "返回"],
  },
  // ── Memory (inspector) ─────────────────────────────────────────────────────
  {
    id: "memory.quickAdd",
    scope: "inspector",
    category: "memory",
    labelKey: "shortcuts.action.memoryQuickAdd",
    // `T` now opens the queue Drawer (queue.toggle); memory keeps `N`.
    defaultBindings: [key("KeyN", "N")],
    keywords: ["memory", "note", "记忆", "备注"],
  },
  // ── Reference (read-only, Q7) — intrinsic widget keys + gestures. Shown in the
  //    cheat-sheet, never rebindable, and skipped by dispatch/conflict (engine).
  {
    id: "ref.closeDialog",
    scope: "global",
    category: "reference",
    labelKey: "shortcuts.action.refCloseDialog",
    defaultBindings: [key("Escape", "Esc")],
    allowUserBindings: false,
  },
  {
    id: "ref.commitField",
    scope: "global",
    category: "reference",
    labelKey: "shortcuts.action.refCommitField",
    defaultBindings: [key("Enter", "Enter")],
    allowUserBindings: false,
  },
  {
    id: "ref.scrub",
    scope: "global",
    category: "reference",
    labelKey: "shortcuts.action.refScrub",
    defaultBindings: [key("ArrowLeft", "←"), key("ArrowRight", "→")],
    allowUserBindings: false,
  },
  {
    id: "ref.swipeBack",
    scope: "global",
    category: "reference",
    labelKey: "shortcuts.action.refSwipeBack",
    defaultBindings: [pointer("shortcuts.gesture.swipeBack")],
    allowUserBindings: false,
  },
  {
    id: "ref.coverSwipe",
    scope: "global",
    category: "reference",
    labelKey: "shortcuts.action.refCoverSwipe",
    defaultBindings: [pointer("shortcuts.gesture.coverSwipeLeft")],
    allowUserBindings: false,
  },
];

export type ShortcutActionId = (typeof SHORTCUT_ACTIONS)[number]["id"];

/** Indexed lookup; built once. */
export const SHORTCUT_ACTIONS_BY_ID: Readonly<Record<string, ShortcutActionDef>> =
  Object.fromEntries(SHORTCUT_ACTIONS.map((action) => [action.id, action]));

/** Whether an action accepts user overrides (not protected, not display-only). */
export function isEditableAction(action: ShortcutActionDef): boolean {
  return action.allowUserBindings !== false && !action.protected;
}
