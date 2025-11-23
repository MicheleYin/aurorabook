export type LibraryFilterOption = "all" | "recent" | "author";

export const LIBRARY_FILTER_OPTIONS: readonly LibraryFilterOption[] = [
  "all",
  "recent",
  "author",
];

export type LibraryViewMode = "grid" | "list";

export const LIBRARY_VIEW_MODES: readonly LibraryViewMode[] = ["grid", "list"];
