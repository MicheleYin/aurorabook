import { Plus, Loader2 } from "lucide-react";
import { memo } from "react";

import type { Book } from "../types/reader";
import type { ConversionProgress } from "../lib/audiobook-converter";
import { Button } from "./ui/button";
import { LibraryEmpty } from "./library/LibraryEmpty";
import { LibraryGrid } from "./library/LibraryGrid";
import { LibraryHeader } from "./library/LibraryHeader";
import { LibraryList } from "./library/LibraryList";
import { LibrarySearchBar } from "./library/LibrarySearchBar";
import type { LibraryFilterOption, LibraryViewMode } from "./library/types";

export type LibraryPanelProps = {
  library: Book[];
  totalBooks: number;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  activeFilter: LibraryFilterOption;
  onFilterChange: (filter: LibraryFilterOption) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (mode: LibraryViewMode) => void;
  activeBookId?: string;
  isImporting: boolean;
  onAddEbook: () => void;
  onOpenBook: (bookId: string) => void;
  onViewDetails: (bookId: string) => void;
  bookConversionProgress?: Record<string, ConversionProgress>;
  conversionStartTimeRef?: React.MutableRefObject<number | null>;
};

function LibraryPanelComponent({
  library,
  totalBooks,
  searchTerm,
  onSearchChange,
  activeFilter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  activeBookId,
  isImporting,
  onAddEbook,
  onOpenBook,
  onViewDetails,
  bookConversionProgress = {},
  conversionStartTimeRef,
}: LibraryPanelProps) {
  const isSearching = searchTerm.trim().length > 0;
  const hasBooks = library.length > 0;

  return (
    <div className="flex h-full flex-col">
      <LibraryHeader
        totalBooks={totalBooks}
        filteredCount={library.length}
        isSearching={isSearching}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        actionSlot={
          <Button onClick={onAddEbook} disabled={isImporting} className="w-full sm:w-auto" aria-label="Add ebook to library">
            {isImporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                Add ebook
              </>
            )}
          </Button>
        }
      />

      <div className="pt-6">
        <LibrarySearchBar
        value={searchTerm}
        onChange={onSearchChange}
        disabled={isImporting}
        />
      </div>

      <div className="flex-1 pt-6">
        {hasBooks ? (
          viewMode === "grid" ? (
            <LibraryGrid
              key="grid"
              books={library}
              activeBookId={activeBookId}
              onOpenBook={onOpenBook}
              onViewDetails={onViewDetails}
              bookConversionProgress={bookConversionProgress}
              conversionStartTimeRef={conversionStartTimeRef}
            />
          ) : (
            <LibraryList
              key="list"
              books={library}
              activeBookId={activeBookId}
              onOpenBook={onOpenBook}
              onViewDetails={onViewDetails}
              bookConversionProgress={bookConversionProgress}
              conversionStartTimeRef={conversionStartTimeRef}
            />
          )
        ) : (
          <LibraryEmpty isSearching={isSearching} activeFilter={activeFilter} />
        )}
      </div>

      <div className="pb-10"></div>
    </div>
  );
}

export const LibraryPanel = memo(LibraryPanelComponent, (prevProps, nextProps) => {
  // Compare primitive props
  if (
    prevProps.totalBooks !== nextProps.totalBooks ||
    prevProps.searchTerm !== nextProps.searchTerm ||
    prevProps.activeFilter !== nextProps.activeFilter ||
    prevProps.viewMode !== nextProps.viewMode ||
    prevProps.activeBookId !== nextProps.activeBookId ||
    prevProps.isImporting !== nextProps.isImporting
  ) {
    return false;
  }
  
  // Compare library array - check length and IDs
  if (prevProps.library.length !== nextProps.library.length) return false;
  const libraryChanged = prevProps.library.some((book, index) => {
    const nextBook = nextProps.library[index];
    return !nextBook || book.id !== nextBook.id || book !== nextBook;
  });
  if (libraryChanged) return false;
  
  // Compare callbacks
  if (
    prevProps.onSearchChange !== nextProps.onSearchChange ||
    prevProps.onFilterChange !== nextProps.onFilterChange ||
    prevProps.onViewModeChange !== nextProps.onViewModeChange ||
    prevProps.onAddEbook !== nextProps.onAddEbook ||
    prevProps.onOpenBook !== nextProps.onOpenBook ||
    prevProps.onViewDetails !== nextProps.onViewDetails
  ) {
    return false;
  }
  
  // Compare conversion progress - check if any book's progress changed
  const prevProgressKeys = Object.keys(prevProps.bookConversionProgress || {});
  const nextProgressKeys = Object.keys(nextProps.bookConversionProgress || {});
  if (prevProgressKeys.length !== nextProgressKeys.length) return false;
  for (const key of prevProgressKeys) {
    const prevProgress = prevProps.bookConversionProgress?.[key];
    const nextProgress = nextProps.bookConversionProgress?.[key];
    if (prevProgress !== nextProgress) return false;
  }
  
  // Compare ref
  if (prevProps.conversionStartTimeRef !== nextProps.conversionStartTimeRef) return false;
  
  return true;
});

