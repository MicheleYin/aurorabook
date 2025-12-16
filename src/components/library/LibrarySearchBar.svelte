<script lang="ts">
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import { cn } from "$lib/utils";

  interface Props {
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    children?: any; // Slot for actions
  }

  let {
    value: valueProp,
    placeholder = "Search by title or author",
    onChange,
    disabled,
    children,
  }: Props = $props();

  // #region agent log
  $effect(() => {
    fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LibrarySearchBar.svelte:21',message:'component render/effect setup',data:{valueProp},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'E'})}).catch(()=>{});
  });
  // #endregion

  // Use local state for immediate UI updates
  let inputValue = $state(valueProp);
  
  // Flag to track if we're updating from user input (to prevent prop sync during user typing)
  let isUserInput = $state(false);
  
  // Track previous prop value using regular variable (not $state) to avoid reactive dependency
  let prevValueProp = valueProp;

  // Sync with prop changes (one-way from parent)
  // Effect only runs when valueProp changes, not when inputValue changes
  // #region agent log
  $effect(() => {
    const currentValueProp = valueProp; // Only read valueProp, nothing else
    const prev = prevValueProp; // Capture previous value before any reads
    fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LibrarySearchBar.svelte:38',message:'$effect triggered',data:{valueProp:currentValueProp,prevValueProp:prev,areEqual:currentValueProp===prev},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'J'})}).catch(()=>{});
    // Only update if valueProp actually changed and it's not from user input
    if (currentValueProp !== prev && !isUserInput) {
      inputValue = currentValueProp;
      prevValueProp = currentValueProp; // Update regular variable (not reactive)
      fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LibrarySearchBar.svelte:42',message:'$effect updated inputValue from prop',data:{valueProp:currentValueProp},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'J'})}).catch(()=>{});
    } else {
      fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LibrarySearchBar.svelte:44',message:'$effect skipped',data:{valueProp:currentValueProp,prevValueProp:prev,isUserInput},timestamp:Date.now(),sessionId:'debug-session',runId:'run4',hypothesisId:'J'})}).catch(()=>{});
    }
    // Reset user input flag after checking
    if (isUserInput) {
      isUserInput = false;
    }
  });
  // #endregion

  function handleInput(event: Event) {
    // #region agent log
    const target = event.target as HTMLInputElement;
    const newValue = target.value;
    fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LibrarySearchBar.svelte:35',message:'handleInput called',data:{newValue,currentInputValue:inputValue,currentValueProp:valueProp},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    // Update local state immediately for responsive UI
    inputValue = newValue;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LibrarySearchBar.svelte:38',message:'calling onChange',data:{newValue},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    // Update parent store (async, but UI is already updated)
    onChange(newValue);
  }
</script>

<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  <div class="relative w-full sm:max-w-md">
    <Search
      class="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
    <input
      type="search"
      value={inputValue}
      oninput={handleInput}
      {disabled}
      {placeholder}
      aria-label="Search library by title or author"
      class={cn(
        "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "pl-10 pr-10 rounded-lg bg-card focus:border-primary focus:ring-primary/40 transition-all",
        // Hide native browser clear button for search inputs
        "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
      )}
    />
    {#if inputValue}
      <button
        type="button"
        onclick={() => {
          inputValue = "";
          onChange("");
        }}
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

