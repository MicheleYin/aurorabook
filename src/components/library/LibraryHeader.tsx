import { LayoutGrid, List } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { anim } from "../../lib/animations";
import {
  LIBRARY_FILTER_OPTIONS,
  LIBRARY_VIEW_MODES,
  LIBRARY_FILTER_LABELS,
  type LibraryFilterOption,
  type LibraryViewMode,
} from "./types";

interface LibraryHeaderProps {
  totalBooks: number;
  filteredCount: number;
  isSearching: boolean;
  activeFilter: LibraryFilterOption;
  onFilterChange: (value: LibraryFilterOption) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (value: LibraryViewMode) => void;
  actionSlot?: ReactNode;
}

export function LibraryHeader({
  totalBooks,
  filteredCount,
  isSearching,
  activeFilter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  actionSlot,
}: LibraryHeaderProps) {
  const showCount = isSearching ? filteredCount : totalBooks;

  return (
    <div className="sticky top-0 z-20 flex flex-col gap-4 border-b border-border bg-background/95 -mx-4 -mt-6 px-4 pt-6 pb-4 backdrop-blur safe-area-top">
      <div className="flex flex-col gap-3">
          {actionSlot ? <div className="sm:ml-auto">{actionSlot}</div> : null}
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
          {LIBRARY_FILTER_OPTIONS.map((option) => {
            const isActive = option === activeFilter;
            const pressedProps = isActive
            ? ({ "aria-pressed": "true" } as const)
            : ({} as const);
            const label = LIBRARY_FILTER_LABELS[option];
            return (
              <button
              key={option}
              type="button"
              onClick={() => onFilterChange(option)}
              className={cn(
                "rounded-full border px-3 py-1",
                anim("normal", "colors"),
                isActive
                ? "border-primary bg-primary/5 text-primary"
                : "border-border hover:bg-muted",
              )}
              {...pressedProps}
              aria-label={`Filter by ${label}`}
              >
                {label}
              </button>
            );
          })}
          

          <div className="ml-auto flex items-center gap-1 text-muted-foreground">
            {LIBRARY_VIEW_MODES.map((mode) => {
              const isActive = mode === viewMode;
              const pressedProps = isActive
                ? ({ "aria-pressed": "true" } as const)
                : ({} as const);
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onViewModeChange(mode)}
                  className={cn(
                    "flex items-center justify-center rounded-md border px-2 py-1 text-muted-foreground",
                    anim("normal", "colors"),
                    isActive
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border hover:bg-muted",
                  )}
                  {...pressedProps}
                  aria-label={mode === "grid" ? "Switch to grid view" : "Switch to list view"}
                >
                  {mode === "grid" ? (
                    <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <List className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span className="sr-only">
                    {mode === "grid" ? "Grid view" : "List view"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
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
