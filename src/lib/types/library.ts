export type LibraryFilterOption =
  | "all"
  | "new"
  | "resume"
  | "finished"
  | "recent"
  | "author";

export const LIBRARY_FILTER_OPTIONS: readonly LibraryFilterOption[] = [
  "all",
  "new",
  "resume",
  "finished",
  "recent",
  "author",
] as const;

export const LIBRARY_FILTER_LABELS: Record<LibraryFilterOption, string> = {
  all: "All books",
  new: "New",
  resume: "Resume reading",
  finished: "Finished",
  recent: "Recently added",
  author: "By author",
};

export type LibraryViewMode = "grid" | "list";

export const LIBRARY_VIEW_MODES: readonly LibraryViewMode[] = ["grid", "list"] as const;

export type LibraryBookStatus = "new" | "resume" | "finished";

