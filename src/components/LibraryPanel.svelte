<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import type { Book } from "$lib/types/reader";
  import type { ConversionProgress } from "$lib/types/conversion";
  import { Button } from "$lib/components/ui/button";
  import LibraryEmpty from "./library/LibraryEmpty.svelte";
  import LibraryGrid from "./library/LibraryGrid.svelte";
  import LibraryHeader from "./library/LibraryHeader.svelte";
  import LibraryList from "./library/LibraryList.svelte";
  import LibrarySearchBar from "./library/LibrarySearchBar.svelte";
  import type { LibraryFilterOption, LibraryViewMode } from "$lib/types/library";

  interface Props {
    library?: Book[];
    totalBooks?: number;
    searchTerm?: string;
    onSearchChange?: (value: string) => void;
    activeFilter?: LibraryFilterOption;
    onFilterChange?: (filter: LibraryFilterOption) => void;
    viewMode?: LibraryViewMode;
    onViewModeChange?: (mode: LibraryViewMode) => void;
    activeBookId?: string;
    isImporting?: boolean;
    onAddEbook?: () => void;
    onOpenBook?: (bookId: string) => void;
    onViewDetails?: (bookId: string) => void;
    bookConversionProgress?: Record<string, ConversionProgress>;
    conversionStartTimeRef?: { current: number | null };
  }

  let {
    library = [],
    totalBooks = 0,
    searchTerm = "",
    onSearchChange = () => {},
    activeFilter = "all",
    onFilterChange = () => {},
    viewMode = "grid",
    onViewModeChange = () => {},
    activeBookId,
    isImporting = false,
    onAddEbook = () => {},
    onOpenBook = () => {},
    onViewDetails = () => {},
    bookConversionProgress = {},
    conversionStartTimeRef,
  }: Props = $props();

  // #region agent log
  $effect(() => {
    fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'LibraryPanel.svelte:48',message:'LibraryPanel render',data:{searchTerm,libraryLength:library.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'F'})}).catch(()=>{});
  });
  // #endregion

  let isSearching = $derived((searchTerm || "").trim().length > 0);
  let hasBooks = $derived(library.length > 0);
</script>

<div class="flex h-full flex-col">
  <LibraryHeader
    {totalBooks}
    filteredCount={library.length}
    {isSearching}
    {activeFilter}
    {onFilterChange}
    {viewMode}
    {onViewModeChange}
  >
    <Button
      onclick={onAddEbook}
      disabled={isImporting}
      class="w-full sm:w-auto"
      aria-label="Add ebook to library"
    >
      {#if isImporting}
        <Loader2 class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Adding…
      {:else}
        <Plus class="mr-2 h-4 w-4" aria-hidden="true" />
        Add ebook
      {/if}
    </Button>
  </LibraryHeader>

  <div class="pt-6">
    <LibrarySearchBar
      value={searchTerm}
      onChange={onSearchChange}
      disabled={isImporting}
    />
  </div>

  <div class="flex-1 pt-6">
    {#if hasBooks}
      {#if viewMode === "grid"}
        <LibraryGrid
          books={library}
          {activeBookId}
          {onOpenBook}
          {onViewDetails}
          {bookConversionProgress}
          {conversionStartTimeRef}
        />
      {:else}
        <LibraryList
          books={library}
          {activeBookId}
          {onOpenBook}
          {onViewDetails}
          {bookConversionProgress}
          {conversionStartTimeRef}
        />
      {/if}
    {:else}
      <LibraryEmpty {isSearching} {activeFilter} />
    {/if}
  </div>

  <div class="pb-10"></div>
</div>
