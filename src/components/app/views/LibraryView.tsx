import { memo } from "react";
import { ErrorBoundary } from "../../ErrorBoundary";
import { LibraryPanel } from "../../LibraryPanel";
import type { Book } from "../../../types/reader";
import type { LibraryFilterOption, LibraryViewMode } from "../../library/types";
import type { ConversionProgress } from "../../../lib/audiobook-converter";

type LibraryViewProps = {
  library: Book[];
  totalBooks: number;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  activeFilter: LibraryFilterOption;
  onFilterChange: (filter: LibraryFilterOption) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (mode: LibraryViewMode) => void;
  activeBookId?: string;
  isImporting: boolean;
  onAddEbook: () => Promise<void>;
  onOpenBook: (bookId: string) => Promise<void>;
  onViewDetails: (bookId: string) => void;
  bookConversionProgress: Record<string, ConversionProgress>;
  conversionStartTimeRef: React.MutableRefObject<number | null>;
};

export const LibraryView = memo(function LibraryView({
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
  bookConversionProgress,
  conversionStartTimeRef,
}: LibraryViewProps) {
  return (
    <ErrorBoundary>
      <LibraryPanel
        library={library}
        totalBooks={totalBooks}
        searchTerm={searchTerm}
        onSearchChange={onSearchChange}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
        activeBookId={activeBookId}
        isImporting={isImporting}
        onAddEbook={onAddEbook}
        onOpenBook={onOpenBook}
        onViewDetails={onViewDetails}
        bookConversionProgress={bookConversionProgress}
        conversionStartTimeRef={conversionStartTimeRef}
      />
    </ErrorBoundary>
  );
});

