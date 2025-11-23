import type { LibraryFilterOption } from "./types";

interface LibraryEmptyProps {
  isSearching: boolean;
  activeFilter: LibraryFilterOption;
}

export function LibraryEmpty({ isSearching, activeFilter }: LibraryEmptyProps) {
  const hasFilter = activeFilter !== "all";
  let title = "Your shelf is empty.";
  let description = "Import an EPUB to start reading.";

  if (isSearching) {
    title = "No books match your search.";
    description = "Try refining your keywords or search by author.";
  } else if (hasFilter) {
    title = "No books found for this filter.";
    description =
      activeFilter === "recent"
        ? "Add more books to see them here."
        : "Try another author filter or search by name.";
  }

  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
