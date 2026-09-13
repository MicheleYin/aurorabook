import type { ColorTheme, DarkTheme, LightTheme, UITheme } from "../types/ui";

const PREFERRED_LIGHT_KEY = "aurorabook.preferredLightTheme";
const PREFERRED_DARK_KEY = "aurorabook.preferredDarkTheme";

const LIGHT_THEMES: readonly LightTheme[] = ["light", "cream", "forest", "sunset", "rose"];
const DARK_THEMES: readonly DarkTheme[] = ["dark", "pitch", "dark_violet", "plum", "dark_green"];
const ALL_THEME_CLASSES = ["light", "dark", "theme-cream", "theme-pitch", "theme-dark_violet", "theme-plum", "theme-forest", "theme-sunset", "theme-rose", "theme-dark_green"] as const;

/** In-memory fallback when localStorage is unavailable (e.g. some test envs). */
const memoryStore = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(key);
    }
  } catch {
    // fall through
  }
  return memoryStore.get(key) ?? null;
}

function storageSet(key: string, value: string): void {
  memoryStore.set(key, value);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
    }
  } catch {
    // keep memory store only
  }
}

export function isLightTheme(theme: string): theme is LightTheme {
  return (LIGHT_THEMES as readonly string[]).includes(theme);
}

export function isDarkTheme(theme: string): theme is DarkTheme {
  return (DARK_THEMES as readonly string[]).includes(theme);
}

export function isColorTheme(theme: string): theme is ColorTheme {
  return isLightTheme(theme) || isDarkTheme(theme);
}

export function isUITheme(theme: string): theme is UITheme {
  return theme === "system" || isColorTheme(theme);
}

export function getPreferredLightTheme(): LightTheme {
  const stored = storageGet(PREFERRED_LIGHT_KEY);
  if (stored && isLightTheme(stored)) return stored;
  return "light";
}

export function getPreferredDarkTheme(): DarkTheme {
  const stored = storageGet(PREFERRED_DARK_KEY);
  if (stored && isDarkTheme(stored)) return stored;
  return "dark";
}

export function rememberPreferredTheme(theme: ColorTheme): void {
  if (isLightTheme(theme)) {
    storageSet(PREFERRED_LIGHT_KEY, theme);
  } else {
    storageSet(PREFERRED_DARK_KEY, theme);
  }
}

/** Resolve system / explicit theme to a concrete color theme. */
export function resolveColorTheme(theme: UITheme): ColorTheme {
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? getPreferredDarkTheme() : getPreferredLightTheme();
  }
  return theme;
}
/** Apply theme classes on the document root (Tailwind `dark` + variant). */
export function applyThemeToDocument(theme: UITheme): ColorTheme {
  const resolved = resolveColorTheme(theme);

  if (isColorTheme(theme)) {
    rememberPreferredTheme(theme);
  }

  const root = document.documentElement;
  root.classList.remove(...ALL_THEME_CLASSES);

  root.classList.add(...themeClassNames(resolved).split(" "));

  return resolved;
}

/** CSS classes for a scoped subtree (e.g. reader content). */
export function themeClassNames(theme: string | undefined): string {
  if (!theme || theme === "system") return "";

  switch (theme) {
    // Light themes
    case "light":
      return "light";

    case "cream":
      return "light theme-cream";

    case "forest":
      return "light theme-forest";

    case "sunset":
      return "light theme-sunset";

    case "rose":
      return "light theme-rose";

    // Dark themes
    case "dark":
      return "dark";

    case "pitch":
      return "dark theme-pitch";

    case "dark_violet":
      return "dark theme-dark_violet";

    case "plum":
      return "dark theme-plum";

    case "dark_green":
      return "dark theme-dark_green";

    default:
      return "";
  }
}

/** Test helper: clear preferred theme memory (and localStorage when present). */
export function clearPreferredThemesForTests(): void {
  memoryStore.clear();
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(PREFERRED_LIGHT_KEY);
      localStorage.removeItem(PREFERRED_DARK_KEY);
    }
  } catch {
    // ignore
  }
}
