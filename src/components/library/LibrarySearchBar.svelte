<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import { Input } from "$lib/components/ui/input";
  import { cn } from "$lib/utils";

  interface Props {
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    children?: any; // Slot for actions
  }

  let {
    value,
    placeholder = "Search by title or author",
    onChange,
    disabled,
    children,
  }: Props = $props();

  function handleInputChange(event: Event) {
    const target = event.target as HTMLInputElement;
    onChange(target.value);
  }
</script>

<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  <div class="relative w-full sm:max-w-md">
    <Search
      class="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
    <Input
      type="search"
      {value}
      oninput={handleInputChange}
      {disabled}
      {placeholder}
      aria-label="Search library by title or author"
      class={cn(
        "pl-10 pr-10 rounded-lg bg-card focus:border-primary focus:ring-primary/40 transition-all",
        // Hide native browser clear button for search inputs
        "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
      )}
    />
    {#if value}
      <button
        type="button"
        onclick={() => onChange("")}
        class={cn(
          "absolute right-2 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted transition-colors"
        )}
        aria-label="Clear search"
      >
        <X class="h-4 w-4" aria-hidden="true" />
      </button>
    {/if}
  </div>
  {#if children}
    <div class="flex items-center gap-2">{@render children()}</div>
  {/if}
</div>

