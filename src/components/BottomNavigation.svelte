<script lang="ts">
  import { cn } from "$lib/utils";

  export let activeView: "library" | "reader" | "settings";
  export let navigationItems: Array<{ id: "library" | "reader" | "settings"; label: string; disabled?: boolean }>;
  export let onViewChange: (view: "library" | "reader" | "settings") => void;
  export let hideNavigation = false;

  function handleClick(item: typeof navigationItems[0]) {
    if (item.disabled) return;
    onViewChange(item.id);
  }
</script>

<div
  class={cn(
    "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 sm:px-6",
    hideNavigation ? "nav-bar-exit" : "nav-bar-enter",
  )}
>
  <div
    class={cn(
      "pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-lg ring-1 ring-black/5",
      hideNavigation ? "backdrop-blur-sm" : "backdrop-blur-xl",
      "transition-[backdrop-filter] duration-300 ease-in-out",
      hideNavigation && "pointer-events-none",
    )}
  >
    {#each navigationItems as item}
      {@const isActive = activeView === item.id}
      {@const isDisabled = Boolean(item.disabled)}
      <button
        type="button"
        disabled={isDisabled}
        onclick={() => handleClick(item)}
        class={cn(
          "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-muted",
          isDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
        title={item.id === "reader" && isDisabled ? "Open a book to enter the reader" : undefined}
        aria-label={item.id === "reader" && isDisabled ? "Open a book to enter the reader" : `Navigate to ${item.label}`}
        aria-current={isActive ? "page" : undefined}
      >
        {item.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .nav-bar-enter {
    animation: nav-bar-enter 0.3s ease-out;
  }

  .nav-bar-exit {
    animation: nav-bar-exit 0.3s ease-in;
  }

  @keyframes nav-bar-enter {
    from {
      opacity: 0;
      transform: translateY(1rem);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes nav-bar-exit {
    from {
      opacity: 1;
      transform: translateY(0);
    }
    to {
      opacity: 0;
      transform: translateY(1rem);
    }
  }
</style>

