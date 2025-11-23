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
    switch (activeFilter) {
      case "new":
        title = "No new books right now.";
        description = "Import a book or clear your progress to see it here.";
        break;
      case "resume":
        title = "Nothing to resume.";
        description = "Start reading a book and your in-progress titles show up here.";
        break;
      case "finished":
        title = "No finished books yet.";
        description = "Finish a book to celebrate it in this view.";
        break;
      case "recent":
        title = "No recent imports.";
        description = "Add more books to see them here.";
        break;
      case "author":
        title = "No books found for this author.";
        description = "Try another author filter or search by name.";
        break;
      default:
        title = "No books found for this filter.";
        description = "Try switching filters or search by title.";
    }
  }

  return (
    <div className="rounded-md border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
