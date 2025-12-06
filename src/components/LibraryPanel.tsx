import { Plus, Loader2 } from "lucide-react";

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

export function LibraryPanel({
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
          <Button onClick={onAddEbook} disabled={isImporting} className="w-full sm:w-auto">
            {isImporting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
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
    </div>
  );
}

