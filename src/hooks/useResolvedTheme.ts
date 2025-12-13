import { useEffect, useState } from "react";
import type { UITheme } from "../types/ui";

/**
 * Resolves a UI theme to either "light" or "dark".
 * If theme is "system", it checks the user's system preference and listens for changes.
 */
export function useResolvedTheme(theme: UITheme): "light" | "dark" {
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
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
  });

  useEffect(() => {
    if (theme !== "system") {
      setResolvedTheme(theme);
      return;
    }

    // Check initial value
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const updateTheme = () => {
      setResolvedTheme(media.matches ? "dark" : "light");
    };

    // Set initial value
    updateTheme();

    // Listen for changes
    media.addEventListener("change", updateTheme);
    return () => media.removeEventListener("change", updateTheme);
  }, [theme]);

  return resolvedTheme;
}

