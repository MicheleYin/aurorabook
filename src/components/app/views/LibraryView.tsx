import { memo } from "react";
import { ErrorBoundary } from "../../ErrorBoundary";
import { LibraryGrid } from "../../library/LibraryGrid";
import { LibraryEmpty } from "../../library/LibraryEmpty";
import type { Book } from "../../../types/reader";

type LibraryViewProps = {
  books: Book[];
  onSelectBook: (bookId: string) => void;
};

export const LibraryView = memo(function LibraryView({
  books,
  onSelectBook,
}: LibraryViewProps) {
  if (books.length === 0) {
    return (
      <ErrorBoundary>
        <LibraryEmpty isSearching={false} activeFilter="all" />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <div className="p-4">
        <LibraryGrid
          books={books}
          activeBookId={undefined}
          onOpenBook={onSelectBook}
          onViewDetails={() => {}} // Simplified - no details view
          bookConversionProgress={{}}
        />
      </div>
    </ErrorBoundary>
  );
});
