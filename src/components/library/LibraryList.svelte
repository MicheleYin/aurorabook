<script lang="ts">
  import ImageOff from "@lucide/svelte/icons/image-off";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import type { Book } from "$lib/types/reader";
  import type { ConversionProgress } from "$lib/types/conversion";
  import {
    cn,
    getBookProgressSummary,
    getLibraryBookStatusFromSummary,
  } from "$lib/utils";
  import { Button } from "$lib/components/ui/button";
  import { Progress } from "$lib/components/ui/progress";
  import LibraryStatusBadge from "./LibraryStatusBadge.svelte";

  interface Props {
    books: Book[];
    activeBookId?: string;
    onOpenBook: (bookId: string) => void;
    onViewDetails: (bookId: string) => void;
    bookConversionProgress?: Record<string, ConversionProgress>;
    conversionStartTimeRef?: { current: number | null };
  }

  let {
    books,
    activeBookId,
    onOpenBook,
    onViewDetails,
    bookConversionProgress = {},
    conversionStartTimeRef,
  }: Props = $props();

  // Track displayed books and exiting animations
  let displayedBooks = $state<Book[]>(books);
  let exitingBookIds = $state<Set<string>>(new Set());
  let previousBooks = $state<Book[]>(books);

  // Handle book changes with exit animations
  $effect(() => {
    const currentBookIds = new Set(books.map((b) => b.id));
    const previousBookIds = new Set(previousBooks.map((b) => b.id));

    // Find books that are leaving
    const leavingIds = Array.from(previousBookIds).filter(
      (id) => !currentBookIds.has(id),
    );

    if (leavingIds.length > 0) {
      // Mark books as exiting
      exitingBookIds = new Set(leavingIds);

      // Remove them after animation completes
      const timer = setTimeout(() => {
        displayedBooks = books;
        exitingBookIds = new Set();
        previousBooks = books;
      }, 200); // Match exit animation duration

      return () => clearTimeout(timer);
    } else {
      // Books are being added or reordered
      displayedBooks = books;
      previousBooks = books;
    }
  });

  function handleKeyDown(event: KeyboardEvent, bookId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenBook(bookId);
    }
  }

  // Merge displayed books with exiting books to show exit animations
  let booksToRender = $derived.by(() => {
    const allBooks = displayedBooks.filter((b) => !exitingBookIds.has(b.id));
    const exitingBooks = previousBooks.filter((b) => exitingBookIds.has(b.id));
    return [...allBooks, ...exitingBooks];
  });

  let isImageLoaded = $state<Record<string, boolean>>({});
  let hasImageError = $state<Record<string, boolean>>({});
</script>

<div class="flex flex-col divide-y divide-border overflow-hidden rounded-xl border">
  {#each booksToRender as book, index}
    {@const isExiting = exitingBookIds.has(book.id)}
    {@const isVisible = books.some((b) => b.id === book.id)}
    {@const displayIndex = isVisible ? books.findIndex((b) => b.id === book.id) : index}
    {@const isActive = book.id === activeBookId}
    {@const progressSummary = getBookProgressSummary(book)}
    {@const status = getLibraryBookStatusFromSummary(progressSummary)}
    {@const hasChapters = book.chapters.length > 0}
    {@const progressText = hasChapters
      ? `Progress: ${progressSummary.label}`
      : "Progress: No chapters available"}
    {@const chapterSummary = hasChapters
      ? `Chapters: ${book.chapters.length}`
      : "Chapters: Not available"}
    {@const conversionProgress = bookConversionProgress[book.id]}
    {@const isConverting = Boolean(conversionProgress)}
    {@const conversionPercent = conversionProgress && conversionProgress.totalWords > 0
      ? Math.min(100, Math.max(0, Math.round((conversionProgress.wordsProcessed / conversionProgress.totalWords) * 100)))
      : conversionProgress && conversionProgress.totalChapters > 0
        ? Math.min(100, Math.max(0, Math.round((conversionProgress.currentChapter / conversionProgress.totalChapters) * 100)))
        : 0}

    <div
      class={cn(
        isExiting ? "library-item-exit" : "library-item-enter",
        "opacity-0 animate-in fade-in-0 slide-in-from-bottom-2",
      )}
      style={`animation-delay: ${displayIndex * 20}ms`}
    >
      <div
        role="button"
        tabindex="0"
        onclick={() => onOpenBook(book.id)}
        onkeydown={(e) => handleKeyDown(e, book.id)}
        class={cn(
          "flex w-full items-center gap-4 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isActive && "bg-primary/5",
        )}
        aria-label="Open {book.title} by {book.author}"
      >
        <div class="relative h-16 w-12 overflow-hidden rounded-md bg-muted shrink-0">
          {#if book.coverUrl && !hasImageError[book.id]}
            {#if !isImageLoaded[book.id]}
              <div
                class="absolute inset-0 animate-shimmer bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%]"
              />
            {/if}
            <img
              src={book.coverUrl}
              alt="{book.title} cover"
              class={cn(
                "h-full w-full object-cover",
                isImageLoaded[book.id] ? "opacity-100" : "opacity-0",
              )}
              onload={() => {
                isImageLoaded = { ...isImageLoaded, [book.id]: true };
              }}
              onerror={() => {
                hasImageError = { ...hasImageError, [book.id]: true };
                isImageLoaded = { ...isImageLoaded, [book.id]: false };
              }}
            />
          {:else}
            <div class="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff class="h-6 w-6" />
            </div>
          {/if}
        </div>
        <div class="flex flex-1 flex-col gap-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="line-clamp-1 text-sm font-semibold text-foreground">
              {book.title}
            </span>
            <LibraryStatusBadge {status} class="shrink-0" />
          </div>
          <span class="line-clamp-1 text-xs text-muted-foreground">
            {book.author}
          </span>
          {#if isConverting && conversionProgress}
            <div class="space-y-1.5">
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted-foreground">
                  {conversionProgress.totalWords > 0
                    ? `${conversionProgress.wordsProcessed.toLocaleString()}/${conversionProgress.totalWords.toLocaleString()} words`
                    : `Converting: Chapter ${conversionProgress.currentChapter} of ${conversionProgress.totalChapters}`}
                </span>
                <span class="font-medium">{conversionPercent}%</span>
              </div>
              <Progress value={conversionPercent} class="h-1.5" />
              <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 class="h-3 w-3 animate-spin" />
                <span class="line-clamp-1">{conversionProgress.message}</span>
              </div>
            </div>
          {:else}
            <span class="line-clamp-1 text-xs text-muted-foreground">{progressText}</span>
            <span class="line-clamp-1 text-xs text-muted-foreground">
              {chapterSummary}
            </span>
          {/if}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onclick={(event) => {
            event.stopPropagation();
            onViewDetails(book.id);
          }}
          aria-label="View details for {book.title}"
          class="shrink-0"
        >
          Details
        </Button>
      </div>
    </div>
  {/each}
</div>

