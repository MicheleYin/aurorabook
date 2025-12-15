<script lang="ts">
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import { cn } from "$lib/utils";
  import {
    LIBRARY_FILTER_OPTIONS,
    LIBRARY_VIEW_MODES,
    LIBRARY_FILTER_LABELS,
    type LibraryFilterOption,
    type LibraryViewMode,
  } from "$lib/types/library";

  interface Props {
    totalBooks: number;
    filteredCount: number;
    isSearching: boolean;
    activeFilter: LibraryFilterOption;
    onFilterChange: (value: LibraryFilterOption) => void;
    viewMode: LibraryViewMode;
    onViewModeChange: (value: LibraryViewMode) => void;
    children?: any; // Slot for action button
  }

  let {
    totalBooks,
    filteredCount,
    isSearching,
    activeFilter,
    onFilterChange,
    viewMode,
    onViewModeChange,
    children,
  }: Props = $props();

  const showCount = isSearching ? filteredCount : totalBooks;
</script>

<div class="sticky top-0 z-20 flex flex-col gap-4 border-b border-border bg-background/95 -mx-4 -mt-6 px-4 pt-6 pb-4 backdrop-blur safe-area-top">
  <div class="flex flex-col gap-3">
    {#if children}
      <div class="sm:ml-auto">{@render children()}</div>
    {/if}
    <div class="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
      {#each LIBRARY_FILTER_OPTIONS as option}
        {@const isActive = option === activeFilter}
        {@const label = LIBRARY_FILTER_LABELS[option]}
        <button
          type="button"
          onclick={() => onFilterChange(option)}
          class={cn(
            "rounded-full border px-3 py-1 transition-colors",
            isActive
              ? "border-primary bg-primary/5 text-primary"
              : "border-border hover:bg-muted",
          )}
          aria-pressed={isActive}
          aria-label="Filter by {label}"
        >
          {label}
        </button>
      {/each}

      <div class="ml-auto flex items-center gap-1 text-muted-foreground">
        {#each LIBRARY_VIEW_MODES as mode}
          {@const isActive = mode === viewMode}
          <button
            type="button"
            onclick={() => onViewModeChange(mode)}
            class={cn(
              "flex items-center justify-center rounded-md border px-2 py-1 text-muted-foreground transition-colors",
              isActive
                ? "border-primary bg-primary/5 text-primary"
                : "border-border hover:bg-muted",
            )}
            aria-pressed={isActive}
            aria-label={mode === "grid" ? "Switch to grid view" : "Switch to list view"}
          >
            {#if mode === "grid"}
              <LayoutGrid class="h-4 w-4" aria-hidden="true" />
            {:else}
              <List class="h-4 w-4" aria-hidden="true" />
            {/if}
            <span class="sr-only">{mode === "grid" ? "Grid view" : "List view"}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
  <p class="text-sm text-muted-foreground">
    {totalBooks === 0
      ? "Import EPUB files to start building your shelf."
      : isSearching
        ? `${showCount} result${showCount === 1 ? "" : "s"} for your search.`
        : `${showCount} book${showCount === 1 ? "" : "s"} in your library.`}
  </p>
</div>

