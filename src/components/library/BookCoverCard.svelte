<script lang="ts">
  import ImageOff from "@lucide/svelte/icons/image-off";
  import Loader2 from "@lucide/svelte/icons/loader-2";
  import type { Book } from "$lib/types/reader";
  import type { ConversionProgress } from "$lib/types/conversion";
  import { cn } from "$lib/utils";
  import { Button } from "$lib/components/ui/button";
  import { Progress } from "$lib/components/ui/progress";
  import LibraryStatusBadge from "./LibraryStatusBadge.svelte";
  import type { LibraryBookStatus } from "$lib/types/library";

  interface Props {
    book: Book;
    isActive: boolean;
    status: LibraryBookStatus;
    progressText: string;
    chapterSummary: string;
    isConverting: boolean;
    conversionProgress?: ConversionProgress;
    conversionPercent: number;
    onOpenBook: (bookId: string) => void;
    onViewDetails: (bookId: string) => void;
    handleKeyDown: (event: KeyboardEvent, bookId: string) => void;
  }

  let {
    book,
    isActive,
    status,
    progressText,
    chapterSummary,
    isConverting,
    conversionProgress,
    conversionPercent,
    onOpenBook,
    onViewDetails,
    handleKeyDown,
  }: Props = $props();

  let isImageLoaded = $state(false);
  let hasImageError = $state(false);
</script>

<div
  role="button"
  tabindex="0"
  onclick={() => onOpenBook(book.id)}
  onkeydown={(e) => handleKeyDown(e, book.id)}
  class={cn(
    "group flex h-full flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:shadow-md",
    isActive && "border-primary shadow-md ring-1 ring-primary/40",
  )}
  aria-label="Open {book.title} by {book.author}"
>
  <div class="relative aspect-[3/4] w-full overflow-hidden bg-muted">
    <LibraryStatusBadge {status} class="absolute left-2 top-2 z-10" />
    {#if book.coverUrl && !hasImageError}
      {#if !isImageLoaded}
        <div
          class="absolute inset-0 animate-shimmer bg-gradient-to-r from-muted via-muted/50 to-muted bg-[length:200%_100%]"
        />
      {/if}
      <img
        src={book.coverUrl}
        alt="{book.title} cover"
        class={cn(
          "h-full w-full object-cover transition-transform duration-300 group-hover:scale-105",
          isImageLoaded ? "opacity-100" : "opacity-0",
        )}
        onload={() => {
          isImageLoaded = true;
        }}
        onerror={() => {
          hasImageError = true;
          isImageLoaded = false;
        }}
      />
    {:else}
      <div class="flex h-full w-full items-center justify-center text-muted-foreground">
        <ImageOff class="h-10 w-10" />
      </div>
    {/if}
  </div>
  <div class="flex flex-1 flex-col gap-2 p-4">
    <div>
      <p class="line-clamp-1 text-sm font-semibold text-foreground">
        {book.title}
      </p>
      <p class="line-clamp-1 text-xs text-muted-foreground">{book.author}</p>
    </div>
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
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <div class="flex items-center gap-1.5">
            <Loader2 class="h-3 w-3 animate-spin" />
            <span class="line-clamp-1">{conversionProgress.message}</span>
          </div>
        </div>
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">{progressText}</p>
    {/if}
    <div class="mt-auto flex items-center justify-between text-xs text-muted-foreground">
      <div class="flex flex-col">
        <span>{chapterSummary}</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onclick={(event) => {
          event.stopPropagation();
          onViewDetails(book.id);
        }}
        aria-label="View details for {book.title}"
      >
        Details
      </Button>
    </div>
  </div>
</div>

