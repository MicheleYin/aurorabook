<script lang="ts">
  import type { Book } from "$lib/types/reader";
  import type { ConversionProgress } from "$lib/types/conversion";
  import {
    cn,
    getBookProgressSummary,
    getLibraryBookStatusFromSummary,
  } from "$lib/utils";
  import BookCoverCard from "./BookCoverCard.svelte";

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
</script>

<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:flex 2xl:flex-wrap library-grid-transition">
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
        `2xl:w-[200px]`,
        // Stagger delay calculation
        `opacity-0 animate-in fade-in-0 slide-in-from-bottom-2`,
      )}
      style={`animation-delay: ${displayIndex * 30}ms`}
    >
      <BookCoverCard
        {book}
        {isActive}
        {status}
        {progressText}
        {chapterSummary}
        {isConverting}
        conversionProgress={conversionProgress}
        conversionPercent={conversionPercent}
        {onOpenBook}
        {onViewDetails}
        {handleKeyDown}
      />
    </div>
  {/each}
</div>

