export type ShortcutScope = "global" | "reader" | "library";

export type ShortcutActionId =
  | "showHelp"
  | "goSettings"
  | "goLibrary"
  | "goReader"
  | "closeOverlays"
  | "playPause"
  | "skipBack"
  | "skipForward"
  | "prevTrack"
  | "nextTrack"
  | "toggleSync"
  | "toggleMinimizePlayer"
  | "slowerRate"
  | "fasterRate"
  | "showAudioPlayer"
  | "prevChapter"
  | "nextChapter"
  | "toggleToc"
  | "toggleChrome"
  | "backToLibrary"
  | "increaseFont"
  | "decreaseFont"
  | "importBook"
  | "focusSearch"
  | "viewGrid"
  | "viewList";

export type ShortcutHandler = () => boolean | void;

/** One physical chord. Prefer `code` for layout-independent keys. */
export interface KeyChord {
  /** Match KeyboardEvent.key (letters compared case-insensitively). */
  key?: string;
  /** Match KeyboardEvent.code (physical key, e.g. "Slash", "Digit1"). */
  code?: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  /**
   * `true` / `false` = require that shift state.
   * `ignore` = accept either (use when the produced `key` already implies shift, e.g. "?").
   */
  shift?: boolean | "ignore";
  alt?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutActionId;
  /** Keys shown in the help overlay (platform-adjusted at render time). */
  keys: string[];
  /** Any listed chord matches. */
  match: KeyChord | KeyChord[];
  /** `global` alone = every tab; otherwise only listed tabs. */
  scope: ShortcutScope | ShortcutScope[];
  labelKey: string;
  groupKey: string;
}

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.closest('[contenteditable="true"], input, textarea, select') != null;
}

export function scopesInclude(
  scope: ShortcutScope | ShortcutScope[],
  active: ShortcutScope
): boolean {
  const list = Array.isArray(scope) ? scope : [scope];
  if (list.length === 1 && list[0] === "global") return true;
  return list.includes(active);
}

function matchesMod(event: KeyboardEvent, wantsMod: boolean | undefined): boolean {
  const apple = isApplePlatform();
  const pressed = apple ? event.metaKey : event.ctrlKey;
  const other = apple ? event.ctrlKey : event.metaKey;
  if (wantsMod) return pressed && !other;
  return !event.metaKey && !event.ctrlKey;
}

function matchesChord(event: KeyboardEvent, chord: KeyChord): boolean {
  if (chord.code && event.code !== chord.code) return false;

  if (chord.key != null) {
    if (event.key.length === 1 && chord.key.length === 1) {
      if (event.key.toLowerCase() !== chord.key.toLowerCase()) return false;
    } else if (event.key !== chord.key) {
      return false;
    }
  }

  if (!chord.code && chord.key == null) return false;

  if (!matchesMod(event, chord.mod)) return false;

  if (chord.shift !== "ignore") {
    if (Boolean(chord.shift) !== event.shiftKey) return false;
  }

  if (Boolean(chord.alt) !== event.altKey) return false;
  return true;
}

export function matchesShortcut(
  event: KeyboardEvent,
  def: ShortcutDefinition
): boolean {
  const chords = Array.isArray(def.match) ? def.match : [def.match];
  return chords.some((chord) => matchesChord(event, chord));
}

/** Display key chips; replaces Mod with ⌘ / Ctrl for the current platform. */
export function formatShortcutKeys(keys: string[]): string[] {
  const mod = isApplePlatform() ? "⌘" : "Ctrl";
  return keys.map((key) => (key === "Mod" ? mod : key));
}

/**
 * Prefer single unshifted keys. Where a character needs Shift on some layouts
 * (e.g. "?"), match via event.code and/or shift:"ignore" on the produced key.
 */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "showHelp",
    // Alternatives (not a chord) — overlay renders these with "or".
    keys: ["F1", "?"],
    match: [
      { key: "F1" },
      // Character "?" on any layout (often Shift+/); ignore shift flag.
      { key: "?", shift: "ignore" },
      // Layouts that still report "/" while Shift is held.
      { key: "/", shift: true },
      // Physical slash + Shift (US/UK and similar).
      { code: "Slash", shift: true },
    ],
    scope: "global",
    labelKey: "shortcuts.show_help",
    groupKey: "shortcuts.group_general",
  },
  {
    id: "goLibrary",
    keys: ["1"],
    match: { code: "Digit1" },
    scope: "global",
    labelKey: "shortcuts.go_library",
    groupKey: "shortcuts.group_general",
  },
  {
    id: "goReader",
    keys: ["2"],
    match: { code: "Digit2" },
    scope: "global",
    labelKey: "shortcuts.go_reader",
    groupKey: "shortcuts.group_general",
  },
  {
    id: "goSettings",
    keys: ["3"],
    match: { code: "Digit3" },
    scope: "global",
    labelKey: "shortcuts.go_settings",
    groupKey: "shortcuts.group_general",
  },
  {
    id: "closeOverlays",
    keys: ["Esc"],
    match: { key: "Escape" },
    scope: "global",
    labelKey: "shortcuts.close_overlays",
    groupKey: "shortcuts.group_general",
  },
  {
    id: "playPause",
    keys: ["Space"],
    match: { key: " " },
    scope: "global",
    labelKey: "shortcuts.play_pause",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "skipBack",
    keys: ["J"],
    match: { key: "j" },
    scope: "global",
    labelKey: "shortcuts.skip_back",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "skipForward",
    keys: ["K"],
    match: { key: "k" },
    scope: "global",
    labelKey: "shortcuts.skip_forward",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "prevTrack",
    keys: ["P"],
    match: { key: "p" },
    scope: "global",
    labelKey: "shortcuts.prev_track",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "nextTrack",
    keys: ["N"],
    match: { key: "n" },
    scope: "global",
    labelKey: "shortcuts.next_track",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "toggleSync",
    keys: ["S"],
    match: { key: "s" },
    scope: "reader",
    labelKey: "shortcuts.toggle_sync",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "toggleMinimizePlayer",
    keys: ["M"],
    match: { key: "m" },
    scope: "global",
    labelKey: "shortcuts.toggle_minimize",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "slowerRate",
    keys: ["U"],
    match: { key: "u" },
    scope: "global",
    labelKey: "shortcuts.slower_rate",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "fasterRate",
    keys: ["I"],
    match: { key: "i" },
    scope: "global",
    labelKey: "shortcuts.faster_rate",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "showAudioPlayer",
    keys: ["A"],
    match: { key: "a" },
    scope: "global",
    labelKey: "shortcuts.show_audio",
    groupKey: "shortcuts.group_audio",
  },
  {
    id: "prevChapter",
    keys: ["←"],
    match: { key: "ArrowLeft" },
    scope: "reader",
    labelKey: "shortcuts.prev_chapter",
    groupKey: "shortcuts.group_reader",
  },
  {
    id: "nextChapter",
    keys: ["→"],
    match: { key: "ArrowRight" },
    scope: "reader",
    labelKey: "shortcuts.next_chapter",
    groupKey: "shortcuts.group_reader",
  },
  {
    id: "toggleToc",
    keys: ["T"],
    match: { key: "t" },
    scope: "reader",
    labelKey: "shortcuts.toggle_toc",
    groupKey: "shortcuts.group_reader",
  },
  {
    id: "toggleChrome",
    keys: ["H"],
    match: { key: "h" },
    scope: "reader",
    labelKey: "shortcuts.toggle_chrome",
    groupKey: "shortcuts.group_reader",
  },
  {
    id: "backToLibrary",
    keys: ["B"],
    match: { key: "b" },
    scope: "reader",
    labelKey: "shortcuts.back_to_library",
    groupKey: "shortcuts.group_reader",
  },
  {
    id: "decreaseFont",
    keys: ["-"],
    // Physical minus key — avoids layouts where "-" needs Shift.
    match: [{ code: "Minus" }, { key: "-" }],
    scope: "reader",
    labelKey: "shortcuts.decrease_font",
    groupKey: "shortcuts.group_reader",
  },
  {
    id: "increaseFont",
    keys: ["="],
    match: [{ code: "Equal" }, { key: "=" }, { key: "+", shift: "ignore" }],
    scope: "reader",
    labelKey: "shortcuts.increase_font",
    groupKey: "shortcuts.group_reader",
  },
  {
    id: "importBook",
    keys: ["O"],
    match: { key: "o" },
    scope: "library",
    labelKey: "shortcuts.import_book",
    groupKey: "shortcuts.group_library",
  },
  {
    id: "focusSearch",
    keys: ["F"],
    match: { key: "f" },
    scope: "library",
    labelKey: "shortcuts.focus_search",
    groupKey: "shortcuts.group_library",
  },
  {
    id: "viewGrid",
    keys: ["G"],
    match: { key: "g" },
    scope: "library",
    labelKey: "shortcuts.view_grid",
    groupKey: "shortcuts.group_library",
  },
  {
    id: "viewList",
    keys: ["L"],
    match: { key: "l" },
    scope: "library",
    labelKey: "shortcuts.view_list",
    groupKey: "shortcuts.group_library",
  },
];

export const SHORTCUT_GROUP_ORDER = [
  "shortcuts.group_general",
  "shortcuts.group_reader",
  "shortcuts.group_audio",
  "shortcuts.group_library",
] as const;

const SHORTCUT_ACTION_IDS = new Set<string>(
  SHORTCUT_DEFINITIONS.map((def) => def.id)
);

export function isShortcutActionId(value: string): value is ShortcutActionId {
  return SHORTCUT_ACTION_IDS.has(value);
}

/** Persisted override shape (matches Rust `KeyboardShortcutBinding`). */
export interface StoredShortcutBinding {
  actionId: ShortcutActionId;
  keys: string[];
  match: KeyChord[];
}

export function normalizeMatchChords(match: KeyChord | KeyChord[]): KeyChord[] {
  return Array.isArray(match) ? match : [match];
}

export function resolveShortcutDefinitions(
  overrides: ReadonlyMap<ShortcutActionId, StoredShortcutBinding>
): ShortcutDefinition[] {
  return SHORTCUT_DEFINITIONS.map((def) => {
    const override = overrides.get(def.id);
    if (!override) return def;
    return {
      ...def,
      keys: override.keys.length > 0 ? override.keys : def.keys,
      match: override.match,
    };
  });
}

export function parseStoredBindings(
  rows: Array<{ actionId: string; keys: string[]; match: unknown }>
): Map<ShortcutActionId, StoredShortcutBinding> {
  const map = new Map<ShortcutActionId, StoredShortcutBinding>();
  for (const row of rows) {
    if (!isShortcutActionId(row.actionId)) continue;
    if (!Array.isArray(row.keys) || !Array.isArray(row.match)) continue;
    const binding: StoredShortcutBinding = {
      actionId: row.actionId,
      keys: row.keys.filter((key): key is string => typeof key === "string"),
      match: row.match as KeyChord[],
    };
    // Drop no-op overrides (same as default) so reset UI stays hidden.
    if (!isCustomShortcutBinding(binding)) continue;
    map.set(row.actionId, binding);
  }
  return map;
}

/** True when two chords would fire for the same physical press. */
export function chordsConflict(a: KeyChord, b: KeyChord): boolean {
  if (Boolean(a.mod) !== Boolean(b.mod)) return false;
  if (Boolean(a.alt) !== Boolean(b.alt)) return false;

  const sameCode = Boolean(a.code && b.code && a.code === b.code);
  const sameKey =
    a.key != null &&
    b.key != null &&
    a.key.toLowerCase() === b.key.toLowerCase();

  if (!sameCode && !sameKey) return false;

  if (a.shift === "ignore" || b.shift === "ignore") return true;
  return Boolean(a.shift) === Boolean(b.shift);
}

export function findBindingConflict(
  definitions: ShortcutDefinition[],
  actionId: ShortcutActionId,
  chords: KeyChord[]
): ShortcutDefinition | null {
  for (const def of definitions) {
    if (def.id === actionId) continue;
    const existing = normalizeMatchChords(def.match);
    for (const chord of chords) {
      if (existing.some((other) => chordsConflict(chord, other))) {
        return def;
      }
    }
  }
  return null;
}

/**
 * True when `chords` is effectively the same binding as `targets`.
 * A single captured chord counts as unchanged if it matches any target chord
 * (defaults may list alternatives like F1 or ?).
 */
export function bindingEquivalentTo(
  chords: KeyChord[],
  targets: KeyChord | KeyChord[]
): boolean {
  const targetList = normalizeMatchChords(targets);
  if (chords.length === 0 || targetList.length === 0) return false;

  if (chords.length === 1) {
    return targetList.some((target) => chordsConflict(chords[0], target));
  }

  if (chords.length !== targetList.length) return false;
  return (
    chords.every((chord) =>
      targetList.some((target) => chordsConflict(chord, target))
    ) &&
    targetList.every((target) =>
      chords.some((chord) => chordsConflict(chord, target))
    )
  );
}

export function getDefaultShortcutDefinition(
  actionId: ShortcutActionId
): ShortcutDefinition | undefined {
  return SHORTCUT_DEFINITIONS.find((def) => def.id === actionId);
}

/** True when a stored override differs from the built-in default. */
export function isCustomShortcutBinding(binding: StoredShortcutBinding): boolean {
  const defaults = getDefaultShortcutDefinition(binding.actionId);
  if (!defaults) return true;
  return !bindingEquivalentTo(binding.match, defaults.match);
}

const MODIFIER_ONLY_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "AltGraph",
]);

function displayNameForKey(key: string): string {
  switch (key) {
    case " ":
    case "Spacebar":
      return "Space";
    case "Escape":
      return "Esc";
    case "ArrowLeft":
      return "←";
    case "ArrowRight":
      return "→";
    case "ArrowUp":
      return "↑";
    case "ArrowDown":
      return "↓";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/**
 * Build a persistable chord + display labels from a keydown event.
 * Returns null for modifier-only presses.
 */
export function chordFromKeyboardEvent(
  event: KeyboardEvent
): { chord: KeyChord; keys: string[] } | null {
  if (MODIFIER_ONLY_KEYS.has(event.key)) return null;

  const apple = isApplePlatform();
  const wantsMod = apple ? event.metaKey : event.ctrlKey;
  const display: string[] = [];
  const chord: KeyChord = {};

  if (wantsMod) {
    chord.mod = true;
    display.push("Mod");
  }
  if (event.altKey) {
    chord.alt = true;
    display.push("Alt");
  }

  const { key, code } = event;

  if (key === "?" || (code === "Slash" && event.shiftKey && key === "/")) {
    if (key === "?") {
      chord.key = "?";
      chord.shift = "ignore";
    } else {
      chord.code = "Slash";
      chord.shift = true;
    }
    display.push("?");
    return { chord, keys: display };
  }

  if (/^Digit[0-9]$/.test(code)) {
    chord.code = code;
    if (event.shiftKey) {
      chord.shift = true;
      display.push("Shift");
    }
    display.push(code.slice("Digit".length));
    return { chord, keys: display };
  }

  if (code === "Space" || key === " ") {
    chord.key = " ";
    if (event.shiftKey) {
      chord.shift = true;
      display.push("Shift");
    }
    display.push("Space");
    return { chord, keys: display };
  }

  if (code === "Minus" || code === "Equal") {
    chord.code = code;
    if (event.shiftKey) {
      chord.shift = true;
      display.push("Shift");
    }
    display.push(code === "Minus" ? "-" : "=");
    return { chord, keys: display };
  }

  if (key.length === 1) {
    const isLetter = /[a-zA-Z]/.test(key);
    chord.key = isLetter ? key.toLowerCase() : key;
    if (event.shiftKey && isLetter) {
      chord.shift = true;
      display.push("Shift");
    } else if (event.shiftKey && !isLetter) {
      // Shift produced a symbol (e.g. "@") — the character already implies shift.
      chord.shift = "ignore";
    }
    display.push(isLetter ? key.toUpperCase() : key);
    return { chord, keys: display };
  }

  chord.key = key;
  if (event.shiftKey) {
    chord.shift = true;
    display.push("Shift");
  }
  display.push(displayNameForKey(key));
  return { chord, keys: display };
}

