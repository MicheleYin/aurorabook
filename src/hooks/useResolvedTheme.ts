import { useMemo } from "react";
import type { UITheme } from "../types/ui";

/**
 * Resolves a UI theme to either "light" or "dark".
 * If theme is "system", it checks the user's system preference.
 */
export function useResolvedTheme(theme: UITheme): "light" | "dark" {
  return useMemo(() => {
    if (theme === "system") {
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      ) {
        return "dark";
      }
      return "light";
    }
    return theme;
  }, [theme]);
}

