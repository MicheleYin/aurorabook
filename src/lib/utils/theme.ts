import type { UITheme } from "../types/ui";

/**
 * Resolves a UI theme to either "light" or "dark".
 * If theme is "system", it checks the user's system preference.
 */
export function resolveTheme(theme: UITheme): "light" | "dark" {
  if (theme === "system") {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }
  return theme;
}

/**
 * Applies the theme to the document by toggling the "dark" class on the root element.
 */
export function applyTheme(theme: UITheme) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  const resolved = resolveTheme(theme);
  root.classList.toggle("dark", resolved === "dark");
}

