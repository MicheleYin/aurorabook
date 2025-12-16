<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import LibraryPanel from "./LibraryPanel.svelte";
  import ReaderPanel from "./ReaderPanel.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";
  import BottomNavigation from "./BottomNavigation.svelte";
  import { libraryStore } from "$lib/stores/library";
  import { appNavigationStore } from "$lib/stores/app-navigation";
  import { bookConversionStore } from "$lib/stores/book-conversion";
  import { filterLibrary } from "$lib/utils";
  import { deleteBook } from "$lib/services/book-service";
  import type { Book } from "$lib/types/reader";
  import type { LibraryFilterOption, LibraryViewMode } from "$lib/types/library";

  // Get library state - subscribe manually to avoid initialization issues
  let library = $state<Book[]>([]);
  let isHydrated = $state(false);
  let isImporting = $state(false);
  
  $effect(() => {
    const unsubscribe = libraryStore.subscribe((books) => {
      library = books;
    });
    return unsubscribe;
  });
  
  $effect(() => {
    const unsubscribe = libraryStore.hydrated.subscribe((value) => {
      isHydrated = value;
    });
    return unsubscribe;
  });
  
  $effect(() => {
    const unsubscribe = libraryStore.isImporting.subscribe((value) => {
      isImporting = value;
    });
    return unsubscribe;
  });

  // Get navigation state - use get() for immediate synchronous access
  // This avoids subscription delays and makes UI feel instant
  let activeView = $state<AppView>(get(appNavigationStore.view));
  let searchTerm = $state(get(appNavigationStore.searchTerm));
  let activeFilter = $state<LibraryFilterOption>(get(appNavigationStore.filter));
  let viewMode = $state<LibraryViewMode>(get(appNavigationStore.viewMode));
  let activeBookId = $state<string | undefined>(get(appNavigationStore.activeBookId));

  // Subscribe to updates (but initial value is set synchronously above)
  $effect(() => {
    const unsubscribe = appNavigationStore.view.subscribe((value) => {
      activeView = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = appNavigationStore.searchTerm.subscribe((value) => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.svelte:59',message:'store subscription fired',data:{newValue:value,currentSearchTerm:searchTerm,areEqual:value===searchTerm},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      // Only update if value actually changed to prevent infinite loops
      if (value !== searchTerm) {
        searchTerm = value;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.svelte:63',message:'searchTerm updated from store',data:{searchTerm},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.svelte:66',message:'searchTerm skipped update (same value)',data:{value,searchTerm},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
      }
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = appNavigationStore.filter.subscribe((value) => {
      activeFilter = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = appNavigationStore.viewMode.subscribe((value) => {
      viewMode = value;
    });
    return unsubscribe;
  });

  $effect(() => {
    const unsubscribe = appNavigationStore.activeBookId.subscribe((value) => {
      activeBookId = value;
    });
    return unsubscribe;
  });

  // Get conversion state
  let bookConversionProgress = $state<Record<string, ConversionProgress>>({});
  let conversionStartTimeRef = $state<{ current: number | null }>({ current: null });

  $effect(() => {
    const unsubscribe = bookConversionStore.progress.subscribe((value) => {
      bookConversionProgress = value;
    });
    return unsubscribe;
  });

  // Filter library
  let filteredLibrary = $derived(filterLibrary(library, activeFilter, searchTerm));

  // Navigation items
  let navigationItems = $derived([
    { id: "library" as const, label: "Library" },
    { id: "reader" as const, label: "Reader", disabled: library.length === 0 },
    { id: "settings" as const, label: "Settings" },
  ]);

  // Event handlers - update local state immediately for instant UI feedback
  function handleViewChange(view: typeof activeView) {
    activeView = view; // Update immediately
    appNavigationStore.view.set(view); // Sync to store
  }

  function handleSearchChange(value: string) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.svelte:113',message:'handleSearchChange called',data:{newValue:value,currentSearchTerm:searchTerm},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    searchTerm = value; // Update immediately
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.svelte:115',message:'setting store value',data:{value},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    appNavigationStore.searchTerm.set(value); // Sync to store
  }

  function handleFilterChange(filter: LibraryFilterOption) {
    activeFilter = filter; // Update immediately
    appNavigationStore.filter.set(filter); // Sync to store
  }

  function handleViewModeChange(mode: LibraryViewMode) {
    viewMode = mode; // Update immediately
    appNavigationStore.viewMode.set(mode); // Sync to store
  }

  async function handleAddEbook() {
    try {
      const result = await libraryStore.importFromDialog();
      if (result && typeof result === "object") {
        // Book was imported successfully
        await libraryStore.refreshLibrary();
      }
    } catch (error) {
      console.error("Failed to add ebook:", error);
    }
  }

  function handleSelectBook(bookId: string) {
    appNavigationStore.activeBookId.set(bookId);
    appNavigationStore.view.set("reader");
  }

  function handleViewDetails(bookId: string) {
    // TODO: Open book details dialog
    console.log("View details for book:", bookId);
  }

  async function handleDeleteBook(bookId: string) {
    try {
      await deleteBook(bookId);
      await libraryStore.refreshLibrary();
      if (activeBookId === bookId) {
        appNavigationStore.activeBookId.set(undefined);
        appNavigationStore.view.set("library");
      }
    } catch (error) {
      console.error("Failed to delete book:", error);
    }
  }

  // Setup conversion listeners
  onMount(() => {
    bookConversionStore.setLibraryRef(library);
    bookConversionStore.setupListeners(() => libraryStore.refreshLibrary());

    // Keep library ref updated
    $effect(() => {
      bookConversionStore.setLibraryRef(library);
    });
  });

  // Update conversion start time ref
  $effect(() => {
    const unsubscribe = bookConversionStore.startTime.subscribe((startTime) => {
      conversionStartTimeRef.current = startTime;
    });
    return unsubscribe;
  });

  // Auto-switch to library if no books
  $effect(() => {
    if (library.length === 0 && activeView === "reader") {
      appNavigationStore.view.set("library");
    }
  });

  function getCurrentView() {
    switch (activeView) {
      case "library":
        return LibraryPanel;
      case "reader":
        return ReaderPanel;
      case "settings":
        return SettingsPanel;
      default:
        return LibraryPanel;
    }
  }
</script>

<div class="flex min-h-screen flex-col bg-background text-foreground">
  <div class="mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
    <div class="flex flex-1 min-h-0 flex-col">
      {#if activeView === "library"}
        <!-- #region agent log -->
        {(() => {
          fetch('http://127.0.0.1:7242/ingest/18fa94d2-7129-4c74-b901-497fa1f501bd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'App.svelte:226',message:'rendering LibraryPanel',data:{searchTerm,filteredLibraryLength:filteredLibrary.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'G'})}).catch(()=>{});
          return '';
        })()}
        <!-- #endregion -->
        <LibraryPanel
          library={filteredLibrary}
          totalBooks={library.length}
          {searchTerm}
          onSearchChange={handleSearchChange}
          {activeFilter}
          onFilterChange={handleFilterChange}
          {viewMode}
          onViewModeChange={handleViewModeChange}
          {activeBookId}
          {isImporting}
          onAddEbook={handleAddEbook}
          onOpenBook={handleSelectBook}
          onViewDetails={handleViewDetails}
          {bookConversionProgress}
          {conversionStartTimeRef}
        />
      {:else if activeView === "reader"}
        <ReaderPanel />
      {:else if activeView === "settings"}
        <SettingsPanel />
      {/if}
    </div>
  </div>
  <BottomNavigation
    {activeView}
    {navigationItems}
    onViewChange={handleViewChange}
    hideNavigation={false}
  />
</div>

