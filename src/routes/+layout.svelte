<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { settingsStore } from "$lib/stores/settings";
  import { applyTheme, resolveTheme } from "$lib/utils/theme";
  import type { UITheme } from "$lib/types/ui";
  import "../app.css";

  let mediaQueryListener: ((e: MediaQueryListEvent) => void) | null = null;

  // Apply theme when settings change
  $effect(() => {
    const settings = $settingsStore;
    applyTheme(settings.theme);

    // If theme is "system", listen for system preference changes
    if (settings.theme === "system" && typeof window !== "undefined") {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      
      // Remove old listener if it exists
      if (mediaQueryListener) {
        media.removeEventListener("change", mediaQueryListener);
      }

      // Create new listener
      mediaQueryListener = () => {
        applyTheme("system");
      };
      media.addEventListener("change", mediaQueryListener);
    } else {
      // Remove listener if theme is not "system"
      if (mediaQueryListener && typeof window !== "undefined") {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        media.removeEventListener("change", mediaQueryListener);
        mediaQueryListener = null;
      }
    }

    // Cleanup
    return () => {
      if (mediaQueryListener && typeof window !== "undefined") {
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        media.removeEventListener("change", mediaQueryListener);
      }
    };
  });

  // Apply initial theme on mount
  onMount(() => {
    const settings = $settingsStore;
    applyTheme(settings.theme);
  });
</script>

<slot />

