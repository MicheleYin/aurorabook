import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { LIBRARY_FILTER_OPTIONS, type LibraryFilterOption } from "./types";

interface LibraryHeaderProps {
  totalBooks: number;
  filteredCount: number;
  isSearching: boolean;
  activeFilter: LibraryFilterOption;
  onFilterChange: (value: LibraryFilterOption) => void;
  actionSlot?: ReactNode;
}

export function LibraryHeader({
  totalBooks,
  filteredCount,
  isSearching,
  activeFilter,
  onFilterChange,
  actionSlot,
}: LibraryHeaderProps) {
  const showCount = isSearching ? filteredCount : totalBooks;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5 text-primary" />
          Library
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
          {LIBRARY_FILTER_OPTIONS.map((option) => {
            const isActive = option === activeFilter;
            const pressedProps = isActive
              ? ({ "aria-pressed": "true" } as const)
              : ({} as const);
            return (
              <button
                key={option}
                type="button"
                onClick={() => onFilterChange(option)}
                className={cn(
                  "rounded-full border px-3 py-1 transition",
                  isActive
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:bg-muted",
                )}
                {...pressedProps}
              >
                {option === "all" && "All books"}
                {option === "recent" && "Recently added"}
                {option === "author" && "By author"}
              </button>
            );
          })}
        </div>
        {actionSlot ? <div className="sm:ml-auto">{actionSlot}</div> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {totalBooks === 0
          ? "Import EPUB files to start building your shelf."
          : isSearching
            ? `${showCount} result${showCount === 1 ? "" : "s"} for your search.`
            : `${showCount} book${showCount === 1 ? "" : "s"} in your library.`}
      </p>
    </div>
  );
}
