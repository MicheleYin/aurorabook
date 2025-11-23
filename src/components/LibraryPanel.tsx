import { Plus } from "lucide-react";

import type { Book } from "../types/reader";
import { Button } from "./ui/button";
import { LibraryEmpty } from "./library/LibraryEmpty";
import { LibraryGrid } from "./library/LibraryGrid";
import { LibraryHeader } from "./library/LibraryHeader";
import { LibrarySearchBar } from "./library/LibrarySearchBar";
import type { LibraryFilterOption } from "./library/types";

export type LibraryPanelProps = {
  library: Book[];
  totalBooks: number;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  activeFilter: LibraryFilterOption;
  onFilterChange: (filter: LibraryFilterOption) => void;
  activeBookId?: string;
  isImporting: boolean;
  onAddEbook: () => void;
  onOpenBook: (bookId: string) => void;
};

export function LibraryPanel({
  library,
  totalBooks,
  searchTerm,
  onSearchChange,
  activeFilter,
  onFilterChange,
  activeBookId,
  isImporting,
  onAddEbook,
  onOpenBook,
}: LibraryPanelProps) {
  const isSearching = searchTerm.trim().length > 0;
  const hasBooks = library.length > 0;

  return (
    <div className="flex h-full flex-col gap-6">
      <LibraryHeader
        totalBooks={totalBooks}
        filteredCount={library.length}
        isSearching={isSearching}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        actionSlot={
          <Button onClick={onAddEbook} disabled={isImporting} className="w-full sm:w-auto">
            {isImporting ? (
              "Adding…"
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Add ebook
              </>
            )}
          </Button>
        }
      />

      <LibrarySearchBar
        value={searchTerm}
        onChange={onSearchChange}
        disabled={isImporting}
      />

      <div className="flex-1">
        {hasBooks ? (
          <LibraryGrid
            books={library}
            activeBookId={activeBookId}
            onOpenBook={onOpenBook}
          />
        ) : (
          <LibraryEmpty isSearching={isSearching} activeFilter={activeFilter} />
        )}
      </div>
    </div>
  );
}

